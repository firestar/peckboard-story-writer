import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM page module, no type declarations
import * as M from "../page/model.js";
import { defaultBrief } from "../src/types";

function brief(patch: any = {}): any {
  const b: any = defaultBrief();
  return { ...b, ...patch, basics: { ...b.basics, ...(patch.basics || {}) }, modes: { ...b.modes, ...(patch.modes || {}) }, elements: { ...b.elements, ...(patch.elements || {}) } };
}

describe("page model: catalogs", () => {
  it("covers every element the plugin knows, in order", async () => {
    const { ELEMENT_KEYS } = await import("../src/types");
    expect(M.ELEMENT_KEYS).toEqual([...ELEMENT_KEYS]);
  });

  it("labels endings for the format", () => {
    expect(M.elementLabel("endings", "vn")).toBe("Endings / routes / choices");
    expect(M.elementLabel("endings", "prose")).toBe("Ending");
    expect(M.wizardSteps("prose").map((s: any) => s.id)).toEqual([
      "about",
      "basics",
      "modes",
      ...M.ELEMENT_KEYS,
      "review",
    ]);
  });
});

describe("page model: save/merge bookkeeping", () => {
  it("builds a patch of only the touched paths", () => {
    const b = brief({ about: "x", basics: { title: "T" }, elements: { premise: "p" } });
    expect(M.buildPatch(b, ["basics.title", "elements.premise", "modes.premise"])).toEqual({
      basics: { title: "T" },
      elements: { premise: "p" },
      modes: { premise: "draft" },
    });
  });

  it("merges the server copy but keeps paths the owner is still editing", () => {
    const local = brief({ about: "typing…", basics: { title: "Mine" } });
    const server = brief({ about: "old", basics: { title: "Old", genre: "Horror" }, elements: { premise: "AI premise" } });
    server.status = { premise: "ai_draft" };
    const merged = M.mergeServer(local, server, new Set(["about"]));
    expect(merged.about).toBe("typing…");
    expect(merged.basics.title).toBe("Old");
    expect(merged.basics.genre).toBe("Horror");
    expect(merged.elements.premise).toBe("AI premise");
    expect(merged.status.premise).toBe("ai_draft");
  });

  it("compares briefs ignoring updated_at and key order (the host store sorts keys)", () => {
    const a = brief({ elements: { characters: [{ id: "x", name: "X", role: "r" }] } });
    const b = JSON.parse(M.canonical(a)); // keys sorted at every level
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(M.sameBrief(a, b)).toBe(true);
    expect(M.sameBrief({ ...brief(), updated_at: "a" }, { ...brief(), updated_at: "b" })).toBe(true);
    expect(M.sameBrief(brief({ about: "a" }), brief({ about: "b" }))).toBe(false);
  });

  it("detects AI drafts that just came back", () => {
    expect(M.newDrafts({ status: { premise: "awaiting_ai" } }, { status: { premise: "ai_draft", setting: "approved" } })).toEqual(["premise"]);
    expect(M.newDrafts({ status: { premise: "ai_draft" } }, { status: { premise: "ai_draft" } })).toEqual([]);
  });

  it("first save carries every path", () => {
    const paths = M.allPaths(brief());
    expect(paths).toContain("about");
    expect(paths).toContain("basics.chapter_count");
    expect(paths).toContain("modes.endings");
    expect(paths).toContain("elements.characters");
    expect(paths).toContain("lesson_overrides");
  });
});

describe("page model: normalizers", () => {
  it("coerces odd AI character shapes into editable sheets with unique ids", () => {
    const chars = M.normalizeCharacters([
      { name: "Mara Voss", values: ["loyalty", "truth"], attitudes: [{ toward: "Teo", attitude: "protective" }], knows: "Teo lied\n- The letter is real" },
      { id: "teo", name: "Teo" },
      { id: "teo", name: "Teo's twin" },
      "not a character",
    ]);
    expect(chars).toHaveLength(3);
    expect(chars[0]).toMatchObject({ id: "mara-voss", values: "loyalty, truth", knows: ["Teo lied", "The letter is real"], fears: "" });
    expect(chars[0].attitudes[0]).toEqual({ toward: "Teo", attitude: "protective", reason: "" });
    expect(chars.map((c: any) => c.id)).toEqual(["mara-voss", "teo", "teo-1"]);
    expect(M.normalizeCharacters('[{"name":"Ada"}]')[0].name).toBe("Ada");
  });

  it("matches attitudes by id or name and re-keys them to the id on edit", () => {
    const [mara, teo] = M.normalizeCharacters([
      { id: "mara", name: "Mara", attitudes: [{ toward: "teo voss", attitude: "Wary", reason: "he lied" }] },
      { id: "teo", name: "Teo Voss" },
    ]);
    expect(M.attitudeToward(mara, teo).attitude).toBe("Wary");
    const next = M.withAttitude(mara, teo, { attitude: "Trusting" });
    expect(next.attitudes).toEqual([{ toward: "teo", attitude: "Trusting", reason: "he lied" }]);
  });

  it("removes a character with every attitude and relationship pointing at it", () => {
    const chars = M.normalizeCharacters([
      { id: "a", name: "Ada", attitudes: [{ toward: "b", attitude: "x" }, { toward: "c", attitude: "y" }] },
      { id: "b", name: "Bo" },
      { id: "c", name: "Cy", attitudes: [{ toward: "Bo", attitude: "z" }] },
    ]);
    const rels = M.normalizeRelationships([
      { id: "r1", a: "a", b: "b" },
      { id: "r2", a: "a", b: "c" },
    ]);
    const out = M.removeCharacter(chars, rels, "b");
    expect(out.characters.map((c: any) => c.id)).toEqual(["a", "c"]);
    expect(out.characters[0].attitudes).toEqual([{ toward: "c", attitude: "y", reason: "" }]);
    expect(out.characters[1].attitudes).toEqual([]);
    expect(out.relationships.map((r: any) => r.id)).toEqual(["r2"]);
  });

  it("normalizes endings and string lists", () => {
    expect(M.normalizeEndings([{ name: "Dawn", kind: "weird" }])[0]).toMatchObject({ id: "ending-1", kind: "ending", conditions: "" });
    expect(M.asStringList("- one\n* two\n\nthree")).toEqual(["one", "two", "three"]);
    expect(M.asText({ a: 1 })).toContain('"a": 1');
  });

  it("strips blank rows before the pipeline starts", () => {
    const b = brief({ elements: { themes: ["a", " ", ""], characters: [{ id: "x", name: "X", knows: ["", "k"] }] } });
    expect(M.stripBlankRows(b).sort()).toEqual(["characters", "themes"]);
    expect(b.elements.themes).toEqual(["a"]);
    expect(b.elements.characters[0].knows).toEqual(["k"]);
  });
});

describe("page model: element view and start gate", () => {
  const engine = (units: any = {}) => ({ units });

  it("derives badges from mode, status and the generate card", () => {
    const b = brief({ modes: { premise: "generate", setting: "write" }, elements: { setting: "s" } });
    expect(M.elementView(b, engine(), "premise").badge).toEqual({ text: "Not generated", tone: "muted" });
    expect(M.elementView(b, engine(), "setting").badge.tone).toBe("ok");
    expect(M.elementView(b, engine({ "generate:premise": { status: "open" } }), "premise").generating).toBe(true);

    b.status = { premise: "awaiting_ai" };
    const stale = M.elementView(b, engine({ "generate:premise": { status: "failed" } }), "premise");
    expect(stale.stale).toBe(true);
    expect(stale.needsGenerate).toBe(true);

    b.status = { premise: "ai_draft" };
    expect(M.elementView(b, engine(), "premise").needsReview).toBe(true);
  });

  it("blocks start until title, idea, chapters and every AI element are ready", () => {
    const b = brief();
    const steps = M.startBlockers(b, engine(), 40).map((x: any) => x.step);
    expect(steps).toEqual(expect.arrayContaining(["about", "basics", "premise", "plot_outline", "characters"]));
    expect(steps).not.toContain("style_rules"); // "I write it" by default

    const ready = brief({ about: "x", basics: { title: "T" } });
    for (const k of M.ELEMENT_KEYS) ready.modes[k] = "write";
    expect(M.startBlockers(ready, engine(), 40)).toEqual([]);
    ready.basics.chapter_count = 41;
    expect(M.startBlockers(ready, engine(), 40).map((x: any) => x.step)).toEqual(["basics"]);
  });

  it("warns about empty write-mode elements and unset basics", () => {
    const b = brief({ modes: { premise: "write" } });
    const w = M.startWarnings(b).map((x: any) => x.step);
    expect(w).toContain("premise");
    expect(w).toContain("basics");
  });
});
