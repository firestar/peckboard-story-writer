import { beforeEach, describe, expect, it } from "vitest";
import { callerScope, docStore, fileWrites, hostCalls, setHandlers, setSession } from "./fakeHost";
import { dispatch } from "../src/lib";

function allowPayload(raw: string): any {
  const v = JSON.parse(raw);
  expect(v.verdict).toBe("allow");
  return v.payload;
}

function invoke(tool: string, args: unknown = {}): any {
  return allowPayload(dispatch("mcp.tool.invoke", { tool, arguments: args, context: {} }));
}

function minimalBrief(): any {
  return {
    about: "",
    basics: {
      title: "T",
      genre: "",
      format: "prose",
      chapter_count: 1,
      pov: "",
      tense: "",
      tone: "",
      audience: "",
      rating: "",
    },
    modes: {},
    status: {},
    elements: {
      premise: "",
      plot_outline: "",
      setting: "",
      characters: [],
      relationships: [],
      themes: [],
      endings: [],
      style_rules: [],
      banned_words: [],
    },
    updated_at: "",
  };
}

const EMPTY_RECORDS = {
  characters: [],
  relationships: [],
  knowledge: [],
  choices: [],
  setups: [],
  glossary: [],
  chapter_state: [],
  scene_sheets: [],
  recaps: [],
};

describe("dispatch: unhandled hooks", () => {
  beforeEach(() => setHandlers({}));

  it("skips a hook this plugin does not listen for", () => {
    expect(dispatch("provider.models", {})).toBe(JSON.stringify({ verdict: "skip" }));
  });

  it("skips card.step.after and timer.tick (stage machine lands later)", () => {
    expect(JSON.parse(dispatch("card.step.after", { card_id: "c1" })).verdict).toBe("skip");
    expect(JSON.parse(dispatch("timer.tick", { now: "2026-01-01T00:00:00Z" })).verdict).toBe("skip");
  });
});

describe("dispatch: mcp.tool.invoke", () => {
  let files: Record<string, string>;

  beforeEach(() => {
    const fw = fileWrites();
    files = fw.files;
    setHandlers({ ...docStore().handlers, ...callerScope("proj-1"), ...fw.handlers });
  });

  it("cancels a call to a tool this plugin does not declare", () => {
    const v = JSON.parse(dispatch("mcp.tool.invoke", { tool: "nope", arguments: {}, context: {} }));
    expect(v.verdict).toBe("cancel");
    expect(v.reason).toMatch(/does not provide tool 'nope'/);
  });

  it("cancels a malformed invoke payload", () => {
    expect(JSON.parse(dispatch("mcp.tool.invoke", null)).verdict).toBe("cancel");
  });

  it("surfaces a scope error as a tool result, not a plugin cancel", () => {
    setHandlers({ ...docStore().handlers, ...callerScope(null) });
    const result = invoke("story_get_brief");
    expect(result.error).toMatch(/project-scoped caller/);
  });

  it("story_get_brief returns null brief, no rules/feedback, and the default state before the wizard has run", () => {
    expect(invoke("story_get_brief")).toMatchObject({ brief: null, rules: [], feedback: [], state: { stage: "setup" } });
  });

  it("story_get_records returns every section, empty by default", () => {
    expect(invoke("story_get_records")).toEqual({ records: EMPTY_RECORDS });
  });

  it("story_submit_records then story_get_records round-trips", () => {
    expect(invoke("story_submit_records", { records: { characters: [{ id: "c1", name: "Ada" }] } })).toEqual({
      ok: true,
      sections: ["characters"],
      counts: { characters: 1 },
    });
    expect(invoke("story_get_records")).toEqual({
      records: { ...EMPTY_RECORDS, characters: [{ id: "c1", name: "Ada" }] },
    });
    expect(files["story/records/characters.json"]).toContain("Ada");
    expect(files["story/records/characters.md"]).toContain("Ada");
  });

  it("story_submit_records upsert-merges by identity instead of replacing the section", () => {
    invoke("story_submit_records", { records: { characters: [{ id: "c1", name: "Ada", role: "lead" }] } });
    invoke("story_submit_records", { records: { characters: [{ id: "c1", role: "support" }, { id: "c2", name: "Bo" }] } });
    expect(invoke("story_get_records").records.characters).toEqual([
      { id: "c1", name: "Ada", role: "support" },
      { id: "c2", name: "Bo" },
    ]);
  });

  it("story_get_records can limit to specific sections", () => {
    invoke("story_submit_records", { records: { characters: [{ id: "c1", name: "Ada" }], glossary: [{ term: "Ley", definition: "magic grid" }] } });
    expect(invoke("story_get_records", { sections: ["glossary"] })).toEqual({
      records: { glossary: [{ term: "Ley", definition: "magic grid" }] },
    });
  });

  it("story_submit_records rejects a missing records object", () => {
    expect(invoke("story_submit_records", {}).error).toMatch(/records/);
  });

  it("story_submit_records rejects an unknown section", () => {
    expect(invoke("story_submit_records", { records: { nope: [] } }).error).toMatch(/records\.nope: unknown property/);
  });

  it("story_submit_records rejects a non-array section value", () => {
    expect(invoke("story_submit_records", { records: { characters: { id: "c1" } } }).error).toMatch(
      /records\.characters: expected array/,
    );
  });

  it("story_submit_records rejects an extra top-level field", () => {
    expect(invoke("story_submit_records", { records: {}, extra: 1 }).error).toMatch(/args\.extra: unknown property/);
  });

  it("story_submit_records rejects an item missing its identity or with a wrongly typed field", () => {
    expect(invoke("story_submit_records", { records: { characters: [{ name: "Ada" }] } }).error).toMatch(
      /characters\[0\]\.id: required/,
    );
    expect(invoke("story_submit_records", { records: { recaps: [{ chapter: "1", recap: "x" }] } }).error).toMatch(
      /recaps\[0\]\.chapter: expected integer/,
    );
  });

  it("story_submit_records requires essential fields on new items only, and writes nothing on rejection", () => {
    const bad = invoke("story_submit_records", {
      records: { glossary: [{ term: "Ley", definition: "grid" }], characters: [{ id: "c1" }] },
    });
    expect(bad.error).toMatch(/records\.characters\[0\]\.name: required for a new item/);
    expect(invoke("story_get_records").records).toEqual(EMPTY_RECORDS); // glossary not half-applied

    invoke("story_submit_records", { records: { characters: [{ id: "c1", name: "Ada" }] } });
    expect(invoke("story_submit_records", { records: { characters: [{ id: "c1", role: "lead" }] } }).ok).toBe(true);
  });

  it("story_submit_records requires answered_in on every unexplained scene item (C3)", () => {
    const sheet = (unexplained: unknown[]) => ({ records: { scene_sheets: [{ id: "s1", chapter: 1, scene: "Dock", unexplained }] } });
    expect(invoke("story_submit_records", sheet([{ name: "the Ninth", kind: "name" }])).error).toMatch(
      /scene_sheets\[0\]\.unexplained\[0\]\.answered_in: required/,
    );
    expect(invoke("story_submit_records", sheet([{ name: "the Ninth", kind: "name", answered_in: {} }])).error).toMatch(
      /answered_in\.chapter: required/,
    );
    expect(invoke("story_submit_records", sheet([{ name: "the Ninth", kind: "name", answered_in: { chapter: 3, scene: "Archive" } }])).ok).toBe(true);
  });

  it("story_submit_chapter requires chapter and markdown", () => {
    expect(invoke("story_submit_chapter", { chapter: 0 }).error).toMatch(/markdown/);
    expect(invoke("story_submit_chapter", { markdown: "x" }).error).toMatch(/chapter/);
  });

  it("story_submit_chapter stores the chapter, mirrors it to a file, and starts at revision 1", () => {
    const result = invoke("story_submit_chapter", { chapter: 1, markdown: "# Ch1", recap: "setup" });
    expect(result).toEqual({ ok: true, path: "story/chapters/chapter-01.md", revision: 1 });
    expect(files["story/chapters/chapter-01.md"]).toBe("# Ch1");
    expect(hostCalls.some((c) => c.name === "peckboard_write_file" && c.input.path === "story/chapters/chapter-01.md")).toBe(
      true,
    );
  });

  it("story_submit_chapter bumps the revision on resubmission", () => {
    invoke("story_submit_chapter", { chapter: 1, markdown: "draft one" });
    const result = invoke("story_submit_chapter", { chapter: 1, markdown: "draft two" });
    expect(result.revision).toBe(2);
    expect(files["story/chapters/chapter-01.md"]).toBe("draft two");
  });

  it("story_submit_chapter's recap merges into the recaps records section and story/recaps.md", () => {
    invoke("story_submit_chapter", { chapter: 1, markdown: "# Ch1", recap: "Ada arrives." });
    expect(invoke("story_get_records", { sections: ["recaps"] })).toEqual({
      records: { recaps: [{ chapter: 1, recap: "Ada arrives." }] },
    });
    expect(files["story/recaps.md"]).toContain("Ada arrives.");
  });

  it("story_submit_chapter accepts a records update alongside the chapter", () => {
    invoke("story_submit_chapter", {
      chapter: 1,
      markdown: "# Ch1",
      records: { knowledge: [{ id: "k1", fact: "Ada knows the cipher", route: "common", known_by: [] }] },
    });
    expect(invoke("story_get_records", { sections: ["knowledge"] }).records.knowledge).toHaveLength(1);
  });

  it("story_update_state merges per-stage status/note/data across calls but never moves the engine-owned stage", () => {
    expect(invoke("story_update_state", { stage: "pilot", status: "active", note: "drafting" })).toMatchObject({
      ok: true,
      state: { stage: "setup", note: "drafting", stages: { pilot: { status: "active", note: "drafting" } } },
    });
    const second = invoke("story_update_state", { data: { chapters_ready: 1 } });
    expect(second.state.stage).toBe("setup");
    expect(second.state.data).toEqual({ chapters_ready: 1 });
    expect(second.state.stages.pilot).toMatchObject({ status: "active", note: "drafting" });
    expect(invoke("story_get_brief")).toMatchObject({ brief: null, feedback: [], state: { stage: "setup" } }); // separate collection
  });

  it("story_report_review rejects a bad verdict", () => {
    expect(invoke("story_report_review", { chapter: 1, pass: "line", verdict: "nope", notes: "x" }).error).toMatch(
      /verdict/,
    );
  });

  it("story_report_review rejects an unknown pass", () => {
    expect(invoke("story_report_review", { chapter: 1, pass: "nope", verdict: "pass", notes: "x" }).error).toMatch(
      /pass/,
    );
  });

  it("story_report_review with changes_requested records feedback but leaves the brief alone", () => {
    expect(
      invoke("story_report_review", { chapter: 2, pass: "line", verdict: "changes_requested", notes: "cut the filler" }),
    ).toMatchObject({ ok: true });
    const got = invoke("story_get_brief");
    expect(got.brief).toBeNull();
    expect(got.feedback).toMatchObject([{ source: "review", chapter: 2, text: "cut the filler", appended_to_rules: false }]);
    expect(files["story/reviews/chapter-02-line.md"]).toContain("cut the filler");
  });

  it("story_report_review with a pass verdict and no rule touches neither the brief nor feedback", () => {
    invoke("story_report_review", { chapter: 1, pass: "copyedit", verdict: "pass", notes: "clean" });
    expect(invoke("story_get_brief")).toMatchObject({ brief: null, rules: [], feedback: [] });
  });

  it("story_report_review with a rule but no brief yet records feedback with appended_to_rules: false", () => {
    invoke("story_report_review", { chapter: 1, pass: "line", verdict: "pass", notes: "ok", rule: "Cut filler." });
    const feedback = invoke("story_get_brief").feedback;
    expect(feedback).toMatchObject([{ text: "Cut filler.", appended_to_rules: false }]);
  });

  it("story_report_review with a rule appends to an existing brief's style_rules and marks feedback appended", () => {
    dispatch("http.request.authed", {
      method: "POST",
      path: "/api/plugin-ui/story-writer/wizard",
      body: JSON.stringify({ brief: minimalBrief() }),
    });
    invoke("story_report_review", { chapter: 3, pass: "copyedit", verdict: "pass", notes: "clean", rule: "No present-tense flashbacks." });
    const got = invoke("story_get_brief");
    expect(invoke("story_get_brief", { full: true }).brief.elements.style_rules).toEqual(["No present-tense flashbacks."]);
    expect(got.rules).toEqual(["No present-tense flashbacks."]);
    expect(got.feedback).toMatchObject([{ text: "No present-tense flashbacks.", appended_to_rules: true }]);
    expect(files["story/brief.md"]).toContain("No present-tense flashbacks.");
  });

  it("story_submit_chapter rejects a bad records update before storing the chapter", () => {
    const bad = invoke("story_submit_chapter", { chapter: 1, markdown: "# Ch1", records: { knowledge: [{ id: "k1" }] } });
    expect(bad.error).toMatch(/knowledge\[0\]\.fact: required for a new item/);
    expect(files["story/chapters/chapter-01.md"]).toBeUndefined();
    expect(invoke("story_submit_chapter", { chapter: 1, markdown: "# Ch1" }).revision).toBe(1);
  });

  it("story_submit_chapter round-trips a chapter larger than one store doc", () => {
    const markdown = "Été \"quoted\" \\ line\n".repeat(20_000); // ~420 KB > 256 KiB cap
    expect(invoke("story_submit_chapter", { chapter: 0, markdown }).path).toBe("story/chapters/chapter-00.md");
    expect(files["story/chapters/chapter-00.md"]).toBe(markdown);
    const state = JSON.parse(
      allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" })).body,
    );
    expect(state.chapters).toMatchObject([{ chapter: 0, revision: 1, length: markdown.length }]);
  });

  it("mirrors records and state into story/ as machine-readable JSON", () => {
    invoke("story_submit_records", { records: { glossary: [{ term: "Ley", definition: "magic grid" }] } });
    expect(JSON.parse(files["story/records/glossary.json"])).toEqual([{ term: "Ley", definition: "magic grid" }]);
    invoke("story_update_state", { stage: "records", status: "done" });
    expect(JSON.parse(files["story/state.json"])).toMatchObject({ stage: "setup", stages: { records: { status: "done" } } });
    invoke("story_submit_chapter", { chapter: 2, markdown: "x", recap: "Bo leaves." });
    expect(JSON.parse(files["story/records/recaps.json"])).toEqual([{ chapter: 2, recap: "Bo leaves." }]);
  });
});

describe("dispatch: http.request.before (public page)", () => {
  beforeEach(() => setHandlers({}));

  it("serves the Story tab page", () => {
    const resp = JSON.parse(dispatch("http.request.before", { method: "GET", path: "/plugin-api/v1/story-writer" }));
    expect(resp.verdict).toBe("allow");
    expect(resp.payload.status).toBe(200);
    expect(resp.payload.body).toContain("Story Writer");
  });

  it("404s an unknown path", () => {
    const resp = JSON.parse(dispatch("http.request.before", { method: "GET", path: "/plugin-api/v1/nope" }));
    expect(resp.payload.status).toBe(404);
  });
});

describe("dispatch: http.request.authed (project UI routes)", () => {
  beforeEach(() => setHandlers({ ...docStore().handlers, ...callerScope("proj-1") }));

  it("400s outside a project scope", () => {
    setHandlers({ ...docStore().handlers, ...callerScope(null) });
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" }),
    );
    expect(resp.payload.status).toBe(400);
  });

  it("GET state reflects what story_submit_records/wizard wrote", () => {
    dispatch("http.request.authed", {
      method: "POST",
      path: "/api/plugin-ui/story-writer/wizard",
      body: JSON.stringify({ brief: { basics: { title: "Ashwood" } } }),
    });
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" }),
    );
    const body = JSON.parse(resp.payload.body);
    expect(body.project_id).toBe("proj-1");
    expect(body.brief.basics).toMatchObject({ title: "Ashwood", format: "prose" });
    expect(body.brief.elements.characters).toEqual([]);
    expect(body.records).toEqual(EMPTY_RECORDS);
    expect(body.pipeline.stage).toBe("setup");
    expect(body.chapters).toEqual([]);
    expect(body.reviews).toEqual([]);
    expect(body.feedback).toEqual([]);
    expect(body.cards).toEqual([]);
  });

  it("GET models returns an empty list when the host declares none", () => {
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/models" }),
    );
    expect(JSON.parse(resp.payload.body)).toEqual({ models: [] });
  });

  it("GET chapter returns one chapter's full text, null before it's submitted", () => {
    setHandlers({ ...docStore().handlers, ...callerScope("proj-1"), ...fileWrites().handlers });
    invoke("story_submit_chapter", { chapter: 2, markdown: "# Two\n\nMara ran.", recap: "Mara runs." });
    const get = (query: string) =>
      JSON.parse(allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/chapter", query })).body);
    expect(get("n=2").chapter).toMatchObject({ chapter: 2, markdown: "# Two\n\nMara ran.", recap: "Mara runs.", revision: 1 });
    expect(get("?n=3")).toEqual({ chapter: null });
    const bad = allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/chapter", query: "n=x" }));
    expect(bad.status).toBe(400);
  });

  it("GET cards returns live board status for the pipeline's own cards only, flagging deleted ones", () => {
    const store = docStore({
      "engine/proj-1": {
        stage: "pilot",
        approved: false,
        finished: false,
        units: {
          pilot: { id: "pilot", kind: "pilot", status: "open", card_id: "c1", attempt: 1, chapter: 1, created_at: "", updated_at: "" },
          "chapter:2": { id: "chapter:2", kind: "chapter", status: "open", card_id: null, attempt: 1, chapter: 2, created_at: "", updated_at: "" },
          "chapter:3": { id: "chapter:3", kind: "chapter", status: "open", card_id: "deleted", attempt: 1, chapter: 3, created_at: "", updated_at: "" },
        },
        cursors: {},
        note: null,
        updated_at: "",
      },
    });
    const listed: any[] = [];
    setHandlers({
      ...store.handlers,
      ...callerScope("proj-1"),
      peckboard_list_cards: (input: any) => {
        listed.push(input);
        return {
          cards: [
            { id: "c1", project_id: "proj-1", title: "Pilot", description: "x".repeat(1000), step: "in_progress", blocked: false, block_reason: null, worker_session_id: "s1", last_worker_session_id: null, model: "m", updated_at: "t" },
            { id: "other", project_id: "proj-1", title: "Unrelated", description: "", step: "backlog", blocked: false, block_reason: null },
          ],
        };
      },
    });
    const body = JSON.parse(allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/cards" })).body);
    expect(listed).toEqual([{ project_id: "proj-1" }]);
    expect(body.cards).toEqual({
      c1: { id: "c1", title: "Pilot", step: "in_progress", blocked: false, block_reason: null, worker_session_id: "s1", last_worker_session_id: null, model: "m", updated_at: "t" },
      deleted: { id: "deleted", missing: true },
    });
  });

  it("GET cards skips the card listing when the pipeline owns no cards yet", () => {
    let calls = 0;
    setHandlers({ ...docStore().handlers, ...callerScope("proj-1"), peckboard_list_cards: () => (calls++, { cards: [] }) });
    const body = JSON.parse(allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/cards" })).body);
    expect(body).toEqual({ cards: {} });
    expect(calls).toBe(0);
  });

  it("404s an unknown authed path", () => {
    const resp = JSON.parse(
      dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/nope" }),
    );
    expect(resp.payload.status).toBe(404);
  });
});

describe("dispatch: cold-read tools (SW-9)", () => {
  let files: Record<string, string>;

  beforeEach(() => {
    const fw = fileWrites();
    files = fw.files;
    setHandlers({ ...docStore().handlers, ...callerScope("proj-1"), ...fw.handlers });
    invoke("story_submit_chapter", { chapter: 1, markdown: "# Ch1\n\nAda ran." });
    invoke("story_submit_chapter", { chapter: 2, markdown: "# Ch2\n\nBo followed." });
  });

  it("story_cold_read_get_text returns the chapter plus earlier chapters as a player saw them", () => {
    setSession("cold-1");
    const result = invoke("story_cold_read_get_text", { chapter: 2 });
    expect(result.chapter).toBe(2);
    expect(result.text).toContain("Bo followed");
    expect(result.previous).toEqual([{ chapter: 1, text: expect.stringContaining("Ada ran") }]);
    expect(result.missing_previous).toEqual([]);
  });

  it("story_cold_read_get_text never leaks the brief or records, even when they're set", () => {
    dispatch("http.request.authed", {
      method: "POST",
      path: "/api/plugin-ui/story-writer/wizard",
      body: JSON.stringify({ brief: { about: "ABOUT-MARK" } }),
    });
    invoke("story_submit_records", { records: { glossary: [{ term: "RECORDS-MARK", definition: "x" }] } });
    setSession("cold-1");
    const result = invoke("story_cold_read_get_text", { chapter: 2 });
    expect(JSON.stringify(result)).not.toContain("ABOUT-MARK");
    expect(JSON.stringify(result)).not.toContain("RECORDS-MARK");
  });

  it("story_cold_read_get_text strips HTML-comment markers from chapter text", () => {
    invoke("story_submit_chapter", { chapter: 3, markdown: "Before.<!-- secret --> After." });
    setSession("cold-1");
    const result = invoke("story_cold_read_get_text", { chapter: 3 });
    expect(result.text).not.toContain("secret");
    expect(result.text).toContain("Before.");
    expect(result.text).toContain("After.");
  });

  it("story_cold_read_get_text errors for an unsubmitted chapter, and reports gaps in earlier chapters", () => {
    setSession("cold-1");
    expect(invoke("story_cold_read_get_text", { chapter: 9 }).error).toMatch(/no submitted text yet/);

    setSession("session-1");
    invoke("story_submit_chapter", { chapter: 5, markdown: "# Five" }); // chapters 3, 4 never submitted
    setSession("cold-2");
    expect(invoke("story_cold_read_get_text", { chapter: 5 }).missing_previous).toEqual([3, 4]);
  });

  it("refuses a cold-read tool for a session that already called a context tool", () => {
    invoke("story_get_brief"); // session-1 is now "context"
    expect(invoke("story_cold_read_get_text", { chapter: 1 }).error).toMatch(/FRESH session/);
  });

  it("refuses a context tool for a session that already read cold-read text", () => {
    setSession("cold-1");
    invoke("story_cold_read_get_text", { chapter: 1 }); // marks cold-1 as a cold reader
    expect(invoke("story_get_brief").error).toMatch(/cold reader/);
  });

  it("story_submit_cold_read stores items with generated ids and mirrors the report to story/cold-reads/", () => {
    setSession("cold-1");
    const result = invoke("story_submit_cold_read", {
      chapter: 2,
      items: [
        { category: "unexplained", text: "Who is Bo?", location: "scene 1, first line" },
        { category: "speaker", text: "Unclear pronoun", quote: "He left." },
      ],
      first_three_lines: { narrator: true, want: false, tension: true, clear: false },
      characters: [{ name: "Bo", said: "a stranger" }],
    });
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      { id: "c1", category: "unexplained", text: "Who is Bo?" },
      { id: "c2", category: "speaker", text: "Unclear pronoun" },
    ]);
    expect(files["story/cold-reads/ch-02.md"]).toContain("Who is Bo?");
    expect(files["story/cold-reads/ch-02.md"]).toContain("Where: scene 1, first line");
    expect(files["story/cold-reads/ch-02.md"]).toContain("### c2 · Unclear speaker or pronoun");
    expect(files["story/cold-reads/ch-02.md"]).toContain("Fix: _not yet fixed_");
    const state = JSON.parse(
      allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" })).body,
    );
    expect(state.cold_reads[0].items[0]).toMatchObject({ id: "c1", category: "unexplained", location: "scene 1, first line", fix: null });
  });

  it("story_submit_cold_read takes an over-explained (obvious) item, counted apart, and requires its quote", () => {
    setSession("cold-1");
    const line = "Nadia only leaves messages when I stop answering, and I let her last two calls ring out.";
    expect(
      invoke("story_submit_cold_read", { chapter: 2, items: [{ category: "obvious", text: "Explains voicemail" }], characters: [] }).error,
    ).toMatch(/must quote the line/);
    const result = invoke("story_submit_cold_read", {
      chapter: 2,
      items: [
        { category: "obvious", text: "Explains how voicemail works", quote: line, location: "opening paragraph" },
        { category: "motive", text: "Why does she hide?" },
      ],
      characters: [],
    });
    expect(result.items.map((i: any) => i.category)).toEqual(["obvious", "motive"]);
    expect(files["story/cold-reads/ch-02.md"]).toContain("1 confusion item(s), 1 over-explained");
    expect(files["story/cold-reads/ch-02.md"]).toContain(`> ${line}`);
    setSession("session-1");
    expect(invoke("story_submit_cold_read_fixes", { chapter: 2, fixes: [{ item: "c1", fix: "cut" }, { item: "c2", fix: "Added her reason." }] }).unfixed).toEqual([]);
  });

  it("story_submit_cold_read rejects an item without a known category", () => {
    setSession("cold-1");
    expect(invoke("story_submit_cold_read", { chapter: 2, items: [{ text: "Who is Bo?" }], characters: [] }).error).toMatch(/category/);
    expect(invoke("story_submit_cold_read", { chapter: 2, items: [{ category: "typo", text: "x" }], characters: [] }).error).toMatch(/category/);
  });

  it("story_submit_cold_read errors for a chapter that hasn't been submitted", () => {
    setSession("cold-1");
    expect(invoke("story_submit_cold_read", { chapter: 9, items: [], characters: [] }).error).toMatch(/no submitted text yet/);
  });

  it("story_submit_cold_read_fixes rejects an unknown item id, and reports which items remain unfixed", () => {
    setSession("cold-1");
    invoke("story_submit_cold_read", { chapter: 2, items: [{ category: "other", text: "a" }, { category: "reread", text: "b" }], characters: [] });
    setSession("session-1");
    expect(invoke("story_submit_cold_read_fixes", { chapter: 2, fixes: [{ item: "nope", fix: "x" }] }).error).toMatch(
      /unknown cold-read item/,
    );
    const result = invoke("story_submit_cold_read_fixes", { chapter: 2, fixes: [{ item: "c1", fix: "Added a line naming Bo." }] });
    expect(result.ok).toBe(true);
    expect(result.unfixed).toEqual(["c2"]);
    const result2 = invoke("story_submit_cold_read_fixes", { chapter: 2, fixes: [{ item: "c2", fix: "Fixed pronoun." }] });
    expect(result2.unfixed).toEqual([]);
    expect(files["story/cold-reads/ch-02.md"]).toContain("Added a line naming Bo.");
  });

  it("story_submit_cold_read_fixes errors when no cold-read report exists yet for the chapter", () => {
    expect(invoke("story_submit_cold_read_fixes", { chapter: 2, fixes: [] }).error).toMatch(/no cold-read report yet/);
  });

  it("story_submit_cold_read bumps attempt and chapter_revision across resubmissions", () => {
    setSession("cold-1");
    invoke("story_submit_cold_read", { chapter: 2, items: [], characters: [] });
    setSession("session-1");
    invoke("story_submit_chapter", { chapter: 2, markdown: "# Two revised" }); // bumps to revision 2
    setSession("cold-2");
    invoke("story_submit_cold_read", { chapter: 2, items: [], characters: [] });
    const state = JSON.parse(
      allowPayload(dispatch("http.request.authed", { method: "GET", path: "/api/plugin-ui/story-writer/state" })).body,
    );
    const doc = state.cold_reads.find((d: any) => d.chapter === 2);
    expect(doc.attempt).toBe(2);
    expect(doc.chapter_revision).toBe(2);
  });
});
