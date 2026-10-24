import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCard, callerScope, docStore, fakeCards, fileWrites, hostCalls, pluginSettings, setHandlers, setSession } from "./fakeHost";
import { dispatch } from "../src/lib";

const PROJECT = "proj-1";
const ALL_PASSES = ["structure", "character", "pacing", "line", "copyedit", "ai-tell", "echo-word", "sentence-shape"];

function allow(raw: string): any {
  const v = JSON.parse(raw);
  expect(v.verdict).toBe("allow");
  return v.payload;
}

function invoke(tool: string, args: unknown = {}): any {
  return allow(dispatch("mcp.tool.invoke", { tool, arguments: args, context: {} }));
}

function authed(method: string, path: string, body?: any): { status: number; body: any } {
  const resp = allow(
    dispatch("http.request.authed", {
      method,
      path: `/api/plugin-ui/story-writer${path}`,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  return { status: resp.status, body: JSON.parse(resp.body) };
}

function cardStep(cards: ReturnType<typeof fakeCards>, cardId: string, step: "done" | "wont_do", projectId = PROJECT): void {
  cards.setStep(cardId, step);
  dispatch("card.step.after", {
    card_id: cardId,
    card_title: "x",
    project_id: projectId,
    project_name: "P",
    old_step: "in_progress",
    new_step: step,
    terminal: true,
  });
}

function finishCard(cards: ReturnType<typeof fakeCards>, cardId: string): void {
  cardStep(cards, cardId, "done");
}

function failCard(cards: ReturnType<typeof fakeCards>, cardId: string): void {
  cardStep(cards, cardId, "wont_do");
}

function open(cards: FakeCard[]): FakeCard[] {
  return cards.filter((c) => c.step !== "done" && c.step !== "wont_do");
}

/// A real writer calls story_submit_chapter before its card reaches done —
/// the cold-read tools (and the engine's own freshness check) need the
/// chapter's text to already be stored. Submits a throwaway draft, then
/// finishes the card.
function submitAndFinish(cards: ReturnType<typeof fakeCards>, cardId: string, chapter: number): void {
  invoke("story_submit_chapter", { chapter, markdown: `# Chapter ${chapter}\n\nDraft text.` });
  finishCard(cards, cardId);
}

function briefFixture(overrides: any = {}): any {
  const modes = {
    premise: "write",
    plot_outline: "write",
    setting: "write",
    characters: "write",
    relationships: "write",
    themes: "write",
    endings: "write",
    style_rules: "write",
    banned_words: "write",
  };
  return {
    about: "A city falls.",
    basics: { title: "T", genre: "g", format: "prose", chapter_count: 3, pov: "third", tense: "past", tone: "tense", audience: "adult", rating: "16+" },
    modes,
    status: {},
    elements: { premise: "p", plot_outline: "po", setting: "s", characters: [], relationships: [], themes: [], endings: [], style_rules: [], banned_words: [] },
    updated_at: "",
    ...overrides,
  };
}

function setupBrief(overrides: any = {}): any {
  const brief = briefFixture(overrides);
  const res = authed("POST", "/wizard", { brief });
  expect(res.status).toBe(200);
  return brief;
}

/// Run one chapter's cold-read (C1) -> cold-read-fix (C2) chain to
/// completion against whatever cold-read/fix cards are currently open: a
/// FRESH session reads and reports (no items by default), the ordinary
/// session fixes any reported items, and each card is finished so the
/// engine's chain clears. Pass `itemTexts` to exercise the fix card.
let coldSessionSeq = 0;
function finishColdRead(cards: ReturnType<typeof fakeCards>, chapter: number, itemTexts: string[] = []): void {
  setSession(`cold-${chapter}-${coldSessionSeq++}`);
  invoke("story_cold_read_get_text", { chapter });
  invoke("story_submit_cold_read", {
    chapter,
    items: itemTexts.map((text) => ({ category: "other", text })),
    first_three_lines: { narrator: true, want: true, tension: true, clear: true },
    characters: [],
  });
  setSession("session-1");

  const readCard = open(cards.cards).find((c) => c.title.startsWith("Cold read"))!;
  expect(readCard, `cold-read card for chapter ${chapter}`).toBeTruthy();
  finishCard(cards, readCard.id);

  if (itemTexts.length === 0) return;
  const fixCard = open(cards.cards).find((c) => c.title.startsWith("Cold-read fixes"))!;
  expect(fixCard, `cold-read-fix card for chapter ${chapter}`).toBeTruthy();
  invoke("story_submit_cold_read_fixes", {
    chapter,
    fixes: itemTexts.map((text, i) => ({ item: `c${i + 1}`, fix: `Fixed: ${text}` })),
  });
  finishCard(cards, fixCard.id);
}

let cards: ReturnType<typeof fakeCards>;
let docs: Record<string, unknown>;

beforeEach(() => {
  cards = fakeCards();
  const fw = fileWrites();
  const ds = docStore();
  docs = ds.docs;
  setHandlers({
    ...ds.handlers,
    ...callerScope(PROJECT),
    ...fw.handlers,
    ...cards.handlers,
    ...pluginSettings({ writer_model: "claude:writer@acct", reviewer_model: "claude:reviewer@acct" }),
  });
});

describe("pipeline engine: happy path", () => {
  it("drives records -> pilot -> cold read -> gate -> chapters -> cold read -> review -> final -> export", () => {
    setupBrief();
    expect(authed("POST", "/pipeline/start").body.ok).toBe(true);

    expect(cards.cards).toHaveLength(1);
    const recordsCard = cards.cards[0];
    expect(recordsCard.title).toMatch(/records/i);
    expect(recordsCard.model).toBe("claude:writer@acct");

    finishCard(cards, recordsCard.id);

    // Pilot + two blocked parallel chapter cards (2, 3) now exist.
    expect(open(cards.cards)).toHaveLength(3);
    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    const ch2 = cards.cards.find((c) => c.title === "Chapter 2")!;
    const ch3 = cards.cards.find((c) => c.title === "Chapter 3")!;
    expect(pilotCard).toBeTruthy();
    expect(ch2.blocked).toBe(true);
    expect(ch3.blocked).toBe(true);

    submitAndFinish(cards, pilotCard.id, 1);
    finishColdRead(cards, 1); // C1/C2 for the pilot, no items -> clears straight through
    expect(authed("GET", "/state").body.engine.stage).toBe("pilot_review");

    const approve = authed("POST", "/pipeline/approve");
    expect(approve.body.ok).toBe(true);
    expect(cards.cards.find((c) => c.id === ch2.id)!.blocked).toBe(false);
    expect(cards.cards.find((c) => c.id === ch3.id)!.blocked).toBe(false);

    submitAndFinish(cards, ch2.id, 2);
    finishColdRead(cards, 2);
    submitAndFinish(cards, ch3.id, 3);
    finishColdRead(cards, 3);
    expect(authed("GET", "/state").body.engine.stage).toBe("review");

    for (const ch of [1, 2, 3]) {
      for (const pass of ALL_PASSES) {
        const reviewCard = cards.cards.find((c) => c.step !== "done" && c.title.includes(`(${pass})`) && c.title.endsWith(`chapter ${ch}`));
        expect(reviewCard, `review card for chapter ${ch} pass ${pass}`).toBeTruthy();
        invoke("story_report_review", { chapter: ch, pass, verdict: "pass", notes: "clean" });
        finishCard(cards, reviewCard!.id);
      }
    }

    const state = authed("GET", "/state").body;
    expect(state.engine.stage).toBe("final");
    expect(state.engine.finished).toBe(true);
    // The engine owns PipelineState's top-level stage and mirrors it.
    expect(state.pipeline.stage).toBe("final");
    expect(state.pipeline.stages.final.status).toBe("done");
    expect(state.pipeline.stages.records.status).toBe("done");
    expect(state.pipeline.stages.review.status).toBe("done");
    expect(state.cold_reads.map((d: any) => d.chapter).sort()).toEqual([1, 2, 3]);

    for (const ch of [1, 2, 3]) invoke("story_submit_chapter", { chapter: ch, markdown: `Chapter ${ch} text`, recap: `r${ch}` });
    const exported = authed("GET", "/export").body;
    expect(exported.chapters).toEqual([1, 2, 3]);
    expect(exported.markdown).toContain("Chapter 1 text");
    expect(exported.markdown).toContain("Chapter 3 text");
  });
});

describe("pipeline engine: owner review gate", () => {
  it("rejects approve before the pilot is reviewable, and while a pilot revision is open", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    const recordsCard = cards.cards[0];

    expect(authed("POST", "/pipeline/approve").status).toBe(409);

    finishCard(cards, recordsCard.id);
    expect(authed("POST", "/pipeline/approve").status).toBe(409); // still in "pilot": pilot card not done yet

    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    submitAndFinish(cards, pilotCard.id, 1);
    finishColdRead(cards, 1); // -> pilot_review

    expect(authed("POST", "/pipeline/feedback", { text: "Rushed ending." }).status).toBe(200);
    expect(authed("POST", "/pipeline/approve").status).toBe(409); // pilot revision still open

    const revisionCard = open(cards.cards).find((c) => c.title.toLowerCase().includes("revise"))!;
    expect(revisionCard).toBeTruthy();
    finishCard(cards, revisionCard.id);

    expect(authed("POST", "/pipeline/approve").status).toBe(200);
  });
});

describe("pipeline engine: owner feedback revision loop", () => {
  it("creates a revision card, appends the feedback to style rules, and records it", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    submitAndFinish(cards, pilotCard.id, 1);
    finishColdRead(cards, 1);

    const fb = authed("POST", "/pipeline/feedback", { text: "Too rushed." });
    expect(fb.body.ok).toBe(true);

    const got = invoke("story_get_brief");
    expect(got.rules).toContain("Too rushed.");
    expect(got.feedback).toMatchObject([{ source: "owner", chapter: 1, text: "Too rushed.", appended_to_rules: true }]);

    const revisionCard = open(cards.cards).find((c) => c.title.toLowerCase().includes("revise"))!;
    expect(revisionCard).toBeTruthy();
    expect(revisionCard.description).toContain("Too rushed.");

    finishCard(cards, revisionCard.id);
    expect(authed("GET", "/state").body.engine.stage).toBe("pilot_review"); // still waiting for approval
  });

  it("rejects feedback before the pilot stage, and for a chapter that hasn't been submitted", () => {
    setupBrief();
    expect(authed("POST", "/pipeline/feedback", { text: "too early" }).status).toBe(409);

    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    submitAndFinish(cards, pilotCard.id, 1);
    finishColdRead(cards, 1);

    expect(authed("POST", "/pipeline/feedback", { chapter: 7, text: "no such chapter" }).status).toBe(400);
  });
});

describe("pipeline engine: review changes_requested loop", () => {
  it("creates a revision on changes_requested and re-runs the same pass with a fresh card", () => {
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 1 } });
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id); // records
    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    submitAndFinish(cards, pilotCard.id, 1); // -> cold read
    finishColdRead(cards, 1); // -> pilot_review
    authed("POST", "/pipeline/approve"); // -> chapters (vacuous, chapter_count 1) -> review

    expect(authed("GET", "/state").body.engine.stage).toBe("review");

    const structureCard = open(cards.cards).find((c) => c.title.includes("(structure)"))!;
    expect(structureCard).toBeTruthy();
    invoke("story_report_review", { chapter: 1, pass: "structure", verdict: "changes_requested", notes: "Fix the midpoint." });
    finishCard(cards, structureCard.id);

    const revCard = open(cards.cards).find((c) => c.title.toLowerCase().includes("revise"))!;
    expect(revCard.description).toContain("Fix the midpoint.");
    finishCard(cards, revCard.id);

    // Same pass, retried: a brand-new structure-review card for chapter 1.
    const structureCard2 = open(cards.cards).find((c) => c.title.includes("(structure)"))!;
    expect(structureCard2).toBeTruthy();
    expect(structureCard2.id).not.toBe(structureCard.id);

    invoke("story_report_review", { chapter: 1, pass: "structure", verdict: "pass", notes: "clean" });
    finishCard(cards, structureCard2.id);

    const nextPass = open(cards.cards).find((c) => c.title.includes("(character)"));
    expect(nextPass).toBeTruthy();
  });

  it("stops re-rolling a pass after MAX_REVIEW_ROUNDS and moves on anyway", () => {
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 1 } });
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);
    finishColdRead(cards, 1);
    authed("POST", "/pipeline/approve");

    for (let round = 1; round <= 2; round++) {
      const structureCard = open(cards.cards).find((c) => c.title.includes("(structure)"))!;
      invoke("story_report_review", { chapter: 1, pass: "structure", verdict: "changes_requested", notes: `round ${round}` });
      finishCard(cards, structureCard.id);
      if (round < 2) {
        const revCard = open(cards.cards).find((c) => c.title.toLowerCase().includes("revise"))!;
        finishCard(cards, revCard.id);
      }
    }
    // Second changes_requested hit the round cap — moves to the next pass
    // instead of asking for a third structure review.
    expect(open(cards.cards).some((c) => c.title.includes("(structure)"))).toBe(false);
    expect(open(cards.cards).some((c) => c.title.includes("(character)"))).toBe(true);
  });
});

describe("pipeline engine: cold-read stage (SW-9)", () => {
  it("creates the cold-read card only after the pilot is written, with no brief content, on the reviewer model", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id); // records
    expect(open(cards.cards).some((c) => c.title.startsWith("Cold read"))).toBe(false);

    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    submitAndFinish(cards, pilotCard.id, 1);

    const readCard = open(cards.cards).find((c) => c.title.startsWith("Cold read"))!;
    expect(readCard).toBeTruthy();
    expect(readCard.model).toBe("claude:reviewer@acct");
    expect(readCard.title).toContain("pilot");
    expect(readCard.description).not.toContain("A city falls."); // the brief's `about`
  });

  it("creates the fix card, on the writer model, only once the cold read reports an item; the gate waits for it", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);

    setSession("cold-1");
    invoke("story_cold_read_get_text", { chapter: 1 });
    invoke("story_submit_cold_read", {
      chapter: 1,
      items: [
        { category: "unexplained", text: "Who is Nadia?", location: "first paragraph" },
        {
          category: "obvious",
          text: "Explains how voicemail works",
          quote: "Nadia only leaves messages when I stop answering, and I let her last two calls ring out.",
        },
      ],
      first_three_lines: { narrator: true, want: true, tension: true, clear: true },
      characters: [{ name: "Nadia", said: "a name on a voicemail" }],
    });
    setSession("session-1");
    const readCard = open(cards.cards).find((c) => c.title.startsWith("Cold read"))!;
    finishCard(cards, readCard.id);

    // With items reported (a confusion and an over-explained line), the fix
    // card exists and the gate is blocked on it.
    const fixCard = open(cards.cards).find((c) => c.title.startsWith("Cold-read fixes"))!;
    expect(fixCard).toBeTruthy();
    expect(fixCard.model).toBe("claude:writer@acct");
    expect(fixCard.description).toContain("c1 [Name or term used before it's explained] (first paragraph): Who is Nadia?");
    expect(fixCard.description).toContain("c2 [Over-explained / obvious]: Explains how voicemail works");
    expect(fixCard.description).toContain("cutting the quoted line, or by replacing the mechanics");
    expect(authed("GET", "/state").body.engine.stage).toBe("pilot"); // not pilot_review yet
    expect(authed("POST", "/pipeline/approve").status).toBe(409);

    invoke("story_submit_cold_read_fixes", {
      chapter: 1,
      fixes: [
        { item: "c1", fix: "Named her as the narrator's sister on first mention." },
        { item: "c2", fix: "cut" },
      ],
    });
    finishCard(cards, fixCard.id);
    expect(authed("GET", "/state").body.engine.stage).toBe("pilot_review");
  });

  it("creates each parallel chapter's cold-read/fix cards only once that chapter's own draft is done", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);
    finishColdRead(cards, 1);
    authed("POST", "/pipeline/approve");

    const ch2 = cards.cards.find((c) => c.title === "Chapter 2")!;
    const ch3 = cards.cards.find((c) => c.title === "Chapter 3")!;
    expect(open(cards.cards).some((c) => c.title.startsWith("Cold read"))).toBe(false);

    submitAndFinish(cards, ch2.id, 2);
    expect(open(cards.cards).filter((c) => c.title.startsWith("Cold read"))).toHaveLength(1);
    expect(open(cards.cards).some((c) => c.title === "Cold read — chapter 3")).toBe(false);

    finishColdRead(cards, 2);
    submitAndFinish(cards, ch3.id, 3);
    expect(open(cards.cards).some((c) => c.title === "Cold read — chapter 3")).toBe(true);
    finishColdRead(cards, 3);
    expect(authed("GET", "/state").body.engine.stage).toBe("review");
  });
  it("runs cold reads in chapter order: chapter 3's waits until chapter 2's chain (read + fix) clears (C1)", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);
    finishColdRead(cards, 1);
    authed("POST", "/pipeline/approve");

    const ch2 = cards.cards.find((c) => c.title === "Chapter 2")!;
    const ch3 = cards.cards.find((c) => c.title === "Chapter 3")!;
    const coldReadCards = () => cards.cards.filter((c) => c.title.startsWith("Cold read —")).map((c) => c.title);
    const units = () => authed("GET", "/state").body.engine.units;

    // Chapter 3's draft lands first: no cold read for it while chapter 2 is unwritten.
    submitAndFinish(cards, ch3.id, 3);
    expect(coldReadCards()).not.toContain("Cold read — chapter 3");
    expect(units()["cold_read:3"]).toBeUndefined();
    dispatch("timer.tick", { now: "" });
    expect(units()["cold_read:3"]).toBeUndefined();

    // Chapter 2 drafted: only its cold read opens.
    submitAndFinish(cards, ch2.id, 2);
    expect(open(cards.cards).filter((c) => c.title.startsWith("Cold read —")).map((c) => c.title)).toEqual(["Cold read — chapter 2"]);

    // Chapter 2's cold read reports an item: still no chapter 3 cold read while its fix is open.
    setSession("cold-2-order");
    invoke("story_cold_read_get_text", { chapter: 2 });
    invoke("story_submit_cold_read", {
      chapter: 2,
      items: [{ category: "other", text: "Who is Bo?" }],
      first_three_lines: { narrator: true, want: true, tension: true, clear: true },
      characters: [],
    });
    setSession("session-1");
    finishCard(cards, open(cards.cards).find((c) => c.title === "Cold read — chapter 2")!.id);
    const fixCard = open(cards.cards).find((c) => c.title === "Cold-read fixes — chapter 2")!;
    expect(fixCard).toBeTruthy();
    expect(units()["cold_read:3"]).toBeUndefined();

    invoke("story_submit_cold_read_fixes", { chapter: 2, fixes: [{ item: "c1", fix: "Named Bo as the ferryman." }] });
    finishCard(cards, fixCard.id);
    expect(open(cards.cards).some((c) => c.title === "Cold read — chapter 3")).toBe(true);

    // The chapter 3 reader now sees every earlier chapter.
    setSession("cold-3-order");
    const text = invoke("story_cold_read_get_text", { chapter: 3 });
    expect(text.missing_previous).toEqual([]);
    expect(text.previous.map((p: any) => p.chapter)).toEqual([1, 2]);
    setSession("session-1");
    finishColdRead(cards, 3);
    expect(authed("GET", "/state").body.engine.stage).toBe("review");
  });


  it("fails the cold-read unit if its card finishes without story_submit_cold_read, and a retry recovers it", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);

    const readCard = open(cards.cards).find((c) => c.title.startsWith("Cold read"))!;
    finishCard(cards, readCard.id); // no story_submit_cold_read call at all

    let state = authed("GET", "/state").body;
    expect(state.engine.units["cold_read:1"].status).toBe("failed");
    expect(state.engine.stage).toBe("pilot"); // stuck

    expect(authed("POST", "/pipeline/retry").body.retried).toEqual(["cold_read:1"]);
    finishColdRead(cards, 1);
    state = authed("GET", "/state").body;
    expect(state.engine.stage).toBe("pilot_review");
  });

  it("fails the cold-read-fix unit if its card finishes with items still unfixed, and a retry recovers it", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);

    setSession("cold-1");
    invoke("story_cold_read_get_text", { chapter: 1 });
    invoke("story_submit_cold_read", { chapter: 1, items: [{ category: "other", text: "a" }, { category: "motive", text: "b" }], characters: [] });
    setSession("session-1");
    finishCard(cards, open(cards.cards).find((c) => c.title.startsWith("Cold read"))!.id);

    const fixCard = open(cards.cards).find((c) => c.title.startsWith("Cold-read fixes"))!;
    invoke("story_submit_cold_read_fixes", { chapter: 1, fixes: [{ item: "c1", fix: "fixed a" }] }); // c2 left unfixed
    finishCard(cards, fixCard.id);

    let state = authed("GET", "/state").body;
    expect(state.engine.units["cold_read_fix:1"].status).toBe("failed");
    expect(state.engine.units["cold_read_fix:1"].note).toContain("c2");
    expect(state.engine.stage).toBe("pilot");

    expect(authed("POST", "/pipeline/retry").body.retried).toEqual(["cold_read_fix:1"]);
    const retriedFixCard = open(cards.cards).find((c) => c.title.startsWith("Cold-read fixes"))!;
    expect(retriedFixCard.id).not.toBe(fixCard.id);
    invoke("story_submit_cold_read_fixes", { chapter: 1, fixes: [{ item: "c2", fix: "fixed b" }] });
    finishCard(cards, retriedFixCard.id);

    state = authed("GET", "/state").body;
    expect(state.engine.stage).toBe("pilot_review");
  });

  it("does not duplicate the cold-read or fix card on a repeated card.step.after or timer.tick", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);

    setSession("cold-1");
    invoke("story_cold_read_get_text", { chapter: 1 });
    invoke("story_submit_cold_read", { chapter: 1, items: [{ category: "other", text: "a" }], characters: [] });
    setSession("session-1");
    const readCard = open(cards.cards).find((c) => c.title.startsWith("Cold read"))!;
    finishCard(cards, readCard.id);

    const countAfterFix = cards.cards.length;
    dispatch("card.step.after", { card_id: readCard.id, project_id: PROJECT, new_step: "done", terminal: true });
    dispatch("timer.tick", { now: "2026-01-01T00:00:00Z" });
    expect(cards.cards.length).toBe(countAfterFix);
  });

  it("uses the default writer model (Opus 5.5) for the fix card when writer_model is unset", () => {
    setHandlers({
      ...docStore().handlers,
      ...callerScope(PROJECT),
      ...fileWrites().handlers,
      ...cards.handlers,
      ...pluginSettings({ reviewer_model: "claude:reviewer@acct" }), // writer_model left unset
    });
    setupBrief();
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);

    setSession("cold-1");
    invoke("story_cold_read_get_text", { chapter: 1 });
    invoke("story_submit_cold_read", { chapter: 1, items: [{ category: "other", text: "a" }], characters: [] });
    setSession("session-1");
    finishCard(cards, open(cards.cards).find((c) => c.title.startsWith("Cold read"))!.id);

    const fixCard = open(cards.cards).find((c) => c.title.startsWith("Cold-read fixes"))!;
    expect(fixCard.model).toBe("claude:claude-opus-5-5@acc_00efb018b53b417996c3ec27f7ecc333");
  });
});

describe("pipeline engine: re-entrancy / idempotency", () => {
  it("does not duplicate cards on a repeated card.step.after or a timer.tick right after", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    const recordsCard = cards.cards[0];
    finishCard(cards, recordsCard.id);
    const countAfterFirst = cards.cards.length;

    dispatch("card.step.after", { card_id: recordsCard.id, project_id: PROJECT, old_step: "in_progress", new_step: "done", terminal: true });
    expect(cards.cards.length).toBe(countAfterFirst);

    dispatch("timer.tick", { now: "2026-01-01T00:00:00Z" });
    expect(cards.cards.length).toBe(countAfterFirst);
  });

  it("rejects a second start instead of re-creating units", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    expect(authed("POST", "/pipeline/start").status).toBe(409);
    expect(cards.cards).toHaveLength(1);
  });

  it("adopts the created card by its marker when the run died before persisting its id", () => {
    // Snapshot the engine doc as stored at the moment the card is created —
    // what survives if the run traps before its final putEngine.
    let atCreate: any = null;
    const ds = docStore();
    docs = ds.docs;
    setHandlers({
      ...ds.handlers,
      ...callerScope(PROJECT),
      ...fileWrites().handlers,
      ...cards.handlers,
      peckboard_create_card: (input: any) => {
        atCreate ??= JSON.parse(JSON.stringify(docs[`engine/${PROJECT}`]));
        return cards.handlers.peckboard_create_card(input);
      },
    });
    setupBrief();
    authed("POST", "/pipeline/start");
    const recordsCard = cards.cards[0];
    expect(recordsCard.description).toContain("story-writer:unit=records#1");
    expect(atCreate.in_flight).toBe(true);
    expect(atCreate.units.records.card_id).toBeNull();

    docs[`engine/${PROJECT}`] = atCreate; // the final write never landed
    dispatch("timer.tick", { now: "2026-01-01T00:00:01Z" });
    expect(cards.cards).toHaveLength(1); // adopted, not duplicated
    const engine = docs[`engine/${PROJECT}`] as any;
    expect(engine.units.records.card_id).toBe(recordsCard.id);
    expect(engine.in_flight).toBe(false);
  });

  it("recovers a dropped card.step.after on the next timer.tick, then throttles the card-list sweep", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    cards.setStep(cards.cards[0].id, "done"); // no event fired
    dispatch("timer.tick", { now: "" });
    expect(authed("GET", "/state").body.engine.stage).toBe("pilot");

    hostCalls.length = 0;
    dispatch("timer.tick", { now: "" });
    expect(hostCalls.some((c) => c.name === "peckboard_list_cards")).toBe(false);
  });

  it("ignores card events that are not a pipeline card finishing", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    hostCalls.length = 0;
    dispatch("card.step.after", { card_id: "someone-elses", project_id: PROJECT, new_step: "done", terminal: true });
    dispatch("card.step.after", { card_id: cards.cards[0].id, project_id: PROJECT, new_step: "in_progress", terminal: false });
    expect(hostCalls.filter((c) => c.name !== "peckboard_store_get")).toEqual([]);
    expect(hostCalls.some((c) => c.name === "peckboard_list_cards")).toBe(false);
  });
});

describe("pipeline engine: AI-generate elements", () => {
  it("creates generate cards, applies a finished draft to the brief, and gates /start on owner approval", () => {
    setupBrief({ modes: { ...briefFixture().modes, premise: "generate", style_rules: "draft" } });

    const gen = authed("POST", "/pipeline/generate");
    expect(gen.body.queued.slice().sort()).toEqual(["premise", "style_rules"]);
    expect(cards.cards).toHaveLength(2);

    expect(authed("POST", "/pipeline/start").status).toBe(409); // still awaiting_ai

    const premiseCard = cards.cards.find((c) => c.title.toLowerCase().includes("premise"))!;
    invoke("story_update_state", { data: { draft_premise: "A reluctant hero rises." } });
    finishCard(cards, premiseCard.id);

    const afterDraft = invoke("story_get_brief").brief;
    expect(afterDraft.elements.premise).toBe("A reluctant hero rises.");
    expect(afterDraft.status.premise).toBe("ai_draft");

    expect(authed("POST", "/pipeline/start").status).toBe(409); // premise needs approval; style_rules still running

    const styleCard = cards.cards.find((c) => c.title.toLowerCase().includes("style"))!;
    invoke("story_update_state", { data: { draft_style_rules: ["Keep sentences short."] } });
    finishCard(cards, styleCard.id);

    // Owner reviews both drafts in the wizard and approves them.
    const reviewed = invoke("story_get_brief").brief;
    reviewed.status.premise = "approved";
    reviewed.status.style_rules = "approved";
    authed("POST", "/wizard", { brief: reviewed });

    expect(authed("POST", "/pipeline/start").status).toBe(200);
  });

  it("marks an element empty with a note if its generate card finishes without a draft", () => {
    setupBrief({ modes: { ...briefFixture().modes, premise: "generate" } });
    authed("POST", "/pipeline/generate");
    const premiseCard = cards.cards[0];
    finishCard(cards, premiseCard.id); // no story_update_state draft pushed

    const brief = invoke("story_get_brief").brief;
    expect(brief.status.premise).toBe("empty");
  });
});

describe("pipeline engine: models and retry", () => {
  it("assigns the reviewer model to review-pass cards", () => {
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 1 } });
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id);
    submitAndFinish(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id, 1);
    finishColdRead(cards, 1);
    authed("POST", "/pipeline/approve");
    const reviewCard = open(cards.cards).find((c) => c.title.includes("(structure)"))!;
    expect(reviewCard.model).toBe("claude:reviewer@acct");
  });

  it("blocks the stage on a won't-do card until retried", () => {
    setupBrief();
    authed("POST", "/pipeline/start");
    const recordsCard = cards.cards[0];
    failCard(cards, recordsCard.id);

    let state = authed("GET", "/state").body;
    expect(state.engine.units.records.status).toBe("failed");
    expect(state.engine.stage).toBe("records"); // stuck
    expect(state.pipeline.stage).toBe("records");
    expect(state.pipeline.stages.records.status).toBe("blocked");
    expect(state.pipeline.stages.records.note).toMatch(/^records: /);

    const retry = authed("POST", "/pipeline/retry");
    expect(retry.body.retried).toEqual(["records"]);

    state = authed("GET", "/state").body;
    expect(state.engine.units.records.status).toBe("open");
    // The failure note goes with the failure (the dashboard shows it as the stage's latest note).
    expect(state.pipeline.stages.records).toMatchObject({ status: "active" });
    expect(state.pipeline.stages.records.note).toBeUndefined();
    const freshCards = open(cards.cards);
    expect(freshCards).toHaveLength(1);
    expect(freshCards[0].id).not.toBe(recordsCard.id);

    finishCard(cards, freshCards[0].id);
    const after = authed("GET", "/state").body;
    expect(after.engine.stage).toBe("pilot");
    expect(after.pipeline.stages.records.status).toBe("done");
    expect(after.pipeline.stages.pilot.status).toBe("active");
  });
});

describe("pipeline engine: host limits", () => {
  it("rejects a chapter_count above MAX_CHAPTERS", () => {
    const res = authed("POST", "/wizard", { brief: briefFixture({ basics: { ...briefFixture().basics, chapter_count: 41 } }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/chapter_count/);
    expect(authed("POST", "/pipeline/start").status).toBe(400);
    expect(cards.cards).toHaveLength(0);
  });

  it("keeps the engine and cards docs under 256 KiB for a worst-case 40-chapter run", () => {
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 40 } });
    expect(authed("POST", "/pipeline/start").status).toBe(200);

    // Every review pass requests changes once and every cold read reports
    // one item (the most units a story can accumulate); everything else
    // finishes as soon as it opens.
    const challenged = new Set<string>();
    let coldSeq = 0;
    for (let guard = 0; guard < 6000; guard++) {
      const next = open(cards.cards)[0];
      if (!next) {
        const stage = authed("GET", "/state").body.engine.stage;
        if (stage === "pilot_review") authed("POST", "/pipeline/approve");
        else if (stage === "final") break;
        else dispatch("timer.tick", { now: "" });
        continue;
      }
      if (next.title.startsWith("Pilot") || next.title.startsWith("Chapter ")) {
        const ch = Number(/(\d+)$/.exec(next.title)![1]);
        invoke("story_submit_chapter", { chapter: ch, markdown: `# Chapter ${ch}\n\nDraft.` });
        finishCard(cards, next.id);
        continue;
      }
      if (next.title.startsWith("Cold read")) {
        const ch = Number(/chapter (\d+)$/.exec(next.title)![1]);
        setSession(`cold-${ch}-${coldSeq++}`);
        invoke("story_cold_read_get_text", { chapter: ch });
        invoke("story_submit_cold_read", {
          chapter: ch,
          items: [{ category: "other", text: "n" }],
          first_three_lines: { narrator: true, want: true, tension: true, clear: true },
          characters: [],
        });
        setSession("session-1");
        finishCard(cards, next.id);
        continue;
      }
      if (next.title.startsWith("Cold-read fixes")) {
        const ch = Number(/chapter (\d+)$/.exec(next.title)![1]);
        invoke("story_submit_cold_read_fixes", { chapter: ch, fixes: [{ item: "c1", fix: "n" }] });
        finishCard(cards, next.id);
        continue;
      }
      const pass = ALL_PASSES.find((p) => next.title.includes(`(${p})`));
      if (pass) {
        const ch = Number(/chapter (\d+)$/.exec(next.title)![1]);
        const key = `${ch}:${pass}`;
        const verdict = challenged.has(key) ? "pass" : "changes_requested";
        challenged.add(key);
        invoke("story_report_review", { chapter: ch, pass, verdict, notes: "n" });
      }
      finishCard(cards, next.id);
    }

    const engine = docs[`engine/${PROJECT}`] as any;
    expect(engine.finished).toBe(true);
    expect(Object.keys(engine.units)).toHaveLength(1 + 1 + 39 + 40 * 2 + 40 * 8 * 2);
    const cap = 256 * 1024;
    expect(JSON.stringify(engine).length).toBeLessThan(cap * 0.8);
    expect(JSON.stringify(docs[`cards/${PROJECT}`]).length).toBeLessThan(cap * 0.8);
    // Core rejects any single stored doc over 256 KiB.
    for (const [key, value] of Object.entries(docs)) {
      expect(new TextEncoder().encode(JSON.stringify(value)).length, key).toBeLessThanOrEqual(cap);
    }
    // A finished pipeline leaves timer.tick's active index.
    expect((docs["engine_index/active"] as any).projects).not.toContain(PROJECT);
  });

  it("stops a timer.tick across many projects at its deadline and resumes round-robin on the next tick", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const ds = docStore();
    docs = ds.docs;
    const base = { ...ds.handlers, ...fileWrites().handlers, ...cards.handlers, ...pluginSettings() };
    for (const id of ids) {
      setHandlers({ ...base, ...callerScope(id) });
      setupBrief();
      expect(authed("POST", "/pipeline/start").status).toBe(200);
    }
    for (const card of cards.cards) cards.setStep(card.id, "done"); // every card.step.after was dropped

    // Each project's card-list sweep costs 400 ms of (fake) wall clock.
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      setHandlers({
        ...base,
        ...callerScope(null),
        peckboard_list_cards: (input: any) => {
          now += 400;
          return cards.handlers.peckboard_list_cards(input);
        },
      });
      const swept = () => hostCalls.filter((c) => c.name === "peckboard_list_cards").map((c) => c.input.project_id);
      const stageOf = (id: string) => (docs[`engine/${id}`] as any).stage;

      const start = now;
      dispatch("timer.tick", { now: "" });
      expect(swept()).toEqual(["p1", "p2", "p3"]); // the 4th project would start past the 1 s deadline
      expect(now - start).toBeLessThan(2000);
      expect(ids.filter((id) => stageOf(id) === "records")).toEqual(["p3", "p4", "p5"]);

      hostCalls.length = 0;
      dispatch("timer.tick", { now: "" });
      expect(swept()).toEqual(["p4", "p5"]); // resumes after p3; p1-p3 were just swept (throttled)
      expect(ids.every((id) => stageOf(id) === "pilot")).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});
