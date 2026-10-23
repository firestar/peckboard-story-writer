import { beforeEach, describe, expect, it } from "vitest";
import { docStore, setHandlers } from "./fakeHost";
import {
  addFeedback,
  applyRecordsUpdate,
  getAllRecords,
  getFeedback,
  getRecordSection,
  upsertSection,
} from "../src/docs";

describe("docs: upsertSection", () => {
  it("appends items with a new identity", () => {
    const out = upsertSection("characters", [{ id: "c1", name: "Ada" }], [{ id: "c2", name: "Bo" }]);
    expect(out).toEqual([{ id: "c1", name: "Ada" }, { id: "c2", name: "Bo" }]);
  });

  it("shallow-merges an item with a matching identity over the existing one", () => {
    const out = upsertSection(
      "characters",
      [{ id: "c1", name: "Ada", role: "lead" }],
      [{ id: "c1", role: "support" }],
    );
    expect(out).toEqual([{ id: "c1", name: "Ada", role: "support" }]);
  });

  it("identifies glossary entries by term, not id", () => {
    const out = upsertSection(
      "glossary",
      [{ term: "Ley", definition: "old def" }],
      [{ term: "Ley", definition: "new def" }],
    );
    expect(out).toEqual([{ term: "Ley", definition: "new def" }]);
  });

  it("identifies chapter_state and recaps by chapter", () => {
    const out = upsertSection("recaps", [{ chapter: 1, recap: "old" }], [{ chapter: 1, recap: "new" }]);
    expect(out).toEqual([{ chapter: 1, recap: "new" }]);
  });
});

describe("docs: applyRecordsUpdate / getAllRecords", () => {
  beforeEach(() => setHandlers(docStore().handlers));

  it("only touches the sections present in the update, leaving others empty", () => {
    const changed = applyRecordsUpdate("proj-1", { characters: [{ id: "c1", name: "Ada" }] });
    expect(changed).toEqual(["characters"]);
    const records = getAllRecords("proj-1");
    expect(records.characters).toEqual([{ id: "c1", name: "Ada" }]);
    expect(records.relationships).toEqual([]);
    expect(records.glossary).toEqual([]);
  });

  it("merges across repeated calls instead of replacing a section", () => {
    applyRecordsUpdate("proj-1", { characters: [{ id: "c1", name: "Ada" }] });
    applyRecordsUpdate("proj-1", { characters: [{ id: "c2", name: "Bo" }] });
    expect(getRecordSection("proj-1", "characters")).toEqual([
      { id: "c1", name: "Ada" },
      { id: "c2", name: "Bo" },
    ]);
  });

  it("ignores non-array values for a section", () => {
    const changed = applyRecordsUpdate("proj-1", { characters: "not-an-array" as any });
    expect(changed).toEqual([]);
  });
});

describe("docs: feedback", () => {
  beforeEach(() => setHandlers(docStore().handlers));

  it("addFeedback appends and assigns id/at", () => {
    const entry = addFeedback("proj-1", { source: "review", chapter: 2, text: "cut filler", appended_to_rules: false });
    expect(entry.id).toBeTruthy();
    expect(entry.at).toBeTruthy();
    expect(getFeedback("proj-1")).toEqual([entry]);
  });

  it("accumulates across calls", () => {
    addFeedback("proj-1", { source: "owner", chapter: null, text: "first", appended_to_rules: false });
    addFeedback("proj-1", { source: "review", chapter: 1, text: "second", appended_to_rules: true });
    expect(getFeedback("proj-1").map((f) => f.text)).toEqual(["first", "second"]);
  });
});
