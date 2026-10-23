// Typed accessors over the chunked doc store (src/store.ts) for each kind of
// document this plugin persists, plus the upsert-merge logic
// `story_submit_records` / `story_submit_chapter` use to apply a partial
// records update without clobbering untouched items.

import { deleteDoc, getDoc, listDocs, putDoc } from "./store";
import {
  Brief,
  ChapterDoc,
  Feedback,
  PipelineState,
  RECORD_ID_KEY,
  RECORD_SECTIONS,
  Records,
  RecordSection,
  ReviewDoc,
  ReviewPass,
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
  const changed: RecordSection[] = [];
  for (const section of RECORD_SECTIONS) {
    const incoming = update[section];
    if (!Array.isArray(incoming)) continue;
    const existing = getRecordSection(projectId, section);
    putRecordSection(projectId, section, upsertSection(section, existing, incoming));
    changed.push(section);
  }
  return changed;
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

// ── Pipeline state ───────────────────────────────────────────────────────

export function getPipelineState(projectId: string): PipelineState {
  return (getDoc("state", projectId) as PipelineState | null) ?? defaultPipelineState();
}

export function putPipelineState(projectId: string, state: PipelineState): void {
  putDoc("state", projectId, state);
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
