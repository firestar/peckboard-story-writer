// The six worker-facing MCP tools (story_get_brief, story_get_records,
// story_submit_records, story_submit_chapter, story_update_state,
// story_report_review). Each is scoped to the calling project
// (`requireProjectId`) and backed by the plugin document store; chapter text
// is additionally mirrored into the project repo under story/ so it survives
// outside the plugin's own storage.
//
// These are deliberately thin for the scaffold: they validate input, persist
// it, and read it back verbatim. The pipeline (card creation/advancement,
// style-rule compilation, the writing-lessons prompt pack) is built on top of
// this storage in later cards.

import { requireProjectId, storeGet, storePut, writeFile } from "./host";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/// Get this story's brief (setup-wizard answers + compiled prompt pack +
/// owner feedback). `null` brief means the wizard hasn't been run yet.
export function toolGetBrief(_args: any, _context: any): any {
  const projectId = requireProjectId();
  return { brief: storeGet("brief", projectId) };
}

/// Get the story's living records (character sheets, per-chapter state,
/// who-knows-what, setup/payoff, glossary, recaps).
export function toolGetRecords(_args: any, _context: any): any {
  const projectId = requireProjectId();
  return { records: asRecord(storeGet("records", projectId)) };
}

/// Merge a partial records update into the stored records doc.
export function toolSubmitRecords(args: any, _context: any): any {
  const projectId = requireProjectId();
  const records = args?.records;
  if (!records || typeof records !== "object" || Array.isArray(records)) {
    throw new Error("records (object) is required");
  }
  const merged = { ...asRecord(storeGet("records", projectId)), ...records };
  storePut("records", projectId, merged);
  return { ok: true };
}

/// Store a chapter's text (and optional recap / records update), and mirror
/// the chapter into story/chapters/ in the project repo.
export function toolSubmitChapter(args: any, context: any): any {
  const projectId = requireProjectId();
  const chapter = args?.chapter;
  const markdown = args?.markdown;
  if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 0) {
    throw new Error("chapter (non-negative integer; 0 = pilot) is required");
  }
  if (typeof markdown !== "string" || markdown.trim().length === 0) {
    throw new Error("markdown is required");
  }
  const key = `${projectId}:${chapter}`;
  const recap = typeof args?.recap === "string" ? args.recap : null;
  storePut("chapters", key, { chapter, markdown, recap });
  writeFile(`story/chapters/chapter-${String(chapter).padStart(2, "0")}.md`, markdown);

  const stateUpdates = args?.state_updates;
  if (stateUpdates && typeof stateUpdates === "object" && !Array.isArray(stateUpdates)) {
    const merged = { ...asRecord(storeGet("records", projectId)), ...stateUpdates };
    storePut("records", projectId, merged);
  }
  return { ok: true, path: `story/chapters/chapter-${String(chapter).padStart(2, "0")}.md` };
}

/// Report pipeline progress (stage, status note, stage-specific data).
export function toolUpdateState(args: any, _context: any): any {
  const projectId = requireProjectId();
  const existing = asRecord(storeGet("state", projectId));
  const next = {
    stage: typeof args?.stage === "string" ? args.stage : existing.stage ?? null,
    note: typeof args?.note === "string" ? args.note : existing.note ?? null,
    data: { ...asRecord(existing.data), ...asRecord(args?.data) },
  };
  storePut("state", projectId, next);
  return { ok: true };
}

/// Report one review pass's verdict on one chapter. `changes_requested`
/// notes are appended to the story's style rules as owner/review feedback.
export function toolReportReview(args: any, _context: any): any {
  const projectId = requireProjectId();
  const chapter = args?.chapter;
  const pass = args?.pass;
  const verdict = args?.verdict;
  const notes = typeof args?.notes === "string" ? args.notes : "";
  if (typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 0) {
    throw new Error("chapter (non-negative integer) is required");
  }
  if (typeof pass !== "string" || pass.trim().length === 0) {
    throw new Error("pass is required");
  }
  if (verdict !== "pass" && verdict !== "changes_requested") {
    throw new Error("verdict must be 'pass' or 'changes_requested'");
  }
  storePut("reviews", `${projectId}:${chapter}:${pass}`, { chapter, pass, verdict, notes });

  if (verdict === "changes_requested" && notes.trim().length > 0) {
    const brief = asRecord(storeGet("brief", projectId));
    const styleRules = Array.isArray(brief.style_rules) ? (brief.style_rules as unknown[]).slice() : [];
    styleRules.push(`[chapter ${chapter}, ${pass} review] ${notes}`);
    storePut("brief", projectId, { ...brief, style_rules: styleRules });
  }
  return { ok: true };
}
