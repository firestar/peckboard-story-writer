// Owner-review revision card (SW-12): the owner reviewed a draft in rounds,
// anchoring notes to lines of the chapter, and pressed "Request changes".
// The writer gets every note — kind, line range, the exact quoted passage,
// the owner's words — addresses each one, and records how (like cold-read
// fixes, C2), so the next round can show the owner what happened to every
// note. A fresh cold read then runs on the redraft before it goes back to
// the owner.

import { renderLessons } from "./lessons";
import { chapterPath, UNIT_ARG_LINE } from "./contract";
import { briefSection, clip, DISCLAIMER, formatOf, lessonsFor, MAX_DESCRIPTION_CHARS, rulesSection, type PromptBrief } from "./templates";

export const OWNER_REVIEW_FIXES_TOOL = "story_submit_owner_review_fixes";

export interface OwnerCardNote {
  id: string;
  kind: string; // OwnerNoteKind
  start_line: number;
  end_line: number;
  quote: string;
  body: string;
  revision: number;
  resolution?: { action: string; how: string } | null;
}

export interface OwnerReviewCardInput {
  chapter: number;
  round: number;
  /// Chapter revision the owner decided on.
  revision: number;
  brief: PromptBrief | null;
  overrides?: Record<string, string>;
  notes: OwnerCardNote[];
  summary?: string;
}

export interface OwnerReviewCardSpec {
  title: string;
  description: string;
  role: "writer";
}

const KIND_LABELS: Record<string, string> = {
  comment: "Comment",
  suggest: "Suggest edit",
  wrong: "Mark wrong",
  expand: "Expand",
  shorten: "Shorten",
};

/// What each note kind asks the writer to do — same verbs as PeckBoard's
/// Review page (docs/host-review-api.md).
const KIND_TASKS = [
  "Comment: do what it asks. If it's a question about the text, answer it in the text where the reader needs it.",
  "Suggest edit: use the owner's replacement text. Adapt it only where continuity, the records or the story rules force it, and say what you changed and why.",
  "Mark wrong: fix exactly what the note says is wrong.",
  "Expand: add what the note asks for — or, with no note text, what the passage is missing — in the story's voice, without filler.",
  "Shorten: cut the passage down to what does work. With no note text, cut what repeats or explains the obvious.",
];

function lines(n: OwnerCardNote): string {
  return n.end_line > n.start_line ? `lines ${n.start_line}–${n.end_line}` : `line ${n.start_line}`;
}

function noteBlock(n: OwnerCardNote): string {
  const out = [`- **${n.id}** · ${KIND_LABELS[n.kind] ?? n.kind} · ${lines(n)} (revision ${n.revision})`];
  if (n.quote) out.push(`  > ${clip(n.quote, 600).replace(/\n+/g, " ")}`);
  out.push(n.body ? `  Owner: ${clip(n.body, 1500).replace(/\n+/g, " ")}` : "  Owner: (no text — the kind is the instruction)");
  if (n.resolution) out.push(`  Already recorded: ${n.resolution.action} — ${clip(n.resolution.how, 300)}`);
  return out.join("\n");
}

const NOTES_BUDGET = 30000;

function notesSection(input: OwnerReviewCardInput): string {
  const { chapter, revision, notes, summary } = input;
  const head = [
    "## The owner's review notes",
    "",
    `Line numbers refer to chapter ${chapter} as the owner read it (draft revision ${revision}, ${chapterPath(chapter)}). ` +
      "The quote is the exact passage — find it by the quote if the lines have moved.",
    "",
  ];
  const body: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const n of notes) {
    const block = noteBlock(n);
    if (body.length > 0 && used + block.length > NOTES_BUDGET) {
      omitted++;
      continue;
    }
    body.push(block);
    used += block.length + 1;
  }
  if (notes.length === 0) body.push("(no line notes — work from the overall note below)");
  if (omitted > 0) body.push(`\n(${omitted} more note${omitted === 1 ? "" : "s"} — full list via story_get_brief → owner_reviews)`);
  const overall = summary && summary.trim() ? ["", "### Overall note", "", `> ${clip(summary, 3000).replace(/\n+/g, "\n> ")}`] : [];
  return [...head, ...body, ...overall].join("\n");
}

export function renderOwnerReviewCard(input: OwnerReviewCardInput): OwnerReviewCardSpec {
  const { chapter, round, brief, overrides = {}, notes } = input;
  const fmt = formatOf(brief);
  const isPilot = chapter === 1;
  const title = isPilot ? `Revise pilot chapter 1 from owner review — round ${round}` : `Revise chapter ${chapter} from owner review — round ${round}`;
  const count = notes.length;
  const ids = notes.map((n) => n.id);

  const header = [
    `# ${title}`,
    "",
    `The owner reviewed this draft and requested changes${count ? ` with ${count} note${count === 1 ? "" : "s"}` : ""}. ` +
      "Address every note, record how you handled each one, and resubmit the chapter. A fresh cold read runs on your " +
      `new draft before it goes back to the owner as round ${round + 1}.`,
    "",
    DISCLAIMER,
  ].join("\n");

  const taskMd = [
    "## Task",
    "",
    "1. Read the brief and the records (story_get_brief, story_get_records).",
    `2. Read the current text of chapter ${chapter} (${chapterPath(chapter)}).`,
    "3. Go through the notes in order. For each one, find the quoted passage and act on it by its kind:",
    ...KIND_TASKS.map((t) => `   - ${t}`),
    "4. Address every note — none may be skipped. Change nothing the notes don't cover, except where a fix forces a continuity change elsewhere in the chapter (then say so in that note's resolution).",
    "5. Read the whole chapter once as a reader; fix anything that no longer connects to the lines around it.",
    `6. Resubmit the full chapter with story_submit_chapter {chapter: ${chapter}, markdown, recap, records} — update the records the changes touched.`,
    `7. Record how you handled every note with ${OWNER_REVIEW_FIXES_TOOL} {chapter: ${chapter}, round: ${round}, resolutions: [{note: "${ids[0] ?? "n1"}", action, how}, ...]}` +
      (count ? ` — one entry per note id above (${ids.join(", ")}).` : " (no line notes: call it with an empty list)."),
    '   - action "fixed": the text now does what the note asks; `how` says what changed.',
    '   - action "answered": the note was a question; `how` is the answer (and where the text now shows it, if it does).',
    '   - action "declined": only when the note conflicts with the brief, the records or an earlier owner decision — `how` names the conflict. The owner sees every declined note in the next round.',
  ].join("\n");

  const doneMd = [
    "## Done when",
    "",
    "- [ ] Every note is fixed in the text, answered, or declined with the conflict named",
    "- [ ] Nothing outside the notes changed except continuity a fix forced",
    "- [ ] The chapter reads clean start to finish",
    `- [ ] story_submit_chapter and ${OWNER_REVIEW_FIXES_TOOL} called`,
  ].join("\n");

  const contractMd = [
    "## Tools contract",
    "",
    "Pull context first: story_get_brief, then story_get_records.",
    "Push results only through story_* tools — the plugin stores them and writes the story/ files. Never write story/ files directly.",
    `Resubmit the revised chapter with story_submit_chapter {chapter:${chapter}, markdown, recap, records}, then record every note with ${OWNER_REVIEW_FIXES_TOOL}.`,
    UNIT_ARG_LINE,
    "Don't create, move or unblock pipeline cards — the plugin starts the cold read and opens the owner's next round when this card reaches done.",
  ].join("\n");

  const lessonsMd = `## Lessons\n\n${renderLessons(lessonsFor("revision", { chapter, format: fmt }), { format: fmt, overrides })}`;

  const assemble = (keep: number, notesMd: string) =>
    [header, briefSection(brief), rulesSection(brief, keep), notesMd, taskMd, doneMd, contractMd, lessonsMd].join("\n\n");
  const notesMd = notesSection(input);
  const rules = Array.isArray(brief?.elements?.style_rules) ? (brief!.elements!.style_rules as unknown[]).length : 0;
  let keep = rules;
  let description = assemble(keep, notesMd);
  while (description.length > MAX_DESCRIPTION_CHARS && keep > 0) {
    keep--;
    description = assemble(keep, notesMd);
  }
  return { title, description, role: "writer" };
}
