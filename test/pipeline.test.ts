import { beforeEach, describe, expect, it } from "vitest";
import { FakeCard, callerScope, docStore, fakeCards, fileWrites, hostCalls, pluginSettings, setHandlers } from "./fakeHost";
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
  it("drives records -> pilot -> gate -> chapters -> review -> final -> export", () => {
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

    finishCard(cards, pilotCard.id);
    expect(authed("GET", "/state").body.engine.stage).toBe("pilot_review");

    const approve = authed("POST", "/pipeline/approve");
    expect(approve.body.ok).toBe(true);
    expect(cards.cards.find((c) => c.id === ch2.id)!.blocked).toBe(false);
    expect(cards.cards.find((c) => c.id === ch3.id)!.blocked).toBe(false);

    finishCard(cards, ch2.id);
    finishCard(cards, ch3.id);
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
    finishCard(cards, pilotCard.id); // -> pilot_review

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
    finishCard(cards, pilotCard.id);

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
    finishCard(cards, pilotCard.id);

    expect(authed("POST", "/pipeline/feedback", { chapter: 7, text: "no such chapter" }).status).toBe(400);
  });
});

describe("pipeline engine: review changes_requested loop", () => {
  it("creates a revision on changes_requested and re-runs the same pass with a fresh card", () => {
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 1 } });
    authed("POST", "/pipeline/start");
    finishCard(cards, cards.cards[0].id); // records
    const pilotCard = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    finishCard(cards, pilotCard.id); // -> pilot_review
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
    finishCard(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id);
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
    finishCard(cards, cards.cards.find((c) => c.title.startsWith("Pilot"))!.id);
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
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 41 } });
    expect(authed("POST", "/pipeline/start").status).toBe(400);
    expect(cards.cards).toHaveLength(0);
  });

  it("keeps the engine and cards docs under 256 KiB for a worst-case 40-chapter run", () => {
    setupBrief({ basics: { ...briefFixture().basics, chapter_count: 40 } });
    expect(authed("POST", "/pipeline/start").status).toBe(200);

    // Every review pass requests changes once (the most units a story can
    // accumulate); everything else finishes as soon as it opens.
    const challenged = new Set<string>();
    for (let guard = 0; guard < 5000; guard++) {
      const next = open(cards.cards)[0];
      if (!next) {
        const stage = authed("GET", "/state").body.engine.stage;
        if (stage === "pilot_review") authed("POST", "/pipeline/approve");
        else if (stage === "final") break;
        else dispatch("timer.tick", { now: "" });
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
    expect(Object.keys(engine.units)).toHaveLength(1 + 1 + 39 + 40 * 8 * 2);
    const cap = 256 * 1024;
    expect(JSON.stringify(engine).length).toBeLessThan(cap * 0.8);
    expect(JSON.stringify(docs[`cards/${PROJECT}`]).length).toBeLessThan(cap * 0.8);
  });
});
