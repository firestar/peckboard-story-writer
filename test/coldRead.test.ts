import { describe, expect, it } from "vitest";
import { renderColdReadCard, renderColdReadFixCard, COLD_READ_TOOLS, type PromptBrief } from "../src/prompts";
import { renderLessons } from "../src/prompts/lessons";
import { lessonsFor } from "../src/prompts/templates";

const BRIEF: PromptBrief = {
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
  elements: {
    style_rules: ["RULE-MARK keep it lean"],
    banned_words: ["BANNED-MARK"],
  },
};

// Every string that would leak brief/records/rules/feedback CONTENT into a
// cold-read card — if any of these showed up, the "fresh reviewer" premise
// is broken. (The card legitimately names story_get_brief/story_get_records
// once, to tell the reviewer NOT to call them — that's not a content leak.)
const LEAKABLE_MARKS = ["Glass Harbour", "ABOUT-MARK", "RULE-MARK", "BANNED-MARK"];

describe("renderColdReadCard", () => {
  it("renders for a chapter and for the pilot", () => {
    const chapter = renderColdReadCard({ chapter: 3 });
    expect(chapter.title).toBe("Cold read — chapter 3");
    expect(chapter.role).toBe("reviewer");
    expect(chapter.description.length).toBeGreaterThan(0);

    const pilot = renderColdReadCard({ chapter: 1, isPilot: true });
    expect(pilot.title).toContain("pilot");
  });

  it("carries no brief, records, rules or feedback content", () => {
    const card = renderColdReadCard({ chapter: 3 });
    for (const mark of LEAKABLE_MARKS) {
      expect(card.description, `should not contain ${mark}`).not.toContain(mark);
    }
  });

  it("instructs the reviewer to pull text via the cold-read tool only", () => {
    const card = renderColdReadCard({ chapter: 4 });
    expect(card.description).toContain(COLD_READ_TOOLS.getText);
    expect(card.description).toContain(COLD_READ_TOOLS.submitColdRead);
  });

  it("covers every confusion category and the first-3-lines check", () => {
    const card = renderColdReadCard({ chapter: 2 });
    expect(card.description).toContain("first three lines");
    expect(card.description).toContain("order of first appearance");
    expect(card.description).toContain("What counts as confusion");
    for (const cat of ["unexplained", "speaker", "orientation", "motive", "reread", "contradiction", "other", "obvious"]) {
      expect(card.description, cat).toContain(`\`${cat}\``);
    }
    expect(card.description).toContain("location");
  });

  it("asks for over-explained lines and carries the §1D \"Don't state the obvious\" lesson", () => {
    const card = renderColdReadCard({ chapter: 2 });
    expect(card.description).toContain("explains what every");
    expect(card.description).toContain("### Don't state the obvious");
    expect(card.description).toContain("Nadia only leaves messages when I stop");
    const fix = renderColdReadFixCard({ chapter: 2, brief: null, items: ["c1 [Over-explained / obvious]: explains voicemail"] });
    expect(fix.description).toContain("### Don't state the obvious");
    expect(fix.description).toContain("cutting the quoted line, or by replacing the");
  });

  it("doesn't offer earlier chapters for chapter 1", () => {
    expect(renderColdReadCard({ chapter: 1 }).description).not.toContain("chapters 1..0");
    expect(renderColdReadCard({ chapter: 3 }).description).toContain("chapters 1..2");
  });
});

describe("renderColdReadFixCard", () => {
  it("renders with the brief, story rules and the cold-read report embedded", () => {
    const card = renderColdReadFixCard({ chapter: 3, brief: BRIEF, items: ["ITEM-MARK: who is Nadia?"] });
    expect(card.title).toBe("Cold-read fixes — chapter 3");
    expect(card.role).toBe("writer");
    expect(card.description).toContain("Glass Harbour");
    expect(card.description).toContain("RULE-MARK");
    expect(card.description).toContain("ITEM-MARK");
    expect(card.description).toContain(COLD_READ_TOOLS.submitFixes);
    expect(card.description).toContain("story_submit_chapter");
  });

  it("renders with a null brief and no items", () => {
    const card = renderColdReadFixCard({ chapter: 1, brief: null, items: [] });
    expect(card.description).toContain("brief not set");
    expect(card.description).toContain("(no items)");
  });

  it("embeds the cold reader's first-appearance character list, in order", () => {
    const card = renderColdReadFixCard({
      chapter: 2,
      brief: null,
      items: ["c1 [Other confusion]: x"],
      characters: ["Jun: the narrator, a courier", "Nadia: a name on a voicemail"],
    });
    expect(card.description).toContain("## Characters in order of first appearance (cold reader)");
    expect(card.description).toContain("1. Jun: the narrator, a courier\n2. Nadia: a name on a voicemail");
    expect(renderColdReadFixCard({ chapter: 2, brief: null, items: [] }).description).toContain("(none reported)");
  });

  it("records the fault-is-the-text's rule (C2)", () => {
    const card = renderColdReadFixCard({ chapter: 1, brief: null, items: [] });
    expect(card.description).toContain("C2");
  });
});

describe("reader V1/V2 are visual-novel only", () => {
  for (const kind of ["pilot", "chapter"] as const) {
    it(`${kind} lessons carry V1/V2 for vn and drop them for prose`, () => {
      const vn = renderLessons(lessonsFor(kind, { chapter: 2, format: "vn" }), { format: "vn" });
      const prose = renderLessons(lessonsFor(kind, { chapter: 2, format: "prose" }), { format: "prose" });
      expect(vn).toContain("V1. Narrator first");
      expect(vn).toContain("V2. A name plate is an introduction");
      expect(prose).not.toContain("V1.");
      expect(prose).not.toContain("V2.");
      expect(prose).toContain("O1.");
    });
  }

  it("the fix card follows the brief's format", () => {
    const vnBrief: PromptBrief = { ...BRIEF, basics: { ...BRIEF.basics!, format: "vn" } };
    expect(renderColdReadFixCard({ chapter: 2, brief: vnBrief, items: [] }).description).toContain("V1. Narrator first");
    expect(renderColdReadFixCard({ chapter: 2, brief: BRIEF, items: [] }).description).not.toContain("V1.");
  });
});