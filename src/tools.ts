// The nine worker-facing MCP tools (story_get_brief, story_get_records,
// story_submit_records, story_submit_chapter, story_update_state,
// story_report_review, story_cold_read_get_text, story_submit_cold_read,
// story_submit_cold_read_fixes). Each is scoped to the calling project
// (`requireProjectId`), validates its input against src/schemas.ts (the same
// schemas the manifest declares), persists through the typed doc store
// (src/docs.ts), and mirrors the human-readable result into the project
// repo under story/ (src/files.ts, project_files_write — only allowed during
// this tool invocation).
//
// Session isolation (SW-9, C1): a cold read must come from a FRESH
// session that never saw the brief/records/cards/other worker output. The
// host scopes an mcp.tool.invoke call to a session id but not to which
// card issued it, so `guardSession` enforces the rule itself: the first
// story_* tool a session calls fixes its role for that project, and it can
// never call a tool from the other side afterward.

import { callerScope, requireProjectId } from "./host";
import { validate } from "./validate";
import { SCHEMAS } from "./schemas";
import {
  addFeedback,
  applyRecordsUpdate,
  getBrief,
  getChapter,
  getColdRead,
  getFeedback,
  getPipelineState,
  getRecordSection,
  getReview,
  getRules,
  getSessionRole,
  putBrief,
  putChapter,
  putColdRead,
  putPipelineState,
  putRecordSection,
  putReview,
  SessionRole,
  setSessionRole,
  upsertSection,
} from "./docs";
import { chapterFileName, writeBrief, writeChapter, writeColdRead, writeRecaps, writeRecordSection, writeReview, writeState } from "./files";
import { Brief, ChapterDoc, ColdReadDoc, ColdReadItem, PipelineState, Recap, RECORD_SECTIONS, RecordSection, ReviewDoc, ReviewRound, StageId, nowIso } from "./types";

const SESSION_ROLE_ERRORS: Record<SessionRole, string> = {
  context:
    "this session already called a story_* tool that pulls or pushes normal story context — cold reads " +
    "need a FRESH session that has never seen the brief, records, cards or any other worker's output. " +
    "Start a new session for the cold read.",
  cold_reader:
    "this session is a cold reader (SW-9 C1): it has already read player-visible chapter text and can't " +
    "call any other story_* tool. Start a new session for writing, records or review.",
};

/// Fix (or check) this session's role for `projectId`: the first story_*
/// tool call a session makes decides whether it's a normal "context"
/// session or a "cold_reader" one, and every later call must match.
/// Sessions with no id (a direct host call outside mcp.tool.invoke, as in
/// most unit tests) are not guarded.
function guardSession(projectId: string, role: SessionRole): void {
  const sessionId = callerScope().session_id;
  if (!sessionId) return;
  const existing = getSessionRole(projectId, sessionId);
  if (existing && existing !== role) {
    throw new Error(SESSION_ROLE_ERRORS[existing]);
  }
  setSessionRole(projectId, sessionId, role);
}

function mirrorChangedSections(projectId: string, sections: RecordSection[]): void {
  for (const section of sections) {
    writeRecordSection(section, getRecordSection(projectId, section));
    if (section === "recaps") {
      writeRecaps(getRecordSection<Recap>(projectId, "recaps"));
    }
  }
}

/// Get this story's brief (setup-wizard answers), its durable style rules,
/// feedback recorded so far, and the pipeline state. `null` brief means the
/// wizard hasn't been run yet.
export function toolGetBrief(args: any, _context: any): any {
  validate(SCHEMAS.story_get_brief, args ?? {});
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  // SW-3: prompt pack
  return {
    brief: getBrief(projectId),
    rules: getRules(projectId),
    feedback: getFeedback(projectId),
    state: getPipelineState(projectId),
  };
}

/// Get the story's living records (character sheets, relationships,
/// who-knows-what, choices, setup/payoff, glossary, per-chapter state,
/// scene sheets, recaps), optionally limited to some sections and/or capped
/// to chapter-indexed sections up to a given chapter.
export function toolGetRecords(args: any, _context: any): any {
  validate(SCHEMAS.story_get_records, args ?? {});
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  const wanted: readonly string[] =
    Array.isArray(args?.sections) && args.sections.length > 0 ? args.sections : RECORD_SECTIONS;
  const chapterCap: number | null = typeof args?.chapter === "number" ? args.chapter : null;

  const records: Record<string, unknown[]> = {};
  for (const section of RECORD_SECTIONS) {
    if (!wanted.includes(section)) continue;
    let items = getRecordSection(projectId, section);
    if (chapterCap !== null && (section === "chapter_state" || section === "recaps")) {
      items = items.filter((item: any) => typeof item?.chapter === "number" && item.chapter <= chapterCap);
    }
    records[section] = items;
  }
  return { records };
}

/// Upsert-merge a partial records update into storage and mirror the
/// touched sections into story/records/. Item shapes are checked by the
/// schema (RECORD_ITEM_SCHEMAS) before anything is written.
export function toolSubmitRecords(args: any, _context: any): any {
  validate(SCHEMAS.story_submit_records, args);
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  const changed = applyRecordsUpdate(projectId, args.records);
  mirrorChangedSections(projectId, changed);
  const counts: Record<string, number> = {};
  for (const section of changed) counts[section] = getRecordSection(projectId, section).length;
  return { ok: true, sections: changed, counts };
}

/// Store a chapter's text (and optional recap / records update), bumping its
/// revision, and mirror it into story/chapters/.
export function toolSubmitChapter(args: any, _context: any): any {
  validate(SCHEMAS.story_submit_chapter, args);
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  const chapter: number = args.chapter;
  const markdown: string = args.markdown;
  const recap: string | null = typeof args.recap === "string" ? args.recap : null;

  // Records first: a rejected item fails the call before the chapter lands.
  if (args.records) {
    mirrorChangedSections(projectId, applyRecordsUpdate(projectId, args.records));
  }

  const existing = getChapter(projectId, chapter);
  const doc: ChapterDoc = {
    chapter,
    markdown,
    recap,
    revision: (existing?.revision ?? 0) + 1,
    submitted_at: nowIso(),
  };
  putChapter(projectId, doc);
  writeChapter(doc);

  if (recap !== null) {
    const merged = upsertSection("recaps", getRecordSection(projectId, "recaps"), [{ chapter, recap }]);
    putRecordSection(projectId, "recaps", merged);
    mirrorChangedSections(projectId, ["recaps"]);
  }

  return { ok: true, path: `story/chapters/${chapterFileName(chapter)}`, revision: doc.revision };
}

/// Report per-stage progress (status, a status note, stage-specific data).
/// The top-level `stage` is owned by the pipeline engine (src/pipeline.ts),
/// so a worker's `stage` only selects which per-stage entry to update.
export function toolUpdateState(args: any, _context: any): any {
  validate(SCHEMAS.story_update_state, args ?? {});
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  const existing = getPipelineState(projectId);

  const stages = { ...existing.stages };
  if (typeof args?.stage === "string") {
    const id = args.stage as StageId;
    const prior = stages[id];
    stages[id] = {
      status: typeof args?.status === "string" ? args.status : prior?.status ?? "active",
      note: typeof args?.note === "string" ? args.note : prior?.note,
      updated_at: nowIso(),
    };
  }

  const next: PipelineState = {
    stage: existing.stage,
    stages,
    note: typeof args?.note === "string" ? args.note : existing.note,
    data: { ...existing.data, ...(args?.data && typeof args.data === "object" ? args.data : {}) },
    updated_at: nowIso(),
  };
  putPipelineState(projectId, next);
  writeState(next);
  return { ok: true, state: next };
}

/// Report one review pass's verdict on one chapter. A `changes_requested`
/// verdict is recorded as feedback; an optional `rule` is additionally
/// appended to the story's style rules (when a brief exists).
export function toolReportReview(args: any, _context: any): any {
  validate(SCHEMAS.story_report_review, args);
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  const { chapter, pass, verdict, notes } = args;
  const rule: string | null = typeof args.rule === "string" && args.rule.trim().length > 0 ? args.rule : null;

  const existing = getReview(projectId, chapter, pass) ?? { chapter, pass, rounds: [] as ReviewRound[] };
  const round: ReviewRound = { verdict, notes, at: nowIso() };
  const doc: ReviewDoc = { chapter, pass, rounds: [...existing.rounds, round] };
  putReview(projectId, doc);
  writeReview(doc);

  if (verdict === "changes_requested") {
    addFeedback(projectId, { source: "review", chapter, text: notes, appended_to_rules: false });
  }

  if (rule) {
    const brief = getBrief(projectId);
    if (brief) {
      const nextBrief: Brief = {
        ...brief,
        elements: { ...brief.elements, style_rules: [...brief.elements.style_rules, rule] },
        updated_at: nowIso(),
      };
      putBrief(projectId, nextBrief);
      writeBrief(nextBrief);
      addFeedback(projectId, { source: "review", chapter, text: rule, appended_to_rules: true });
    } else {
      addFeedback(projectId, { source: "review", chapter, text: rule, appended_to_rules: false });
    }
  }

  return { ok: true, round };
}

/// Strip any HTML-comment markers (e.g. the `<!-- story-writer:unit=... -->`
/// the pipeline stamps onto card descriptions) from chapter text before a
/// cold reader ever sees it — belt and suspenders, since chapter markdown
/// should already be player-visible only.
function stripMarkers(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").trim();
}

/// FRESH READER SESSIONS ONLY. Get one chapter's player-visible text plus
/// every earlier chapter as a player would see them — nothing else. A
/// chapter not yet submitted is an error; an earlier chapter that's
/// missing (shouldn't happen once the pipeline runs chapters in order) is
/// reported back rather than silently skipped.
export function toolColdReadGetText(args: any, _context: any): any {
  validate(SCHEMAS.story_cold_read_get_text, args);
  const projectId = requireProjectId();
  guardSession(projectId, "cold_reader");
  const chapter: number = args.chapter;

  const doc = getChapter(projectId, chapter);
  if (!doc) throw new Error(`chapter ${chapter} has no submitted text yet`);

  const previous: { chapter: number; text: string }[] = [];
  const missingPrevious: number[] = [];
  for (let i = 1; i < chapter; i++) {
    const prior = getChapter(projectId, i);
    if (prior) previous.push({ chapter: i, text: stripMarkers(prior.markdown) });
    else missingPrevious.push(i);
  }

  return { chapter, text: stripMarkers(doc.markdown), previous, missing_previous: missingPrevious };
}

/// FRESH READER SESSIONS ONLY. Submit one chapter's cold read (C1): every
/// point of confusion from a single, un-primed read, whether the first
/// three lines land, and the first-appearance character list. `attempt`
/// numbers repeat submissions for the same chapter (a redraft after a
/// cold-read fix gets a fresh pilot/chapter card and so a fresh report).
export function toolSubmitColdRead(args: any, _context: any): any {
  validate(SCHEMAS.story_submit_cold_read, args);
  const projectId = requireProjectId();
  guardSession(projectId, "cold_reader");
  const chapter: number = args.chapter;

  const chapterDoc = getChapter(projectId, chapter);
  if (!chapterDoc) throw new Error(`chapter ${chapter} has no submitted text yet`);

  const existing = getColdRead(projectId, chapter);
  const raw: any[] = Array.isArray(args.items) ? args.items : [];
  raw.forEach((it, i) => {
    // "Don't state the obvious" items are fixed by cutting or replacing the
    // exact line, so the writer has to be told which line it was.
    if (it.category === "obvious" && !(typeof it.quote === "string" && it.quote.trim())) {
      throw new Error(`items[${i}]: an "obvious" (over-explained) item must quote the line`);
    }
  });
  const items: ColdReadItem[] = raw.map((it: any, i: number) => ({
    id: `c${i + 1}`,
    category: it.category,
    text: it.text,
    quote: typeof it.quote === "string" && it.quote.trim() ? it.quote : undefined,
    location: typeof it.location === "string" && it.location.trim() ? it.location : undefined,
    fix: null,
  }));

  const doc: ColdReadDoc = {
    chapter,
    attempt: (existing?.attempt ?? 0) + 1,
    chapter_revision: chapterDoc.revision,
    items,
    first_three_lines: args.first_three_lines ?? null,
    characters: Array.isArray(args.characters) ? args.characters : [],
    submitted_at: nowIso(),
  };
  putColdRead(projectId, doc);
  writeColdRead(doc);

  return { ok: true, items: items.map((i) => ({ id: i.id, category: i.category, text: i.text })) };
}

/// Record, for a chapter's cold-read report, exactly what changed in the
/// text to fix each item (C2). The pipeline (src/pipeline.ts) refuses to
/// let the chapter advance past cold-read fixing until every item here has
/// a non-null `fix`.
export function toolSubmitColdReadFixes(args: any, _context: any): any {
  validate(SCHEMAS.story_submit_cold_read_fixes, args);
  const projectId = requireProjectId();
  guardSession(projectId, "context");
  const chapter: number = args.chapter;

  const doc = getColdRead(projectId, chapter);
  if (!doc) throw new Error(`chapter ${chapter} has no cold-read report yet`);

  for (const f of Array.isArray(args.fixes) ? args.fixes : []) {
    const item = doc.items.find((i) => i.id === f.item);
    if (!item) throw new Error(`unknown cold-read item '${f.item}' for chapter ${chapter}`);
    item.fix = f.fix;
    item.fixed_at = nowIso();
  }
  doc.fixes_at = nowIso();
  putColdRead(projectId, doc);
  writeColdRead(doc);

  const unfixed = doc.items.filter((i) => i.fix === null).map((i) => i.id);
  return { ok: true, unfixed };
}
