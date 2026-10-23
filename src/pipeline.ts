// Pipeline stage-machine engine. `card.step.after` is the primary driver
// (re-run the engine for the card's project whenever one of its cards
// changes step); `timer.tick` is the safety net for a stage that stalled
// without a card transition reaching us (plugin restart, a dropped event).
//
// The engine owns one `EngineState` doc per project (collection "engine",
// src/docs.ts getEngine/putEngine) tracking a flat map of `Unit`s — one per
// board card it created (a stage's card, a chapter draft, a review pass, a
// revision). A unit's `id` is a stable key the engine never reuses for
// different work; a retry resets the SAME record in place (new `attempt`,
// cleared `card_id`) instead of minting a new id, so "does this unit
// already have a card" is always a single lookup — the core of this
// engine's idempotency.
//
// Every mutating entry point (the two hooks, and the request* functions
// src/http.ts's /pipeline/* routes call) funnels into `runEngine`, which:
//   1. reconciles OPEN units with their cards — from the card.step.after
//      payload itself, or (timer.tick, throttled) the full card list —
//      applying kind-specific side effects (a finished "generate" unit
//      copies its draft into the brief);
//   2. materializes any pending "revision:fb:*" units (owner feedback can
//      land in any stage from pilot_review onward);
//   3. repeatedly tries to advance the current stage (create the next
//      units, or cross to the next stage once the current one's units are
//      all done) until nothing more fits in the call's budget.
//
// Budget: a wall-clock deadline plus a max-creates-per-call counter, so one
// hook invocation can never create an unbounded number of cards or run
// past core's 2 s default call budget. Whatever doesn't fit resumes on the
// next event or timer.tick.

import { errMsg, skip } from "./verdict";
import { Card, CreateCardInput, createCard, getPluginSetting, listCards, updateCard } from "./host";
import {
  addFeedback,
  getBrief,
  getChapter,
  getEngine,
  getFeedback,
  getPipelineState,
  listChapters,
  listEngines,
  getReview,
  putBrief,
  putCards,
  putEngine,
  putPipelineState,
} from "./docs";
import { PromptBrief, PromptFeedback, StageKind, draftKey, renderCard } from "./prompts";
import {
  Brief,
  CardRef,
  ELEMENT_KEYS,
  ElementKey,
  EngineState,
  Feedback,
  MAX_REVIEW_ROUNDS,
  REVIEW_PASSES,
  ReviewCursor,
  ReviewPass,
  ReviewRound,
  ReviewVerdict,
  STAGES,
  StageId,
  StageStatus,
  StoryElements,
  Unit,
  nowIso,
} from "./types";

// ── Budget ───────────────────────────────────────────────────────────────

// Core's default per-call budget is 2 s; keep every hook/route invocation
// (store reads/writes + card creates) comfortably inside it.
const CREATE_BUDGET_MS = 1200;
const TIMER_BUDGET_MS = 1200; // shared across every project in one timer.tick
const MAX_CREATES_PER_RUN = 8;
// list_cards returns every card with its full (up to ~48 KB) description, so
// the hot path never calls it; timer.tick's safety-net sweep is throttled.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
// ~17 units per chapter (draft + 8 review passes + up to 8 revisions) keeps
// the engine and cards docs well under core's 256 KiB per-doc cap.
export const MAX_CHAPTERS = 40;

interface Budget {
  deadline: number;
  createsLeft: number;
}

function newBudget(ms = CREATE_BUDGET_MS, creates = MAX_CREATES_PER_RUN): Budget {
  return { deadline: Date.now() + ms, createsLeft: creates };
}

function hasBudget(b: Budget): boolean {
  return b.createsLeft > 0 && Date.now() < b.deadline;
}

// ── Run context ──────────────────────────────────────────────────────────

interface Ctx {
  projectId: string;
  brief: Brief | null;
  feedback: Feedback[];
  engine: EngineState;
  budget: Budget;
  dirty: boolean;
  wroteAhead: boolean; // this run persisted engine.in_flight before creating a card
}

function toPromptBrief(brief: Brief | null): PromptBrief | null {
  return brief as unknown as PromptBrief | null;
}

function toPromptFeedback(feedback: Feedback[]): PromptFeedback[] {
  return feedback.map((f) => ({ source: f.source, chapter: f.chapter, text: f.text, at: f.at }));
}

function chapterCountOf(ctx: Ctx): number {
  return ctx.brief?.basics?.chapter_count ?? 1;
}

// ── Unit lifecycle ───────────────────────────────────────────────────────

interface UnitSpec {
  id: string;
  kind: StageKind;
  priority: number;
  chapter?: number;
  pass?: ReviewPass;
  element?: ElementKey;
  blocked?: boolean;
  blockReason?: string;
  feedbackText?: string;
}

function unitMarker(id: string, attempt: number): string {
  return `<!-- story-writer:unit=${id}#${attempt} -->`;
}

function modelFor(role: "writer" | "reviewer"): string | undefined {
  const raw = getPluginSetting(role === "writer" ? "writer_model" : "reviewer_model");
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/// Create a card, retrying once without a model if the host rejects it
/// (e.g. the configured writer_model/reviewer_model setting names a model
/// that no longer exists) rather than failing the whole engine run.
function createCardSafe(ctx: Ctx, input: CreateCardInput): Card {
  try {
    return createCard(input);
  } catch (e) {
    if (!input.model) throw e;
    const { model, ...rest } = input;
    const card = createCard(rest);
    ctx.engine.note = `model '${model}' was rejected for '${input.title}' (${errMsg(e)}) — created without a model`;
    return card;
  }
}

/// Turn a pending unit (status "open", no card yet) into a real card.
/// Before the run's first create, `in_flight` is persisted so that a run
/// dying between createCard and the final putEngine is detected next time
/// (`adoptOrphans`). No-ops if the budget is spent; the next run retries.
function materialize(ctx: Ctx, unit: Unit, spec: UnitSpec): void {
  if (!hasBudget(ctx.budget)) return;
  const marker = unitMarker(unit.id, unit.attempt);

  const rendered = renderCard(spec.kind, {
    brief: toPromptBrief(ctx.brief),
    feedback: toPromptFeedback(ctx.feedback),
    chapter: spec.chapter,
    pass: spec.pass,
    element: spec.element,
    feedbackText: spec.feedbackText,
  });
  const description = `${rendered.description}\n\n${marker}`;
  const model = modelFor(rendered.role);
  const input: CreateCardInput = {
    project_id: ctx.projectId,
    title: rendered.title,
    description,
    priority: spec.priority,
    blocked: spec.blocked,
    block_reason: spec.blockReason,
  };
  if (model) input.model = model;

  if (!ctx.wroteAhead) {
    ctx.engine.in_flight = true;
    putEngine(ctx.projectId, ctx.engine);
    ctx.wroteAhead = true;
  }
  const created = createCardSafe(ctx, input);
  unit.card_id = created.id;
  unit.updated_at = nowIso();
  ctx.budget.createsLeft -= 1;
  ctx.dirty = true;
}

/// Register `spec`'s unit if it doesn't exist yet, then materialize its
/// card if it's pending. Idempotent: calling this again for the same id
/// once a card exists (or the unit has failed) is a no-op beyond the
/// lookup, which is what makes every stage-advance function safe to call
/// on every engine run regardless of what already happened.
function ensureUnit(ctx: Ctx, spec: UnitSpec): Unit {
  let unit = ctx.engine.units[spec.id];
  if (!unit) {
    const now = nowIso();
    unit = {
      id: spec.id,
      kind: spec.kind,
      status: "open",
      card_id: null,
      attempt: 1,
      chapter: spec.chapter,
      pass: spec.pass,
      element: spec.element,
      created_at: now,
      updated_at: now,
    };
    ctx.engine.units[spec.id] = unit;
    ctx.dirty = true;
  }
  if (unit.status === "open" && unit.card_id === null) {
    materialize(ctx, unit, spec);
  }
  return unit;
}

/// Reset a unit for a retry: same id, new attempt, no card — the next
/// `ensureUnit`/`materialize` call mints it a fresh card (with a new
/// marker, so it can never be confused with the one that failed).
function resetUnit(ctx: Ctx, id: string): void {
  const unit = ctx.engine.units[id];
  if (!unit) return;
  unit.status = "open";
  unit.card_id = null;
  unit.attempt += 1;
  unit.note = undefined;
  unit.updated_at = nowIso();
  ctx.dirty = true;
}

// ── Reconciliation ───────────────────────────────────────────────────────

/// The previous run died between creating a card and persisting its id
/// (`in_flight` left set): match every pending unit to its card by marker
/// instead of creating a duplicate.
function adoptOrphans(ctx: Ctx): void {
  if (!ctx.engine.in_flight) return;
  const pending = Object.values(ctx.engine.units).filter((u) => u.status === "open" && u.card_id === null);
  if (pending.length > 0) {
    const cards = listCards(ctx.projectId);
    for (const unit of pending) {
      const marker = unitMarker(unit.id, unit.attempt);
      const card = cards.find((c) => typeof c.description === "string" && c.description.includes(marker));
      if (card) {
        unit.card_id = card.id;
        unit.updated_at = nowIso();
      }
    }
  }
  ctx.engine.in_flight = false;
  ctx.dirty = true;
}

/// card.step.after names the card and its new step — apply just that.
function reconcileEvent(ctx: Ctx, cardId: string, newStep: string): void {
  if (newStep !== "done" && newStep !== "wont_do") return;
  const unit = Object.values(ctx.engine.units).find((u) => u.card_id === cardId && u.status === "open");
  if (!unit) return;
  if (newStep === "done") completeUnit(ctx, unit);
  else failUnit(unit, "card marked won't-do");
  ctx.dirty = true;
}

/// timer.tick's safety net for a dropped card.step.after or a deleted card.
function reconcileSweep(ctx: Ctx): void {
  const open = Object.values(ctx.engine.units).filter((u) => u.status === "open" && u.card_id !== null);
  if (open.length === 0 || Date.now() >= ctx.budget.deadline) return;
  const last = ctx.engine.swept_at ? Date.parse(ctx.engine.swept_at) : 0;
  if (Date.now() - last < SWEEP_INTERVAL_MS) return;
  const byId = new Map(listCards(ctx.projectId).map((c) => [c.id, c]));
  for (const unit of open) {
    const card = byId.get(unit.card_id as string);
    if (!card) failUnit(unit, "card not found (deleted?)");
    else if (card.step === "done") completeUnit(ctx, unit);
    else if (card.step === "wont_do") failUnit(unit, "card marked won't-do");
  }
  ctx.engine.swept_at = nowIso();
  ctx.dirty = true;
}

function failUnit(unit: Unit, note: string): void {
  unit.status = "failed";
  unit.note = note;
  unit.updated_at = nowIso();
}

function completeUnit(ctx: Ctx, unit: Unit): void {
  unit.status = "done";
  unit.updated_at = nowIso();
  if (unit.kind === "generate" && unit.element) {
    applyGenerateResult(ctx, unit.element);
  }
}

/// A finished "generate" card pushes its draft through
/// `story_update_state {data: {draft_<element>: value}}` (src/prompts
/// contract.ts `draftKey`). Pull it into the brief for the wizard to show,
/// marking the element `ai_draft` (needs owner review) — or `empty` with a
/// note if the worker finished the card without pushing anything.
function applyGenerateResult(ctx: Ctx, element: ElementKey): void {
  if (!ctx.brief) return;
  const state = getPipelineState(ctx.projectId);
  const key = draftKey(element);
  const draft = state.data[key];
  const nextStatus = { ...ctx.brief.status };
  if (draft === undefined) {
    nextStatus[element] = "empty";
    ctx.engine.note = `generate card for ${element} finished without a draft`;
  } else {
    ctx.brief = { ...ctx.brief, elements: { ...ctx.brief.elements, [element]: draft } as StoryElements };
    nextStatus[element] = "ai_draft";
  }
  ctx.brief = { ...ctx.brief, status: nextStatus, updated_at: nowIso() };
  putBrief(ctx.projectId, ctx.brief);
  const { [key]: _droppedDraft, ...restData } = state.data;
  putPipelineState(ctx.projectId, { ...state, data: restData, updated_at: nowIso() });
}

/// Owner feedback (pilot or any chapter) creates a "revision:fb:*" unit
/// outside any particular stage — materialize whichever are still pending,
/// independent of the stage-advance switch below.
function materializeFeedbackRevisions(ctx: Ctx): void {
  for (const unit of Object.values(ctx.engine.units)) {
    if (!unit.id.startsWith("revision:fb:")) continue;
    if (unit.status !== "open" || unit.card_id !== null) continue;
    if (!hasBudget(ctx.budget)) return;
    const feedbackId = unit.id.slice("revision:fb:".length);
    const fb = ctx.feedback.find((f) => f.id === feedbackId);
    const text = fb?.text ?? "Owner feedback — see story_get_brief.";
    materialize(ctx, unit, { id: unit.id, kind: "revision", chapter: unit.chapter, priority: 1, feedbackText: text });
  }
}

// ── Stage advance ────────────────────────────────────────────────────────

/// Try to make ONE unit of forward progress for the current stage. Returns
/// true when something actually changed (a card got created, or the stage
/// boundary was crossed) so `runEngine`'s loop keeps going; false means
/// "nothing more to do until the next event" — stop.
function advanceStage(ctx: Ctx): boolean {
  switch (ctx.engine.stage) {
    case "setup":
      return advanceSetup(ctx);
    case "records":
      return advanceRecords(ctx);
    case "pilot":
      return advancePilot(ctx);
    case "pilot_review":
      return false; // owner-gated: /pipeline/approve or /pipeline/feedback
    case "chapters":
      return advanceChapters(ctx);
    case "review":
      return advanceReview(ctx);
    case "final":
      return false;
  }
}

/// Setup never auto-advances to "records" (that's the explicit
/// /pipeline/start action) — it only keeps materializing any pending
/// AI-generate-element cards the wizard queued.
function advanceSetup(ctx: Ctx): boolean {
  let progressed = false;
  for (const unit of Object.values(ctx.engine.units)) {
    if (unit.kind !== "generate" || unit.status !== "open" || unit.card_id !== null) continue;
    if (!hasBudget(ctx.budget)) break;
    materialize(ctx, unit, { id: unit.id, kind: "generate", priority: 2, element: unit.element });
    if (unit.card_id !== null) progressed = true;
  }
  return progressed;
}

function advanceRecords(ctx: Ctx): boolean {
  const unit = ensureUnit(ctx, { id: "records", kind: "records", priority: 2 });
  if (unit.status !== "done") return false;
  ctx.engine.stage = "pilot";
  ctx.dirty = true;
  return true;
}

/// Queues the pilot card and the (blocked) parallel chapter cards 2..N up
/// front, so the blocked cards are visible on the board before the owner
/// approves — not created only at approval time.
function advancePilot(ctx: Ctx): boolean {
  const n = chapterCountOf(ctx);
  const pilot = ensureUnit(ctx, { id: "pilot", kind: "pilot", chapter: 1, priority: 1 });
  for (let i = 2; i <= n; i++) {
    if (!hasBudget(ctx.budget)) break;
    ensureUnit(ctx, {
      id: `chapter:${i}`,
      kind: "chapter",
      chapter: i,
      priority: 2,
      blocked: true,
      blockReason: "Waiting for the owner to approve the pilot chapter",
    });
  }
  if (pilot.status !== "done") return false;
  ctx.engine.stage = "pilot_review";
  ctx.dirty = true;
  return true;
}

function advanceChapters(ctx: Ctx): boolean {
  const n = chapterCountOf(ctx);
  let allDone = true;
  for (let i = 2; i <= n; i++) {
    const unit = ensureUnit(ctx, { id: `chapter:${i}`, kind: "chapter", chapter: i, priority: 2, blocked: false });
    if (unit.status !== "done") allDone = false;
  }
  if (!allDone) return false;
  if (Object.values(ctx.engine.units).some((u) => u.kind === "revision" && u.status === "open")) return false;
  ctx.engine.stage = "review";
  for (let i = 1; i <= n; i++) {
    ctx.engine.cursors[String(i)] = { chapter: i, pass_index: 0, round: 1, waiting: "review" };
  }
  ctx.dirty = true;
  return true;
}

function advanceReview(ctx: Ctx): boolean {
  const n = chapterCountOf(ctx);
  let progressed = false;
  let allDone = true;
  for (let i = 1; i <= n; i++) {
    const key = String(i);
    let cursor = ctx.engine.cursors[key];
    if (!cursor) {
      cursor = { chapter: i, pass_index: 0, round: 1, waiting: "review" };
      ctx.engine.cursors[key] = cursor;
      ctx.dirty = true;
    }
    if (cursor.waiting === "done") continue;
    allDone = false;
    if (advanceCursor(ctx, cursor)) progressed = true;
  }
  if (allDone) {
    ctx.engine.stage = "final";
    ctx.engine.finished = true;
    ctx.dirty = true;
    return true;
  }
  return progressed;
}

function latestReview(projectId: string, chapter: number, pass: ReviewPass): ReviewRound | null {
  const doc = getReview(projectId, chapter, pass);
  if (!doc || doc.rounds.length === 0) return null;
  return doc.rounds[doc.rounds.length - 1];
}

function latestReviewVerdict(projectId: string, chapter: number, pass: ReviewPass): ReviewVerdict | null {
  return latestReview(projectId, chapter, pass)?.verdict ?? null;
}

function latestReviewNotes(projectId: string, chapter: number, pass: ReviewPass): string {
  return latestReview(projectId, chapter, pass)?.notes ?? `Review pass "${pass}" requested changes for chapter ${chapter}.`;
}

/// One chapter's review-pass chain: structure -> character -> ... ->
/// sentence-shape, each pass allowed up to MAX_REVIEW_ROUNDS attempts
/// (changes_requested -> a revision card -> the same pass again) before
/// moving on regardless, so one stubborn pass can't stall a chapter
/// forever. A pass with no report at all is treated as a pass.
function advanceCursor(ctx: Ctx, cursor: ReviewCursor): boolean {
  const pass = REVIEW_PASSES[cursor.pass_index];
  if (cursor.waiting === "review") {
    const unit = ensureUnit(ctx, { id: `review:${cursor.chapter}:${pass}`, kind: "review", chapter: cursor.chapter, pass, priority: 2 });
    if (unit.status !== "done") return false;

    const verdict = latestReviewVerdict(ctx.projectId, cursor.chapter, pass);
    if (verdict === "changes_requested" && cursor.round < MAX_REVIEW_ROUNDS) {
      cursor.waiting = "revision";
      ctx.dirty = true;
      return true;
    }
    cursor.pass_index += 1;
    cursor.round = 1;
    cursor.waiting = cursor.pass_index >= REVIEW_PASSES.length ? "done" : "review";
    ctx.dirty = true;
    return true;
  }

  // waiting === "revision"
  const notes = latestReviewNotes(ctx.projectId, cursor.chapter, pass);
  const unit = ensureUnit(ctx, { id: `revision:review:${cursor.chapter}:${pass}`, kind: "revision", chapter: cursor.chapter, priority: 1, feedbackText: notes });
  if (unit.status !== "done") return false;

  cursor.round += 1;
  cursor.waiting = "review";
  resetUnit(ctx, `review:${cursor.chapter}:${pass}`); // fresh card for the retry
  ctx.dirty = true;
  return true;
}

// ── Dashboard mirror ─────────────────────────────────────────────────────

function stageOfKind(kind: StageKind): StageId {
  switch (kind) {
    case "generate":
      return "setup";
    case "records":
      return "records";
    case "pilot":
      return "pilot";
    case "chapter":
      return "chapters";
    case "review":
    case "revision":
      return "review";
  }
}

function syncCardsMirror(ctx: Ctx): void {
  const refs: CardRef[] = Object.values(ctx.engine.units)
    .filter((u): u is Unit & { card_id: string } => u.card_id !== null)
    .map((u) => ({
      card_id: u.card_id,
      stage: stageOfKind(u.kind),
      kind: u.kind,
      chapter: u.chapter,
      pass: u.pass,
      element: u.element,
      status: u.status,
      created_at: u.created_at,
      updated_at: u.updated_at,
    }));
  putCards(ctx.projectId, refs);
}

/// The engine owns PipelineState's top-level stage (workers only report
/// per-stage notes through story_update_state); mirror it after each run.
function syncPipelineStage(ctx: Ctx): void {
  const state = getPipelineState(ctx.projectId);
  const stage = ctx.engine.stage;
  const failed = Object.values(ctx.engine.units).find((u) => u.status === "failed");
  const status: StageStatus = ctx.engine.finished ? "done" : failed ? "blocked" : "active";
  const now = nowIso();
  const stages = { ...state.stages };
  let changed = state.stage !== stage;
  for (const s of STAGES.slice(0, STAGES.indexOf(stage))) {
    if (stages[s]?.status === "done") continue;
    stages[s] = { ...stages[s], status: "done", updated_at: now };
    changed = true;
  }
  const prior = stages[stage];
  const note = failed ? `${failed.id}: ${failed.note ?? "failed"} — retry it from the dashboard` : prior?.note;
  if (prior?.status !== status || prior?.note !== note) {
    stages[stage] = { status, note, updated_at: now };
    changed = true;
  }
  if (changed) putPipelineState(ctx.projectId, { ...state, stage, stages, updated_at: now });
}

// ── Entry points ─────────────────────────────────────────────────────────

export interface RunTrigger {
  event?: { card_id: string; new_step: string }; // card.step.after
  sweep?: boolean; // timer.tick
}

/// Run the engine for one project: reconcile, materialize feedback
/// revisions, then advance the stage machine until nothing more fits in
/// `budget`. Never throws — a failure is recorded on `engine.note` instead
/// of trapping the plugin.
export function runEngine(projectId: string, budget: Budget = newBudget(), trigger: RunTrigger = {}): void {
  const ctx: Ctx = {
    projectId,
    brief: getBrief(projectId),
    feedback: getFeedback(projectId),
    engine: getEngine(projectId),
    budget,
    dirty: false,
    wroteAhead: false,
  };
  try {
    adoptOrphans(ctx);
    if (trigger.event) reconcileEvent(ctx, trigger.event.card_id, trigger.event.new_step);
    if (trigger.sweep) reconcileSweep(ctx);
    materializeFeedbackRevisions(ctx);
    let progressed = true;
    while (progressed && hasBudget(ctx.budget)) {
      progressed = advanceStage(ctx);
    }
  } catch (e) {
    ctx.engine.note = `engine error: ${errMsg(e)}`;
    ctx.dirty = true;
  } finally {
    if (ctx.wroteAhead) ctx.engine.in_flight = false;
    if (ctx.dirty) {
      ctx.engine.updated_at = nowIso();
      putEngine(ctx.projectId, ctx.engine);
      syncCardsMirror(ctx);
      syncPipelineStage(ctx);
    }
  }
}

/// Only a pipeline card reaching done/wont_do can move the engine, so every
/// other card transition on the board costs a single store read.
export function onCardStepAfter(payload: any): string {
  const projectId = typeof payload?.project_id === "string" ? payload.project_id : "";
  const cardId = typeof payload?.card_id === "string" ? payload.card_id : "";
  const newStep = typeof payload?.new_step === "string" ? payload.new_step : "";
  if (!projectId || !cardId || (newStep !== "done" && newStep !== "wont_do")) return skip();
  try {
    const engine = getEngine(projectId);
    if (Object.values(engine.units).some((u) => u.card_id === cardId && u.status === "open")) {
      runEngine(projectId, newBudget(), { event: { card_id: cardId, new_step: newStep } });
    }
  } catch (_e) {
    // runEngine already swallows its own errors into engine.note; this
    // is defense in depth only — a hook must never trap the plugin.
  }
  return skip();
}

export function onTimerTick(_payload: any): string {
  const deadline = Date.now() + TIMER_BUDGET_MS;
  try {
    for (const { projectId, engine } of listEngines()) {
      if (Date.now() >= deadline) break;
      if (engine.finished) continue;
      try {
        runEngine(projectId, { deadline, createsLeft: MAX_CREATES_PER_RUN }, { sweep: true });
      } catch (_e) {
        // one project's failure must not stall every other project's tick.
      }
    }
  } catch (_e) {
    // listing engine docs failed; the next tick retries.
  }
  return skip();
}

// ── Owner/wizard actions (src/http.ts /pipeline/* routes) ────────────────

/// The request is valid but the pipeline's current state doesn't allow it
/// (wrong stage, a blocking card still open) — the routes answer 409.
export class PipelineConflict extends Error {}

/// Queue AI-generate-element cards for every requested element whose mode
/// is "draft"/"generate" (default: every such element) and that isn't
/// already pending. Marks each element `awaiting_ai` until its card
/// returns a draft for the wizard to review.
export function requestGenerate(projectId: string, elements?: string[]): { ok: true; queued: ElementKey[] } {
  const brief = getBrief(projectId);
  if (!brief) throw new Error("set up the brief before generating elements");
  const wanted: readonly string[] = Array.isArray(elements) && elements.length > 0 ? elements : ELEMENT_KEYS;
  const engine = getEngine(projectId);
  const queued: ElementKey[] = [];
  const nextStatus = { ...brief.status };

  for (const raw of wanted) {
    if (!(ELEMENT_KEYS as readonly string[]).includes(raw)) throw new Error(`unknown element: ${raw}`);
    const el = raw as ElementKey;
    const mode = brief.modes?.[el];
    if (mode !== "draft" && mode !== "generate") continue;
    const id = `generate:${el}`;
    const existing = engine.units[id];
    if (existing && existing.status === "open") continue;
    const now = nowIso();
    engine.units[id] = {
      id,
      kind: "generate",
      status: "open",
      card_id: null,
      attempt: (existing?.attempt ?? 0) + 1,
      element: el,
      created_at: now,
      updated_at: now,
    };
    nextStatus[el] = "awaiting_ai";
    queued.push(el);
  }

  if (queued.length > 0) {
    putBrief(projectId, { ...brief, status: nextStatus, updated_at: nowIso() });
    putEngine(projectId, engine);
    runEngine(projectId);
  }
  return { ok: true, queued };
}

/// Move the pipeline from "setup" to "records", gated on: a brief with at
/// least one chapter, every draft/generate element reviewed to "approved",
/// and no AI-generate card still running.
export function requestStart(projectId: string): { ok: true } {
  const brief = getBrief(projectId);
  if (!brief) throw new Error("set up the brief before starting the pipeline");
  if (!brief.basics || !brief.basics.chapter_count || brief.basics.chapter_count < 1) {
    throw new Error("basics.chapter_count must be at least 1");
  }
  if (brief.basics.chapter_count > MAX_CHAPTERS) {
    throw new Error(`basics.chapter_count must be at most ${MAX_CHAPTERS}`);
  }
  const engine = getEngine(projectId);
  if (engine.stage !== "setup") throw new PipelineConflict(`pipeline already started (stage: ${engine.stage})`);

  for (const el of ELEMENT_KEYS) {
    const mode = brief.modes?.[el];
    if (mode !== "draft" && mode !== "generate") continue;
    const status = brief.status?.[el];
    if (status !== "approved") {
      throw new PipelineConflict(`${el} needs owner review before starting (status: ${status ?? "empty"})`);
    }
  }
  for (const unit of Object.values(engine.units)) {
    if (unit.kind === "generate" && unit.status === "open") {
      throw new PipelineConflict(`generate card for ${unit.element} is still running`);
    }
  }

  engine.stage = "records";
  engine.updated_at = nowIso();
  putEngine(projectId, engine);
  runEngine(projectId);
  return { ok: true };
}

/// Owner approves the pilot: unblocks the queued parallel chapter cards
/// (re-rendering their description so any brief/rule edits made while
/// waiting are picked up) and advances to "chapters". Refused while a
/// pilot revision from feedback is still open — the owner should see the
/// revised pilot before committing the rest of the book to it.
export function requestApprove(projectId: string): { ok: true } {
  const engine = getEngine(projectId);
  if (engine.stage !== "pilot_review") {
    throw new PipelineConflict(`cannot approve from stage '${engine.stage}' (must be pilot_review)`);
  }
  const openPilotRevision = Object.values(engine.units).some((u) => u.kind === "revision" && u.chapter === 1 && u.status === "open");
  if (openPilotRevision) throw new PipelineConflict("a pilot revision is still open — wait for it to finish before approving");

  engine.approved = true;
  engine.stage = "chapters";
  engine.updated_at = nowIso();

  const brief = getBrief(projectId);
  const feedback = getFeedback(projectId);
  for (const unit of Object.values(engine.units)) {
    if (unit.kind !== "chapter" || !unit.card_id) continue;
    try {
      const rendered = renderCard("chapter", { brief: toPromptBrief(brief), feedback: toPromptFeedback(feedback), chapter: unit.chapter });
      updateCard({ card_id: unit.card_id, description: `${rendered.description}\n\n${unitMarker(unit.id, unit.attempt)}`, blocked: false });
    } catch (e) {
      engine.note = `failed to unblock chapter ${unit.chapter}: ${errMsg(e)}`;
    }
  }

  putEngine(projectId, engine);
  runEngine(projectId);
  return { ok: true };
}

/// Owner feedback on the pilot or any already-submitted chapter: recorded,
/// appended to the story's durable style rules, and turned into a revision
/// card — independent of whatever stage the pipeline is currently in.
export function requestFeedback(projectId: string, chapterArg: number | undefined, text: string): { ok: true; feedback_id: string } {
  if (typeof text !== "string" || text.trim() === "") throw new Error("text is required");
  const engine = getEngine(projectId);
  if (STAGES.indexOf(engine.stage) < STAGES.indexOf("pilot_review")) {
    throw new PipelineConflict(`cannot leave feedback before the pilot is written (stage: ${engine.stage})`);
  }
  const chapter = typeof chapterArg === "number" ? chapterArg : 1;
  if (chapter !== 1 && !getChapter(projectId, chapter)) {
    throw new Error(`chapter ${chapter} has no submitted text yet`);
  }

  const entry = addFeedback(projectId, { source: "owner", chapter, text, appended_to_rules: true });
  const brief = getBrief(projectId);
  if (brief) {
    putBrief(projectId, { ...brief, elements: { ...brief.elements, style_rules: [...brief.elements.style_rules, text] }, updated_at: nowIso() });
  }

  const id = `revision:fb:${entry.id}`;
  const now = nowIso();
  engine.units[id] = { id, kind: "revision", status: "open", card_id: null, attempt: 1, chapter, created_at: now, updated_at: now };
  putEngine(projectId, engine);
  runEngine(projectId);
  return { ok: true, feedback_id: entry.id };
}

/// Reset every failed unit (or just `unitId`) so the next engine run mints
/// it a fresh card — the only way a won't-do'd card stops blocking its
/// stage.
export function requestRetry(projectId: string, unitId?: string): { ok: true; retried: string[] } {
  const engine = getEngine(projectId);
  let targets: string[];
  if (unitId) {
    const unit = engine.units[unitId];
    if (!unit) throw new Error(`unknown unit '${unitId}'`);
    if (unit.status !== "failed") throw new PipelineConflict(`unit '${unitId}' is not failed (status: ${unit.status})`);
    targets = [unitId];
  } else {
    targets = Object.values(engine.units)
      .filter((u) => u.status === "failed")
      .map((u) => u.id);
  }

  for (const id of targets) {
    const unit = engine.units[id];
    unit.status = "open";
    unit.card_id = null;
    unit.attempt += 1;
    unit.note = undefined;
    unit.updated_at = nowIso();
  }
  putEngine(projectId, engine);
  if (targets.length > 0) runEngine(projectId);
  return { ok: true, retried: targets };
}

/// Assemble every submitted chapter (ascending) into one manuscript for
/// the "Final / export" stage.
export function assembleExport(projectId: string): { markdown: string; chapters: number[] } {
  const chapters = listChapters(projectId);
  const markdown = chapters.map((c) => `# Chapter ${c.chapter}\n\n${c.markdown}`).join("\n\n---\n\n");
  return { markdown, chapters: chapters.map((c) => c.chapter) };
}
