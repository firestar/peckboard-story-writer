import { beforeEach, describe, expect, it } from "vitest";
import { callerScope, docStore, fakeCards, fileWrites, pluginSettings, setHandlers } from "./fakeHost";
import { dispatch } from "../src/lib";
import { lessons, renderLessons, packLessons, styleGuide, STYLE_GUIDE_IDS, DEFAULT_BANNED } from "../src/prompts";

function authed(method: string, path: string, body?: any): { status: number; body: any } {
  const v = JSON.parse(
    dispatch("http.request.authed", {
      method,
      path: `/api/plugin-ui/story-writer${path}`,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  expect(v.verdict).toBe("allow");
  return { status: v.payload.status, body: JSON.parse(v.payload.body) };
}

function invoke(tool: string, args: unknown = {}): any {
  const v = JSON.parse(dispatch("mcp.tool.invoke", { tool, arguments: args, context: {} }));
  expect(v.verdict).toBe("allow");
  return v.payload;
}

function save(brief: any) {
  return authed("POST", "/wizard", { brief });
}

let cards: ReturnType<typeof fakeCards>;

beforeEach(() => {
  cards = fakeCards();
  setHandlers({
    ...docStore().handlers,
    ...callerScope("proj-1"),
    ...fileWrites().handlers,
    ...cards.handlers,
    ...pluginSettings({}),
  });
});

describe("GET /defaults", () => {
  it("returns the starting brief, the editable style guide, built-in banned words and the chapter cap", () => {
    const { status, body } = authed("GET", "/defaults");
    expect(status).toBe(200);
    expect(body.max_chapters).toBe(40);
    expect(body.banned_words).toEqual(DEFAULT_BANNED);
    expect(body.brief.basics.format).toBe("prose");
    expect(body.brief.modes).toMatchObject({ premise: "draft", characters: "generate", style_rules: "write" });
    expect(body.style_guide.map((e: any) => e.id)).toEqual([...STYLE_GUIDE_IDS]);
    const humour = body.style_guide.find((e: any) => e.id === "style.humour");
    expect(humour.text).toMatch(/Humour: none written/);
    expect(body.style_guide.find((e: any) => e.id === "choices").vn_only).toBe(true);
    // Doc-history parentheticals are trimmed from titles.
    expect(body.style_guide.find((e: any) => e.id === "system-voice").title).toBe("System / status window voice");
  });

  it("groups the style guide and puts the §1D reader rules (introductions, banned openers) in it as new editable defaults", () => {
    const { body } = authed("GET", "/defaults");
    const byId = Object.fromEntries(body.style_guide.map((e: any) => [e.id, e]));
    expect(byId["style.voice"]).toMatchObject({ group: "style", added: null });
    expect(byId["english.conciseness"].group).toBe("english");
    expect(byId["choices"].group).toBe("vn");
    expect(byId["reader.intro-characters"]).toMatchObject({ group: "reader", added: "2026-10-23", title: "Introduce every character" });
    expect(byId["reader.openings"].text).toMatch(/Banned openers/);
    expect(byId["reader.opening-craft"].title).toBe("Opening craft");
    expect(byId["reader.reader-knows"].title).toBe("What the reader knows");
    expect(byId["reader.vn"].vn_only).toBe(true);
    // Groups are contiguous, in display order.
    const order = body.style_guide.map((e: any) => e.group).filter((g: string, i: number, a: string[]) => a.indexOf(g) === i);
    expect(order).toEqual(["style", "reader", "english", "vn"]);
  });

  it("names the pipeline's models: the writer defaults to Claude Opus 5.5", () => {
    const { body } = authed("GET", "/defaults");
    expect(body.models.writer).toEqual({ id: "claude:claude-opus-5-5@acc_00efb018b53b417996c3ec27f7ecc333", name: "Claude Opus 5.5", is_default: true });
    expect(body.models.reviewer).toEqual({ id: null, name: null, is_default: true });

    setHandlers({
      ...docStore().handlers,
      ...callerScope("proj-1"),
      ...pluginSettings({ writer_model: "claude:sonnet@acc_x", reviewer_model: "claude:claude-opus-5-5@acc_y" }),
      peckboard_list_models: () => ({ models: [{ id: "claude:claude-opus-5-5@acc_y", display_name: "[Work] Claude Opus 5.5" }] }),
    });
    const custom = authed("GET", "/defaults").body.models;
    expect(custom.writer).toEqual({ id: "claude:sonnet@acc_x", name: "Sonnet", is_default: false });
    expect(custom.reviewer).toEqual({ id: "claude:claude-opus-5-5@acc_y", name: "[Work] Claude Opus 5.5", is_default: false });
  });
});

describe("POST /wizard (partial merge)", () => {
  it("creates a full default brief on the first save and merges later partial saves", () => {
    const first = save({ about: "A city floods.", basics: { title: "Low Tide" } });
    expect(first.status).toBe(200);
    expect(first.body.brief).toMatchObject({
      about: "A city floods.",
      basics: { title: "Low Tide", format: "prose", chapter_count: 12 },
      modes: { premise: "draft" },
      elements: { characters: [], style_rules: [] },
      lesson_overrides: {},
    });

    save({ basics: { genre: "Urban fantasy" }, modes: { premise: "write" }, elements: { premise: "She swims." } });
    const brief = authed("GET", "/state").body.brief;
    expect(brief.about).toBe("A city floods.");
    expect(brief.basics).toMatchObject({ title: "Low Tide", genre: "Urban fantasy" });
    expect(brief.modes).toMatchObject({ premise: "write", plot_outline: "generate" });
    expect(brief.elements.premise).toBe("She swims.");
  });

  it("validates fields", () => {
    const bad: Array<[any, RegExp]> = [
      [{ title: "x" }, /unknown brief field: title/],
      [{ basics: { format: "comic" } }, /basics.format/],
      [{ basics: { chapter_count: 0 } }, /chapter_count/],
      [{ basics: { chapter_count: 41 } }, /chapter_count/],
      [{ basics: { chapter_count: 2.5 } }, /chapter_count/],
      [{ basics: { colour: "red" } }, /unknown basics field/],
      [{ modes: { premise: "maybe" } }, /modes.premise/],
      [{ modes: { villain: "write" } }, /unknown element/],
      [{ elements: { characters: "Ada" } }, /elements.characters: expected an array/],
      [{ elements: { themes: [1] } }, /elements.themes\[0\]/],
      [{ elements: { premise: ["x"] } }, /elements.premise: expected a string/],
      [{ status: { premise: "done" } }, /status.premise/],
      [{ lesson_overrides: { "style.nope": "x" } }, /unknown lesson/],
      [{ lesson_overrides: { "style.voice": 3 } }, /expected a string/],
    ];
    for (const [brief, err] of bad) {
      const res = save(brief);
      expect(res.status, JSON.stringify(brief)).toBe(400);
      expect(res.body.error).toMatch(err);
    }
    expect(authed("GET", "/state").body.brief).toBeNull();
  });

  it("lets the owner approve but never set awaiting_ai", () => {
    save({ elements: { premise: "p" } });
    expect(save({ status: { premise: "approved" } }).body.brief.status.premise).toBe("approved");
    const res = save({ status: { plot_outline: "awaiting_ai" } });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toEqual(["plot_outline"]);
    expect(res.body.brief.status.plot_outline).toBeUndefined();
  });

  it("protects an element while its AI-generate card runs, and reports the dropped edit", () => {
    save({ about: "x", modes: { premise: "generate" } });
    expect(authed("POST", "/pipeline/generate", { elements: ["premise"] }).body.queued).toEqual(["premise"]);

    const res = save({ elements: { premise: "mine", setting: "a place" }, status: { premise: "approved" } });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toEqual(["premise"]);
    expect(res.body.brief.elements.premise).toBe("");
    expect(res.body.brief.status.premise).toBe("awaiting_ai");
    expect(res.body.brief.elements.setting).toBe("a place");

    // The AI's draft lands and is reviewable/editable again.
    invoke("story_update_state", { data: { draft_premise: "AI premise" } });
    dispatch("card.step.after", { card_id: cards.cards[0].id, project_id: "proj-1", new_step: "done", terminal: true });
    const after = save({ elements: { premise: "AI premise, edited" } }).body.brief;
    expect(after.elements.premise).toBe("AI premise, edited");
    expect(after.status.premise).toBe("ai_draft");
  });

  it("resets a stale awaiting_ai element (its card closed without a draft) when the owner edits it", () => {
    save({ about: "x", modes: { premise: "generate" } });
    authed("POST", "/pipeline/generate", { elements: ["premise"] });
    dispatch("card.step.after", { card_id: cards.cards[0].id, project_id: "proj-1", new_step: "wont_do", terminal: true });
    const state = authed("GET", "/state").body;
    expect(state.engine.units["generate:premise"].status).toBe("failed");
    expect(state.brief.status.premise).toBe("awaiting_ai");

    const res = save({ elements: { premise: "I'll write it" } });
    expect(res.body.ignored).toEqual([]);
    expect(res.body.brief.elements.premise).toBe("I'll write it");
    expect(res.body.brief.status.premise).toBe("empty");
  });

  it("stores lesson overrides as a whole map", () => {
    save({ lesson_overrides: { "style.humour": "Dry wit is fine.", "english.grammar": "" } });
    expect(save({ lesson_overrides: { "style.humour": "Dry wit is fine." } }).body.brief.lesson_overrides).toEqual({
      "style.humour": "Dry wit is fine.",
    });
  });

  it("fixes format and chapter count once the pipeline has started", () => {
    const modes = Object.fromEntries(Object.keys(authed("GET", "/defaults").body.brief.modes).map((k) => [k, "write"]));
    save({ about: "x", basics: { chapter_count: 3 }, modes });
    expect(authed("POST", "/pipeline/start").status).toBe(200);

    for (const basics of [{ chapter_count: 5 }, { format: "vn" }]) {
      const res = save({ basics });
      expect(res.status, JSON.stringify(basics)).toBe(409);
      expect(res.body.error).toMatch(/fixed once the pipeline has started/);
    }
    expect(save({ basics: { chapter_count: 3, title: "Renamed" } }).status).toBe(200);
    expect(authed("GET", "/state").body.brief.basics).toMatchObject({ chapter_count: 3, format: "prose", title: "Renamed" });
  });
});

describe("lesson overrides", () => {
  const all = lessons();

  it("a child's text is a verbatim slice of its parent's", () => {
    for (const id of STYLE_GUIDE_IDS) {
      const lesson = all.get(id)!;
      if (!lesson.parent) continue;
      expect(all.get(lesson.parent)!.text.includes(lesson.text), id).toBe(true);
    }
  });

  it("applies a sub-section override inside a card that embeds the whole parent section", () => {
    const original = all.get("english.conciseness")!.text;
    const md = renderLessons(["english"], { format: "prose", overrides: { "english.conciseness": "CONCISE-OVERRIDE" } });
    expect(md).toContain("CONCISE-OVERRIDE");
    expect(md).not.toContain(original);
    expect(md).toContain(all.get("english.variety")!.text);
  });

  it("drops an overridden-off sub-section from its parent", () => {
    const md = renderLessons(["english"], { format: "prose", overrides: { "english.grammar": "" } });
    expect(md).not.toContain(all.get("english.grammar")!.text);
    expect(md).toContain(all.get("english.variety")!.text);
  });

  it("lets a parent override supersede its children's", () => {
    const md = renderLessons(["english"], { format: "prose", overrides: { english: "PARENT", "english.grammar": "CHILD" } });
    expect(md).toContain("PARENT");
    expect(md).not.toContain("CHILD");
  });

  it("packLessons honours sub-section overrides too", () => {
    expect(packLessons({ "style.humour": "HUMOUR-OVERRIDE" })).toContain("HUMOUR-OVERRIDE");
  });

  it("styleGuide lists every editable section with its default text", () => {
    const guide = styleGuide();
    expect(guide).toHaveLength(STYLE_GUIDE_IDS.length);
    for (const e of guide) expect(e.text).toBe(all.get(e.id)!.text);
  });

  it("the story's overrides reach the cards the pipeline creates", () => {
    save({
      about: "x",
      basics: { title: "T", chapter_count: 2 },
      modes: { style_rules: "generate" },
      lesson_overrides: { "style.humour": "HUMOUR-OVERRIDE: dry wit is allowed." },
    });
    authed("POST", "/pipeline/generate", { elements: ["style_rules"] });
    expect(cards.cards).toHaveLength(1);
    expect(cards.cards[0].description).toContain("HUMOUR-OVERRIDE: dry wit is allowed.");
    expect(cards.cards[0].description).not.toContain("Humour: none written");
  });
});
