// The six worker-facing MCP tools (story_get_brief, story_get_records,
// story_submit_records, story_submit_chapter, story_update_state,
// story_report_review). Each is scoped to the calling project
// (`requireProjectId`), validates its input against src/schemas.ts (the same
// schemas the manifest declares), persists through the typed doc store
// (src/docs.ts), and mirrors the human-readable result into the project
// repo under story/ (src/files.ts, project_files_write — only allowed during
// this tool invocation).

import { requireProjectId } from "./host";
import { validate } from "./validate";
import { SCHEMAS } from "./schemas";
import {
  addFeedback,
  applyRecordsUpdate,
  getBrief,
  getChapter,
  getFeedback,
  getPipelineState,
  getRecordSection,
  getReview,
  getRules,
  putBrief,
  putChapter,
  putPipelineState,
  putRecordSection,
  putReview,
  upsertSection,
} from "./docs";
import { chapterFileName, writeBrief, writeChapter, writeRecaps, writeRecordSection, writeReview, writeState } from "./files";
import { Brief, ChapterDoc, PipelineState, Recap, RECORD_SECTIONS, RecordSection, ReviewDoc, ReviewRound, nowIso } from "./types";

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

/// Report pipeline progress (stage, status, a status note, stage-specific
/// data). Does not advance cards itself — card.step.after / timer.tick
/// drive the stage machine (src/pipeline.ts, later card).
export function toolUpdateState(args: any, _context: any): any {
  validate(SCHEMAS.story_update_state, args ?? {});
  const projectId = requireProjectId();
  const existing = getPipelineState(projectId);
  const stage = typeof args?.stage === "string" ? args.stage : existing.stage;

  const stages = { ...existing.stages };
  if (typeof args?.stage === "string") {
    const prior = stages[args.stage];
    stages[args.stage] = {
      status: typeof args?.status === "string" ? args.status : prior?.status ?? "active",
      note: typeof args?.note === "string" ? args.note : prior?.note,
      updated_at: nowIso(),
    };
  }

  const next: PipelineState = {
    stage,
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
