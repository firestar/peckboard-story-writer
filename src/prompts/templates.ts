// Card-description templates for every stage of the pipeline: records,
// pilot, chapter N, each review pass, a revision from feedback, and an
// AI-generate element draft. Each embeds the brief, owner/review feedback,
// the story's rule overrides, the tools contract, and exactly the lessons
// relevant to that stage — never the whole 450-line lessons doc.

import { packLessons, renderLessons } from "./lessons";
import { contract, chapterPath, draftKey, StageKind } from "./contract";

export type Format = "prose" | "vn";

export const REVIEW_PASSES = ["structure", "character", "pacing", "line", "copyedit", "ai-tell", "echo-word", "sentence-shape"] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

export const ELEMENT_KEYS = [
  "premise",
  "plot_outline",
  "setting",
  "characters",
  "relationships",
  "themes",
  "endings",
  "style_rules",
  "banned_words",
] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];

const ELEMENT_LABELS: Record<ElementKey, string> = {
  premise: "Premise",
  plot_outline: "Plot outline",
  setting: "Setting / world",
  characters: "Characters",
  relationships: "Relationships",
  themes: "Themes",
  endings: "Endings / routes / choices",
  style_rules: "Style rules",
  banned_words: "Banned words",
};

const ELEMENT_HINTS: Record<ElementKey, string> = {
  premise: "a short string.",
  plot_outline:
    "a markdown string: one `## Chapter N: title` section per chapter (brief.basics.chapter_count total), each a short summary plus its scenes as bullets, each scene caused by the one before it.",
  setting: "a markdown string: a summary, the key places (name + description), and the world's rules.",
  characters:
    "CharacterSheet[]: {id, name, role, personality, values, fears, flaws, want, need, lie, wound, ghost, speech_habit, initial_emotion, attitudes:[{toward, attitude, reason}], knows:[]}.",
  relationships: "[{id, a, b, kind, description}].",
  themes: "string[].",
  endings: '[{id, name, kind:"ending"|"route", description, conditions}].',
  style_rules: "string[] — no numeric quotas, no sample lines you don't want copied verbatim.",
  banned_words: "string[].",
};

export interface PromptBrief {
  about?: string;
  basics?: {
    title?: string;
    genre?: string;
    format?: string;
    chapter_count?: number;
    pov?: string;
    tense?: string;
    tone?: string;
    audience?: string;
    rating?: string;
  };
  modes?: Record<string, string>;
  elements?: Record<string, unknown>;
}

export interface PromptFeedback {
  source?: "owner" | "review";
  chapter?: number | null;
  text: string;
  at?: string;
}

export interface RenderInput {
  brief: PromptBrief | null;
  feedback?: PromptFeedback[];
  overrides?: Record<string, string>;
  chapter?: number;
  pass?: string;
  element?: string;
  feedbackText?: string;
}

export interface CardSpec {
  title: string;
  description: string;
  role: "writer" | "reviewer";
  kind: StageKind;
}

export const MAX_DESCRIPTION_CHARS = 48000;

const DEFAULT_BANNED = [
  "tapestry",
  "testament to",
  "delve",
  "a sense of",
  "palpable",
  "unwavering",
  "echoed through",
  "whispered through",
  "in the realm of",
  "it's worth noting",
  "boundaries of",
];

const DISCLAIMER =
  "> Default lessons below were learned on an earlier visual novel; their examples quote that story " +
  "(Elin, Nadia, the Vein). Follow the rules, not the examples' content. Where this story's brief or " +
  "story rules differ (POV, tense, format, spelling, tone), the brief and story rules win.";

function clip(v: unknown, n: number): string {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)) + "…";
}

function formatOf(brief: PromptBrief | null): Format {
  return brief?.basics?.format === "vn" ? "vn" : "prose";
}

function briefSection(brief: PromptBrief | null): string {
  if (!brief) {
    return "## Brief\n\n(brief not set yet — use story_get_brief)";
  }
  const b = brief.basics ?? {};
  const formatLabel = b.format === "vn" ? "visual-novel script" : "prose novel";
  const lines = [
    "## Brief",
    "",
    `**${clip(b.title ?? "(untitled)", 120)}** · ${clip(b.genre ?? "—", 60)} · ${formatLabel} · ` +
      `${b.chapter_count ?? "?"} chapters · ${clip(b.pov ?? "—", 30)}/${clip(b.tense ?? "—", 20)} · ` +
      `${clip(b.tone ?? "—", 60)} · ${clip(b.audience ?? "—", 30)}/${clip(b.rating ?? "—", 20)}`,
    "",
    `About: ${clip(brief.about ?? "—", 600)}`,
  ];
  const premise = brief.elements?.premise;
  if (premise) lines.push("", `Premise: ${clip(premise, 800)}`);
  lines.push("", "Full brief: story_get_brief.");
  return lines.join("\n");
}

function storyRules(brief: PromptBrief | null): string[] {
  return Array.isArray(brief?.elements?.style_rules) ? (brief!.elements!.style_rules as unknown[]).map(String) : [];
}

/// `keep` caps how many story rules are listed (the rest are noted, not
/// lost: story_get_brief has them all) — used only when the card would
/// otherwise exceed MAX_DESCRIPTION_CHARS.
function rulesSection(brief: PromptBrief | null, keep = Infinity): string {
  const rules = storyRules(brief);
  const bannedWords = Array.isArray(brief?.elements?.banned_words) ? (brief!.elements!.banned_words as unknown[]).map(String) : [];
  const seen = new Set<string>();
  const bannedDisplay: string[] = [];
  for (const w of [...bannedWords, ...DEFAULT_BANNED]) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bannedDisplay.push(w);
  }
  const shown = rules.slice(0, keep);
  let ruleLines = shown.length > 0 ? shown.map((r) => `- ${r}`).join("\n") : "(none yet)";
  if (shown.length < rules.length) ruleLines += `\n\n(${rules.length - shown.length} more story rules omitted — full list via story_get_brief)`;
  return `## Story rules (override the defaults)\n\n${ruleLines}\n\nBanned words (never use): ${bannedDisplay.join(", ")}.`;
}

function filterFeedback(kind: StageKind, feedback: PromptFeedback[], chapter?: number): PromptFeedback[] {
  if (kind === "chapter" || kind === "pilot" || kind === "revision" || kind === "review") {
    return feedback.filter((f) => (f.source ?? "owner") === "owner" || f.chapter === chapter);
  }
  return feedback.filter((f) => (f.source ?? "owner") === "owner");
}

function feedbackSection(feedback: PromptFeedback[], budget: number): string {
  if (feedback.length === 0) return "";
  const header = "## Owner feedback\n\n";
  const reversed = feedback.slice().reverse(); // newest first
  const rendered: string[] = [];

  const renderWith = (n: number) => {
    const omitted = reversed.length - n;
    const note = omitted > 0 ? `\n\n(${omitted} older feedback item${omitted === 1 ? "" : "s"} omitted — full list via story_get_brief)` : "";
    return header + rendered.slice(0, n).join("\n\n") + note;
  };

  for (const f of reversed) {
    const label = f.chapter != null ? `chapter ${f.chapter}` : "general";
    rendered.push(`> [${f.source ?? "owner"}, ${label}] ${clip(f.text, 2000)}`);
    // Always keep at least the newest entry, even if it alone exceeds budget.
    if (rendered.length > 1 && renderWith(rendered.length).length > budget) {
      rendered.pop();
      break;
    }
  }
  return renderWith(rendered.length);
}

const H3_STYLE_IDS = ["style.voice", "style.flow", "style.scene-logic", "style.dialogue", "style.humour", "style.drama"];

export function lessonsFor(kind: StageKind, input: { chapter?: number; pass?: string; element?: string; format?: Format }): string[] {
  const chapterIds = [
    "process.3",
    "process.4",
    "process.6",
    "memory.intro",
    "memory.chapter-state",
    "memory.attitudes",
    "memory.reasons",
    "memory.continuity",
    "memory.recaps",
    "memory.setting",
    "craft.setup-payoff",
    "craft.choices",
    "craft.exposition",
    "craft.pov",
    "craft.text-art",
    "craft.box-pacing",
    "craft.escalation",
    "research.structure",
    "research.dialogue",
    "research.prose",
    "research.tension",
    "research.fights",
    "research.ai",
    "research.owner",
    ...H3_STYLE_IDS,
    "english",
    "choices",
    "system-voice",
    "mechanical",
  ];

  switch (kind) {
    case "records":
      return [
        "process.2",
        "process.4",
        "memory.intro",
        "memory.character-sheets",
        "memory.chapter-state",
        "memory.attitudes",
        "memory.recaps",
        "memory.setting",
        "craft.setup-payoff",
        "craft.exposition",
        "craft.choices",
        "craft.escalation",
        "research.structure",
        "research.character",
        "research.branching",
        "research.20",
        "research.36",
      ];
    case "pilot":
      return ["process.1", "process.11", ...chapterIds];
    case "chapter":
      return chapterIds;
    case "review": {
      const base = ["process.3", "process.6", "process.9"];
      const byPass: Record<string, string[]> = {
        structure: [
          "process.1",
          "process.5",
          "research.structure",
          "research.tension",
          "research.36",
          "research.29",
          "craft.setup-payoff",
          "craft.escalation",
          "craft.choices",
          "research.branching",
          "memory.continuity",
        ],
        character: [
          "memory.character-sheets",
          "memory.chapter-state",
          "memory.attitudes",
          "memory.reasons",
          "research.character",
          "research.dialogue",
          "owner.A",
          "craft.pov",
          "style.dialogue",
        ],
        pacing: [
          "craft.box-pacing",
          "research.16",
          "research.19",
          "research.21",
          "research.22",
          "style.flow",
          "style.drama",
          "research.fights",
          "owner.B",
          "memory.continuity",
        ],
        line: [...H3_STYLE_IDS, "style-v1", "research.prose", "research.11", "research.12", "research.13", "owner.E", "english.intro", "english.conciseness", "english.variety"],
        copyedit: ["english.intro", "english.grammar", "research.30", "choices", "system-voice", "mechanical"],
        "ai-tell": ["research.ai", "research.15", "research.12", "style.humour", "english.conciseness"],
        "echo-word": ["research.18", "english.intro", "english.conciseness"],
        "sentence-shape": ["research.34", "english.variety", "english.grammar", "owner.B"],
      };
      const extra = input.pass ? byPass[input.pass] : undefined;
      if (!extra) throw new Error(`unknown review pass: ${input.pass}`);
      return [...base, ...extra];
    }
    case "revision":
      return [
        "process.3",
        "process.6",
        "process.9",
        "memory.reasons",
        "memory.continuity",
        ...H3_STYLE_IDS,
        "english.intro",
        "english.conciseness",
        "research.ai",
        "research.owner",
        "mechanical",
      ];
    case "generate": {
      const byElement: Record<ElementKey, string[]> = {
        premise: ["research.6", "research.21", "craft.escalation", "style.voice"],
        plot_outline: ["process.2", "research.structure", "research.tension", "research.36", "craft.setup-payoff", "craft.escalation", "research.branching"],
        setting: ["craft.exposition", "memory.setting", "owner.E"],
        characters: ["memory.character-sheets", "research.character", "style.dialogue", "owner.A"],
        relationships: ["research.10", "research.14", "memory.attitudes"],
        themes: ["research.6", "research.7"],
        endings: ["craft.choices", "research.branching", "owner.C", "owner.D", ...(input.format === "prose" ? ["research.structure"] : [])],
        style_rules: ["process.7", "process.8", ...H3_STYLE_IDS, "english.intro", "research.owner"],
        banned_words: ["research.32", "research.15", "research.12", "english.conciseness"],
      };
      const element = input.element as ElementKey;
      const ids = byElement[element];
      if (!ids) throw new Error(`unknown generate element: ${input.element}`);
      return ids;
    }
  }
}

function titleFor(kind: StageKind, input: RenderInput & { chapter?: number }): string {
  switch (kind) {
    case "records":
      return "Story records: characters, knowledge, setup/payoff";
    case "pilot":
      return `Pilot chapter ${input.chapter}`;
    case "chapter":
      return `Chapter ${input.chapter}`;
    case "review":
      return input.chapter != null ? `Review (${input.pass}) — chapter ${input.chapter}` : `Review (${input.pass}) — whole novel`;
    case "revision":
      return `Revise chapter ${input.chapter} from owner feedback`;
    case "generate": {
      const key = input.element as ElementKey;
      const label = ELEMENT_LABELS[key];
      const mode = input.brief?.modes?.[key];
      return mode === "draft" ? `Draft ${label} for owner edit` : `Generate ${label}`;
    }
  }
}

function roleLine(kind: StageKind): string {
  switch (kind) {
    case "records":
      return "Build the story's living records before any chapter is written.";
    case "pilot":
      return "Write the pilot chapter alone; the owner reviews it before the rest fan out.";
    case "chapter":
      return "Write this chapter.";
    case "review":
      return "Review and fix this chapter (or the whole novel), then report the verdict.";
    case "revision":
      return "Revise this chapter from the feedback below.";
    case "generate":
      return "Generate this story element as a draft for the owner to review in the wizard.";
  }
}

function taskFor(kind: StageKind, input: RenderInput & { chapter?: number; format: Format }): string[] {
  switch (kind) {
    case "records":
      return [
        "Read the brief (story_get_brief) and the setup-wizard answers.",
        "Build a character sheet for every character: role, personality, values/fears/flaws, want vs need, lie/wound/ghost, one speech habit, starting emotion, starting attitude to every other character with a reason, and what they know.",
        "Build the relationships, the glossary, the setup/payoff list (promise → progress → payoff), and chapter 1's scene-fact sheet and chapter-state sheet.",
        "Submit everything with story_submit_records.",
      ];
    case "pilot":
    case "chapter":
      return [
        "Read the brief, the records (story_get_records), and the recap of every earlier chapter.",
        "Build a scene-fact sheet per scene: time, place, light, who's present and where, what each person wants, what the lead carries/wears/is injured by.",
        input.format === "vn"
          ? "Look at this chapter's background art and sprites before writing each scene; let the setting drive what happens."
          : "Picture each scene's place before writing it; let the setting drive what happens.",
        "Write the whole chapter scene by scene — never line by line. No jokes, no filler; fights run in phases with a low point before the turn.",
        "Read the full chapter once as a reader; fix anything that doesn't connect to the lines around it; re-read until a full read finds nothing.",
        "Update the records that changed (chapter state, who-knows-what, setup/payoff, glossary) last, and write a short recap.",
        "Submit with story_submit_chapter.",
      ];
    case "review":
      return [
        "Read the chapter(s) and the records.",
        "Read start to finish as a reader; note every place a line doesn't connect to the ones around it.",
        "Fix this pass's concerns in place; re-read until a full read finds nothing.",
        "Check the checklist of past fixes isn't being undone by this pass.",
        "Report the verdict with story_report_review.",
      ];
    case "revision":
      return [
        `Owner/review feedback to fix: "${clip(input.feedbackText ?? "", 2000)}"`,
        "Read the current chapter text and the records.",
        "Fix exactly what the feedback calls out, without introducing new problems.",
        "Re-read the whole chapter once it's clean.",
        "Resubmit with story_submit_chapter.",
      ];
    case "generate": {
      const key = input.element as ElementKey;
      const label = ELEMENT_LABELS[key];
      const lines = ["Read the brief and the records.", `Draft the ${label.toLowerCase()}. Value shape: ${ELEMENT_HINTS[key]}`];
      const existing = input.brief?.elements?.[key];
      const mode = input.brief?.modes?.[key];
      if (mode === "draft" && existing) {
        lines.push(`Existing draft to edit, not replace wholesale: ${clip(existing, 2000)}`);
      }
      lines.push("Push the draft with story_update_state — don't call story_submit_records or story_submit_chapter for this card.");
      return lines;
    }
  }
}

function doneFor(kind: StageKind): string[] {
  switch (kind) {
    case "records":
      return [
        "Every character has a sheet with role, personality, values/fears/flaws, want vs need, lie/wound/ghost, speech habit, starting emotion, starting attitudes with reasons, and what they know",
        "Relationships, glossary and setup/payoff list exist",
        "story_submit_records called",
      ];
    case "pilot":
    case "chapter":
      return [
        "The chapter reads clean start to finish",
        "Every line has a reason; nothing contradicts the records or the setting",
        "Records updated and a recap written",
        "story_submit_chapter called",
      ];
    case "review":
      return ["A full read finds nothing left to fix for this pass", "Past fixes from the checklist are still in place", "story_report_review called"];
    case "revision":
      return ["The feedback's specific complaint is fixed", "No new problems introduced", "story_submit_chapter called"];
    case "generate":
      return ["The draft follows the value shape", "No banned words or story-rule violations", "story_update_state called with the draft"];
  }
}

/// Render one pipeline card's title + description for the given stage.
export function renderCard(kind: StageKind, input: RenderInput): CardSpec {
  const brief = input.brief;
  const fmt = formatOf(brief);
  const overrides = input.overrides ?? {};

  let chapter = input.chapter;
  if (kind === "pilot") chapter = chapter ?? 1;
  if ((kind === "chapter" || kind === "revision") && chapter == null) {
    throw new Error(`${kind} card requires input.chapter`);
  }
  if (kind === "revision" && (!input.feedbackText || input.feedbackText.trim() === "")) {
    throw new Error("revision card requires input.feedbackText");
  }
  if (kind === "review" && !(REVIEW_PASSES as readonly string[]).includes(input.pass ?? "")) {
    throw new Error(`review card requires a valid input.pass (one of ${REVIEW_PASSES.join(", ")})`);
  }
  if (kind === "generate" && !(ELEMENT_KEYS as readonly string[]).includes(input.element ?? "")) {
    throw new Error(`generate card requires a valid input.element (one of ${ELEMENT_KEYS.join(", ")})`);
  }

  const resolved = { ...input, chapter, format: fmt };
  const title = titleFor(kind, resolved);
  const role: "writer" | "reviewer" = kind === "review" ? "reviewer" : "writer";
  const ids = lessonsFor(kind, { chapter, pass: input.pass, element: input.element, format: fmt });
  const feedback = filterFeedback(kind, input.feedback ?? [], chapter);

  const header = `# ${title}\n\n${roleLine(kind)}\n\n${DISCLAIMER}`;
  const briefMd = briefSection(brief);
  const taskLines = taskFor(kind, resolved);
  const taskMd = `## Task\n\n${taskLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
  const doneMd = `## Done when\n\n${doneFor(kind).map((l) => `- [ ] ${l}`).join("\n")}`;
  const contractMd = contract(kind, { chapter, pass: input.pass, element: input.element });
  const lessonsMd = `## Lessons\n\n${renderLessons(ids, { format: fmt, overrides })}`;

  // Lessons are never cut. Story rules are trimmed last-first only if the
  // card can't fit them at all; feedback fills whatever budget is left.
  const assemble = (rulesMd: string) => [header, briefMd, rulesMd, taskMd, doneMd, contractMd, lessonsMd].join("\n\n");
  let keep = storyRules(brief).length;
  let rulesMd = rulesSection(brief, keep);
  let core = assemble(rulesMd);
  while (core.length > MAX_DESCRIPTION_CHARS && keep > 0) {
    keep--;
    rulesMd = rulesSection(brief, keep);
    core = assemble(rulesMd);
  }

  const budget = Math.max(0, MAX_DESCRIPTION_CHARS - core.length - "\n\n".length);
  const feedbackMd = feedbackSection(feedback, budget);

  const description = feedbackMd ? [header, briefMd, feedbackMd, rulesMd, taskMd, doneMd, contractMd, lessonsMd].join("\n\n") : core;

  return { title, description, role, kind };
}

/// The full default style guide (every lessons section, document order,
/// all formats) with top-level overrides, followed by this story's rules
/// and banned words — the reference doc for story_get_brief's SW-3 hook.
export function promptPack(brief: PromptBrief | null, overrides: Record<string, string> = {}): string {
  return `${packLessons(overrides)}\n\n${rulesSection(brief)}`;
}

export { chapterPath, draftKey };
export type { StageKind };
