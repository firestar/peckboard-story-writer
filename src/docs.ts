// Typed accessors over the chunked doc store (src/store.ts) for each kind of
// document this plugin persists, plus the upsert-merge logic
// `story_submit_records` / `story_submit_chapter` use to apply a partial
// records update without clobbering untouched items.

import { deleteDoc, getDoc, listDocs, putDoc } from "./store";
import {
  Brief,
  CardRef,
  ColdReadDoc,
  ChapterDoc,
  EngineState,
  Feedback,
  OwnerReviewDoc,
  RECORD_ID_KEY,
  RECORD_REQUIRED_FIELDS,
  RECORD_SECTIONS,
  Records,
  RecordSection,
  PipelineState,
  ReviewDoc,
  ReviewPass,
  defaultEngineState,
  defaultPipelineState,
  emptyRecords,
  nowIso,
} from "./types";

function pk(...parts: (string | number)[]): string {
  return parts.join(":");
}

// ── Brief ────────────────────────────────────────────────────────────────

export function getBrief(projectId: string): Brief | null {
  return getDoc("brief", projectId) ?? null;
}

export function putBrief(projectId: string, brief: Brief): void {
  putDoc("brief", projectId, brief);
}

/// The story's durable style rules (wizard rules plus any appended by
/// `story_report_review`'s `rule`); empty before the wizard has run.
export function getRules(projectId: string): string[] {
  return getBrief(projectId)?.elements?.style_rules ?? [];
}

// ── Records (one doc per section) ───────────────────────────────────────

export function getRecordSection<T = unknown>(projectId: string, section: RecordSection): T[] {
  const value = getDoc("records", pk(projectId, section));
  return Array.isArray(value) ? (value as T[]) : [];
}

export function putRecordSection(projectId: string, section: RecordSection, items: unknown[]): void {
  putDoc("records", pk(projectId, section), items);
}

export function getAllRecords(projectId: string): Records {
  const records = emptyRecords();
  for (const section of RECORD_SECTIONS) {
    (records as any)[section] = getRecordSection(projectId, section);
  }
  return records;
}

/// Merge `incoming` items into `existing` by each item's identity field
/// (`RECORD_ID_KEY[section]`): an incoming item with the same identity
/// shallow-merges over the existing one, others are appended.
export function upsertSection(section: RecordSection, existing: unknown[], incoming: unknown[]): unknown[] {
  const idKey = RECORD_ID_KEY[section];
  const out = existing.slice();
  for (const item of incoming) {
    const id = (item as any)?.[idKey];
    const index = out.findIndex((e) => (e as any)?.[idKey] === id);
    if (index >= 0) {
      out[index] = { ...(out[index] as any), ...(item as any) };
    } else {
      out.push(item);
    }
  }
  return out;
}

/// Apply a partial records update (section -> item[]) to storage, upsert-
/// merging each touched section. Returns the sections that changed.
export function applyRecordsUpdate(projectId: string, update: Record<string, unknown>): RecordSection[] {
  // Merge every section first and write only once all pass, so a bad item
  // in one section can't leave the others half-applied.
  const merged: [RecordSection, unknown[]][] = [];
  for (const section of RECORD_SECTIONS) {
    const incoming = update[section];
    if (!Array.isArray(incoming)) continue;
    const existing = getRecordSection(projectId, section);
    const idKey = RECORD_ID_KEY[section];
    incoming.forEach((item, i) => {
      const id = (item as any)?.[idKey];
      if (existing.some((e) => (e as any)?.[idKey] === id)) return;
      for (const field of RECORD_REQUIRED_FIELDS[section]) {
        if ((item as any)?.[field] === undefined) {
          throw new Error(`records.${section}[${i}].${field}: required for a new item`);
        }
      }
    });
    merged.push([section, upsertSection(section, existing, incoming)]);
  }
  for (const [section, items] of merged) putRecordSection(projectId, section, items);
  return merged.map(([section]) => section);
}

// ── Chapters ─────────────────────────────────────────────────────────────

export function getChapter(projectId: string, chapter: number): ChapterDoc | null {
  return getDoc("chapters", pk(projectId, chapter)) ?? null;
}

export function putChapter(projectId: string, doc: ChapterDoc): void {
  putDoc("chapters", pk(projectId, doc.chapter), doc);
}

export function listChapters(projectId: string): ChapterDoc[] {
  const prefix = `${projectId}:`;
  return listDocs("chapters")
    .filter((d) => d.key.startsWith(prefix))
    .map((d) => d.value as ChapterDoc)
    .sort((a, b) => a.chapter - b.chapter);
}

// ── Reviews ──────────────────────────────────────────────────────────────

export function getReview(projectId: string, chapter: number, pass: ReviewPass): ReviewDoc | null {
  return getDoc("reviews", pk(projectId, chapter, pass)) ?? null;
}

export function putReview(projectId: string, doc: ReviewDoc): void {
  putDoc("reviews", pk(projectId, doc.chapter, doc.pass), doc);
}

export function listReviews(projectId: string): ReviewDoc[] {
  const prefix = `${projectId}:`;
  return listDocs("reviews")
    .filter((d) => d.key.startsWith(prefix))
    .map((d) => d.value as ReviewDoc);
}

// ── Cold reads (C1/C2) ───────────────────────────────────────────────

export function getColdRead(projectId: string, chapter: number): ColdReadDoc | null {
  return getDoc("coldreads", pk(projectId, chapter)) ?? null;
}

export function putColdRead(projectId: string, doc: ColdReadDoc): void {
  putDoc("coldreads", pk(projectId, doc.chapter), doc);
}

export function listColdReads(projectId: string): ColdReadDoc[] {
  const prefix = `${projectId}:`;
  return listDocs("coldreads")
    .filter((d) => d.key.startsWith(prefix))
    .map((d) => d.value as ColdReadDoc)
    .sort((a, b) => a.chapter - b.chapter);
}

// ── Owner review rounds (SW-12) ────────────────────────────────────

export function getOwnerReview(projectId: string, chapter: number): OwnerReviewDoc | null {
  return getDoc("owner_reviews", pk(projectId, chapter)) ?? null;
}

export function putOwnerReview(projectId: string, doc: OwnerReviewDoc): void {
  putDoc("owner_reviews", pk(projectId, doc.chapter), doc);
}

export function listOwnerReviews(projectId: string): OwnerReviewDoc[] {
  const prefix = `${projectId}:`;
  return listDocs("owner_reviews")
    .filter((d) => d.key.startsWith(prefix))
    .map((d) => d.value as OwnerReviewDoc)
    .sort((a, b) => a.chapter - b.chapter);
}

// ── Cold-read session roles ──────────────────────────────────────────
// A cold-read reader must be a FRESH session: never one that already
// pulled story context (brief/records/state) or pushed a worker result.
// The host doesn't scope which card a session belongs to, so this is
// enforced here by remembering each session's first role and refusing to
// let it switch sides (src/tools.ts `guardSession`).

export type SessionRole = "context" | "cold_reader";

// Oldest-inserted dropped first once a project's session map grows past
// this — a session only needs its first call remembered, so an unbounded
// map would just be wasted store space on a long-running project.
const SESSION_ROLES_MAX = 300;

export function getSessionRole(projectId: string, sessionId: string): SessionRole | null {
  const roles = getDoc("sessions", projectId) as Record<string, SessionRole> | null;
  return roles?.[sessionId] ?? null;
}

/// First call wins: once a session has a role, later calls are a no-op
/// (the caller already checked it matches before doing any work).
export function setSessionRole(projectId: string, sessionId: string, role: SessionRole): void {
  const roles = (getDoc("sessions", projectId) as Record<string, SessionRole> | null) ?? {};
  if (roles[sessionId]) return;
  const entries = Object.entries(roles);
  while (entries.length >= SESSION_ROLES_MAX) entries.shift();
  entries.push([sessionId, role]);
  putDoc("sessions", projectId, Object.fromEntries(entries));
}

// ── Pipeline state ───────────────────────────────────────────────────────

export function getPipelineState(projectId: string): PipelineState {
  return (getDoc("state", projectId) as PipelineState | null) ?? defaultPipelineState();
}

export function putPipelineState(projectId: string, state: PipelineState): void {
  putDoc("state", projectId, state);
}

// ── Pipeline cards (one doc per project holding the list) ──────────────────

export function getCards(projectId: string): CardRef[] {
  const value = getDoc("cards", projectId);
  return Array.isArray(value) ? (value as CardRef[]) : [];
}

export function putCards(projectId: string, cards: CardRef[]): void {
  putDoc("cards", projectId, cards);
}

// ── Pipeline engine state (one doc per project) ───────────────────────────

export function getEngine(projectId: string): EngineState {
  return (getDoc("engine", projectId) as EngineState | null) ?? defaultEngineState();
}

export function putEngine(projectId: string, state: EngineState): void {
  putDoc("engine", projectId, state);
  const index = getEngineIndex();
  const listed = index.projects.includes(projectId);
  if (!state.finished && !listed) {
    putEngineIndex({ ...index, projects: [...index.projects, projectId] });
  } else if (state.finished && listed) {
    putEngineIndex({ ...index, projects: index.projects.filter((p) => p !== projectId) });
  }
}

/// Unfinished pipelines, kept in sync by `putEngine`, plus the last project
/// timer.tick swept so the next tick resumes after it (round-robin). A small
/// doc, so a tick never has to load every project's engine doc.
export interface EngineIndex {
  projects: string[];
  cursor: string | null;
}

export function getEngineIndex(): EngineIndex {
  const value = getDoc("engine_index", "active") as EngineIndex | null;
  return { projects: value?.projects ?? [], cursor: value?.cursor ?? null };
}

export function putEngineIndex(index: EngineIndex): void {
  putDoc("engine_index", "active", index);
}

// ── Feedback (one doc per project holding the append-only list) ──────────

export function getFeedback(projectId: string): Feedback[] {
  const value = getDoc("feedback", projectId);
  return Array.isArray(value) ? (value as Feedback[]) : [];
}

export function addFeedback(projectId: string, entry: Omit<Feedback, "id" | "at">): Feedback {
  const existing = getFeedback(projectId);
  const full: Feedback = { ...entry, id: `fb-${existing.length + 1}-${Date.now()}`, at: nowIso() };
  putDoc("feedback", projectId, [...existing, full]);
  return full;
}

export { deleteDoc as deleteStoredDoc };
