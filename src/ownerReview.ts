// Owner review rounds (SW-12): pure helpers over the round/note model in
// src/types.ts — input validation, round lookup, and the text a round's
// notes become (the feedback entry and the writer's card). No host calls
// and no engine state here; src/pipeline.ts owns the lifecycle (opening
// rounds, decisions, the revision card, the cold read re-run).

import {
  MAX_OWNER_NOTE_CHARS,
  MAX_OWNER_QUOTE_CHARS,
  OWNER_NOTE_KIND_LABELS,
  OWNER_NOTE_KINDS,
  OWNER_NOTE_NEEDS_BODY,
  OwnerNote,
  OwnerNoteKind,
  OwnerReviewDoc,
  OwnerReviewRound,
  nowIso,
} from "./types";
import type { OwnerCardNote } from "./prompts/ownerReview";

export const OWNER_REVISION_PREFIX = "revision:owner:";

export function ownerRevisionId(chapter: number, round: number): string {
  return `${OWNER_REVISION_PREFIX}${chapter}:${round}`;
}

export function isOwnerRevisionId(id: string): boolean {
  return id.startsWith(OWNER_REVISION_PREFIX);
}

export function latestRound(doc: OwnerReviewDoc | null): OwnerReviewRound | null {
  return doc && doc.rounds.length > 0 ? doc.rounds[doc.rounds.length - 1] : null;
}

export function findRound(doc: OwnerReviewDoc | null, round: number): OwnerReviewRound | null {
  return doc?.rounds.find((r) => r.round === round) ?? null;
}

function lineCount(markdown: string): number {
  return Math.max(1, String(markdown).replace(/\r\n?/g, "\n").split("\n").length);
}

function kindOf(raw: unknown): OwnerNoteKind {
  if (typeof raw !== "string" || !(OWNER_NOTE_KINDS as readonly string[]).includes(raw)) {
    throw new Error(`kind must be one of: ${OWNER_NOTE_KINDS.join(", ")}`);
  }
  return raw as OwnerNoteKind;
}

function bodyOf(raw: unknown, kind: OwnerNoteKind): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (OWNER_NOTE_NEEDS_BODY[kind] && !body) throw new Error(`a "${OWNER_NOTE_KIND_LABELS[kind]}" note needs text — say what should change`);
  if (body.length > MAX_OWNER_NOTE_CHARS) throw new Error(`note is too long (max ${MAX_OWNER_NOTE_CHARS} characters)`);
  return body;
}

function lineOf(raw: unknown, name: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) throw new Error(`${name} must be a line number (1 or more)`);
  return raw;
}

/// "n<k>": one past every id the round ever handed out (`next_note`, kept
/// across deletes), so a deleted note's id never goes to a different note.
export function nextNoteId(round: OwnerReviewRound): string {
  let k = round.next_note ?? 1;
  for (const n of round.notes) {
    const used = Number(n.id.replace(/^n/, ""));
    if (Number.isInteger(used) && used >= k) k = used + 1;
  }
  return `n${k}`;
}

/// Build a note from the page's input, anchored to the chapter text the
/// owner was reading. Lines are clamped to the text (a stale page can't
/// anchor past the end); the quote is a display aid, capped.
export function buildNote(input: any, round: OwnerReviewRound, chapterMarkdown: string, revision: number): OwnerNote {
  const kind = kindOf(input?.kind);
  const body = bodyOf(input?.body, kind);
  const total = lineCount(chapterMarkdown);
  const start = Math.min(lineOf(input?.start_line, "start_line"), total);
  const endRaw = input?.end_line === undefined || input?.end_line === null ? start : lineOf(input.end_line, "end_line");
  const end = Math.min(Math.max(endRaw, start), total);
  const quote = (typeof input?.quote === "string" ? input.quote.trim() : "").slice(0, MAX_OWNER_QUOTE_CHARS);
  const id = nextNoteId(round);
  round.next_note = Number(id.slice(1)) + 1;
  return {
    id,
    kind,
    start_line: start,
    end_line: end,
    quote,
    body,
    revision,
    created_at: nowIso(),
    resolution: null,
  };
}

/// Apply an edit (body and/or kind) to an open round's note.
export function editNote(note: OwnerNote, input: any): void {
  const kind = input?.kind === undefined ? note.kind : kindOf(input.kind);
  note.body = bodyOf(input?.body === undefined ? note.body : input.body, kind);
  note.kind = kind;
  note.updated_at = nowIso();
}

function lineLabel(n: OwnerNote): string {
  return n.end_line > n.start_line ? `lines ${n.start_line}–${n.end_line}` : `line ${n.start_line}`;
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/// The feedback entry a "Request changes" becomes. With no line notes it is
/// the overall note verbatim (what the old free-text box sent).
export function feedbackText(chapter: number, round: OwnerReviewRound, summary: string): string {
  if (round.notes.length === 0) return summary;
  const head = `Owner review of chapter ${chapter}, round ${round.round}: ${round.notes.length} note${round.notes.length === 1 ? "" : "s"}.`;
  const lines = round.notes.map((n) => {
    const quote = n.quote ? ` "${oneLine(n.quote, 160)}"` : "";
    const body = n.body ? ` — ${oneLine(n.body, 400)}` : "";
    return `- ${n.id} ${OWNER_NOTE_KIND_LABELS[n.kind]}, ${lineLabel(n)}${quote}${body}`;
  });
  const overall = summary ? [`Overall: ${summary}`] : [];
  return [head, ...lines, ...overall].join("\n");
}

export function cardNotes(round: OwnerReviewRound): OwnerCardNote[] {
  return round.notes.map((n) => ({
    id: n.id,
    kind: n.kind,
    start_line: n.start_line,
    end_line: n.end_line,
    quote: n.quote,
    body: n.body,
    revision: n.revision,
    resolution: n.resolution ? { action: n.resolution.action, how: n.resolution.how } : null,
  }));
}

/// Why a finished owner-revision card doesn't count yet, or null if it does:
/// every note needs a recorded resolution, and a redraft (newer than the
/// draft the owner decided on) is needed unless every note was only
/// answered or declined.
export function revisionProblem(chapter: number, round: OwnerReviewRound, chapterRevision: number | null): string | null {
  const unresolved = round.notes.filter((n) => !n.resolution);
  if (unresolved.length > 0) {
    return (
      `card finished with ${unresolved.length} owner note${unresolved.length === 1 ? "" : "s"} still unaddressed for chapter ${chapter} ` +
      `(round ${round.round}): ${unresolved.map((n) => n.id).join(", ")} — record each with story_submit_owner_review_fixes`
    );
  }
  const needsDraft = round.notes.length === 0 || round.notes.some((n) => n.resolution?.action === "fixed");
  if (needsDraft && (chapterRevision === null || chapterRevision <= (round.decided_revision ?? 0))) {
    return `card finished without a new draft of chapter ${chapter} (story_submit_chapter) for owner review round ${round.round}`;
  }
  return null;
}

/// The round the chapter is being redrafted for (the owner requested
/// changes and the redraft hasn't cleared its cold read yet), or null.
/// Review passes wait for it: they read the text the owner will see next.
export function underRevision(doc: OwnerReviewDoc | null): OwnerReviewRound | null {
  const last = latestRound(doc);
  return last && last.status === "changes_requested" ? last : null;
}

/// The round whose redraft the writer still owes (SW-15): under revision
/// and the card's work isn't in yet (`revisionProblem`), so the chapter text
/// is the draft the owner sent back — a cold read or its fixes on it would
/// be thrown away. Null once the redraft (or an answers-only resolution)
/// is in and the redraft's own cold read may run.
export function redraftPending(doc: OwnerReviewDoc | null, chapter: number, chapterRevision: number | null): OwnerReviewRound | null {
  const round = underRevision(doc);
  return round && revisionProblem(chapter, round, chapterRevision) !== null ? round : null;
}

/// The open round's notes the owner hasn't sent (SW-15): approving would
/// leave them with no writer ever seeing them, so approval waits until
/// they're sent (Request changes) or deleted.
export function unsentNotes(doc: OwnerReviewDoc | null): OwnerNote[] {
  const last = latestRound(doc);
  return last && last.status === "open" ? last.notes : [];
}
