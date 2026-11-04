import { beforeEach, describe, expect, it } from "vitest";
import { callerScope, docStore, fakeCards, fileWrites, pluginSettings, setHandlers } from "./fakeHost";
import { dispatch } from "../src/lib";
import { DEFAULT_WRITER_MODEL } from "../src/types";

const PROJECT = "proj-1";

function allow(raw: string): any {
  const v = JSON.parse(raw);
  expect(v.verdict).toBe("allow");
  return v.payload;
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

function setupBrief(): void {
  const modes = Object.fromEntries(
    ["premise", "plot_outline", "setting", "characters", "relationships", "themes", "endings", "style_rules", "banned_words"].map((k) => [k, "write"]),
  );
  const brief = {
    about: "A city falls.",
    basics: { title: "T", genre: "g", format: "prose", chapter_count: 3, pov: "third", tense: "past", tone: "tense", audience: "adult", rating: "16+" },
    modes,
    status: {},
    elements: { premise: "p", plot_outline: "po", setting: "s", characters: [], relationships: [], themes: [], endings: [], style_rules: [], banned_words: [] },
    updated_at: "",
  };
  expect(authed("POST", "/wizard", { brief }).status).toBe(200);
}

let cards: ReturnType<typeof fakeCards>;

function useSettings(values: Record<string, unknown>): void {
  cards = fakeCards();
  const ds = docStore();
  setHandlers({ ...ds.handlers, ...callerScope(PROJECT), ...fileWrites().handlers, ...cards.handlers, ...pluginSettings(values) });
}

/// Start the pipeline and finish the records card, so the pilot and the
/// (blocked) chapter cards exist. Returns the cards by title.
function startThroughRecords(): { records: any; pilot: any; ch2: any; ch3: any } {
  setupBrief();
  const started = authed("POST", "/pipeline/start");
  expect(started.body.ok, JSON.stringify(started.body)).toBe(true);
  const records = cards.cards[0];
  cards.setStep(records.id, "done");
  dispatch("card.step.after", { card_id: records.id, card_title: "x", project_id: PROJECT, project_name: "P", old_step: "in_progress", new_step: "done", terminal: true });
  return {
    records,
    pilot: cards.cards.find((c) => c.title.startsWith("Pilot"))!,
    ch2: cards.cards.find((c) => c.title === "Chapter 2")!,
    ch3: cards.cards.find((c) => c.title === "Chapter 3")!,
  };
}

describe("per-story writer models", () => {
  beforeEach(() => useSettings({ writer_model: "claude:writer@acct", reviewer_model: "claude:reviewer@acct" }));

  it("with no story picks and no chapter setting, every writer card runs on writer_model (unchanged behaviour)", () => {
    const { records, pilot, ch2, ch3 } = startThroughRecords();
    for (const c of [records, pilot, ch2, ch3]) expect(c.model).toBe("claude:writer@acct");
  });

  it("assigns the story's pilot pick to records + pilot and its chapter pick to chapters 2..N", () => {
    expect(authed("POST", "/models/story", { pilot: "claude:pilot@acct", chapter: "codex:chapters@acct" }).status).toBe(200);
    const { records, pilot, ch2, ch3 } = startThroughRecords();
    expect(records.model).toBe("claude:pilot@acct");
    expect(pilot.model).toBe("claude:pilot@acct");
    expect(ch2.model).toBe("codex:chapters@acct");
    expect(ch3.model).toBe("codex:chapters@acct");
  });

  it("chapters follow the story's pilot pick when only the pilot is picked", () => {
    authed("POST", "/models/story", { pilot: "claude:pilot@acct" });
    const { pilot, ch2 } = startThroughRecords();
    expect(pilot.model).toBe("claude:pilot@acct");
    expect(ch2.model).toBe("claude:pilot@acct");
  });

  it("reviewer cards (cold reads) keep the reviewer_model setting", () => {
    authed("POST", "/models/story", { pilot: "claude:pilot@acct", chapter: "codex:chapters@acct" });
    const { pilot } = startThroughRecords();
    const unit = /<!-- story-writer:unit=([^\s#]+#\d+) -->/.exec(pilot.description)![1];
    const res = allow(
      dispatch("mcp.tool.invoke", {
        tool: "story_submit_chapter",
        arguments: { chapter: 1, markdown: "# Chapter 1\n\nText.", handoff: "## Causal chain\n- 1.", unit },
        context: {},
      }),
    );
    expect(res.ok, res.error).toBe(true);
    cards.setStep(pilot.id, "done");
    dispatch("card.step.after", { card_id: pilot.id, card_title: "x", project_id: PROJECT, project_name: "P", old_step: "in_progress", new_step: "done", terminal: true });
    const cold = cards.cards.find((c) => c.title.startsWith("Cold read"))!;
    expect(cold).toBeTruthy();
    expect(cold.model).toBe("claude:reviewer@acct");
  });

  it("a cleared pick falls back to the plugin settings", () => {
    authed("POST", "/models/story", { pilot: "claude:pilot@acct", chapter: "codex:chapters@acct" });
    const res = authed("POST", "/models/story", { chapter: "" });
    expect(res.status).toBe(200);
    expect(res.body.models).toMatchObject({ pilot: "claude:pilot@acct" });
    expect(res.body.models.chapter).toBeUndefined();
    const { ch2 } = startThroughRecords();
    expect(ch2.model).toBe("claude:pilot@acct");
  });

  it("changes apply to cards created afterwards; open cards keep their model", () => {
    const { ch2 } = startThroughRecords();
    authed("POST", "/models/story", { chapter: "codex:chapters@acct" });
    expect(cards.cards.find((c) => c.id === ch2.id)!.model).toBe("claude:writer@acct");
    const recreated = authed("POST", "/pipeline/recreate");
    expect(recreated.status).toBe(200);
    const fresh = cards.cards.filter((c) => c.title === "Chapter 2" && c.id !== ch2.id);
    expect(fresh.length).toBe(1);
    expect(fresh[0].model).toBe("codex:chapters@acct");
  });

  it("reports each slot's model and where it came from in /state", () => {
    let m = authed("GET", "/state").body.models;
    expect(m.story).toEqual({ pilot: null, chapter: null });
    expect(m.pilot).toMatchObject({ id: "claude:writer@acct", source: "setting" });
    expect(m.chapter).toMatchObject({ id: "claude:writer@acct", source: "pilot" });
    expect(m.reviewer).toMatchObject({ id: "claude:reviewer@acct" });

    authed("POST", "/models/story", { chapter: "codex:chapters@acct" });
    m = authed("GET", "/state").body.models;
    expect(m.story).toEqual({ pilot: null, chapter: "codex:chapters@acct" });
    expect(m.chapter).toMatchObject({ id: "codex:chapters@acct", source: "story", in_catalog: false });
  });

  it("rejects bad picks without writing anything", () => {
    authed("POST", "/models/story", { pilot: "claude:pilot@acct" });
    for (const body of [{}, { pilot: 5 }, { chapter: "a\nb" }, { chapter: "x".repeat(201) }]) {
      const res = authed("POST", "/models/story", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    expect(authed("GET", "/state").body.models.story).toEqual({ pilot: "claude:pilot@acct", chapter: null });
  });

  it("trims picks", () => {
    const res = authed("POST", "/models/story", { pilot: "  claude:pilot@acct  " });
    expect(res.body.models.pilot).toBe("claude:pilot@acct");
  });
});

describe("plugin-level chapter writer setting", () => {
  it("chapter_writer_model moves chapters 2..N without touching the pilot", () => {
    useSettings({ writer_model: "claude:writer@acct", chapter_writer_model: "codex:chapter-default@acct" });
    const { records, pilot, ch2 } = startThroughRecords();
    expect(records.model).toBe("claude:writer@acct");
    expect(pilot.model).toBe("claude:writer@acct");
    expect(ch2.model).toBe("codex:chapter-default@acct");
    expect(authed("GET", "/state").body.models.chapter).toMatchObject({ id: "codex:chapter-default@acct", source: "setting" });
  });

  it("a story's chapter pick beats the chapter_writer_model setting", () => {
    useSettings({ writer_model: "claude:writer@acct", chapter_writer_model: "codex:chapter-default@acct" });
    authed("POST", "/models/story", { chapter: "claude:mine@acct" });
    expect(startThroughRecords().ch2.model).toBe("claude:mine@acct");
  });

  it("with no settings at all, writer cards use the built-in default", () => {
    useSettings({});
    const { pilot, ch2 } = startThroughRecords();
    expect(pilot.model).toBe(DEFAULT_WRITER_MODEL);
    expect(ch2.model).toBe(DEFAULT_WRITER_MODEL);
    expect(authed("GET", "/state").body.models.pilot.source).toBe("default");
  });
});
