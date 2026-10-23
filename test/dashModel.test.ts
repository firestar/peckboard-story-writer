import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM page module, no type declarations
import * as D from "../page/dash-model.js";
import { REVIEW_PASSES, STAGES, defaultBrief } from "../src/types";

function unit(id: string, patch: any = {}): any {
  const [kind] = id.split(":");
  return { id, kind, status: "open", card_id: null, attempt: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "", ...patch };
}

function st(patch: any = {}): any {
  const brief: any = defaultBrief();
  brief.basics.chapter_count = patch.chapters ?? 3;
  if (patch.format) brief.basics.format = patch.format;
  if (patch.brief) Object.assign(brief.elements, patch.brief);
  const units: Record<string, any> = {};
  for (const u of patch.units || []) units[u.id] = u;
  return {
    brief,
    engine: { stage: patch.stage ?? "records", approved: !!patch.approved, finished: !!patch.finished, units, cursors: patch.cursors || {}, note: null },
    pipeline: { stage: patch.stage ?? "records", stages: patch.stageNotes || {}, note: null, data: {} },
    records: {
      characters: [],
      relationships: [],
      knowledge: [],
      choices: [],
      setups: [],
      glossary: [],
      chapter_state: [],
      scene_sheets: [],
      recaps: [],
      ...(patch.records || {}),
    },
    chapters: patch.docs || [],
    reviews: patch.reviews || [],
    feedback: patch.feedback || [],
    cards: [],
  };
}

describe("dash model: catalogs", () => {
  it("lists every review pass, in engine order", () => {
    expect(D.PASSES.map((p: any) => p.id)).toEqual([...REVIEW_PASSES]);
  });

  it("covers every engine stage after setup, in order", () => {
    expect(D.STAGES.map((s: any) => s.id)).toEqual(STAGES.filter((s) => s !== "setup"));
  });
});

describe("dash model: worker status", () => {
  const cards = {
    c1: { id: "c1", step: "in_progress", blocked: false, worker_session_id: "s1", last_worker_session_id: null },
    c2: { id: "c2", step: "backlog", blocked: true, block_reason: "Waiting for the owner", worker_session_id: null, last_worker_session_id: null },
    c3: { id: "c3", step: "backlog", blocked: false, worker_session_id: null, last_worker_session_id: null },
    c4: { id: "c4", step: "done", blocked: false, worker_session_id: null, last_worker_session_id: "s4" },
    gone: { id: "gone", missing: true },
  };

  it("combines the engine's and the board's view of a card", () => {
    expect(D.unitStatus(null, cards).key).toBe("pending");
    expect(D.unitStatus(unit("pilot"), cards).key).toBe("queued");
    expect(D.unitStatus(unit("pilot", { card_id: "c1" }), null).key).toBe("open");
    expect(D.unitStatus(unit("pilot", { card_id: "c1" }), cards)).toMatchObject({ key: "working", tone: "busy", sessionId: "s1" });
    expect(D.unitStatus(unit("chapter:2", { card_id: "c2" }), cards)).toMatchObject({ key: "blocked", detail: "Waiting for the owner" });
    expect(D.unitStatus(unit("records", { card_id: "c3" }), cards)).toMatchObject({ key: "waiting", detail: "On the board: backlog" });
    expect(D.unitStatus(unit("records", { card_id: "gone" }), cards)).toMatchObject({ key: "missing", card: null, sessionId: null });
    // Created after the last /cards listing: not missing, just not listed yet.
    expect(D.unitStatus(unit("records", { card_id: "new" }), cards).key).toBe("open");
    expect(D.unitStatus(unit("records", { card_id: "c4", status: "done" }), cards)).toMatchObject({ key: "done", sessionId: "s4" });
    expect(D.unitStatus(unit("records", { card_id: "c4", status: "failed", note: "closed as won't do" }), cards)).toMatchObject({
      key: "failed",
      detail: "closed as won't do",
    });
  });

  it("labels units for people", () => {
    expect(D.unitLabel(unit("review:3:echo-word", { chapter: 3, pass: "echo-word" }))).toBe("Chapter 3 · Echo words pass");
    expect(D.unitLabel(unit("revision:review:3:line", { chapter: 3 }))).toBe("Chapter 3 · Line revision");
    expect(D.unitLabel(unit("revision:fb:fb-1-1", { chapter: 1 }))).toBe("Chapter 1 · revision from your feedback");
  });
});

describe("dash model: stages", () => {
  it("marks earlier stages done, the owner gate as waiting, and counts work", () => {
    const s = st({
      stage: "pilot_review",
      units: [
        unit("records", { status: "done", card_id: "a" }),
        unit("pilot", { kind: "pilot", chapter: 1, status: "done", card_id: "b" }),
        unit("chapter:2", { chapter: 2, card_id: "c" }),
        unit("chapter:3", { chapter: 3, card_id: "d" }),
      ],
    });
    const by = Object.fromEntries(D.stageSummaries(s, null).map((x: any) => [x.id, x]));
    expect(by.records).toMatchObject({ status: "done", done: 1, total: 1 });
    expect(by.pilot).toMatchObject({ status: "done", done: 1 });
    expect(by.pilot_review).toMatchObject({ status: "waiting", sub: "Waiting on you" });
    expect(by.chapters).toMatchObject({ status: "pending", done: 0, total: 2, sub: "0 / 2 written" });
    expect(by.chapters.units.map((u: any) => u.id)).toEqual(["chapter:2", "chapter:3"]);
    expect(by.review).toMatchObject({ status: "pending", total: 24 });
  });

  it("flags a stage with a failed card and lists feedback revisions under your review", () => {
    const s = st({
      stage: "chapters",
      approved: true,
      units: [unit("chapter:2", { chapter: 2, status: "failed" }), unit("revision:fb:x", { kind: "revision", chapter: 2 })],
    });
    const by = Object.fromEntries(D.stageSummaries(s, null).map((x: any) => [x.id, x]));
    expect(by.chapters.status).toBe("blocked");
    expect(by.pilot_review).toMatchObject({ status: "done", sub: "1 revision open" });
    expect(D.failedUnits(s).map((u: any) => u.id)).toEqual(["chapter:2"]);
  });

  it("shows the gate as in progress, not waiting on the owner, while their revision runs", () => {
    const s = st({ stage: "pilot_review", units: [unit("revision:fb:a", { kind: "revision", chapter: 1, card_id: "c" })] });
    const gate = D.stageSummaries(s, null).find((x: any) => x.id === "pilot_review");
    expect(gate).toMatchObject({ status: "active", sub: "Revising · 1 open" });
  });

  it("counts review passes from the cursors", () => {
    const s = st({
      stage: "review",
      chapters: 2,
      cursors: { "1": { chapter: 1, pass_index: 3, round: 1, waiting: "review" }, "2": { chapter: 2, pass_index: 8, round: 1, waiting: "done" } },
    });
    expect(D.passesDone(s)).toBe(11);
    expect(D.overall(s)).toMatchObject({ chapters: 2, passes: 11, passesTotal: 16 });
  });
});

describe("dash model: owner gate and feedback", () => {
  it("allows approving only from the gate with no pilot revision open", () => {
    expect(D.gateInfo(st({ stage: "pilot_review", chapters: 5 }))).toMatchObject({ active: true, canApprove: true, remaining: 4 });
    const revising = st({ stage: "pilot_review", units: [unit("revision:fb:a", { kind: "revision", chapter: 1 })] });
    expect(D.gateInfo(revising)).toMatchObject({ active: true, openPilotRevision: true, canApprove: false });
    expect(D.gateInfo(st({ stage: "chapters" })).active).toBe(false);
  });

  it("accepts feedback on the pilot or a written chapter from the gate onward", () => {
    const docs = [{ chapter: 2, revision: 1, recap: null, length: 10, submitted_at: "" }];
    expect(D.canGiveFeedback(st({ stage: "pilot" }), 1)).toBe(false);
    expect(D.canGiveFeedback(st({ stage: "pilot_review" }), 1)).toBe(true);
    expect(D.canGiveFeedback(st({ stage: "chapters", docs }), 2)).toBe(true);
    expect(D.canGiveFeedback(st({ stage: "chapters", docs }), 3)).toBe(false);
  });
});

describe("dash model: chapter grid", () => {
  const cards = { r: { id: "r", step: "in_progress", blocked: false, worker_session_id: "s9", last_worker_session_id: null } };

  it("derives the draft cell from the unit and the submitted chapter", () => {
    const docs = [{ chapter: 1, revision: 2, recap: "x", length: 900, submitted_at: "" }];
    const s = st({
      stage: "chapters",
      docs,
      units: [
        unit("pilot", { kind: "pilot", chapter: 1, status: "done", card_id: "p" }),
        unit("chapter:2", { chapter: 2, card_id: "r" }),
      ],
    });
    expect(D.draftCell(s, 1, cards)).toMatchObject({ key: "done", label: "Written", detail: "revision 2" });
    expect(D.draftCell(s, 2, cards)).toMatchObject({ key: "working", label: "Writing", sessionId: "s9" });
    expect(D.draftCell(s, 3, cards).key).toBe("pending");
  });

  it("derives pass cells from the cursor, the unit and the review rounds", () => {
    const s = st({
      stage: "review",
      chapters: 1,
      cursors: { "1": { chapter: 1, pass_index: 2, round: 2, waiting: "review" } },
      units: [
        unit("review:1:structure", { chapter: 1, pass: "structure", status: "done" }),
        unit("review:1:character", { chapter: 1, pass: "character", status: "done" }),
        unit("review:1:pacing", { chapter: 1, pass: "pacing", card_id: "r", attempt: 2 }),
      ],
      reviews: [
        { chapter: 1, pass: "structure", rounds: [{ verdict: "pass", notes: "solid", at: "" }] },
        {
          chapter: 1,
          pass: "character",
          rounds: [
            { verdict: "changes_requested", notes: "Mara too warm", at: "" },
            { verdict: "changes_requested", notes: "still warm", at: "" },
          ],
        },
        { chapter: 1, pass: "pacing", rounds: [{ verdict: "changes_requested", notes: "slow middle", at: "" }] },
      ],
    });
    const [structure, character, pacing, line] = [0, 1, 2, 3].map((i) => D.passCell(s, 1, i, cards));
    expect(structure).toMatchObject({ key: "passed", tone: "ok", detail: "solid" });
    expect(character).toMatchObject({ key: "changes", label: "Changes requested · moved on", rounds: 2 });
    expect(pacing).toMatchObject({ key: "working", label: "Reviewing", detail: "round 2" });
    expect(line.key).toBe("pending");
  });

  it("shows a pass waiting on its revision as revising", () => {
    const s = st({
      stage: "review",
      chapters: 1,
      cursors: { "1": { chapter: 1, pass_index: 0, round: 1, waiting: "revision" } },
      units: [unit("review:1:structure", { chapter: 1, pass: "structure", status: "done" }), unit("revision:review:1:structure", { kind: "revision", chapter: 1, card_id: "r" })],
      reviews: [{ chapter: 1, pass: "structure", rounds: [{ verdict: "changes_requested", notes: "the midpoint sags", at: "" }] }],
    });
    expect(D.passCell(s, 1, 0, cards)).toMatchObject({ key: "revising", detail: "the midpoint sags", sessionId: "s9" });
    expect(D.chapterRows(s, cards)[0]).toMatchObject({ chapter: 1, pilot: true, revising: true, revisions: 1 });
  });
});

describe("dash model: record viewers", () => {
  const cast = [
    { id: "mara", name: "Mara Vey", attitudes: [{ toward: "jun", attitude: "wary", reason: "he lied once" }] },
    { id: "jun", name: "Jun", attitudes: [] },
  ];

  it("resolves characters by id or name, any case", () => {
    const r = D.characterResolver(cast);
    expect(r("MARA")).toMatchObject({ key: "id:mara", name: "Mara Vey", known: true });
    expect(r("mara vey").key).toBe("id:mara");
    expect(r("Ghost")).toMatchObject({ key: "name:ghost", name: "Ghost", known: false });
  });

  it("falls back to the setup's cast before the records exist", () => {
    expect(D.castOf(st({ brief: { characters: cast } }))).toMatchObject({ source: "brief" });
    expect(D.castOf(st({ records: { characters: cast } }))).toMatchObject({ source: "records" });
  });

  it("builds the emotion timeline and carries attitudes forward", () => {
    const s = st({
      records: {
        characters: cast,
        chapter_state: [
          { chapter: 2, emotions: { Jun: "guilty" }, attitudes: [{ from: "Jun", to: "mara", attitude: "protective", reason: "owes her" }] },
          { chapter: 1, emotions: { mara: "tense", Jun: "calm" }, attitudes: [{ from: "mara", to: "jun", attitude: "cold", reason: "the lie surfaced" }] },
        ],
      },
    });
    const tl = D.emotionTimeline(s);
    expect(tl.chapters).toEqual([1, 2]);
    expect(tl.rows.map((r: any) => [r.name, r.cells])).toEqual([
      ["Mara Vey", { 1: "tense" }],
      ["Jun", { 1: "calm", 2: "guilty" }],
    ]);
    const start = D.attitudesAt(s, 0);
    expect(start.get("id:mara", "id:jun")).toMatchObject({ attitude: "wary", chapter: 0 });
    const ch2 = D.attitudesAt(s, 2);
    expect(ch2.get("id:mara", "id:jun")).toMatchObject({ attitude: "cold", chapter: 1, changed: false });
    expect(ch2.get("id:jun", "id:mara")).toMatchObject({ attitude: "protective", changed: true });
    expect(ch2.state.chapter).toBe(2);
  });

  it("filters who-knows-what by route and chapter", () => {
    const s = st({
      records: {
        characters: cast,
        knowledge: [
          { id: "k1", fact: "The vault is empty", route: "common", known_by: [{ character: "mara", since_chapter: 1 }, { character: "Jun", since_chapter: 3, how: "overheard" }] },
          { id: "k2", fact: "Jun is the informant", route: "mara", known_by: [{ character: "Mara Vey", since_chapter: 4 }] },
        ],
      },
    });
    expect(D.knowledgeRoutes(s)).toEqual(["mara"]);
    expect(D.knowledgeMatrix(s, "common", null).rows.map((r: any) => r.id)).toEqual(["k1"]);
    expect(D.knowledgeMatrix(s, "mara", null).rows.map((r: any) => r.id)).toEqual(["k1", "k2"]);
    const asOf2 = D.knowledgeMatrix(s, "all", 2);
    expect(asOf2.rows[0].cells).toEqual({ "id:mara": { since: 1, how: null } });
    expect(asOf2.rows[1].count).toBe(0);
    expect(D.knowledgeMatrix(s, "all", null).rows[0].cells["id:jun"]).toEqual({ since: 3, how: "overheard" });
  });

  it("sorts and filters setups, groups choices and maps routes", () => {
    const s = st({
      format: "vn",
      brief: { endings: [{ id: "true", name: "True ending", kind: "ending", description: "" }] },
      records: {
        setups: [
          { id: "s2", promise: "The locked door", setup_chapter: 3, progress: [], status: "open" },
          { id: "s1", promise: "The gun", setup_chapter: 1, progress: [{ chapter: 5, note: "b" }, { chapter: 2, note: "a" }], status: "paid", payoff_chapter: 6, payoff: "fired" },
        ],
        choices: [
          { id: "c2", chapter: 4, options: [{ label: "Run", consequence: "alone", route: "lone" }] },
          { id: "c1", chapter: 2, options: [{ label: "Trust Jun", consequence: "he stays", route: "True ending" }] },
        ],
      },
    });
    const all = D.setupList(s, "all");
    expect(all.counts).toEqual({ all: 2, open: 1, paid: 1, dropped: 0 });
    expect(all.items.map((x: any) => x.id)).toEqual(["s1", "s2"]);
    expect(all.items[0].progress.map((p: any) => p.chapter)).toEqual([2, 5]);
    expect(D.setupList(s, "open").items.map((x: any) => x.id)).toEqual(["s2"]);
    expect(D.choicesByChapter(s).map((g: any) => g.chapter)).toEqual([2, 4]);
    const routes = D.routeMap(s);
    expect(routes.map((r: any) => [r.name, r.options.map((o: any) => o.label), !!r.unlisted])).toEqual([
      ["True ending", ["Trust Jun"], false],
      ["lone", ["Run"], true],
    ]);
  });

  it("searches the glossary and lists a recap per chapter", () => {
    const s = st({
      chapters: 3,
      docs: [
        { chapter: 1, revision: 1, recap: "Mara arrives.", length: 1, submitted_at: "" },
        { chapter: 2, revision: 1, recap: null, length: 1, submitted_at: "" },
      ],
      records: {
        glossary: [
          { term: "ley", definition: "the city's magic grid" },
          { term: "Ashwood", definition: "a district" },
        ],
        recaps: [{ chapter: 1, recap: "Mara arrives in Ashwood." }],
      },
    });
    expect(D.glossaryList(s, "").map((g: any) => g.term)).toEqual(["Ashwood", "ley"]);
    expect(D.glossaryList(s, "MAGIC").map((g: any) => g.term)).toEqual(["ley"]);
    expect(D.recapList(s)).toEqual([
      { chapter: 1, recap: "Mara arrives in Ashwood.", written: true },
      { chapter: 2, recap: null, written: true },
      { chapter: 3, recap: null, written: false },
    ]);
  });
});

describe("dash model: rules and feedback", () => {
  it("traces each story rule to the setup, owner feedback or a review", () => {
    const s = st({
      brief: { style_rules: ["No flashbacks.", "Keep Mara cold.", "Cut filler."] },
      feedback: [
        { id: "f1", source: "owner", chapter: 1, text: "Keep Mara cold.", appended_to_rules: true, at: "2026-01-02" },
        { id: "f2", source: "review", chapter: 3, text: "Cut filler.", appended_to_rules: true, at: "2026-01-03" },
        { id: "f3", source: "review", chapter: 3, text: "pacing notes", appended_to_rules: false, at: "2026-01-04" },
      ],
      units: [unit("revision:fb:f1", { kind: "revision", chapter: 1, status: "done" })],
    });
    expect(D.storyRules(s).map((r: any) => [r.source, r.chapter])).toEqual([
      ["setup", null],
      ["owner", 1],
      ["review", 3],
    ]);
    const rows = D.feedbackRows(s, null);
    expect(rows.map((r: any) => r.id)).toEqual(["f3", "f2", "f1"]);
    expect(rows[2].status.key).toBe("done");
    expect(rows[0].status).toBeNull();
  });

  it("names the style-guide sections a story edited or turned off", () => {
    const s = st();
    s.brief.lesson_overrides = { "english.conciseness": "", "style.voice": "Dry and close." };
    const guide = [
      { id: "style.voice", title: "Voice", text: "default", vn_only: false },
      { id: "english.conciseness", title: "Conciseness", text: "default", vn_only: false },
    ];
    expect(D.lessonOverrides(s, guide)).toEqual([
      { id: "english.conciseness", title: "Conciseness", off: true, text: "", original: "default" },
      { id: "style.voice", title: "Voice", off: false, text: "Dry and close.", original: "default" },
    ]);
  });

  it("counts words and makes a safe export file name", () => {
    expect(D.wordCount("Mara didn't wait — she ran.\n\nJun's 2nd try.")).toBe(8);
    expect(D.fileSlug("Ashwood: The Drowned Café!")).toBe("ashwood-the-drowned-cafe");
    expect(D.fileSlug("   ")).toBe("story");
  });
});
