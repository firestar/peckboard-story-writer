import { describe, expect, it } from "vitest";
import { renderColdReadCard, renderColdReadFixCard, COLD_READ_TOOLS, type PromptBrief } from "../src/prompts";

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

  it("records the fault-is-the-text's rule (C2)", () => {
    const card = renderColdReadFixCard({ chapter: 1, brief: null, items: [] });
    expect(card.description).toContain("C2");
  });
});
