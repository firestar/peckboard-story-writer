// Typed document store over the host's `data_store` permission
// (`peckboard_store_put/get/list/delete`, see src/host.ts). Every document
// this plugin persists goes through here so the ≤256-KiB-per-doc limit and
// project-id keying are handled in one place.
//
// Collections: "brief" (key = projectId), "records" (key =
// `${projectId}:${section}`, one doc per RECORD_SECTION), "chapters" (key =
// `${projectId}:${chapter}`), "reviews" (key = `${projectId}:${chapter}:${pass}`),
// "state" (key = projectId), "feedback" (key = projectId, one doc holding the
// list — feedback entries are small and append-only).
//
// Core broadcasts a `plugin-data` WS frame on every effective store put/
// delete (peckboard/src/plugin/host.rs `notify_store_changed`), which the
// app forwards into the sandboxed page as `{type: "plugin-ui-event", event:
// "plugin-data", collection}` (see PluginFullPage.tsx / usePluginDataForward).
// That IS this plugin's live-refresh signal — callers get it for free from
// every putDoc/deleteDoc below; there is no separate host call to emit it.
//
// Chunking: core rejects a `peckboard_store_put` whose serialized `data`
// exceeds 256 KiB. A document that would exceed that is split into a head
// record `{ __chunked: 1, parts: n }` plus `n` part docs stored at
// `${key}#0`, `${key}#1`, ... Parts are written before the head (so a reader
// never sees a head pointing at a missing part) and any now-stale parts from
// a shrunk document are deleted after the head update.

import { storeDelete, storeGet, storeList, storePut } from "./host";

/// Stay well under the host's 256 KiB (262144 byte) cap to leave room for the
/// JSON envelope `peckboard_store_put` wraps the value in.
const CHUNK_BUDGET = 240 * 1024;

interface ChunkHead {
  __chunked: 1;
  parts: number;
}

function isChunkHead(v: unknown): v is ChunkHead {
  return !!v && typeof v === "object" && (v as any).__chunked === 1 && typeof (v as any).parts === "number";
}

/// UTF-8 byte length of a string, without relying on TextEncoder (not
/// available in every Extism/QuickJS build).
function utf8Len(s: string): number {
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) len += 1;
    else if (code < 0x800) len += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: the pair encodes one 4-byte code point. Count it
      // once here and skip the low surrogate on the next iteration.
      len += 4;
      i++;
    } else len += 3;
  }
  return len;
}

function fitsBudget(json: string, i: number, end: number): boolean {
  return utf8Len(JSON.stringify(json.slice(i, end))) <= CHUNK_BUDGET;
}

/// Binary-search the largest `end > i` such that `json.slice(i, end)` still
/// fits `CHUNK_BUDGET` once quoted. A one-char-at-a-time shrink loop is
/// quadratic on escape- or multi-byte-heavy text (each step re-stringifies
/// the whole candidate slice); binary search keeps it nearly linear. `hi` is
/// capped at `i + CHUNK_BUDGET` since every character costs >= 1 byte, so
/// nothing past that could fit anyway.
function findChunkEnd(json: string, i: number): number {
  const cap = Math.min(json.length, i + CHUNK_BUDGET);
  if (!fitsBudget(json, i, i + 1)) {
    // Budget too small for even one char (shouldn't happen at 240 KiB) —
    // force progress to avoid an infinite loop.
    return i + 1;
  }
  let lo = i + 1;
  let hi = cap;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (fitsBudget(json, i, mid)) lo = mid;
    else hi = mid - 1;
  }
  // Don't split a surrogate pair across parts.
  if (lo < json.length) {
    const code = json.charCodeAt(lo - 1);
    if (code >= 0xd800 && code <= 0xdbff) lo--;
  }
  return lo;
}

/// Split `json` (a JSON-encoded string) into parts, each short enough that
/// `JSON.stringify(part)` (the quoting `peckboard_store_put` actually sends)
/// stays under `CHUNK_BUDGET`. Never splits a surrogate pair.
function splitIntoParts(json: string): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < json.length) {
    const end = findChunkEnd(json, i);
    parts.push(json.slice(i, end));
    i = end;
  }
  return parts.length > 0 ? parts : [""];
}

function partKey(key: string, i: number): string {
  return `${key}#${i}`;
}

/// Store `value` under `collection`/`key`, transparently chunked if its JSON
/// encoding is too large for one doc. Emits the host's `plugin-data` live
/// refresh event as a side effect of the underlying `peckboard_store_put`
/// call(s).
export function putDoc(collection: string, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  const priorHead = storeGet(collection, key);
  const priorParts = isChunkHead(priorHead) ? priorHead.parts : 0;

  if (utf8Len(json) <= CHUNK_BUDGET) {
    // Fits as a plain doc. Write it, then clean up any stale parts from a
    // previously-chunked version of this key.
    storePut(collection, key, value);
    for (let i = 0; i < priorParts; i++) storeDelete(collection, partKey(key, i));
    return;
  }

  const parts = splitIntoParts(json);
  for (let i = 0; i < parts.length; i++) {
    storePut(collection, partKey(key, i), parts[i]);
  }
  storePut(collection, key, { __chunked: 1, parts: parts.length } as ChunkHead);
  for (let i = parts.length; i < priorParts; i++) storeDelete(collection, partKey(key, i));
}

/// Read `collection`/`key` back, reassembling chunks transparently. `null`
/// when absent.
export function getDoc(collection: string, key: string): any {
  const head = storeGet(collection, key);
  if (!isChunkHead(head)) return head;
  let json = "";
  for (let i = 0; i < head.parts; i++) {
    const part = storeGet(collection, partKey(key, i));
    if (typeof part !== "string") {
      throw new Error(`story-writer: missing chunk ${i}/${head.parts} for ${collection}/${key}`);
    }
    json += part;
  }
  return JSON.parse(json);
}

/// Delete `collection`/`key`, including any chunk parts.
export function deleteDoc(collection: string, key: string): void {
  const head = storeGet(collection, key);
  if (isChunkHead(head)) {
    for (let i = 0; i < head.parts; i++) storeDelete(collection, partKey(key, i));
  }
  storeDelete(collection, key);
}

/// List every non-chunk-part key in `collection`, reassembling chunked docs.
/// Keys are returned as stored (callers strip their own prefix).
export function listDocs(collection: string): { key: string; value: unknown }[] {
  const raw = storeList(collection);
  const byKey = new Map(raw.map((r) => [r.key, r.value]));
  const out: { key: string; value: unknown }[] = [];
  for (const { key, value } of raw) {
    if (key.includes("#")) continue; // chunk part; only visited via its head
    out.push({ key, value: isChunkHead(value) ? reassemble(byKey, key, value) : value });
  }
  return out;
}

function reassemble(byKey: Map<string, unknown>, key: string, head: ChunkHead): unknown {
  let json = "";
  for (let i = 0; i < head.parts; i++) {
    const part = byKey.get(partKey(key, i));
    if (typeof part !== "string") {
      throw new Error(`story-writer: missing chunk ${i}/${head.parts} for ${key}`);
    }
    json += part;
  }
  return JSON.parse(json);
}
