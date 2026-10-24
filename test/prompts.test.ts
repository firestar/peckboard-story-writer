import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import {
  lessons,
  lessonIds,
  parseLessons,
  renderLessons,
  promptPack,
  renderCard,
  lessonsFor,
  REVIEW_PASSES,
  ELEMENT_KEYS,
  MAX_DESCRIPTION_CHARS,
  type PromptBrief,
  type PromptFeedback,
  type StageKind,
} from "../src/prompts";

const LESSONS_DOC = fs.readFileSync("docs/writing-lessons.md", "utf8");

const BRIEF_PROSE: PromptBrief = {
  about: "ABOUT-MARK a hunter and her sister in a flooded city",
  basics: {
    title: "Glass Harbour",
    genre: "urban fantasy",
    format: "prose",
    chapter_count: 7,
    pov: "first",
    tense: "present",
    tone: "tense",
    audience: "adult",
    rating: "16+",
  },
  modes: { premise: "write", characters: "generate", style_rules: "draft" },
  elements: {
    premise: "PREMISE-MARK a hunter protects her sister from the Hollow.",
    style_rules: ["RULE-MARK keep it lean"],
    banned_words: ["BANNED-MARK"],
  },
};

const BRIEF_VN: PromptBrief = { ...BRIEF_PROSE, basics: { ...BRIEF_PROSE.basics, format: "vn" } };

const FEEDBACK: PromptFeedback[] = [
  { source: "owner", chapter: 1, text: "FEEDBACK-MARK the ending felt rushed" },
  { source: "review", chapter: 3, text: "REVIEWNOTE-MARK" },
];

const ALL_IDS = [
  "intro",
  "process",
  ...Array.from({ length: 13 }, (_, i) => `process.${i + 1}`),
  "memory",
  "memory.intro",
  "memory.character-sheets",
  "memory.chapter-state",
  "memory.attitudes",
  "memory.reasons",
  "memory.continuity",
  "memory.recaps",
  "memory.setting",
  "craft",
  "craft.setup-payoff",
  "craft.choices",
  "craft.exposition",
  "craft.pov",
  "craft.text-art",
  "craft.box-pacing",
  "craft.escalation",
  "research",
  "research.intro",
  "research.structure",
  "research.character",
  "research.dialogue",
  "research.prose",
  "research.tension",
  "research.fights",
  "research.branching",
  "research.revision",
  "research.ai",
  "research.owner",
  ...Array.from({ length: 36 }, (_, i) => `research.${i + 1}`),
  "reader",
  "reader.intro",
  "reader.intro-characters",
  "reader.openings",
  "reader.opening-craft",
  "reader.reader-knows",
  "reader.mystery",
  "reader.checking",
  "reader.obvious",
  "reader.vn",
  "reader.feelings",
  ...["O1", "O2", "O3", "O4", "O5", "O6", "X1"].map((c) => `reader.${c}`),
  ...Array.from({ length: 10 }, (_, i) => `reader.K${i + 1}`),
  "reader.M1",
  "reader.M2",
  "reader.C1",
  "reader.C2",
  "reader.C3",
  "reader.V1",
  "reader.V2",
  "reader.X2",
  ...["A", "B", "C", "D", "E"].map((l) => `owner.${l}`),
  "style-v1",
  "style",
  "style.voice",
  "style.flow",
  "style.scene-logic",
  "style.dialogue",
  "style.humour",
  "style.drama",
  "english",
  "english.intro",
  "english.conciseness",
  "english.variety",
  "english.grammar",
  "choices",
  "system-voice",
  "mechanical",
  "card-template",
];

describe("lessons parser", () => {
  it("resolves every expected section id to non-empty text", () => {
    const all = lessons();
    for (const id of ALL_IDS) {
      const lesson = all.get(id);
      expect(lesson, `missing id ${id}`).toBeTruthy();
      expect(lesson!.text.trim().length, `empty text for ${id}`).toBeGreaterThan(0);
    }
    expect(lessonIds().length).toBe(ALL_IDS.length);
  });

  it("numbers process items with a bold title", () => {
    for (let n = 1; n <= 13; n++) {
      expect(lessons().get(`process.${n}`)!.text).toMatch(/^\d+\.\s+\*\*/);
    }
  });

  it("owner.A covers subtext", () => {
    expect(lessons().get("owner.A")!.text).toContain("Subtext");
  });

  it("lessons() memoizes the parsed map", () => {
    expect(lessons()).toBe(lessons());
  });

  it("throws on an unmapped H2 heading", () => {
    expect(() => parseLessons("## 99. Mystery section\n\nbody text\n")).toThrow(/unmapped lessons heading/);
  });

  it("throws on an unmapped H3 heading", () => {
    const md = "## 1A. Story memory: x\n\n### Totally Unknown Heading\n\nbody\n";
    expect(() => parseLessons(md)).toThrow(/unmapped lessons heading/);
  });
});

describe("promptPack", () => {
  it("contains every H2 heading line, plus the story's rules and banned words", () => {
    const pack = promptPack(BRIEF_PROSE);
    for (const line of LESSONS_DOC.split("\n")) {
      if (/^## \d+[A-Z]?\. /.test(line)) {
        expect(pack, `missing heading: ${line}`).toContain(line);
      }
    }
    expect(pack).toContain("RULE-MARK");
    expect(pack).toContain("BANNED-MARK");
    expect(pack).toContain("tapestry");
  });

  it("applies a top-level override", () => {
    const pack = promptPack(BRIEF_PROSE, { mechanical: "MECHANICS-OVERRIDE-MARK", choices: "" });
    expect(pack).toContain("MECHANICS-OVERRIDE-MARK");
    expect(pack).not.toContain("## 7. Mechanical rules");
    expect(pack).not.toContain("## 5. Choices");
  });

  it("handles a null brief", () => {
    expect(() => promptPack(null)).not.toThrow();
  });
});

type Kind = StageKind;
const KIND_CASES: Array<{ kind: Kind; chapter?: number; pass?: string; element?: string }> = [
  { kind: "records" },
  { kind: "pilot" },
  { kind: "chapter", chapter: 3 },
  ...REVIEW_PASSES.map((pass) => ({ kind: "review" as const, chapter: 3, pass })),
  { kind: "review", pass: "structure" }, // whole-novel review, no chapter
  { kind: "revision", chapter: 2 },
  ...ELEMENT_KEYS.map((element) => ({ kind: "generate" as const, element })),
];

describe("renderCard", () => {
  for (const format of ["prose", "vn"] as const) {
    const brief = format === "vn" ? BRIEF_VN : BRIEF_PROSE;

    for (const c of KIND_CASES) {
      it(`${format}/${c.kind}${c.chapter ? ` ch${c.chapter}` : ""}${c.pass ? `/${c.pass}` : ""}${c.element ? `/${c.element}` : ""} renders`, () => {
        const card = renderCard(c.kind, {
          brief,
          feedback: FEEDBACK,
          chapter: c.chapter,
          pass: c.pass,
          element: c.element,
          feedbackText: c.kind === "revision" ? "REVISE-MARK fix the rushed ending" : undefined,
        });

        expect(card.title.length).toBeGreaterThan(0);
        expect(card.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
        expect(card.role).toBe(c.kind === "review" ? "reviewer" : "writer");

        expect(card.description).toContain("Glass Harbour");
        expect(card.description).toContain("story_get_brief");
        expect(card.description).toContain("story_get_records");
        expect(card.description).toContain("RULE-MARK");
        expect(card.description).toContain("BANNED-MARK");
        expect(card.description).toContain("tapestry");
        expect(card.description).toContain("FEEDBACK-MARK");

        if (c.kind === "revision") expect(card.description).toContain("REVISE-MARK");

        const pushTool: Record<Kind, string[]> = {
          records: ["story_submit_records"],
          pilot: ["story_submit_chapter"],
          chapter: ["story_submit_chapter"],
          review: ["story_report_review", "story_submit_chapter"],
          revision: ["story_submit_chapter"],
          generate: ["story_update_state", `"draft_${c.element}"`],
        };
        for (const tool of pushTool[c.kind]) expect(card.description).toContain(tool);

        const resolvedChapter = c.kind === "pilot" ? c.chapter ?? 1 : c.chapter;
        const wantsReviewNote = (c.kind === "chapter" || c.kind === "review") && c.chapter === 3;
        if (wantsReviewNote) expect(card.description).toContain("REVIEWNOTE-MARK");
        else expect(card.description).not.toContain("REVIEWNOTE-MARK");

        const ids = lessonsFor(c.kind, { chapter: resolvedChapter, pass: c.pass, element: c.element, format });
        const all = lessons();
        for (const id of ids) {
          const lesson = all.get(id)!;
          const firstLine = lesson.text.split("\n")[0];
          if (format === "prose" && lesson.vnOnly) {
            expect(card.description, `${id} should be dropped in prose`).not.toContain(firstLine);
          } else {
            expect(card.description, `${id} should be present`).toContain(firstLine);
          }
        }
      });
    }
  }

  it("drops vn-only sections entirely in prose format", () => {
    const card = renderCard("chapter", { brief: BRIEF_PROSE, chapter: 3 });
    expect(card.description).not.toContain("## 7. Mechanical rules");
    expect(card.description).not.toContain("## 5. Choices");
  });

  it("puts §1D \"Don't state the obvious\" in the writer cards and the line pass, and lets a story override it", () => {
    for (const card of [
      renderCard("pilot", { brief: BRIEF_PROSE, chapter: 1 }),
      renderCard("chapter", { brief: BRIEF_PROSE, chapter: 3 }),
      renderCard("review", { brief: BRIEF_PROSE, chapter: 3, pass: "line" }),
    ]) {
      expect(card.description).toContain("### Don't state the obvious");
      expect(card.description).toContain("Never explain what every adult already knows");
    }
    const off = renderCard("chapter", { brief: BRIEF_PROSE, chapter: 3, overrides: { "reader.obvious": "" } });
    expect(off.description).not.toContain("### Don't state the obvious");
  });

  it("applies per-id overrides, including omission", () => {
    const card = renderCard("chapter", {
      brief: BRIEF_VN,
      chapter: 3,
      overrides: { "style.humour": "OVERRIDE-MARK", "research.ai": "" },
    });
    expect(card.description).toContain("OVERRIDE-MARK");
    expect(card.description).not.toContain("Humour: none written");
    expect(card.description).not.toContain("### AI failure modes");
  });

  it("stays within budget with heavy feedback, keeping the newest item", () => {
    const heavy: PromptFeedback[] = Array.from({ length: 400 }, (_, i) => ({
      source: "owner" as const,
      chapter: 1,
      text: `old feedback #${i} `.padEnd(300, "x"),
    }));
    heavy.push({ source: "owner", chapter: 1, text: "NEWEST-FEEDBACK-MARK" });

    const card = renderCard("chapter", { brief: BRIEF_PROSE, chapter: 1, feedback: heavy });
    expect(card.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(card.description).toContain("NEWEST-FEEDBACK-MARK");
    expect(card.description).toContain("older feedback items omitted");
  });

  it("renders every kind with a null brief", () => {
    for (const c of KIND_CASES) {
      const card = renderCard(c.kind, {
        brief: null,
        chapter: c.chapter,
        pass: c.pass,
        element: c.element,
        feedbackText: c.kind === "revision" ? "REVISE-MARK" : undefined,
      });
      expect(card.description).toContain("brief not set");
    }
  });

  it("throws when a required field is missing", () => {
    expect(() => renderCard("chapter", { brief: null })).toThrow();
    expect(() => renderCard("review", { brief: null, chapter: 1, pass: "not-a-real-pass" })).toThrow();
    expect(() => renderCard("generate", { brief: null, element: "not-a-real-element" })).toThrow();
    expect(() => renderCard("revision", { brief: null, chapter: 1 })).toThrow();
  });

  it("renders all kinds x formats quickly", () => {
    const start = Date.now();
    for (const format of ["prose", "vn"] as const) {
      const brief = format === "vn" ? BRIEF_VN : BRIEF_PROSE;
      for (const c of KIND_CASES) {
        renderCard(c.kind, {
          brief,
          feedback: FEEDBACK,
          chapter: c.chapter,
          pass: c.pass,
          element: c.element,
          feedbackText: c.kind === "revision" ? "REVISE-MARK" : undefined,
        });
      }
    }
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("draft mode titles the card for owner edit and embeds the existing content", () => {
    const card = renderCard("generate", {
      brief: { ...BRIEF_PROSE, elements: { ...BRIEF_PROSE.elements, style_rules: ["RULE-MARK keep it lean"] } },
      element: "style_rules",
    });
    expect(card.title).toBe("Draft Style rules for owner edit");
    expect(card.description).toContain("Existing draft to edit");
    expect(renderCard("generate", { brief: BRIEF_PROSE, element: "characters" }).title).toBe("Generate Characters");
  });

  it("prose chapter tasks don't mention VN art; vn ones do", () => {
    expect(renderCard("chapter", { brief: BRIEF_PROSE, chapter: 2 }).description).not.toContain("sprites");
    expect(renderCard("chapter", { brief: BRIEF_VN, chapter: 2 }).description).toContain("sprites");
  });

  it("contract only uses stage ids story_update_state accepts", () => {
    for (const c of KIND_CASES) {
      const d = renderCard(c.kind, { brief: BRIEF_VN, chapter: c.chapter, pass: c.pass, element: c.element, feedbackText: "x" }).description;
      for (const m of d.matchAll(/stage:"([^"]+)"/g)) {
        expect(["setup", "records", "pilot", "pilot_review", "chapters", "review", "final"]).toContain(m[1]);
      }
    }
  });

  it("whole-novel review reports once per chapter", () => {
    const d = renderCard("review", { brief: BRIEF_PROSE, pass: "structure" }).description;
    expect(d).toContain("once per chapter reviewed");
    expect(d).toContain("Review (structure) — whole novel");
  });

  it("trims story rules last-first only when they can't fit, never lessons", () => {
    const rules = Array.from({ length: 200 }, (_, i) => `rule #${i} `.padEnd(400, "r"));
    rules[0] = "FIRST-RULE-MARK";
    const brief = { ...BRIEF_PROSE, elements: { ...BRIEF_PROSE.elements, style_rules: rules } };
    const card = renderCard("chapter", { brief, chapter: 3 });
    expect(card.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(card.description).toContain("FIRST-RULE-MARK");
    expect(card.description).toContain("more story rules omitted");
    expect(card.description).toContain("## Lessons");
    expect(card.description).toContain(lessons().get("style.drama")!.text.split("\n")[0]);
  });
});
