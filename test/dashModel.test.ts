import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM page module, no type declarations
import * as D from "../page/dash-model.js";
import { COLD_READ_CATEGORIES, REVIEW_PASSES, STAGES, defaultBrief } from "../src/types";

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
    cold_reads: patch.coldReads || [],
    owner_reviews: patch.ownerReviews || [],
  };
}

describe("dash model: catalogs", () => {
  it("lists every review pass, in engine order", () => {
    expect(D.PASSES.map((p: any) => p.id)).toEqual([...REVIEW_PASSES]);
  });

  it("covers every engine stage after setup, in order, with the pilot's cold read and fix as their own steps", () => {
    const engine = STAGES.filter((s) => s !== "setup");
    const ids = D.STAGES.map((s: any) => s.id);
    expect(ids.filter((id: string) => id !== "cold_read" && id !== "cold_fix")).toEqual(engine);
    expect(ids.slice(ids.indexOf("pilot"), ids.indexOf("pilot_review") + 1)).toEqual(["pilot", "cold_read", "cold_fix", "pilot_review"]);
  });

  it("has one cold-read category per server enum value, obvious last", () => {
    expect(D.COLD_CATEGORIES.map((c: any) => c.id)).toEqual([...COLD_READ_CATEGORIES]);
    expect(D.coldCategory("nope").id).toBe("other");
    expect(D.coldCategory(undefined).id).toBe("other");
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

describe("dash model: cold read (C1/C2)", () => {
  const pilotDone = unit("pilot", { chapter: 1, status: "done", card_id: "p" });
  const report = (items: any[], extra: any = {}) => ({
    chapter: 1,
    attempt: 1,
    chapter_revision: 1,
    items,
    first_three_lines: { narrator: true, want: false, tension: true, clear: false },
    characters: [{ name: "Mara", said: "the narrator, a letter-runner" }],
    submitted_at: "2026-01-02T00:00:00Z",
    ...extra,
  });
  const items = [
    { id: "c1", category: "unexplained", text: "Who is Nadia?", quote: "Nadia called.", location: "para 1", fix: "Named her as my sister." },
    { id: "c2", category: "speaker", text: "Who says this?", fix: null },
    { id: "c3", category: "obvious", text: "Explains voicemail", quote: "Nadia only leaves messages when I stop answering.", fix: null },
  ];

  it("splits the pilot stage into pilot -> cold read -> cold-read fix on the timeline", () => {
    expect(D.currentStep(st({ stage: "pilot", units: [unit("pilot", { chapter: 1 })] }))).toBe("pilot");
    const reading = st({ stage: "pilot", units: [pilotDone, unit("cold_read:1", { chapter: 1, card_id: "r" })] });
    expect(D.currentStep(reading)).toBe("cold_read");
    const by = Object.fromEntries(D.stageSummaries(reading, { r: { id: "r", step: "in_progress", worker_session_id: "s9" } }).map((x: any) => [x.id, x]));
    expect(by.pilot.status).toBe("done");
    expect(by.cold_read).toMatchObject({ status: "active", sub: "Reading", working: 1 });
    expect(by.cold_read.units.map((u: any) => u.id)).toEqual(["cold_read:1"]);
    expect(by.cold_fix.status).toBe("pending");

    const fixing = st({
      stage: "pilot",
      units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" }), unit("cold_read_fix:1", { chapter: 1, card_id: "f" })],
      coldReads: [report(items)],
    });
    expect(D.currentStep(fixing)).toBe("cold_fix");
    const by2 = Object.fromEntries(D.stageSummaries(fixing, null).map((x: any) => [x.id, x]));
    expect(by2.cold_read).toMatchObject({ status: "done", sub: "3 items found" });
    expect(by2.cold_fix).toMatchObject({ status: "active", done: 1, total: 3, sub: "1 / 3 fixed" });
    expect(by2.cold_fix.units.map((u: any) => u.id)).toEqual(["cold_read_fix:1"]);
    expect(by2.pilot_review.status).toBe("pending");
  });

  it("keeps the gate not ready (no approve) until every pilot cold-read item is fixed", () => {
    const fixing = st({
      stage: "pilot",
      units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" }), unit("cold_read_fix:1", { chapter: 1 })],
      coldReads: [report(items)],
    });
    expect(D.gateInfo(fixing)).toMatchObject({ active: false, notReady: true, coldClear: false, canApprove: false });
    expect(D.gateInfo(fixing).cold).toMatchObject({ total: 3, fixed: 1, open: 2, confusion: { total: 2, fixed: 1 }, obvious: { total: 1, fixed: 0 } });

    const allFixed = items.map((i) => ({ ...i, fix: i.fix || "cut" }));
    const atGate = st({
      stage: "pilot_review",
      units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" }), unit("cold_read_fix:1", { chapter: 1, status: "done" })],
      coldReads: [report(allFixed)],
    });
    expect(D.gateInfo(atGate)).toMatchObject({ active: true, notReady: false, coldClear: true, canApprove: true });
    // A pipeline from before cold reads existed reaches the gate without one.
    expect(D.gateInfo(st({ stage: "pilot_review", units: [pilotDone] })).canApprove).toBe(true);
  });

  it("grid cells for the cold read and its fixes", () => {
    const none = st({ stage: "pilot", units: [unit("pilot", { chapter: 1 })] });
    expect(D.coldReadCell(none, 1, null)).toMatchObject({ key: "pending", label: "Not started" });
    expect(D.coldFixCell(none, 1, null).key).toBe("pending");

    const reading = st({ stage: "pilot", units: [pilotDone, unit("cold_read:1", { chapter: 1, card_id: "r" })] });
    expect(D.coldReadCell(reading, 1, { r: { id: "r", step: "in_progress", worker_session_id: "s9" } })).toMatchObject({ key: "working", label: "Reading", sessionId: "s9" });

    const clear = st({ stage: "pilot_review", units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" })], coldReads: [report([])] });
    expect(D.coldReadCell(clear, 1, null)).toMatchObject({ key: "passed", label: "Nothing found" });
    expect(D.coldFixCell(clear, 1, null)).toMatchObject({ key: "passed", label: "Nothing to fix" });

    const fixing = st({
      stage: "pilot",
      units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" }), unit("cold_read_fix:1", { chapter: 1, card_id: "f" })],
      coldReads: [report(items)],
    });
    expect(D.coldReadCell(fixing, 1, null)).toMatchObject({ key: "flagged", tone: "warn", label: "3 items found", detail: "2 confusion items · 1 over-explained" });
    expect(D.coldFixCell(fixing, 1, { f: { id: "f", step: "in_progress", worker_session_id: "w" } })).toMatchObject({ key: "working", label: "Fixing", detail: "1 of 3 fixed" });
    expect(D.chapterRows(fixing, null)[0]).toMatchObject({ cold: { key: "flagged" }, fix: { key: "open" } });
    const fixed = st({
      stage: "pilot_review",
      units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" }), unit("cold_read_fix:1", { chapter: 1, status: "done" })],
      coldReads: [report(items.map((i) => ({ ...i, fix: i.fix || "cut" })))],
    });
    expect(D.coldReadCell(fixed, 1, null)).toMatchObject({ key: "passed", tone: "ok", label: "3 items found · all fixed" });
    expect(D.coldFixCell(fixed, 1, null)).toMatchObject({ key: "done", label: "All 3 fixed" });

    const failed = st({ stage: "pilot", units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "failed", note: "no submit" })] });
    expect(D.coldReadCell(failed, 1, null)).toMatchObject({ key: "failed", detail: "no submit" });
  });

  it("lists a later chapter's cold-read units under Chapters, right after that chapter's draft", () => {
    const s = st({
      stage: "chapters",
      approved: true,
      units: [
        unit("chapter:3", { chapter: 3, status: "done" }),
        unit("cold_read_fix:2", { chapter: 2 }),
        unit("cold_read:2", { chapter: 2, status: "done" }),
        unit("chapter:2", { chapter: 2, status: "done" }),
        unit("cold_read:3", { chapter: 3 }),
      ],
    });
    const chapters = D.stageSummaries(s, null).find((x: any) => x.id === "chapters");
    expect(chapters.units.map((u: any) => u.id)).toEqual(["chapter:2", "cold_read:2", "cold_read_fix:2", "chapter:3", "cold_read:3"]);
    expect(chapters.sub).toBe("2 in cold read");
    expect(D.unitLabel(unit("cold_read:2", { chapter: 2 }))).toBe("Chapter 2 · cold read");
    expect(D.unitLabel(unit("cold_read_fix:1", { chapter: 1 }))).toBe("Pilot · cold-read fixes");
  });

  it("the viewer filters by category (confusion vs obvious) and status, with the first-lines check", () => {
    const s = st({ stage: "pilot", units: [pilotDone, unit("cold_read:1", { chapter: 1, status: "done" })], coldReads: [report(items)] });
    const all = D.coldReadView(s, 1);
    expect(all.items.map((i: any) => [i.id, i.cat.id, i.obvious, i.fixed])).toEqual([
      ["c1", "unexplained", false, true],
      ["c2", "speaker", false, false],
      ["c3", "obvious", true, false],
    ]);
    expect(all.counts).toEqual({ all: 3, open: 2, fixed: 1 });
    expect(all.byCategory).toEqual({ unexplained: 1, speaker: 1, obvious: 1 });
    expect(D.coldReadView(s, 1, { category: "obvious" }).shown.map((i: any) => i.id)).toEqual(["c3"]);
    expect(D.coldReadView(s, 1, { category: "confusion" }).shown.map((i: any) => i.id)).toEqual(["c1", "c2"]);
    expect(D.coldReadView(s, 1, { category: "confusion", status: "open" }).shown.map((i: any) => i.id)).toEqual(["c2"]);
    expect(D.coldReadView(s, 1, { status: "fixed" }).shown.map((i: any) => i.id)).toEqual(["c1"]);
    expect(all.checks.map((c: any) => [c.key, c.ok])).toEqual([
      ["narrator", true],
      ["want", false],
      ["tension", true],
      ["clear", false],
    ]);
    expect(all.characters).toEqual([{ name: "Mara", said: "the narrator, a letter-runner" }]);
    // A report filed before categories existed reads as "other confusion".
    const legacy = st({ coldReads: [report([{ id: "c1", text: "?", fix: null }])] });
    expect(D.coldReadView(legacy, 1).items[0].cat.id).toBe("other");
    expect(D.coldReadChapters(st({ coldReads: [report([])], units: [unit("cold_read:3", { chapter: 3 })] }))).toEqual([1, 3]);
  });
});

describe("dash model: first introductions and unexplained names (C3)", () => {
  it("reads a character's first introduction", () => {
    expect(D.firstIntro({ first_intro: { chapter: 1, scene: "The job", line: "My sister Nadia never calls twice." } })).toEqual({
      chapter: 1,
      scene: "The job",
      line: "My sister Nadia never calls twice.",
    });
    expect(D.firstIntro({})).toBeNull();
    expect(D.firstIntro({ first_intro: { scene: "x" } })).toBeNull();
  });

  it("flags scenes over the cap and names unanswered too long", () => {
    const s = st({
      chapters: 5,
      docs: [1, 2, 3, 4].map((c) => ({ chapter: c, revision: 1, length: 10 })),
      records: {
        scene_sheets: [
          { id: "s3", chapter: 3, scene: "Archive", unexplained: [{ name: "the Ninth", kind: "name" }] },
          {
            id: "s1",
            chapter: 1,
            scene: "The job",
            unexplained: [
              { name: "Tidewardens", kind: "term", answered_in: { chapter: 2, scene: "Canal" } },
              { name: "black wax", kind: "rule" },
              { name: "Jun", kind: "name", answered_in: { chapter: 1 } },
              { name: "the Low Wards", kind: "name" },
            ],
          },
          { id: "s2", chapter: 2, scene: "Quiet", unexplained: [] },
        ],
      },
    });
    const all = D.unexplainedList(s);
    expect(all.latest).toBe(4);
    expect(all.rows.map((r: any) => [r.id, r.overCap, r.flagged])).toEqual([
      ["s1", true, true],
      ["s3", false, false],
    ]);
    expect(all.rows[0].items.map((i: any) => [i.name, i.answered, i.age, i.overdue])).toEqual([
      ["Tidewardens", true, 1, false],
      ["black wax", false, 3, true],
      ["Jun", true, 0, false],
      ["the Low Wards", false, 3, true],
    ]);
    expect(all.counts).toEqual({ scenes: 2, total: 5, answered: 2, unanswered: 3, overdue: 2, overCap: 1, flagged: 1 });
    expect(D.unexplainedList(s, "unanswered").rows.map((r: any) => r.items.length)).toEqual([2, 1]);
    expect(D.unexplainedList(s, "flagged").rows.map((r: any) => r.id)).toEqual(["s1"]);
  });
});
describe("dash model: owner review rounds (SW-12)", () => {
  const TEXT = ["# Chapter 1", "", "Rain on the roof.", "Jun counted.", "", "> A sign: CLOSED", "", "---", "", "They left."].join("\n");
  const doc = (n: number, revision = 2) => ({ chapter: n, revision, recap: null, length: 10, submitted_at: "" });
  const note = (id: string, start: number, end = start, patch: any = {}) => ({
    id,
    kind: "comment",
    start_line: start,
    end_line: end,
    quote: "",
    body: "b",
    revision: 2,
    created_at: "",
    resolution: null,
    ...patch,
  });
  const clearPilot = [unit("pilot", { status: "done", chapter: 1 }), unit("cold_read:1", { status: "done", chapter: 1 })];
  const clearCold = [{ chapter: 1, attempt: 1, chapter_revision: 2, items: [], first_three_lines: null, characters: [], submitted_at: "" }];

  it("splits the text into blocks with their source line ranges", () => {
    expect(D.proseBlocks(TEXT).map((b: any) => [b.type, b.start, b.end])).toEqual([
      ["heading", 1, 1],
      ["para", 3, 4],
      ["quote", 6, 6],
      ["hr", 8, 8],
      ["para", 10, 10],
    ]);
    expect(D.proseBlocks("A\r\n# H\r\nB").map((b: any) => [b.type, b.start])).toEqual([
      ["para", 1],
      ["heading", 2],
      ["para", 3],
    ]);
  });

  it("puts each note under the block holding its first line (or the next block)", () => {
    const blocks = D.proseBlocks(TEXT);
    const at = D.placeNotes(blocks, [note("n1", 4), note("n2", 5), note("n3", 99), note("n4", 1)]);
    expect(at.map((xs: any[]) => xs.map((x) => x.id))).toEqual([["n4"], ["n1"], ["n2"], [], ["n3"]]);
  });

  it("the pilot at the gate is reviewable; an open round's notes count and hold Approve until sent or deleted (SW-15)", () => {
    const s = st({ stage: "pilot_review", units: clearPilot, docs: [doc(1)], coldReads: clearCold, ownerReviews: [{ chapter: 1, rounds: [{ round: 1, chapter_revision: 2, status: "open", notes: [note("n1", 3)], opened_at: "" }] }] });
    const r = D.reviewInfo(s, 1, null);
    expect(r).toMatchObject({ canReview: true, why: null, roundNo: 1, revision: 2, pending: null });
    expect(r.notes.map((n: any) => n.id)).toEqual(["n1"]);
    expect(D.gateInfo(s)).toMatchObject({ active: true, redraft: false, unsent: 1, canApprove: false });
    const emptied = st({ stage: "pilot_review", units: clearPilot, docs: [doc(1)], coldReads: clearCold, ownerReviews: [{ chapter: 1, rounds: [{ round: 1, chapter_revision: 2, status: "open", notes: [], opened_at: "" }] }] });
    expect(D.gateInfo(emptied)).toMatchObject({ unsent: 0, canApprove: true });
  });

  it("a requested round blocks approval and reports where the redraft stands", () => {
    const pending = { chapter: 1, rounds: [{ round: 1, chapter_revision: 2, status: "changes_requested", notes: [note("n1", 3)], opened_at: "", decided_revision: 2 }] };
    const writing = st({ stage: "pilot_review", units: [...clearPilot, unit("revision:owner:1:1", { chapter: 1, round: 1, card_id: "c9" })], docs: [doc(1)], coldReads: clearCold, ownerReviews: [pending] });
    const r = D.reviewInfo(writing, 1, null);
    expect(r).toMatchObject({ canReview: false, roundNo: 1 });
    expect(r.phase.key).toBe("revising");
    expect(D.gateInfo(writing)).toMatchObject({ redraft: true, canApprove: false });
    expect(D.unitLabel(writing.engine.units["revision:owner:1:1"])).toBe("Pilot · redraft from your round 1 notes");
    expect(D.stageOfUnit(writing.engine.units["revision:owner:1:1"])).toBe("pilot_review");

    const reading = st({
      stage: "pilot_review",
      units: [unit("pilot", { status: "done", chapter: 1 }), unit("cold_read:1", { chapter: 1, attempt: 2, card_id: "c10" }), unit("revision:owner:1:1", { status: "done", chapter: 1, round: 1 })],
      docs: [doc(1, 3)],
      coldReads: clearCold,
      ownerReviews: [pending],
    });
    expect(D.reviewInfo(reading, 1, null).phase.key).toBe("cold_read");
    const failed = st({ stage: "pilot_review", units: [...clearPilot, unit("revision:owner:1:1", { chapter: 1, round: 1, status: "failed", note: "x" })], docs: [doc(1)], ownerReviews: [pending] });
    expect(D.reviewInfo(failed, 1, null).phase).toMatchObject({ key: "failed" });
  });

  it("says why a chapter can't be reviewed yet", () => {
    expect(D.reviewInfo(st({ stage: "pilot" }), 1, null).why).toMatch(/once it's written/);
    const ch = st({ stage: "chapters", approved: true, units: [...clearPilot, unit("chapter:2", { status: "done", chapter: 2 }), unit("cold_read:2", { chapter: 2 })], docs: [doc(1), doc(2)], coldReads: clearCold });
    expect(D.reviewInfo(ch, 3, null).why).toBe("Not written yet.");
    expect(D.reviewInfo(ch, 2, null).why).toMatch(/cold read/);
    expect(D.reviewInfo(ch, 1, null).canReview).toBe(true);
  });

  it("lists rounds newest first with resolution counts, and totals them", () => {
    const fixed = (id: string, action: string) => note(id, 3, 3, { resolution: { action, how: "h", at: "" } });
    const s = st({
      stage: "chapters",
      approved: true,
      units: clearPilot,
      docs: [doc(1, 4)],
      coldReads: clearCold,
      ownerReviews: [
        {
          chapter: 1,
          rounds: [
            { round: 1, chapter_revision: 2, status: "revised", notes: [fixed("n1", "fixed"), fixed("n2", "declined"), fixed("n3", "answered")], opened_at: "", decided_revision: 2, revised_revision: 4 },
            { round: 2, chapter_revision: 4, status: "approved", notes: [], opened_at: "", decided_revision: 4 },
          ],
        },
      ],
    });
    const rows = D.roundRows(s, 1, null);
    expect(rows.map((r: any) => [r.round, r.statusInfo.label])).toEqual([
      [2, "Approved"],
      [1, "Redrafted"],
    ]);
    expect(rows[1]).toMatchObject({ fixed: 1, declined: 1, answered: 1, draftRevision: 2, revised_revision: 4 });
    expect(D.reviewInfo(s, 1, null)).toMatchObject({ approved: true, roundNo: 3 });
    expect(D.reviewTotals(s)).toEqual({ sent: 3, unsent: 0, redrafting: 0, approved: 1 });
    expect(D.lineLabel(note("n1", 4, 6))).toBe("lines 4–6");
  });

  it("links an owner feedback entry to its round's revision card", () => {
    const s = st({
      stage: "pilot_review",
      units: [unit("revision:owner:1:2", { chapter: 1, round: 2 })],
      feedback: [{ id: "fb-1", source: "owner", chapter: 1, text: "t", appended_to_rules: false, round: 2, at: "2026-01-01" }],
    });
    expect(D.feedbackRows(s, null)[0].unit.id).toBe("revision:owner:1:2");
  });
});
