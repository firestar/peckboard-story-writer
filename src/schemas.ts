// Input JSON schemas for the six worker-facing MCP tools — the single
// source of truth the manifest declares to agents (src/manifest.ts) and
// src/tools.ts validates calls against (src/validate.ts). Keeping one copy
// means a tool's declared contract and its enforced contract can't drift.

import type { Schema } from "./validate";
import { COLD_READ_CATEGORIES, MAX_UNEXPLAINED_PER_SCENE, RECORD_ID_KEY, RECORD_SECTIONS, RecordSection, REVIEW_PASSES, STAGES, STAGE_STATUSES } from "./types";

export const EMPTY_SCHEMA: Schema = { type: "object", properties: {}, additionalProperties: false };

const ID: Schema = { type: "string", minLength: 1 };
const TEXT: Schema = { type: "string" };
const CHAPTER: Schema = { type: "integer", minimum: 0 };
const FIRST_INTRO: Schema = {
  type: "object",
  properties: { chapter: CHAPTER, scene: TEXT, line: TEXT },
  required: ["chapter", "scene", "line"],
};

/// One item schema per record section. Only the identity field is required
/// by the schema: an item updating an existing one may carry just its
/// identity plus the changed fields. A NEW item must also carry
/// `RECORD_REQUIRED_FIELDS[section]` — that depends on what is stored, so
/// src/docs.ts `applyRecordsUpdate` checks it. Items are open-ended
/// (writers/reviewers add fields like `notes`), so no
/// `additionalProperties: false` here — only the top-level tool args and the
/// section map are closed.
function item(section: RecordSection, properties: Record<string, Schema>): Schema {
  return { type: "object", properties, required: [RECORD_ID_KEY[section]] };
}

export const RECORD_ITEM_SCHEMAS: Record<RecordSection, Schema> = {
  characters: item("characters", { id: ID, name: TEXT, first_intro: FIRST_INTRO }),
  relationships: item("relationships", { id: ID, a: TEXT, b: TEXT }),
  knowledge: item("knowledge", {
    id: ID,
    fact: TEXT,
    known_by: {
      type: "array",
      items: { type: "object", properties: { character: TEXT, since_chapter: CHAPTER }, required: ["character", "since_chapter"] },
    },
  }),
  choices: item("choices", { id: ID, chapter: CHAPTER, options: { type: "array" } }),
  setups: item("setups", { id: ID, promise: TEXT, setup_chapter: CHAPTER }),
  glossary: item("glossary", { term: ID, definition: TEXT }),
  chapter_state: item("chapter_state", { chapter: CHAPTER }),
  scene_sheets: item("scene_sheets", {
    id: ID,
    chapter: CHAPTER,
    scene: TEXT,
    unexplained: {
      type: "array",
      maxItems: MAX_UNEXPLAINED_PER_SCENE,
      items: {
        type: "object",
        properties: {
          name: TEXT,
          kind: { type: "string", enum: ["name", "term", "rule"] },
          answered_in: {
            type: "object",
            properties: { chapter: CHAPTER, scene: TEXT },
            required: ["chapter"],
          },
        },
        required: ["name", "kind"],
      },
    },
  }),
  recaps: item("recaps", { chapter: CHAPTER, recap: TEXT }),
};

const RECORDS_UPDATE_SCHEMA: Schema = {
  type: "object",
  properties: Object.fromEntries(
    RECORD_SECTIONS.map((section) => [section, { type: "array", items: RECORD_ITEM_SCHEMAS[section] } as Schema]),
  ),
  additionalProperties: false,
  description:
    "Partial records update, keyed by section (characters, relationships, knowledge, choices, " +
    "setups, glossary, chapter_state, scene_sheets, recaps); each value is an array of items for " +
    "that section. Items with a matching identity (id, or `term`/`chapter` for glossary/chapter_state/" +
    "recaps) merge over the existing item (send only the changed fields); others are appended and " +
    "must carry the section's essential fields (characters: id+name, relationships: id+a+b, " +
    "knowledge: id+fact+known_by, choices: id+chapter+options, setups: id+promise+setup_chapter, " +
    "glossary: term+definition, scene_sheets: id+chapter+scene, recaps: chapter+recap).",
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
      stage: { type: "string", enum: STAGES, description: "Which stage this status/note is about (does not move the pipeline)." },
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

  story_cold_read_get_text: {
    type: "object",
    properties: {
      chapter: {
        type: "integer",
        minimum: 1,
        description: "Chapter to cold-read (the pilot is chapter 1). Returns only that chapter's text plus chapters 1..N-1 as a player saw them.",
      },
    },
    required: ["chapter"],
    additionalProperties: false,
  } as Schema,

  story_submit_cold_read: {
    type: "object",
    properties: {
      chapter: { type: "integer", minimum: 1 },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: COLD_READ_CATEGORIES,
              description:
                "unexplained = name/term used before it's explained; speaker = unclear speaker or pronoun; " +
                "orientation = unclear place, time or elapsed time; motive = unexplained motive; reread = had " +
                "to guess or re-read; contradiction = contradicts earlier text; other = any other confusion; " +
                "obvious = over-explained: the line explains what every adult already knows or repeats what " +
                "follows from the line before (quote it).",
            },
            text: { type: "string", minLength: 1 },
            quote: TEXT,
            location: { type: "string", description: "Where in the chapter (e.g. \"scene 2, third paragraph\")." },
          },
          required: ["category", "text"],
        },
        description: "Every point of confusion found on a single cold read, plus every over-explained line (category obvious).",
      },
      first_three_lines: {
        type: "object",
        properties: {
          narrator: { type: "boolean" },
          want: { type: "boolean" },
          tension: { type: "boolean" },
          clear: { type: "boolean" },
        },
        required: ["narrator", "want", "tension", "clear"],
      },
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: { name: TEXT, said: TEXT },
          required: ["name", "said"],
        },
        description: "Characters in order of first appearance, with only what the text said about them.",
      },
    },
    required: ["chapter", "items", "characters"],
    additionalProperties: false,
  } as Schema,

  story_submit_cold_read_fixes: {
    type: "object",
    properties: {
      chapter: { type: "integer", minimum: 1 },
      fixes: {
        type: "array",
        items: {
          type: "object",
          properties: { item: ID, fix: { type: "string", minLength: 1 } },
          required: ["item", "fix"],
        },
        description: "One fix per cold-read item id (story_submit_cold_read's returned item ids).",
      },
    },
    required: ["chapter", "fixes"],
    additionalProperties: false,
  } as Schema,
} as const;
