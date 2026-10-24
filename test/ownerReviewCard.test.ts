import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_CHARS, renderOwnerReviewCard, type OwnerCardNote, type PromptBrief } from "../src/prompts";
import { feedbackText, revisionProblem } from "../src/ownerReview";
import type { OwnerReviewRound } from "../src/types";

const BRIEF: PromptBrief = {
  about: "A harbour town.",
  basics: { title: "Salt", genre: "urban fantasy", format: "prose", chapter_count: 3, pov: "first", tense: "past" },
  elements: { premise: "p", style_rules: ["No weather openers."], banned_words: [] },
};

function n(id: string, over: Partial<OwnerCardNote> = {}): OwnerCardNote {
  return { id, kind: "wrong", start_line: 4, end_line: 6, quote: "Mara forgave him.", body: "Too fast.", revision: 2, ...over };
}

describe("owner review revision card", () => {
  it("lists every note with kind, lines, quote and text, and asks for a resolution per note", () => {
    const card = renderOwnerReviewCard({ chapter: 2, round: 3, revision: 2, brief: BRIEF, notes: [n("n1"), n("n2", { kind: "shorten", body: "", start_line: 9, end_line: 9 })], summary: "Colder." });
    expect(card.title).toBe("Revise chapter 2 from owner review — round 3");
    expect(card.role).toBe("writer");
    expect(card.description).toContain("**n1** · Mark wrong · lines 4–6 (revision 2)");
    expect(card.description).toContain("> Mara forgave him.");
    expect(card.description).toContain("Owner: Too fast.");
    expect(card.description).toContain("**n2** · Shorten · line 9");
    expect(card.description).toContain("(no text — the kind is the instruction)");
    expect(card.description).toContain("### Overall note");
    expect(card.description).toContain("story_submit_owner_review_fixes {chapter: 2, round: 3");
    expect(card.description).toContain("(n1, n2)");
    expect(card.description).toContain("Address every note — none may be skipped.");
    expect(card.description).toContain('action "declined": only when the note conflicts');
    expect(card.description).toContain("back to the owner as round 4");
    expect(card.description).toContain("No weather openers."); // story rules
    expect(card.description).toContain("## Lessons");
  });

  it("names the pilot and stays under the description cap with a full round of long notes", () => {
    const notes = Array.from({ length: 100 }, (_, i) => n(`n${i + 1}`, { body: "x".repeat(4000), quote: "q".repeat(1000) }));
    const card = renderOwnerReviewCard({ chapter: 1, round: 1, revision: 1, brief: BRIEF, notes });
    expect(card.title).toBe("Revise pilot chapter 1 from owner review — round 1");
    expect(card.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(card.description).toMatch(/\(\d+ more notes — full list via story_get_brief → owner_reviews\)/);
  });
});

function round(over: Partial<OwnerReviewRound> = {}): OwnerReviewRound {
  return { round: 1, chapter_revision: 2, status: "changes_requested", notes: [], opened_at: "", decided_revision: 2, ...over };
}

describe("owner review helpers", () => {
  it("feedback text: the overall note verbatim without notes, a note digest with them", () => {
    expect(feedbackText(1, round(), "Less weather.")).toBe("Less weather.");
    const text = feedbackText(
      3,
      round({
        round: 2,
        notes: [{ id: "n1", kind: "suggest", start_line: 2, end_line: 2, quote: "They left.", body: "They ran.", revision: 2, created_at: "", resolution: null }],
      }),
      "",
    );
    expect(text).toBe('Owner review of chapter 3, round 2: 1 note.\n- n1 Suggest edit, line 2 "They left." — They ran.');
  });

  it("a revision counts only with every note resolved and a newer draft when anything was fixed", () => {
    const note = { id: "n1", kind: "wrong" as const, start_line: 1, end_line: 1, quote: "", body: "x", revision: 2, created_at: "", resolution: null };
    expect(revisionProblem(1, round({ notes: [note] }), 3)).toContain("still unaddressed for chapter 1 (round 1): n1");
    const fixed = { ...note, resolution: { action: "fixed" as const, how: "y", at: "" } };
    expect(revisionProblem(1, round({ notes: [fixed] }), 2)).toContain("without a new draft");
    expect(revisionProblem(1, round({ notes: [fixed] }), 3)).toBeNull();
    const answered = { ...note, resolution: { action: "answered" as const, how: "y", at: "" } };
    expect(revisionProblem(1, round({ notes: [answered] }), 2)).toBeNull(); // nothing to redraft
    expect(revisionProblem(1, round({ summary: "Colder." }), 2)).toContain("without a new draft");
  });
});
