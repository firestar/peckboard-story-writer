// story_get_brief's output (SW-16). The full dump (brief + every feedback
// entry + every owner note + the whole pipeline state, drafts included) ran
// to ~145k characters on a live story; the harness spills a result that big
// to a file outside the project folder, where a sandboxed worker can't read
// it. So by default the tool returns a summary under `max_chars`, and
// workers ask for the parts they need by section. `full: true` keeps the
// old dump.
//
// Pure: the tool (src/tools.ts) gathers the docs, this shapes them.

import { DEFAULT_BANNED } from "./prompts";
import { Brief, ELEMENT_KEYS, ElementKey, Feedback, PipelineState } from "./types";

export const DEFAULT_MAX_CHARS = 20_000;
export const MIN_MAX_CHARS = 5_000;
export const MAX_MAX_CHARS = 250_000;

/// Owner review rounds being redrafted right now, as story_get_brief lists them.
export interface OwnerReviewView {
  chapter: number;
  round: number;
  revision: number;
  notes: unknown[];
  summary: string | null;
}

export interface BriefData {
  brief: Brief | null;
  feedback: Feedback[];
  state: PipelineState;
  owner_reviews: OwnerReviewView[];
}

export interface BriefArgs {
  sections?: string[];
  max_chars?: number;
  full?: boolean;
}

export interface Cut {
  section: string;
  note: string;
  fetch: string;
}

const TOP_SECTIONS = ["basics", "rules", "banned_words", "feedback", "owner_reviews", "state", "elements", "lesson_overrides"] as const;
/// Element arrays whose items carry an `id`, addressable one at a time.
const ID_ELEMENTS: ElementKey[] = ["characters", "relationships", "endings"];

/// Every section name story_get_brief accepts, for the unknown-section error
/// and the hint (`<id>` = any item id of that element).
export function validSections(): string[] {
  return [
    ...TOP_SECTIONS,
    ...ELEMENT_KEYS.map((k) => `elements.${k}`),
    ...ID_ELEMENTS.map((k) => `elements.${k}.<id>`),
  ];
}

function len(v: unknown): number {
  return JSON.stringify(v)?.length ?? 0;
}

function fetchCall(sections: string[], maxChars?: number): string {
  const s = `sections:[${sections.map((x) => JSON.stringify(x)).join(", ")}]`;
  return `story_get_brief {${s}${maxChars ? `, max_chars:${maxChars}` : ""}}`;
}

/// The value of one section, keyed as it appears in the output. Throws on a
/// name that isn't a section (or an item id that doesn't exist).
function sectionValue(name: string, d: BriefData): Record<string, unknown> {
  const b = d.brief;
  switch (name) {
    case "basics":
      return { basics: b ? { about: b.about, ...b.basics, modes: b.modes, status: b.status, updated_at: b.updated_at } : null };
    case "rules":
      return { rules: b?.elements?.style_rules ?? [], rule_sources: b?.rule_sources ?? [] };
    case "banned_words":
      return { banned_words: b?.elements?.banned_words ?? [], banned_words_built_in: DEFAULT_BANNED };
    case "feedback":
      return { feedback: d.feedback };
    case "owner_reviews":
      return { owner_reviews: d.owner_reviews };
    case "state":
      return { state: d.state };
    case "elements":
      return { elements: b?.elements ?? null };
    case "lesson_overrides":
      return { lesson_overrides: b?.lesson_overrides ?? {} };
  }
  const parts = name.split(".");
  if (parts[0] === "elements" && (ELEMENT_KEYS as readonly string[]).includes(parts[1])) {
    const key = parts[1] as ElementKey;
    const value = b?.elements?.[key] ?? null;
    if (parts.length === 2) return { [name]: value };
    if (parts.length >= 3 && ID_ELEMENTS.includes(key)) {
      const id = parts.slice(2).join(".");
      const items = Array.isArray(value) ? (value as { id?: string }[]) : [];
      const item = items.find((it) => it?.id === id);
      if (!item) {
        throw new Error(`no ${key} item with id '${id}' (ids: ${items.map((it) => it?.id).join(", ") || "none"})`);
      }
      return { [name]: item };
    }
  }
  throw new Error(`unknown section '${name}'. Valid sections: ${validSections().join(", ")}`);
}

function clipText(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + "…";
}

const SUMMARY_TEXT_CHARS: Partial<Record<ElementKey, number>> = { premise: 1500, plot_outline: 3000, setting: 1500 };
const SUMMARY_FEEDBACK_ITEMS = 8;
const SUMMARY_FEEDBACK_CHARS = 800;

/// The default view: basics, all style rules, banned words, recent
/// feedback, owner reviews and pipeline state in short form; long text
/// clipped and arrays as id + name, each with a `truncated` note naming the
/// section that has it in full.
function summary(d: BriefData, cuts: Cut[]): Record<string, unknown> {
  const b = d.brief;
  let brief: unknown = null;
  if (b) {
    const el = b.elements ?? ({} as Brief["elements"]);
    const elements: Record<string, unknown> = {};
    for (const key of ELEMENT_KEYS) {
      if (key === "style_rules" || key === "banned_words") continue; // top-level `rules` / `banned_words`
      const value: unknown = (el as any)[key];
      const section = `elements.${key}`;
      const limit = SUMMARY_TEXT_CHARS[key];
      if (typeof value === "string" && limit) {
        elements[key] = clipText(value, limit);
        if (value.length > limit) cuts.push({ section, note: `clipped to ${limit} of ${value.length} characters`, fetch: fetchCall([section]) });
      } else if (Array.isArray(value) && ID_ELEMENTS.includes(key)) {
        elements[key] = value.map((it: any) =>
          key === "relationships" ? { id: it?.id, a: it?.a, b: it?.b, kind: it?.kind } : { id: it?.id, name: it?.name, ...(it?.role ? { role: it.role } : {}) },
        );
        if (value.length > 0) {
          cuts.push({ section, note: `${value.length} item(s) summarized as id + name`, fetch: `${fetchCall([section])} or one item: ${fetchCall([`${section}.<id>`])}` });
        }
      } else {
        elements[key] = value;
      }
    }
    const overrides = Object.keys(b.lesson_overrides ?? {});
    brief = {
      about: clipText(b.about ?? "", 1500),
      basics: b.basics,
      modes: b.modes,
      status: b.status,
      elements,
      lesson_overrides: overrides,
      updated_at: b.updated_at,
    };
    if ((b.about ?? "").length > 1500) cuts.push({ section: "basics", note: "about clipped to 1500 characters", fetch: fetchCall(["basics"]) });
    if (overrides.length > 0) cuts.push({ section: "lesson_overrides", note: "edited style-guide lessons listed by id only", fetch: fetchCall(["lesson_overrides"]) });
  }

  const recent = d.feedback.slice(-SUMMARY_FEEDBACK_ITEMS);
  let clipped = false;
  const feedback = recent.map((f) => {
    if (f.text.length > SUMMARY_FEEDBACK_CHARS) clipped = true;
    return { ...f, text: clipText(f.text, SUMMARY_FEEDBACK_CHARS) };
  });
  if (recent.length < d.feedback.length || clipped) {
    const parts: string[] = [];
    if (recent.length < d.feedback.length) parts.push(`newest ${recent.length} of ${d.feedback.length} entries`);
    if (clipped) parts.push(`texts clipped to ${SUMMARY_FEEDBACK_CHARS} characters`);
    cuts.push({ section: "feedback", note: parts.join("; "), fetch: fetchCall(["feedback"]) });
  }

  const owner_reviews = d.owner_reviews.map((r) => ({
    chapter: r.chapter,
    round: r.round,
    revision: r.revision,
    note_count: r.notes.length,
    summary: r.summary === null ? null : clipText(r.summary, SUMMARY_FEEDBACK_CHARS),
  }));
  if (owner_reviews.length > 0) cuts.push({ section: "owner_reviews", note: "rounds listed without their notes", fetch: fetchCall(["owner_reviews"]) });

  const dataKeys = Object.keys(d.state.data ?? {});
  const state = { stage: d.state.stage, stages: d.state.stages, note: d.state.note, data_keys: dataKeys, updated_at: d.state.updated_at };
  if (dataKeys.length > 0) cuts.push({ section: "state", note: "state.data listed by key only", fetch: fetchCall(["state"]) });

  return {
    brief,
    rules: b?.elements?.style_rules ?? [],
    banned_words: b?.elements?.banned_words ?? [],
    feedback,
    feedback_total: d.feedback.length,
    owner_reviews,
    state,
  };
}

// ── Fitting under max_chars ─────────────────────────────────────────────

/// Largest n in [0, hi] with ok(n), given ok is monotone (true then false).
function largest(hi: number, ok: (n: number) => boolean): number {
  let lo = 0;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/// Shrink `value` until its JSON fits `budget` characters: strings are
/// clipped, arrays keep their first items (`tail`: their last), objects
/// shrink their children last-key-first. Every cut is noted in `cuts`.
function shrink(value: unknown, budget: number, path: string, outer: string, tail: boolean, cuts: Cut[]): unknown {
  const full = len(value);
  // A cut inside the summary's brief.elements.<key> is fetched by that element's section.
  const m = /^brief\.elements\.([a-z_]+)/.exec(path);
  const section = m ? `elements.${m[1]}` : outer;
  if (full <= budget) return value;
  if (typeof value === "string") {
    const n = largest(value.length, (k) => len(value.slice(0, k) + "…") <= budget);
    cuts.push({ section, note: `${path}: clipped to ${n} of ${value.length} characters`, fetch: fetchCall([section], bump(full)) });
    return value.slice(0, n) + "…";
  }
  if (Array.isArray(value)) {
    const pick = (k: number) => (tail ? value.slice(value.length - k) : value.slice(0, k));
    const n = largest(value.length, (k) => len(pick(k)) <= budget);
    const ids = ID_ELEMENTS.some((k) => section === `elements.${k}`);
    cuts.push({
      section,
      note: `${path}: kept ${tail ? "newest" : "first"} ${n} of ${value.length} items`,
      fetch: ids ? `${fetchCall([section], bump(full))} or one item at a time: ${fetchCall([`${section}.<id>`])}` : fetchCall([section], bump(full)),
    });
    return pick(n);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    const keys = Object.keys(out).reverse();
    for (const key of keys) {
      const over = len(out) - budget;
      if (over <= 0) break;
      const child = out[key];
      const childLen = len(child);
      const target = Math.max(2, childLen - over);
      out[key] = shrink(child, target, `${path}.${key}`, outer, false, cuts);
    }
    for (const key of keys) {
      if (len(out) <= budget) break;
      delete out[key];
      cuts.push({ section, note: `${path}.${key}: dropped (no room)`, fetch: fetchCall([section], bump(full)) });
    }
    return out;
  }
  return value;
}

/// A max_chars that would fit a section of `n` characters with room to spare.
function bump(n: number): number {
  return Math.min(MAX_MAX_CHARS, Math.ceil((n + 4000) / 1000) * 1000);
}

/// Which output keys belong to which section, for fitting and notes.
function sectionOf(key: string): string {
  switch (key) {
    case "brief":
      return "basics";
    case "rule_sources":
      return "rules";
    case "banned_words_built_in":
      return "banned_words";
    case "feedback_total":
      return "feedback";
    default:
      return key;
  }
}

/// Build story_get_brief's result for `args` (see src/schemas.ts).
export function briefView(d: BriefData, args: BriefArgs): Record<string, unknown> {
  if (args.full) {
    return { brief: d.brief, rules: d.brief?.elements?.style_rules ?? [], feedback: d.feedback, state: d.state, owner_reviews: d.owner_reviews };
  }
  const maxChars = Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, Math.floor(args.max_chars ?? DEFAULT_MAX_CHARS)));
  const requested = Array.isArray(args.sections) && args.sections.length > 0 ? Array.from(new Set(args.sections)) : null;
  // Validate every name up front, so an unknown section errors before any work.
  if (requested) for (const name of requested) sectionValue(name, d);

  // Leave room for the notes and hint that ride along; if they turn out
  // bigger than that, cut the content harder and try again.
  let result: Record<string, unknown> = {};
  for (let reserve = 1500; reserve < maxChars; reserve += 1500) {
    result = fit(d, requested, maxChars, maxChars - reserve);
    if (len(result) <= maxChars) break;
  }
  return result;
}

function fit(d: BriefData, requested: string[] | null, maxChars: number, budget: number): Record<string, unknown> {
  const cuts: Cut[] = [];
  let body: Record<string, unknown>;
  // Keys cut first when the result is over budget.
  let shrinkOrder: string[];
  if (requested) {
    body = {};
    for (const name of requested) Object.assign(body, sectionValue(name, d));
    shrinkOrder = Object.keys(body).reverse();
  } else {
    body = summary(d, cuts);
    // Rules last: every style rule belongs in the default view.
    shrinkOrder = ["state", "feedback", "owner_reviews", "brief", "banned_words", "rules"];
  }

  for (const key of shrinkOrder) {
    const over = len(body) - budget;
    if (over <= 0) break;
    if (!(key in body)) continue;
    const childLen = len(body[key]);
    body[key] = shrink(body[key], Math.max(2, childLen - over), key, sectionOf(key), key === "feedback", cuts);
  }

  const result: Record<string, unknown> = { ...body };
  if (!requested) {
    result.hint =
      `Summary view (under ${maxChars} characters). Ask for the parts you need in full: ${fetchCall(["elements.plot_outline", "elements.characters"])}. ` +
      `Sections: ${validSections().join(", ")}. max_chars raises the cap (up to ${MAX_MAX_CHARS}); full:true returns everything unsummarized.`;
  }
  if (cuts.length > 0) {
    const shown = cuts.slice(0, 20);
    result.truncated = shown;
    if (cuts.length > shown.length) result.truncated_more = cuts.length - shown.length;
  }
  return result;
}
