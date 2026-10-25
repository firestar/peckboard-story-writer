// SW-16: story_add_style_rules, the sectioned/capped story_get_brief, and
// story_update_state's merge semantics.

import { beforeEach, describe, expect, it } from "vitest";
import { callerScope, docStore, fakeCards, fileWrites, pluginSettings, setHandlers } from "./fakeHost";
import { dispatch } from "../src/lib";
// @ts-expect-error — plain ESM page module, no type declarations
import { storyRules } from "../page/dash-model.js";

const PROJECT = "proj-1";

// The three rules the VN2 owner review (story/reviews/chapter-01-owner.md:41) asked for.
const VN2_RULES = [
  "Never describe the ship, bells, or any Ossari tech with body-like, fleshy, or sexual-reading imagery: no wet, membrane, throat, mouth, swallow, body-warm, or seed similes. Describe them in plain physical terms (material, shape, color, temperature).",
  "No writerly invented-precision or counting lines, such as 'knows it to the second', 'this exact minute', or 'stopped counting days past two hundred'. Say the plain thing.",
  "No unexplained jargon (e.g. 'gristle' for the cradle straps). Define a term in plain words on first use, or cut it.",
];
const SOURCE = "story/reviews/chapter-01-owner.md:41";

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
    dispatch("http.request.authed", { method, path: `/api/plugin-ui/story-writer${path}`, body: body !== undefined ? JSON.stringify(body) : undefined }),
  );
  return { status: resp.status, body: JSON.parse(resp.body) };
}

function briefFixture(overrides: any = {}): any {
  const modes = Object.fromEntries(
    ["premise", "plot_outline", "setting", "characters", "relationships", "themes", "endings", "style_rules", "banned_words"].map((k) => [k, "write"]),
  );
  return {
    about: "A ship falls out of the sky.",
    basics: { title: "VN2", genre: "sf", format: "vn", chapter_count: 3, pov: "first", tense: "present", tone: "tense", audience: "adult", rating: "16+" },
    modes,
    status: {},
    elements: {
      premise: "p",
      plot_outline: "po",
      setting: "s",
      characters: [],
      relationships: [],
      themes: [],
      endings: [],
      style_rules: ["Owner rule: keep sentences short."],
      banned_words: ["tapestry"],
    },
    updated_at: "",
    ...overrides,
  };
}

let cards: ReturnType<typeof fakeCards>;
let files: Record<string, string>;

beforeEach(() => {
  cards = fakeCards();
  const fw = fileWrites();
  files = fw.files;
  setHandlers({
    ...docStore().handlers,
    ...callerScope(PROJECT),
    ...fw.handlers,
    ...cards.handlers,
    ...pluginSettings({ writer_model: "claude:writer@acct", reviewer_model: "claude:reviewer@acct" }),
  });
});

function setupBrief(overrides: any = {}): void {
  expect(authed("POST", "/wizard", { brief: briefFixture(overrides) }).status).toBe(200);
}

function finish(cardId: string): void {
  cards.setStep(cardId, "done");
  dispatch("card.step.after", { card_id: cardId, card_title: "x", project_id: PROJECT, project_name: "P", old_step: "in_progress", new_step: "done", terminal: true });
}

describe("story_add_style_rules", () => {
  it("adds the 3 VN2 rules once, then skips all 3 as duplicates; the owner's rule is untouched", () => {
    setupBrief();
    const first = invoke("story_add_style_rules", { rules: VN2_RULES, source: SOURCE });
    expect(first).toEqual({ added: VN2_RULES, skipped_duplicates: [], total: 4 });

    // Same rules again, re-cased and padded: exact match after trim + case-fold.
    const again = invoke("story_add_style_rules", { rules: VN2_RULES.map((r, i) => (i === 0 ? `  ${r.toUpperCase()}  ` : r)), source: SOURCE });
    expect(again.added).toEqual([]);
    expect(again.skipped_duplicates).toHaveLength(3);
    expect(again.total).toBe(4);

    const brief = invoke("story_get_brief", { full: true }).brief;
    expect(brief.elements.style_rules).toEqual(["Owner rule: keep sentences short.", ...VN2_RULES]);
    expect(brief.rule_sources).toHaveLength(3);
    expect(brief.rule_sources[0]).toMatchObject({ rule: VN2_RULES[0], source: SOURCE, session_id: "session-1" });
    expect(typeof brief.rule_sources[0].added_at).toBe("string");
    expect(files["story/brief.md"]).toContain(VN2_RULES[2]);
  });

  it("stores the card id when given and dedupes within one call", () => {
    setupBrief();
    const res = invoke("story_add_style_rules", { rules: ["Cut filler.", "cut filler."], source: "owner note", card_id: "card-9" });
    expect(res).toEqual({ added: ["Cut filler."], skipped_duplicates: ["cut filler."], total: 2 });
    expect(invoke("story_get_brief", { sections: ["rules"] }).rule_sources[0]).toMatchObject({ card_id: "card-9", source: "owner note" });
  });

  it("returns the rules in story_get_brief({sections:['rules']}) and the default summary", () => {
    setupBrief();
    invoke("story_add_style_rules", { rules: VN2_RULES, source: SOURCE });
    const got = invoke("story_get_brief", { sections: ["rules"] });
    expect(got.rules).toEqual(["Owner rule: keep sentences short.", ...VN2_RULES]);
    expect(got.rule_sources.map((s: any) => s.rule)).toEqual(VN2_RULES);
    expect(invoke("story_get_brief").rules).toEqual(["Owner rule: keep sentences short.", ...VN2_RULES]);
  });

  it("puts the new rules on every writing card rendered after the call", () => {
    setupBrief();
    expect(authed("POST", "/pipeline/start").body.ok).toBe(true);
    const recordsCard = cards.cards[0];
    invoke("story_add_style_rules", { rules: VN2_RULES, source: SOURCE });
    finish(recordsCard.id);
    const pilot = cards.cards.find((c) => c.title.startsWith("Pilot"))!;
    expect(pilot).toBeTruthy();
    for (const rule of VN2_RULES) expect(pilot.description).toContain(rule);
    expect(pilot.description).toContain("Owner rule: keep sentences short.");
  });

  it("errors without a brief, on an empty or oversized rule, and with no source", () => {
    expect(invoke("story_add_style_rules", { rules: ["x"], source: SOURCE }).error).toMatch(/no brief yet/);
    setupBrief();
    expect(invoke("story_add_style_rules", { rules: [], source: SOURCE }).error).toMatch(/at least one rule/);
    expect(invoke("story_add_style_rules", { rules: ["   "], source: SOURCE }).error).toMatch(/empty rule/);
    expect(invoke("story_add_style_rules", { rules: ["x".repeat(2001)], source: SOURCE }).error).toMatch(/too long/);
    expect(invoke("story_add_style_rules", { rules: ["x"], source: "  " }).error).toMatch(/source/);
    expect(invoke("story_add_style_rules", { rules: ["x"] }).error).toMatch(/source: required/);
    expect(invoke("story_get_brief", { sections: ["rules"] }).rules).toEqual(["Owner rule: keep sentences short."]);
  });

  it("refuses to grow the rules past the total cap, writing nothing", () => {
    setupBrief({ elements: { ...briefFixture().elements, style_rules: Array.from({ length: 31 }, (_, i) => `${i} ${"r".repeat(1950)}`) } });
    const res = invoke("story_add_style_rules", { rules: ["One more rule that tips it over."], source: SOURCE });
    expect(res.error).toMatch(/would total \d+ characters \(max 60000\)/);
    const rules = invoke("story_get_brief", { sections: ["rules"] });
    expect(rules.rules.length).toBeLessThan(31); // cut to the default 20k cap…
    expect(rules.truncated[0]).toMatchObject({ section: "rules" });
    expect(rules.truncated[0].fetch).toMatch(/sections:\["rules"\], max_chars:\d+/); // …with the call that gets them all
    expect(invoke("story_get_brief", { sections: ["rules"], max_chars: 100_000 }).rules).toHaveLength(31);
  });

  it("shows agent rules as 'agent' on the dashboard; the owner deleting or rewriting one drops its tag", () => {
    setupBrief();
    invoke("story_add_style_rules", { rules: VN2_RULES, source: SOURCE });
    const state = authed("GET", "/state").body;
    expect(storyRules(state).map((r: any) => [r.source, r.from ?? null])).toEqual([
      ["setup", null],
      ["agent", SOURCE],
      ["agent", SOURCE],
      ["agent", SOURCE],
    ]);

    // Owner removes rule 2 and rewrites rule 3 in the wizard.
    const next = ["Owner rule: keep sentences short.", VN2_RULES[0], "No jargon. Define every term on first use."];
    expect(authed("POST", "/wizard", { brief: { elements: { style_rules: next } } }).status).toBe(200);
    const brief = invoke("story_get_brief", { full: true }).brief;
    expect(brief.elements.style_rules).toEqual(next);
    expect(brief.rule_sources.map((s: any) => s.rule)).toEqual([VN2_RULES[0]]);
  });
});

describe("story_get_brief sections and size cap", () => {
  function bigBrief(): any {
    const characters = Array.from({ length: 60 }, (_, i) => ({
      id: `c${i}`,
      name: `Character ${i}`,
      role: "crew",
      personality: "p".repeat(600),
      values: "v".repeat(300),
      fears: "f".repeat(300),
      flaws: "x".repeat(300),
      want: "w",
      need: "n",
      lie: "l",
      wound: "w",
      ghost: "g",
      speech_habit: "s",
      initial_emotion: "e",
      attitudes: [],
      knows: [],
    }));
    return briefFixture({
      elements: {
        ...briefFixture().elements,
        plot_outline: "Outline. ".repeat(3000),
        characters,
        relationships: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, a: `c${i}`, b: `c${i + 1}`, kind: "crew", description: "d".repeat(500) })),
      },
    });
  }

  function seedBig(): void {
    setupBrief(bigBrief());
    for (let i = 0; i < 30; i++) {
      invoke("story_report_review", { chapter: 1, pass: "line", verdict: "changes_requested", notes: `Note ${i}: ${"n".repeat(3000)}` });
    }
    invoke("story_update_state", { data: { draft_setting: "S".repeat(20000), draft_themes: ["a", "b"] } });
  }

  it("keeps the full dump over 100k but the default view under 20k, with every rule and a hint", () => {
    seedBig();
    const full = invoke("story_get_brief", { full: true });
    expect(JSON.stringify(full).length).toBeGreaterThan(100_000);
    expect(full.brief.elements.characters[0].personality).toHaveLength(600);

    const got = invoke("story_get_brief");
    expect(JSON.stringify(got).length).toBeLessThanOrEqual(20_000);
    expect(got.rules).toEqual(["Owner rule: keep sentences short."]);
    expect(got.banned_words).toEqual(["tapestry"]);
    expect(got.brief.basics.title).toBe("VN2");
    expect(got.brief.elements.characters[0]).toEqual({ id: "c0", name: "Character 0", role: "crew" });
    expect(got.state).toMatchObject({ stage: "setup", data_keys: ["draft_setting", "draft_themes"] });
    expect(got.feedback_total).toBe(30);
    expect(got.feedback.length).toBeGreaterThan(0);
    expect(got.feedback[got.feedback.length - 1].text).toMatch(/^Note 29/); // newest kept
    expect(got.hint).toMatch(/sections/);
    const sections = got.truncated.map((t: any) => t.section);
    expect(sections).toEqual(expect.arrayContaining(["elements.plot_outline", "elements.characters", "feedback", "state"]));
    const chars = got.truncated.find((t: any) => t.section === "elements.characters");
    expect(chars.fetch).toContain('story_get_brief {sections:["elements.characters"]}');
    expect(chars.fetch).toContain('"elements.characters.<id>"');
  });

  it("returns requested sections in full, cut to max_chars with a note on how to get the rest", () => {
    seedBig();
    const one = invoke("story_get_brief", { sections: ["elements.characters.c7"] });
    expect(one["elements.characters.c7"]).toMatchObject({ id: "c7", name: "Character 7", personality: "p".repeat(600) });

    const chars = invoke("story_get_brief", { sections: ["elements.characters"] });
    expect(JSON.stringify(chars).length).toBeLessThanOrEqual(20_000);
    expect(chars["elements.characters"].length).toBeLessThan(60);
    expect(chars["elements.characters"][0].personality).toHaveLength(600); // whole items, not stubs
    expect(chars.truncated[0]).toMatchObject({ section: "elements.characters" });
    expect(chars.truncated[0].note).toMatch(/kept first \d+ of 60 items/);
    expect(chars.truncated[0].fetch).toMatch(/max_chars:\d+/);

    const all = invoke("story_get_brief", { sections: ["elements.characters"], max_chars: 120_000 });
    expect(all["elements.characters"]).toHaveLength(60);
    expect(all.truncated).toBeUndefined();

    const fb = invoke("story_get_brief", { sections: ["feedback", "state"], max_chars: 200_000 });
    expect(fb.feedback).toHaveLength(30);
    expect(fb.state.data.draft_setting).toHaveLength(20000);
  });

  it("stays under even the smallest max_chars, notes included", () => {
    seedBig();
    for (const args of [{ max_chars: 5000 }, { max_chars: 5000, sections: ["elements", "feedback", "state", "rules"] }]) {
      const got = invoke("story_get_brief", args);
      expect(got.error).toBeUndefined();
      expect(JSON.stringify(got).length).toBeLessThanOrEqual(5000);
    }
  });

  it("rejects an unknown section, listing the valid ones", () => {
    setupBrief();
    const err = invoke("story_get_brief", { sections: ["nope"] }).error;
    expect(err).toMatch(/unknown section 'nope'/);
    for (const s of ["rules", "banned_words", "feedback", "owner_reviews", "state", "elements", "elements.setting", "elements.characters"]) {
      expect(err).toContain(s);
    }
    expect(invoke("story_get_brief", { sections: ["elements.characters.ghost"] }).error).toMatch(/no characters item with id 'ghost'/);
    expect(invoke("story_get_brief", { max_chars: 10 }).error).toMatch(/max_chars/);
  });

  it("serves elements.setting and the other sections by name", () => {
    setupBrief();
    const got = invoke("story_get_brief", { sections: ["elements.setting", "banned_words", "basics", "owner_reviews", "lesson_overrides"] });
    expect(got["elements.setting"]).toBe("s");
    expect(got.banned_words).toEqual(["tapestry"]);
    expect(got.banned_words_built_in).toContain("delve");
    expect(got.basics).toMatchObject({ title: "VN2", about: "A ship falls out of the sky." });
    expect(got.owner_reviews).toEqual([]);
    expect(got.lesson_overrides).toEqual({});
    expect(got.hint).toBeUndefined();
  });
});

describe("story_update_state data merge", () => {
  it("a partial push keeps the other draft_* keys", () => {
    invoke("story_update_state", { data: { draft_premise: "P", draft_setting: "S", draft_characters: [{ id: "a", name: "A" }] } });
    const res = invoke("story_update_state", { stage: "setup", data: { draft_setting: "S2" } });
    expect(res.state.data).toEqual({ draft_premise: "P", draft_setting: "S2", draft_characters: [{ id: "a", name: "A" }] });
  });

  it("a key set to null is deleted", () => {
    invoke("story_update_state", { data: { draft_premise: "P", draft_setting: "S" } });
    expect(invoke("story_update_state", { data: { draft_premise: null } }).state.data).toEqual({ draft_setting: "S" });
  });

  it("replace:true replaces state.data wholesale", () => {
    invoke("story_update_state", { data: { draft_premise: "P", draft_setting: "S" } });
    expect(invoke("story_update_state", { data: { draft_themes: ["t"] }, replace: true }).state.data).toEqual({ draft_themes: ["t"] });
    expect(invoke("story_update_state", { replace: true }).state.data).toEqual({});
  });
});
