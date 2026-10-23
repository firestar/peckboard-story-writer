// Input JSON schemas for the six worker-facing MCP tools — the single
// source of truth the manifest declares to agents (src/manifest.ts) and
// src/tools.ts validates calls against (src/validate.ts). Keeping one copy
// means a tool's declared contract and its enforced contract can't drift.

import type { Schema } from "./validate";
import { RECORD_SECTIONS, REVIEW_PASSES, STAGES, STAGE_STATUSES } from "./types";

export const EMPTY_SCHEMA: Schema = { type: "object", properties: {}, additionalProperties: false };

/// Record-section items are open-ended (writers/reviewers add fields like
/// `notes` the schema doesn't enumerate) — only the top-level tool args are
/// closed with `additionalProperties: false`.
const RECORDS_UPDATE_SCHEMA: Schema = {
  type: "object",
  description:
    "Partial records update, keyed by section (characters, relationships, knowledge, choices, " +
    "setups, glossary, chapter_state, scene_sheets, recaps); each value is an array of items for " +
    "that section. Items with a matching identity (id, or `term`/`chapter` for glossary/chapter_state/" +
    "recaps) merge over the existing item; others are appended.",
};

export const SCHEMAS = {
  story_get_brief: EMPTY_SCHEMA,

  story_get_records: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        items: { type: "string", enum: RECORD_SECTIONS },
        description: "Limit the result to these sections (default: all).",
      },
      chapter: {
        type: "integer",
        minimum: 0,
        description: "Limit chapter-indexed sections (chapter_state, recaps) to this chapter and earlier.",
      },
    },
    required: [],
    additionalProperties: false,
  } as Schema,

  story_submit_records: {
    type: "object",
    properties: { records: RECORDS_UPDATE_SCHEMA },
    required: ["records"],
    additionalProperties: false,
  } as Schema,

  story_submit_chapter: {
    type: "object",
    properties: {
      chapter: { type: "integer", minimum: 0, description: "Chapter number (0 = pilot)." },
      markdown: { type: "string", minLength: 1, description: "The complete chapter text." },
      recap: { type: "string", description: "Short recap of this chapter for later context." },
      records: {
        ...RECORDS_UPDATE_SCHEMA,
        description: "Optional partial records update this chapter causes (same shape as story_submit_records).",
      },
    },
    required: ["chapter", "markdown"],
    additionalProperties: false,
  } as Schema,

  story_update_state: {
    type: "object",
    properties: {
      stage: { type: "string", enum: STAGES, description: "Pipeline stage id." },
      status: { type: "string", enum: STAGE_STATUSES, description: "This stage's status." },
      note: { type: "string", description: "Short status note shown on the dashboard." },
      data: { type: "object", description: "Stage-specific structured data." },
    },
    required: [],
    additionalProperties: false,
  } as Schema,

  story_report_review: {
    type: "object",
    properties: {
      chapter: { type: "integer", minimum: 0, description: "Chapter number this review pass covers." },
      pass: { type: "string", enum: REVIEW_PASSES, description: "Which review pass this is." },
      verdict: { type: "string", enum: ["pass", "changes_requested"] },
      notes: { type: "string", description: "Findings / requested changes, or a brief pass note." },
      rule: {
        type: "string",
        description: "Optional: a durable style rule to append to the story's style_rules.",
      },
    },
    required: ["chapter", "pass", "verdict", "notes"],
    additionalProperties: false,
  } as Schema,
} as const;
