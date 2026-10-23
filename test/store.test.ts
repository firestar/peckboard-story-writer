import { beforeEach, describe, expect, it } from "vitest";
import { docStore, setHandlers, MAX_DOC_BYTES } from "./fakeHost";
import { deleteDoc, getDoc, listDocs, putDoc } from "../src/store";

describe("store: chunking", () => {
  let store: ReturnType<typeof docStore>;

  beforeEach(() => {
    store = docStore();
    setHandlers(store.handlers);
  });

  it("round-trips a small doc as a single, unchunked record", () => {
    putDoc("records", "proj-1:characters", [{ id: "c1", name: "Ada" }]);
    expect(store.docs["records/proj-1:characters"]).toEqual([{ id: "c1", name: "Ada" }]);
    expect(getDoc("records", "proj-1:characters")).toEqual([{ id: "c1", name: "Ada" }]);
  });

  it("returns null for a doc that was never written", () => {
    expect(getDoc("records", "proj-1:characters")).toBeNull();
  });

  it("chunks a document whose JSON exceeds the host's per-doc cap, and every chunk stays within it", () => {
    const big = { markdown: "x".repeat(1_000_000) };
    putDoc("chapters", "proj-1:1", big);

    const head = store.docs["chapters/proj-1:1"] as any;
    expect(head.__chunked).toBe(1);
    expect(head.parts).toBeGreaterThan(1);
    for (let i = 0; i < head.parts; i++) {
      const part = store.docs[`chapters/proj-1:1#${i}`];
      expect(typeof part).toBe("string");
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(MAX_DOC_BYTES);
    }
    expect(getDoc("chapters", "proj-1:1")).toEqual(big);
  });

  it("round-trips unicode (multi-byte + surrogate-pair emoji) across a chunk boundary", () => {
    const chunk = "é𝌆漢字🎉".repeat(20000); // mixes 2/3/4-byte UTF-8 sequences
    const big = { markdown: chunk };
    putDoc("chapters", "proj-1:2", big);
    expect(getDoc("chapters", "proj-1:2")).toEqual(big);
  });

  it("deletes stale chunk parts when a doc shrinks back under the cap", () => {
    putDoc("chapters", "proj-1:3", { markdown: "x".repeat(1_000_000) });
    const partsBefore = (store.docs["chapters/proj-1:3"] as any).parts;
    expect(partsBefore).toBeGreaterThan(1);

    putDoc("chapters", "proj-1:3", { markdown: "small" });
    expect(store.docs["chapters/proj-1:3"]).toEqual({ markdown: "small" });
    for (let i = 0; i < partsBefore; i++) {
      expect(store.docs[`chapters/proj-1:3#${i}`]).toBeUndefined();
    }
  });

  it("deletes stale chunk parts when a chunked doc shrinks to fewer chunks", () => {
    putDoc("chapters", "proj-1:4", { markdown: "x".repeat(2_000_000) });
    const partsBefore = (store.docs["chapters/proj-1:4"] as any).parts;

    putDoc("chapters", "proj-1:4", { markdown: "y".repeat(1_000_000) });
    const partsAfter = (store.docs["chapters/proj-1:4"] as any).parts;
    expect(partsAfter).toBeLessThan(partsBefore);
    for (let i = partsAfter; i < partsBefore; i++) {
      expect(store.docs[`chapters/proj-1:4#${i}`]).toBeUndefined();
    }
    expect(getDoc("chapters", "proj-1:4")).toEqual({ markdown: "y".repeat(1_000_000) });
  });

  it("deleteDoc removes a chunked doc's head and every part", () => {
    putDoc("chapters", "proj-1:5", { markdown: "x".repeat(1_000_000) });
    deleteDoc("chapters", "proj-1:5");
    expect(Object.keys(store.docs).some((k) => k.startsWith("chapters/proj-1:5"))).toBe(false);
  });

  it("listDocs reassembles a chunked doc and skips its parts as independent entries", () => {
    putDoc("chapters", "proj-1:1", { chapter: 1, markdown: "x".repeat(1_000_000) });
    putDoc("chapters", "proj-1:2", { chapter: 2, markdown: "short" });

    const items = listDocs("chapters");
    expect(items.map((i) => i.key).sort()).toEqual(["proj-1:1", "proj-1:2"]);
    const chunked = items.find((i) => i.key === "proj-1:1")!.value as any;
    expect(chunked.markdown.length).toBe(1_000_000);
  });
});
