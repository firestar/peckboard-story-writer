// Cold-read (C1) and cold-read-fix (C2) card templates.
//
// A cold read must see ONLY what a player sees: the chapter text plus
// chapters 1..N-1 as the reader encountered them — never the brief, story
// rules, owner/review feedback, records or any other worker's output.
// That text is delivered at runtime through story_cold_read_get_text
// (input limited to player-visible text — see the project context's MCP
// tools list), never embedded here, so these two templates don't take a
// brief at all.
//
// These are deliberately NOT part of the StageKind/renderCard dispatcher
// in templates.ts: the pipeline wiring that creates one of these cards per
// chapter (and advances the stage machine on completion) is SW-9's job.
// This file only has to produce a correct card given a chapter number.

import { renderLessons } from "./lessons";
import { briefSection, clip, DISCLAIMER, formatOf, rulesSection, type PromptBrief } from "./templates";

export const COLD_READ_TOOLS = {
  getText: "story_cold_read_get_text",
  submitColdRead: "story_submit_cold_read",
  submitFixes: "story_submit_cold_read_fixes",
} as const;

export interface ColdReadCardSpec {
  title: string;
  description: string;
  role: "writer" | "reviewer";
}

export interface ColdReadCardInput {
  chapter: number;
  isPilot?: boolean;
}

// What counts as confusion, for the reviewer's own calibration — not craft
// advice about writing, since a cold reader isn't fixing anything.
const COLD_READ_LESSON_IDS = ["reader.checking", "reader.reader-knows", "reader.mystery"];

/// A FRESH reviewer session: no brief, no records, no rules, no feedback,
/// no prior worker output of any kind — only the chapter text (fetched via
/// story_cold_read_get_text, never embedded in this card).
export function renderColdReadCard(input: ColdReadCardInput): ColdReadCardSpec {
  const { chapter, isPilot } = input;
  const title = isPilot ? `Cold read — pilot chapter ${chapter}` : `Cold read — chapter ${chapter}`;

  const header = [
    `# ${title}`,
    "",
    "You are a completely fresh reader. You have never seen this story before and have no access",
    "to the writers' brief, story records, rules, cards, feedback or any other worker's output —",
    "only the chapter text itself. Don't call story_get_brief or story_get_records; don't ask for",
    "anything beyond what story_cold_read_get_text gives you.",
  ].join("\n");

  const taskMd = [
    "## Task",
    "",
    `1. Call ${COLD_READ_TOOLS.getText} {chapter: ${chapter}} to get this chapter's player-visible text` +
      (chapter > 1 ? `, plus chapters 1..${chapter - 1} as a player would see them.` : "."),
    "2. Read start to finish, once, cold — no re-reading to figure something out, no priming.",
    "3. Note every point of confusion: names or terms used before they're explained; an unclear" +
      " speaker or pronoun; unclear place, time or elapsed time; an unexplained motive; anything" +
      " you had to guess or re-read to understand; any contradiction with what you read earlier.",
    "4. Check the first three lines: can you say who the narrator is, what they want right now," +
      " and what the tension is? If not, say so plainly.",
    "5. List every character in order of first appearance, with exactly what the text said about" +
      " them at that point — not what you inferred or already knew.",
    `6. Submit with ${COLD_READ_TOOLS.submitColdRead} {chapter: ${chapter}, items, first_three_lines, characters}.`,
  ].join("\n");

  const doneMd = [
    "## Done when",
    "",
    "- [ ] Every point of confusion is reported, not silently resolved by re-reading",
    "- [ ] Characters are listed in order of first appearance with only what the text said",
    `- [ ] ${COLD_READ_TOOLS.submitColdRead} called`,
  ].join("\n");

  const lessonsMd = `## What counts as confusion\n\n${renderLessons(COLD_READ_LESSON_IDS, { format: "prose" })}`;

  const description = [header, taskMd, doneMd, lessonsMd].join("\n\n");
  return { title, description, role: "reviewer" };
}

export interface ColdReadFixCardInput {
  chapter: number;
  brief: PromptBrief | null;
  overrides?: Record<string, string>;
  items: string[];
}

// The craft needed to actually fix clarity issues, not just the checklist.
const COLD_READ_FIX_LESSON_IDS = ["reader.intro-characters", "reader.openings", "reader.reader-knows", "reader.checking", "reader.vn"];
/// The writer, with full context, fixing every cold-read item. Unlike the
/// cold-read card, this one gets the brief and the story's rules — the fix
/// has to land inside the actual story's voice and continuity. `items` are
/// pre-formatted "id: text" lines (src/pipeline.ts `coldReadItemTexts`) so
/// the writer can reference the same id in story_submit_cold_read_fixes.
export function renderColdReadFixCard(input: ColdReadFixCardInput): ColdReadCardSpec {
  const { chapter, brief, overrides = {}, items } = input;
  const fmt = formatOf(brief);
  const title = `Cold-read fixes — chapter ${chapter}`;

  const header = [`# ${title}`, "", "Fix every item a fresh reader got confused by in this chapter.", "", DISCLAIMER].join("\n");
  const briefMd = briefSection(brief);
  const rulesMd = rulesSection(brief);

  const itemsMd =
    items.length > 0
      ? `## Cold-read report\n\n${items.map((it) => `- ${clip(it, 2000)}`).join("\n")}`
      : "## Cold-read report\n\n(no items)";

  const taskMd = [
    "## Task",
    "",
    "1. Read the brief and the records (story_get_brief, story_get_records).",
    "2. Read the cold-read report above: every confusion item (each with its id) and the character first-appearance list.",
    "3. Fix every item in the chapter text. C2: confusion is the text's fault, not the reader's —" +
      " fix emphasis, order or clarity; never argue the point was already there.",
    "4. Record item→fix: for each cold-read item above, note exactly what in the text changed.",
    `5. Resubmit the fixed chapter with story_submit_chapter, then log the mapping with ${COLD_READ_TOOLS.submitFixes} ` +
      `{chapter: ${chapter}, fixes: [{item: "c1", fix: "..."}, ...]} — one entry per item id shown above.`,
  ].join("\n");

  const doneMd = [
    "## Done when",
    "",
    "- [ ] Every cold-read item is fixed in the text, not argued away",
    "- [ ] Each item has a recorded fix",
    "- [ ] story_submit_chapter and " + COLD_READ_TOOLS.submitFixes + " called",
  ].join("\n");

  const lessonsMd = `## Lessons\n\n${renderLessons(COLD_READ_FIX_LESSON_IDS, { format: fmt, overrides })}`;

  const description = [header, briefMd, rulesMd, itemsMd, taskMd, doneMd, lessonsMd].join("\n\n");
  return { title, description, role: "writer" };
}
