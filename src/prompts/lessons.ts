// Parses the vendored writing-lessons doc (docs/writing-lessons.md, baked in
// by esbuild.js stage 0 as LESSONS_MD) into named, addressable sections so
// card templates can pull exactly the lessons relevant to a stage instead of
// dumping the whole 450-line doc into every card.
//
// Section ids mirror the doc's own numbering (## 1A -> "memory", ### Character
// sheets -> "memory.character-sheets", numbered item 7 under 1C -> "research.7",
// owner decision D -> "owner.D", ...). An unmapped heading throws rather than
// silently dropping a section, so re-vendoring a changed lessons doc fails
// loudly instead of quietly losing craft rules.

import { LESSONS_MD } from "../generated/lessons";

export interface Lesson {
  id: string;
  title: string;
  text: string;
  parent: string | null;
  vnOnly: boolean;
}

// Sections that are specific to the visual-novel format (choice menus,
// sprites/backgrounds, routes) and don't belong in a prose-novel card.
const VN_ONLY = new Set([
  "memory.setting",
  "craft.choices",
  "craft.text-art",
  "research.branching",
  "owner.C",
  "owner.D",
  "choices",
  "system-voice",
  "mechanical",
  "reader.vn",
  "reader.V1",
  "reader.V2",
]);

const H2_SECTIONS: Record<string, string> = {
  "1": "process",
  "1A": "memory",
  "1B": "craft",
  "1C": "research",
  "1D": "reader",
  "2": "style-v1",
  "3": "style",
  "4": "english",
  "5": "choices",
  "6": "system-voice",
  "7": "mechanical",
  "8": "card-template",
};

// H2 id -> ordered list of [heading-prefix, sub-id] for its H3 subsections.
const H3_SECTIONS: Record<string, Array<[string, string]>> = {
  memory: [
    ["Character sheets", "character-sheets"],
    ["Per-chapter character state", "chapter-state"],
    ["Attitudes change", "attitudes"],
    ["Every sentence has a reason", "reasons"],
    ["Continuity across chapters", "continuity"],
    ["Chapter recap notes", "recaps"],
    ["The setting drives the scene", "setting"],
  ],
  craft: [
    ["Setup and payoff list", "setup-payoff"],
    ["Choices with consequences", "choices"],
    ["Exposition and glossary", "exposition"],
    ["Point of view", "pov"],
    ["Text and art in sync", "text-art"],
    ["Text box length and pacing", "box-pacing"],
    ["Escalation and antagonists", "escalation"],
  ],
  research: [
    ["Structure", "structure"],
    ["Character", "character"],
    ["Dialogue", "dialogue"],
    ["Prose", "prose"],
    ["Tension", "tension"],
    ["Fights", "fights"],
    ["Branching and choices", "branching"],
    ["Revision", "revision"],
    ["AI failure modes", "ai"],
    ["Owner decisions", "owner"],
  ],
  reader: [
    ["Introduce every character", "intro-characters"],
    ["Openings", "openings"],
    ["Opening craft", "opening-craft"],
    ["What the reader knows", "reader-knows"],
    ["Mystery vs confusion", "mystery"],
    ["Checking from the reader's side", "checking"],
    ["Visual-novel specific", "vn"],
    ["Stating feelings", "feelings"],
  ],
  english: [
    ["Conciseness", "conciseness"],
    ["Sentence variety", "variety"],
    ["Grammar basics", "grammar"],
  ],
};

// H2 "3" (style) uses bold-label blocks instead of H3 headings.
const STYLE_BLOCKS: Array<[string, string]> = [
  ["**Voice", "voice"],
  ["**Flow", "flow"],
  ["**Scene logic", "scene-logic"],
  ["**Dialogue", "dialogue"],
  ["**Humour", "humour"],
  ["**Drama and fights", "drama"],
];

function trimTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && (lines[end - 1].trim() === "" || lines[end - 1].trim() === "---")) end--;
  return lines.slice(0, end);
}

function isBlank(lines: string[]): boolean {
  return lines.every((l) => l.trim() === "");
}

export function parseLessons(md: string): Map<string, Lesson> {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = new Map<string, Lesson>();

  const h2Indices: number[] = [];
  lines.forEach((l, i) => {
    if (/^## \d+[A-Z]?\. /.test(l)) h2Indices.push(i);
  });
  if (h2Indices.length === 0) {
    throw new Error("lessons doc: no H2 (## N.) sections found");
  }

  const introLines = trimTrailingBlank(lines.slice(0, h2Indices[0]));
  if (!isBlank(introLines)) {
    out.set("intro", {
      id: "intro",
      title: introLines[0]?.replace(/^#\s*/, "").trim() ?? "intro",
      text: introLines.join("\n").trim(),
      parent: null,
      vnOnly: false,
    });
  }

  for (let hi = 0; hi < h2Indices.length; hi++) {
    const start = h2Indices[hi];
    const end = hi + 1 < h2Indices.length ? h2Indices[hi + 1] : lines.length;
    const heading = lines[start];
    const m = heading.match(/^## (\d+[A-Z]?)\. (.*)$/);
    if (!m) throw new Error(`lessons doc: malformed H2 heading: ${heading}`);
    const [, num, titleText] = m;
    const h2id = H2_SECTIONS[num];
    if (!h2id) throw new Error(`unmapped lessons heading: ## ${num}. ${titleText}`);

    const sectionLines = trimTrailingBlank(lines.slice(start, end));
    out.set(h2id, {
      id: h2id,
      title: titleText.trim(),
      text: sectionLines.join("\n"),
      parent: null,
      vnOnly: VN_ONLY.has(h2id),
    });

    const h3defs = H3_SECTIONS[h2id];
    if (h3defs) {
      parseH3Subsections(lines, start + 1, end, h2id, h3defs, out);
    } else if (h2id === "style") {
      parseStyleBlocks(lines, start + 1, end, out);
    } else if (h2id === "process") {
      parseNumberedItems(lines, start + 1, end, "process", "process", out);
    }
  }

  return out;
}

function parseH3Subsections(
  lines: string[],
  start: number,
  end: number,
  h2id: string,
  defs: Array<[string, string]>,
  out: Map<string, Lesson>,
): void {
  const h3s: Array<{ idx: number; sub: string; title: string }> = [];
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^### (.*)$/);
    if (!m) continue;
    const headingText = m[1].trim();
    const def = defs.find(([prefix]) => headingText.startsWith(prefix));
    if (!def) throw new Error(`unmapped lessons heading: ### ${headingText} (under ## ${h2id})`);
    h3s.push({ idx: i, sub: def[1], title: headingText });
  }
  if (h3s.length === 0) return;

  if (h3s[0].idx > start) {
    const introLines = trimTrailingBlank(lines.slice(start, h3s[0].idx));
    if (!isBlank(introLines)) {
      out.set(`${h2id}.intro`, {
        id: `${h2id}.intro`,
        title: out.get(h2id)!.title,
        text: introLines.join("\n").trim(),
        parent: h2id,
        vnOnly: VN_ONLY.has(h2id),
      });
    }
  }

  for (let k = 0; k < h3s.length; k++) {
    const { idx, sub, title } = h3s[k];
    const subEnd = k + 1 < h3s.length ? h3s[k + 1].idx : end;
    const id = `${h2id}.${sub}`;
    const bodyLines = trimTrailingBlank(lines.slice(idx, subEnd));
    out.set(id, {
      id,
      title,
      text: bodyLines.join("\n"),
      parent: h2id,
      vnOnly: VN_ONLY.has(id) || VN_ONLY.has(h2id),
    });

    if (h2id === "research") {
      if (sub === "owner") {
        parseOwnerItems(lines, idx + 1, subEnd, id, out);
      } else {
        parseNumberedItems(lines, idx + 1, subEnd, "research", id, out);
      }
    } else if (h2id === "reader") {
      parseCodedItems(lines, idx + 1, subEnd, id, out);
    }
  }
}

function parseStyleBlocks(lines: string[], start: number, end: number, out: Map<string, Lesson>): void {
  const blocks: Array<{ idx: number; sub: string; title: string }> = [];
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.startsWith("**")) continue;
    const def = STYLE_BLOCKS.find(([prefix]) => line.startsWith(prefix));
    if (!def) continue;
    const tm = line.match(/^\*\*([^*]+)\*\*/);
    blocks.push({ idx: i, sub: def[1], title: tm ? tm[1].trim() : def[1].replace(/^\*\*/, "") });
  }
  if (blocks.length === 0) return;

  if (blocks[0].idx > start) {
    const introLines = trimTrailingBlank(lines.slice(start, blocks[0].idx));
    if (!isBlank(introLines)) {
      out.set("style.intro", {
        id: "style.intro",
        title: "Style intro",
        text: introLines.join("\n").trim(),
        parent: "style",
        vnOnly: false,
      });
    }
  }

  for (let k = 0; k < blocks.length; k++) {
    const { idx, sub, title } = blocks[k];
    const subEnd = k + 1 < blocks.length ? blocks[k + 1].idx : end;
    const id = `style.${sub}`;
    const bodyLines = trimTrailingBlank(lines.slice(idx, subEnd));
    out.set(id, { id, title, text: bodyLines.join("\n"), parent: "style", vnOnly: false });
  }
}

function parseNumberedItems(
  lines: string[],
  start: number,
  end: number,
  idPrefix: string,
  parent: string,
  out: Map<string, Lesson>,
): void {
  const items: Array<{ idx: number; n: string }> = [];
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^(\d+)\. /);
    if (m) items.push({ idx: i, n: m[1] });
  }
  for (let k = 0; k < items.length; k++) {
    const { idx, n } = items[k];
    const itemEnd = k + 1 < items.length ? items[k + 1].idx : end;
    const bodyLines = trimTrailingBlank(lines.slice(idx, itemEnd));
    const id = `${idPrefix}.${n}`;
    const tm = lines[idx].match(/\*\*([^*]+)\*\*/);
    out.set(id, {
      id,
      title: tm ? tm[1].trim() : lines[idx].replace(/^\d+\.\s*/, "").trim(),
      text: bodyLines.join("\n"),
      parent,
      vnOnly: VN_ONLY.has(id),
    });
  }
}

function parseOwnerItems(lines: string[], start: number, end: number, parent: string, out: Map<string, Lesson>): void {
  const items: Array<{ idx: number; letter: string }> = [];
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^- \*\*([A-E])\. /);
    if (m) items.push({ idx: i, letter: m[1] });
  }
  for (let k = 0; k < items.length; k++) {
    const { idx, letter } = items[k];
    const itemEnd = k + 1 < items.length ? items[k + 1].idx : end;
    const bodyLines = trimTrailingBlank(lines.slice(idx, itemEnd));
    const id = `owner.${letter}`;
    const tm = lines[idx].match(/\*\*([A-E]\. [^*]+)\*\*/);
    out.set(id, {
      id,
      title: tm ? tm[1].trim() : lines[idx].trim(),
      text: bodyLines.join("\n"),
      parent,
      vnOnly: VN_ONLY.has(id),
    });
  }
}

function parseCodedItems(lines: string[], start: number, end: number, parent: string, out: Map<string, Lesson>): void {
  const items: Array<{ idx: number; code: string }> = [];
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^- \*\*([A-Z]\d{1,2})\. /);
    if (m) items.push({ idx: i, code: m[1] });
  }
  for (let k = 0; k < items.length; k++) {
    const { idx, code } = items[k];
    const itemEnd = k + 1 < items.length ? items[k + 1].idx : end;
    const bodyLines = trimTrailingBlank(lines.slice(idx, itemEnd));
    const id = `reader.${code}`;
    const tm = lines[idx].match(/\*\*([A-Z]\d{1,2}\. [^*]+)\*\*/);
    out.set(id, {
      id,
      title: tm ? tm[1].trim() : lines[idx].trim(),
      text: bodyLines.join("\n"),
      parent,
      vnOnly: VN_ONLY.has(id),
    });
  }
}

let memo: Map<string, Lesson> | null = null;

/// The parsed lessons doc, memoized (same Map instance on every call).
export function lessons(): Map<string, Lesson> {
  if (!memo) memo = parseLessons(LESSONS_MD);
  return memo;
}

export function lessonIds(): string[] {
  return Array.from(lessons().keys());
}

function hasAncestorInSet(id: string, idSet: Set<string>, all: Map<string, Lesson>): boolean {
  let cur = all.get(id)?.parent ?? null;
  while (cur) {
    if (idSet.has(cur)) return true;
    cur = all.get(cur)?.parent ?? null;
  }
  return false;
}

function depthOf(id: string, all: Map<string, Lesson>): number {
  let d = 0;
  let cur = all.get(id)?.parent ?? null;
  while (cur) {
    d++;
    cur = all.get(cur)?.parent ?? null;
  }
  return d;
}

function overrideBlock(id: string, text: string): string {
  return `<!-- story override: ${id} -->\n${text}`;
}

/// One lesson's text with the story's overrides applied, or null when the
/// story drops it. The lesson's own override wins outright; otherwise every
/// overridden DESCENDANT is swapped out (or cut, for "") inside the parent's
/// text — shallowest first, so an overridden ancestor's replacement already
/// supersedes its children — because a card that embeds a whole section
/// (`english`) must still honour an edit to one of its parts
/// (`english.conciseness`). A child's text is always a verbatim slice of its
/// parent's (both are line ranges of the same doc), so a plain substring
/// swap is exact.
function lessonText(id: string, all: Map<string, Lesson>, overrides: Record<string, string>): string | null {
  const own = overrides[id];
  if (own === "") return null;
  if (typeof own === "string" && own) return overrideBlock(id, own);
  let text = all.get(id)!.text;
  const nested = Object.keys(overrides)
    .filter((k) => k !== id && typeof overrides[k] === "string" && all.has(k) && hasAncestorInSet(k, new Set([id]), all))
    .sort((a, b) => depthOf(a, all) - depthOf(b, all));
  for (const k of nested) {
    const original = all.get(k)!.text;
    const at = text.indexOf(original);
    if (at < 0) continue; // inside an already-replaced ancestor
    const before = text.slice(0, at);
    const after = text.slice(at + original.length);
    const value = overrides[k];
    text = value === "" ? `${before.trimEnd()}\n\n${after.trimStart()}`.trim() : before + overrideBlock(k, value) + after;
  }
  return text;
}

/// Render a set of lesson ids as markdown: drops VN-only ids when
/// `format` is "prose", dedupes an id whose ancestor is also in the list,
/// and applies per-id text overrides (empty string = omit the id) — to the
/// id itself or to any of its sub-sections (see `lessonText`).
export function renderLessons(ids: string[], opts: { format: "prose" | "vn"; overrides?: Record<string, string> }): string {
  const all = lessons();
  const overrides = opts.overrides ?? {};

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const lesson = all.get(id);
    if (!lesson) throw new Error(`unknown lesson id: ${id}`);
    if (opts.format === "prose" && lesson.vnOnly) continue;
    seen.add(id);
    kept.push(id);
  }

  const idSet = new Set(kept);
  const final = kept.filter((id) => !hasAncestorInSet(id, idSet, all));

  return final
    .map((id) => lessonText(id, all, overrides))
    .filter((x): x is string => x !== null)
    .join("\n\n");
}

const PACK_IDS = ["intro", "process", "memory", "craft", "research", "reader", "style-v1", "style", "english", "choices", "system-voice", "mechanical", "card-template"];

/// Every top-level section in document order, with overrides applied (to a
/// section or any of its sub-sections). Unlike renderLessons this ignores
/// format — it's the reference doc behind promptPack (templates.ts), not a
/// card.
export function packLessons(overrides: Record<string, string> = {}): string {
  const all = lessons();
  return PACK_IDS.map((id) => {
    if (!all.has(id)) throw new Error(`unknown lesson id: ${id}`);
    return lessonText(id, all, overrides);
  })
    .filter((x): x is string => x !== null)
    .join("\n\n");
}

/// The style-guide sections the setup wizard shows as editable defaults
/// ("style rules"), in display order and grouped: the owner-approved v2
/// style blocks, §1D (introducing characters, openings and banned openers,
/// the reader's point of view), the English-quality rules, and — for
/// visual novels — choice labels and the system voice. Edits land in
/// `brief.lesson_overrides` and reach every card through renderLessons.
/// `added` dates the owner updates the wizard flags as new.
const STYLE_GUIDE: ReadonlyArray<{ id: string; group: StyleGuideGroup; added?: string }> = [
  { id: "style.voice", group: "style" },
  { id: "style.flow", group: "style" },
  { id: "style.scene-logic", group: "style" },
  { id: "style.dialogue", group: "style" },
  { id: "style.humour", group: "style" },
  { id: "style.drama", group: "style" },
  { id: "reader.intro-characters", group: "reader", added: "2026-10-23" },
  { id: "reader.openings", group: "reader", added: "2026-10-23" },
  { id: "reader.opening-craft", group: "reader", added: "2026-10-23" },
  { id: "reader.reader-knows", group: "reader", added: "2026-10-23" },
  { id: "reader.mystery", group: "reader", added: "2026-10-23" },
  { id: "reader.checking", group: "reader", added: "2026-10-23" },
  { id: "reader.feelings", group: "reader", added: "2026-10-23" },
  { id: "reader.vn", group: "reader", added: "2026-10-23" },
  { id: "english.intro", group: "english" },
  { id: "english.conciseness", group: "english" },
  { id: "english.variety", group: "english" },
  { id: "english.grammar", group: "english" },
  { id: "choices", group: "vn" },
  { id: "system-voice", group: "vn" },
];

export const STYLE_GUIDE_IDS: readonly string[] = STYLE_GUIDE.map((e) => e.id);

export type StyleGuideGroup = "style" | "reader" | "english" | "vn";

export interface StyleGuideEntry {
  id: string;
  title: string;
  text: string;
  vn_only: boolean;
  group: StyleGuideGroup;
  added: string | null;
}

export function styleGuide(): StyleGuideEntry[] {
  const all = lessons();
  return STYLE_GUIDE.map(({ id, group, added }) => {
    const lesson = all.get(id);
    if (!lesson) throw new Error(`unknown lesson id: ${id}`);
    // Doc headings carry history, codes or a summary after the name ("(kept
    // from v1, works)", "(O1–O6, X1)", "Humour: none written."); the wizard
    // shows the plain name.
    const title = id === "english.intro" ? "English quality" : lesson.title.replace(/\s*\(.*\)\s*$/, "").replace(/\s*:.*$/, "");
    return { id, title, text: lesson.text, vn_only: lesson.vnOnly, group, added: added ?? null };
  });
}
