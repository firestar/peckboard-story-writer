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
  getColdRead,
  getEngine,
  getFeedback,
  getPipelineState,
  getOwnerReview,
  putOwnerReview,
  listChapters,
  getEngineIndex,
  putEngineIndex,
  getReview,
  putBrief,
  putCards,
  putEngine,
  putPipelineState,
} from "./docs";
import { PromptBrief, PromptFeedback, draftKey, renderCard } from "./prompts";
import { renderColdReadCard, renderColdReadFixCard } from "./prompts/coldRead";
import { renderOwnerReviewCard } from "./prompts/ownerReview";
import { buildNote, cardNotes, editNote, feedbackText, findRound, isOwnerRevisionId, latestRound, ownerRevisionId, revisionProblem } from "./ownerReview";
import {
  DEFAULT_WRITER_MODEL,
  COLD_READ_CATEGORY_LABELS,
  Brief,
  CardRef,
  ChapterDoc,
  ELEMENT_KEYS,
  ElementKey,
  EngineState,
  Feedback,
  REVIEW_PASSES,
  MAX_REVIEW_ROUNDS,
  MAX_OWNER_NOTES_PER_ROUND,
  OwnerNote,
  MAX_OWNER_SUMMARY_CHARS,
  OwnerReviewDoc,
  OwnerReviewRound,
  ReviewCursor,
  ReviewPass,
  ReviewRound,
  ReviewVerdict,
  STAGES,
  StageId,
  StageStatus,
  StoryElements,
  UnitKind,
  Unit,
  nowIso,
} from "./types";

// ── Budget ───────────────────────────────────────────────────────────────

// Core's default per-call budget is 2 s; keep every hook/route invocation
// (store reads/writes + card creates) comfortably inside it.
const CREATE_BUDGET_MS = 1200;
// Shared by every project in one timer.tick; each run still has fixed store
// I/O after its last deadline check, so leave extra headroom under 2 s.
const TIMER_BUDGET_MS = 1000;
const MAX_CREATES_PER_RUN = 8;
// list_cards returns every card with its full (up to ~48 KB) description, so
// the hot path never calls it; timer.tick's safety-net sweep is throttled.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
// ~19 units per chapter (draft + cold-read + cold-read-fix + 8 review
// passes + up to 8 revisions) keeps the engine and cards docs well under
// core's 256 KiB per-doc cap.
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

/// The story's edits to the built-in style guide (wizard "style rules").
function overridesOf(brief: Brief | null): Record<string, string> {
  return brief?.lesson_overrides ?? {};
}
function toPromptFeedback(feedback: Feedback[]): PromptFeedback[] {
  return feedback.map((f) => ({ source: f.source, chapter: f.chapter, text: f.text, at: f.at, chapter_only: f.chapter_only }));
}

function chapterCountOf(ctx: Ctx): number {
  return ctx.brief?.basics?.chapter_count ?? 1;
}

// ── Unit lifecycle ───────────────────────────────────────────────────────

interface UnitSpec {
  id: string;
  kind: UnitKind;
  priority: number;
  chapter?: number;
  pass?: ReviewPass;
  element?: ElementKey;
  blocked?: boolean;
  blockReason?: string;
  feedbackText?: string;
  /// Owner-review revision: the round whose notes the card addresses.
  ownerRound?: number;
}

function unitMarker(id: string, attempt: number): string {
  return `<!-- story-writer:unit=${id}#${attempt} -->`;
}

/// The model the pipeline assigns to a role's cards: the plugin setting,
/// else the writer default (reviewer cards fall back to the host default).
/// Also shown in the setup wizard (GET /defaults).
export function modelFor(role: "writer" | "reviewer"): string | undefined {
  const raw = getPluginSetting(role === "writer" ? "writer_model" : "reviewer_model");
  const trimmed = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
  return trimmed ?? (role === "writer" ? DEFAULT_WRITER_MODEL : undefined);
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

/// Cold-read-fix card items as "id [category] (where): text ("quote")"
/// lines so the writer's story_submit_cold_read_fixes {fixes:[{item, fix}]}
/// call can reference exactly the id shown on the card.
function coldReadItemTexts(projectId: string, chapter: number): string[] {
  const doc = getColdRead(projectId, chapter);
  if (!doc) return [];
  return doc.items.map((i) => {
    const label = COLD_READ_CATEGORY_LABELS[i.category ?? "other"] ?? i.category;
    return `${i.id} [${label}]${i.location ? ` (${i.location})` : ""}: ${i.text}${i.quote ? ` ("${i.quote}")` : ""}`;
  });
}

/// The cold reader's first-appearance list as "Name: what the text said"
/// lines, in the order reported.
function coldReadCharacterTexts(projectId: string, chapter: number): string[] {
  const doc = getColdRead(projectId, chapter);
  if (!doc) return [];
  return doc.characters.map((c) => `${c.name}: ${c.said}`);
}

/// Turn a pending unit (status "open", no card yet) into a real card.
/// Before the run's first create, `in_flight` is persisted so that a run
/// dying between createCard and the final putEngine is detected next time
/// (`adoptOrphans`). No-ops if the budget is spent; the next run retries.
function materialize(ctx: Ctx, unit: Unit, spec: UnitSpec): void {
  if (!hasBudget(ctx.budget)) return;
  const marker = unitMarker(unit.id, unit.attempt);

  const rendered =
    spec.kind === "cold_read"
      ? renderColdReadCard({ chapter: spec.chapter as number, isPilot: spec.chapter === 1 })
      : spec.kind === "cold_read_fix"
        ? renderColdReadFixCard({
            chapter: spec.chapter as number,
            brief: toPromptBrief(ctx.brief),
            overrides: overridesOf(ctx.brief),
            items: coldReadItemTexts(ctx.projectId, spec.chapter as number),
            characters: coldReadCharacterTexts(ctx.projectId, spec.chapter as number),
          })
        : spec.ownerRound !== undefined
          ? ownerRevisionCard(ctx, spec.chapter as number, spec.ownerRound)
          : renderCard(spec.kind, {
              brief: toPromptBrief(ctx.brief),
              feedback: toPromptFeedback(ctx.feedback),
              overrides: overridesOf(ctx.brief),
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
  if (isOwnerRevisionId(unit.id)) {
    const chapter = unit.chapter as number;
    const round = findRound(getOwnerReview(ctx.projectId, chapter), unit.round as number);
    const problem = round ? revisionProblem(chapter, round, getChapter(ctx.projectId, chapter)?.revision ?? null) : null;
    if (problem) {
      failUnit(unit, problem);
      return;
    }
  }
  if (unit.kind === "cold_read") {
    const chapter = unit.chapter as number;
    const doc = getColdRead(ctx.projectId, chapter);
    const chapterDoc = getChapter(ctx.projectId, chapter);
    if (!doc || !chapterDoc || doc.chapter_revision !== chapterDoc.revision) {
      failUnit(unit, `card finished without a fresh story_submit_cold_read for chapter ${chapter}`);
      return;
    }
  }
  if (unit.kind === "cold_read_fix") {
    const chapter = unit.chapter as number;
    const doc = getColdRead(ctx.projectId, chapter);
    const unfixed = doc ? doc.items.filter((i) => i.fix === null) : [];
    if (!doc || unfixed.length > 0) {
      failUnit(
        unit,
        `card finished with ${unfixed.length} cold-read item(s) still unfixed for chapter ${chapter}: ${unfixed.map((i) => i.id).join(", ")}`,
      );
      return;
    }
  }
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

/// The owner-review revision card for one round: every note of the round,
/// anchored to its lines and quote (src/prompts/ownerReview.ts).
function ownerRevisionCard(ctx: Ctx, chapter: number, roundNo: number): { title: string; description: string; role: "writer" | "reviewer" } {
  const round = findRound(getOwnerReview(ctx.projectId, chapter), roundNo);
  return renderOwnerReviewCard({
    chapter,
    round: roundNo,
    revision: round?.decided_revision ?? round?.chapter_revision ?? 0,
    brief: toPromptBrief(ctx.brief),
    overrides: overridesOf(ctx.brief),
    notes: round ? cardNotes(round) : [],
    summary: round?.summary,
  });
}

/// Whether one chapter's cold-read chain has cleared, from the engine's
/// units and the stored report — without creating any card.
function coldReadCleared(projectId: string, units: Record<string, Unit>, chapter: number): boolean {
  const read = units[`cold_read:${chapter}`];
  if (!read || read.status !== "done") return false;
  const doc = getColdRead(projectId, chapter);
  if (!doc || doc.items.length === 0) return true;
  const fix = units[`cold_read_fix:${chapter}`];
  return !!fix && fix.status === "done" && doc.items.every((i) => i.fix !== null);
}

/// An owner review round whose changes are still being made (the revision
/// card, or the redraft's cold read) — the chapter can't move on yet.
function ownerRevisionPending(ctx: Ctx, chapter?: number): boolean {
  return Object.values(ctx.engine.units).some((u) => isOwnerRevisionId(u.id) && !u.settled && u.status !== "failed" && (chapter === undefined || u.chapter === chapter));
}

/// Drive every owner-review revision (SW-12): materialize its card; once
/// the writer's redraft is in, re-run the chapter's cold read (C1) and
/// fixes (C2) on it; once that clears, close the round as revised and open
/// the next one on the new draft, so it goes back to the owner.
///
/// The chain is driven here for the pilot and once the chapter stage is
/// over; during "chapters", advanceChapters drives chapters 2..N in order
/// (C1: chapter N is cold-read only after 1..N−1 cleared) and this only
/// watches for the chain to clear.
function advanceOwnerReviews(ctx: Ctx): void {
  for (const unit of Object.values(ctx.engine.units)) {
    if (!isOwnerRevisionId(unit.id) || unit.settled) continue;
    if (!hasBudget(ctx.budget)) return;
    const chapter = unit.chapter as number;
    if (unit.status === "open") {
      if (unit.card_id === null) materialize(ctx, unit, { id: unit.id, kind: "revision", chapter, priority: 1, ownerRound: unit.round });
      continue;
    }
    if (unit.status !== "done") continue; // failed: waits for a retry
    if (!unit.cold_reset) {
      if (ctx.engine.units[`cold_read:${chapter}`]) resetUnit(ctx, `cold_read:${chapter}`);
      unit.cold_reset = true;
      unit.updated_at = nowIso();
      ctx.dirty = true;
    }
    const drive = chapter === 1 || STAGES.indexOf(ctx.engine.stage) > STAGES.indexOf("chapters");
    const cleared = drive ? advanceColdReadChain(ctx, chapter) : coldReadCleared(ctx.projectId, ctx.engine.units, chapter);
    if (!cleared) continue;
    openNextRound(ctx.projectId, chapter, unit.round as number);
    unit.settled = true;
    unit.updated_at = nowIso();
    ctx.dirty = true;
  }
}

/// The redraft cleared its cold read: the round it answered is revised and
/// the next round opens on the new draft (the owner's next review).
function openNextRound(projectId: string, chapter: number, roundNo: number): void {
  const doc = getOwnerReview(projectId, chapter);
  const round = findRound(doc, roundNo);
  if (!doc || !round || round.status !== "changes_requested") return;
  const revision = getChapter(projectId, chapter)?.revision ?? round.chapter_revision;
  const now = nowIso();
  round.status = "revised";
  round.revised_at = now;
  round.revised_revision = revision;
  if (!doc.rounds.some((r) => r.round > roundNo)) {
    doc.rounds.push({ round: roundNo + 1, chapter_revision: revision, status: "open", notes: [], opened_at: now });
  }
  putOwnerReview(projectId, doc);
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
  if (!advanceColdReadChain(ctx, 1)) return false;
  ctx.engine.stage = "pilot_review";
  ctx.dirty = true;
  return true;
}

/// Chapters 2..N are written in parallel, but their cold reads run in
/// order (C1): `cold_read:i` is created only once chapters 1..i−1 have
/// cleared their cold-read chain, so the fresh reader gets every earlier
/// chapter as the player will finally see it — never missing, never
/// mid-fix. Chapter 1 (the pilot) cleared its chain before this stage.
function advanceChapters(ctx: Ctx): boolean {
  const n = chapterCountOf(ctx);
  let allDone = true;
  let priorCleared = true;
  for (let i = 2; i <= n; i++) {
    const unit = ensureUnit(ctx, { id: `chapter:${i}`, kind: "chapter", chapter: i, priority: 2, blocked: false });
    const cleared: boolean = priorCleared && unit.status === "done" && advanceColdReadChain(ctx, i);
    if (!cleared) allDone = false;
    priorCleared = cleared;
  }
  if (!allDone) return false;
  if (Object.values(ctx.engine.units).some((u) => u.kind === "revision" && u.status === "open")) return false;
  if (ownerRevisionPending(ctx)) return false;
  ctx.engine.stage = "review";
  for (let i = 1; i <= n; i++) {
    ctx.engine.cursors[String(i)] = { chapter: i, pass_index: 0, round: 1, waiting: "review" };
  }
  ctx.dirty = true;
  return true;
}

/// Advance one chapter's cold-read (C1) -> cold-read-fix (C2) chain
/// (pilot included: chapter 1). Returns true once the chain is cleared
/// (no items reported, or every item has a recorded fix) so the chapter
/// can advance; false while a card is still open, or stays false after a
/// card finished without the right story_* submission (completeUnit fails
/// the unit, so the stage is stuck until `requestRetry`).
function advanceColdReadChain(ctx: Ctx, chapter: number): boolean {
  const readUnit = ensureUnit(ctx, { id: `cold_read:${chapter}`, kind: "cold_read", chapter, priority: 1 });
  if (readUnit.status !== "done") return false;

  const doc = getColdRead(ctx.projectId, chapter);
  if (!doc || doc.items.length === 0) return true;

  // A fresh report after an earlier fix (an owner-review redraft re-runs the
  // cold read) needs a fresh fix card: the old one fixed the old report.
  const fixId = `cold_read_fix:${chapter}`;
  const prior = ctx.engine.units[fixId];
  if (prior && prior.status === "done" && doc.items.some((i) => i.fix === null)) resetUnit(ctx, fixId);
  const fixUnit = ensureUnit(ctx, { id: fixId, kind: "cold_read_fix", chapter, priority: 1 });
  return fixUnit.status === "done";
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

function stageOfKind(kind: UnitKind, chapter?: number): StageId {
  switch (kind) {
    case "generate":
      return "setup";
    case "records":
      return "records";
    case "pilot":
      return "pilot";
    case "chapter":
      return "chapters";
    case "cold_read":
    case "cold_read_fix":
      return chapter === 1 ? "pilot" : "chapters";
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
      stage: stageOfKind(u.kind, u.chapter),
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
/// A failed unit's note replaces the stage note while it's failed and is
/// dropped again once nothing is (the dashboard shows it as the latest note).
const RETRY_HINT = " — retry it from the dashboard";
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
  const kept = prior?.note?.endsWith(RETRY_HINT) ? undefined : prior?.note;
  const note = failed ? `${failed.id}: ${failed.note ?? "failed"}${RETRY_HINT}` : kept;
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
    advanceOwnerReviews(ctx);
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

/// Sweeps unfinished pipelines round-robin, starting after the project the
/// previous tick reached, until the shared deadline — so with many
/// projects each tick stays inside the call budget and the rest are
/// reached on the following ticks.
export function onTimerTick(_payload: any): string {
  const deadline = Date.now() + TIMER_BUDGET_MS;
  try {
    const { projects, cursor } = getEngineIndex();
    if (projects.length === 0) return skip();
    const start = cursor === null ? 0 : (projects.indexOf(cursor) + 1) % projects.length;
    let reached: string | null = null;
    for (let k = 0; k < projects.length; k++) {
      if (Date.now() >= deadline) break;
      const projectId = projects[(start + k) % projects.length];
      try {
        runEngine(projectId, { deadline, createsLeft: MAX_CREATES_PER_RUN }, { sweep: true });
      } catch (_e) {
        // one project's failure must not stall every other project's tick.
      }
      reached = projectId;
    }
    if (reached !== null) putEngineIndex({ ...getEngineIndex(), cursor: reached });
  } catch (_e) {
    // reading the index failed; the next tick retries.
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
/// pilot revision from feedback is still open, or while the redraft from
/// the owner's last review is still being cold-read — the owner should see
/// the revised pilot before committing the rest of the book to it. Closes
/// the pilot's open review round as approved.
export function requestApprove(projectId: string): { ok: true; round: number } {
  const engine = getEngine(projectId);
  if (engine.stage !== "pilot_review") {
    throw new PipelineConflict(`cannot approve from stage '${engine.stage}' (must be pilot_review)`);
  }
  const openPilotRevision = Object.values(engine.units).some((u) => u.kind === "revision" && u.chapter === 1 && u.status === "open");
  if (openPilotRevision) throw new PipelineConflict("a pilot revision is still open — wait for it to finish before approving");
  if (latestRound(getOwnerReview(projectId, 1))?.status === "changes_requested") {
    throw new PipelineConflict("the pilot is being redrafted from your review — approve the new draft once its cold read is done");
  }

  engine.approved = true;
  engine.stage = "chapters";
  engine.updated_at = nowIso();

  const brief = getBrief(projectId);
  const feedback = getFeedback(projectId);
  for (const unit of Object.values(engine.units)) {
    if (unit.kind !== "chapter" || !unit.card_id) continue;
    try {
      const rendered = renderCard("chapter", {
        brief: toPromptBrief(brief),
        feedback: toPromptFeedback(feedback),
        overrides: overridesOf(brief),
        chapter: unit.chapter,
      });
      updateCard({ card_id: unit.card_id, description: `${rendered.description}\n\n${unitMarker(unit.id, unit.attempt)}`, blocked: false });
    } catch (e) {
      engine.note = `failed to unblock chapter ${unit.chapter}: ${errMsg(e)}`;
    }
  }

  putEngine(projectId, engine);
  const round = recordApproval(projectId, 1);
  runEngine(projectId);
  return { ok: true, round };
}

// ── Owner review rounds (SW-12) ───────────────────────────────────────────
// The owner reviews a draft in rounds (src/types.ts "Owner review rounds"):
// notes anchored to lines, then Approve or Request changes. A round opens
// with the owner's first note or decision, or — after a redraft cleared its
// cold read — by the engine (`openNextRound`).

const redraftMessage = (chapter: number, round: number) =>
  `chapter ${chapter} is being redrafted from your round ${round} review — the new draft comes back as round ${round + 1} once its cold read is done`;

/// The chapter text the owner may review now, or why not: from the owner
/// gate on, a chapter with submitted text whose cold read (C1) and fixes
/// (C2) have cleared — a draft reaches the owner only after that — and
/// whose last review isn't still being redrafted.
function reviewableChapter(engine: EngineState, projectId: string, chapter: number): ChapterDoc {
  if (!Number.isInteger(chapter) || chapter < 1) throw new Error("chapter must be a chapter number (1 or more)");
  if (STAGES.indexOf(engine.stage) < STAGES.indexOf("pilot_review")) {
    throw new PipelineConflict(`cannot review before the pilot is ready for you (stage: ${engine.stage})`);
  }
  const doc = getChapter(projectId, chapter);
  if (!doc) throw new Error(`chapter ${chapter} has no submitted text yet`);
  const last = latestRound(getOwnerReview(projectId, chapter));
  if (last?.status === "changes_requested") throw new PipelineConflict(redraftMessage(chapter, last.round));
  // Pipelines started before cold reads existed passed the pilot (and, past
  // the chapter stage, every chapter) without one.
  const legacy = !engine.units[`cold_read:${chapter}`] && (chapter === 1 || STAGES.indexOf(engine.stage) > STAGES.indexOf("chapters"));
  if (!legacy && !coldReadCleared(projectId, engine.units, chapter)) {
    throw new PipelineConflict(`chapter ${chapter} isn't ready for your review yet — its cold read and cold-read fixes come first`);
  }
  return doc;
}

/// The chapter's open round, or a new one on the current draft. Not saved.
function openRound(projectId: string, chapter: number, revision: number): { doc: OwnerReviewDoc; round: OwnerReviewRound } {
  const doc = getOwnerReview(projectId, chapter) ?? { chapter, rounds: [] };
  const last = latestRound(doc);
  if (last && last.status === "open") return { doc, round: last };
  if (last && last.status === "changes_requested") throw new PipelineConflict(redraftMessage(chapter, last.round));
  const round: OwnerReviewRound = { round: (last?.round ?? 0) + 1, chapter_revision: revision, status: "open", notes: [], opened_at: nowIso() };
  doc.rounds.push(round);
  return { doc, round };
}

function recordApproval(projectId: string, chapter: number): number {
  const revision = getChapter(projectId, chapter)?.revision ?? 0;
  const { doc, round } = openRound(projectId, chapter, revision);
  round.status = "approved";
  round.decided_at = nowIso();
  round.decided_revision = revision;
  putOwnerReview(projectId, doc);
  return round.round;
}

/// Add one note to the chapter's open round (opening one if needed),
/// anchored to lines of the current draft.
export function requestOwnerNote(projectId: string, chapter: number, input: any): { ok: true; round: number; note: OwnerNote } {
  const chapterDoc = reviewableChapter(getEngine(projectId), projectId, chapter);
  const { doc, round } = openRound(projectId, chapter, chapterDoc.revision);
  if (round.notes.length >= MAX_OWNER_NOTES_PER_ROUND) {
    throw new Error(`a review round holds at most ${MAX_OWNER_NOTES_PER_ROUND} notes — request changes on these first`);
  }
  const note = buildNote(input, round, chapterDoc.markdown, chapterDoc.revision);
  round.notes.push(note);
  putOwnerReview(projectId, doc);
  return { ok: true, round: round.round, note };
}

function openNote(projectId: string, chapter: number, id: unknown): { doc: OwnerReviewDoc; round: OwnerReviewRound; index: number } {
  const doc = getOwnerReview(projectId, chapter);
  const round = latestRound(doc);
  if (!doc || !round || round.status !== "open") {
    throw new PipelineConflict(`chapter ${chapter} has no open review round — notes can only change until you approve or request changes`);
  }
  const index = round.notes.findIndex((n) => n.id === id);
  if (index < 0) throw new Error(`unknown note '${String(id)}' in chapter ${chapter}, round ${round.round}`);
  return { doc, round, index };
}

export function requestOwnerNoteUpdate(projectId: string, chapter: number, id: unknown, input: any): { ok: true; round: number; note: OwnerNote } {
  const { doc, round, index } = openNote(projectId, chapter, id);
  editNote(round.notes[index], input);
  putOwnerReview(projectId, doc);
  return { ok: true, round: round.round, note: round.notes[index] };
}

export function requestOwnerNoteDelete(projectId: string, chapter: number, id: unknown): { ok: true; round: number } {
  const { doc, round, index } = openNote(projectId, chapter, id);
  round.notes.splice(index, 1);
  putOwnerReview(projectId, doc);
  return { ok: true, round: round.round };
}

/// The owner finishes a round. "approve": the pilot at the gate passes it
/// (requestApprove); any other chapter's round closes as approved.
/// "changes": every note (plus the optional overall note) becomes one
/// feedback entry and an owner-review revision card; the overall note is
/// appended to the story's rules unless `toRules` is false. The writer's
/// redraft is cold-read again and returns as the next round.
export function requestOwnerDecision(
  projectId: string,
  chapter: number,
  decision: unknown,
  summaryArg?: unknown,
  toRulesArg?: unknown,
): { ok: true; round: number; feedback_id?: string } {
  if (decision !== "approve" && decision !== "changes") throw new Error('decision must be "approve" or "changes"');
  const engine = getEngine(projectId);
  if (decision === "approve" && chapter === 1 && engine.stage === "pilot_review") return requestApprove(projectId);
  const chapterDoc = reviewableChapter(engine, projectId, chapter);

  if (decision === "approve") {
    const last = latestRound(getOwnerReview(projectId, chapter));
    if (last && last.status === "approved" && last.decided_revision === chapterDoc.revision) return { ok: true, round: last.round };
    return { ok: true, round: recordApproval(projectId, chapter) };
  }

  const summary = typeof summaryArg === "string" ? summaryArg.trim() : "";
  if (summary.length > MAX_OWNER_SUMMARY_CHARS) throw new Error(`the overall note is too long (max ${MAX_OWNER_SUMMARY_CHARS} characters)`);
  const { doc, round } = openRound(projectId, chapter, chapterDoc.revision);
  if (round.notes.length === 0 && !summary) throw new Error("add at least one note, or an overall note, before requesting changes");
  const toRules = !!summary && toRulesArg !== false;

  const entry = addFeedback(projectId, {
    source: "owner",
    chapter,
    text: feedbackText(chapter, round, summary),
    appended_to_rules: toRules,
    ...(round.notes.length > 0 ? { chapter_only: true } : {}),
    round: round.round,
  });
  if (toRules) {
    const brief = getBrief(projectId);
    if (brief) {
      putBrief(projectId, { ...brief, elements: { ...brief.elements, style_rules: [...brief.elements.style_rules, summary] }, updated_at: nowIso() });
    }
  }

  const now = nowIso();
  round.status = "changes_requested";
  round.decided_at = now;
  round.decided_revision = chapterDoc.revision;
  if (summary) round.summary = summary;
  round.summary_to_rules = toRules;
  round.feedback_id = entry.id;
  putOwnerReview(projectId, doc);

  const id = ownerRevisionId(chapter, round.round);
  engine.units[id] = { id, kind: "revision", status: "open", card_id: null, attempt: 1, chapter, round: round.round, created_at: now, updated_at: now };
  putEngine(projectId, engine);
  runEngine(projectId);
  return { ok: true, round: round.round, feedback_id: entry.id };
}

/// The free-text fallback (POST /pipeline/feedback): an overall note with
/// no line notes — the same "Request changes" path, appended to the rules.
export function requestFeedback(projectId: string, chapterArg: number | undefined, text: string): { ok: true; feedback_id: string } {
  if (typeof text !== "string" || text.trim() === "") throw new Error("text is required");
  const chapter = typeof chapterArg === "number" ? chapterArg : 1;
  const res = requestOwnerDecision(projectId, chapter, "changes", text, true);
  return { ok: true, feedback_id: res.feedback_id as string };
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
