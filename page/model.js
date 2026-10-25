// Wizard model: catalogs, value normalizers and the save/merge bookkeeping.
// Pure functions only (no DOM, no bridge) so vitest can cover them.

// ── Catalogs ─────────────────────────────────────────────────────────────

const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const PENCIL_SPARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6.5l3 3L8 19l-4 1 1-4Z"/><path d="M19 2v4M17 4h4"/></svg>';
const SPARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4Z"/><path d="M19 15v4M17 17h4"/></svg>';

export const MODES = [
  { value: "write", label: "I write it", short: "You", icon: PENCIL },
  { value: "draft", label: "AI drafts, I edit", short: "AI draft", icon: PENCIL_SPARK },
  { value: "generate", label: "AI generates", short: "AI", icon: SPARK },
];

export const ELEMENTS = [
  {
    key: "premise",
    label: "Premise",
    kind: "text",
    blurb: "The story in two or three sentences: who wants what, what stands in the way, and what it costs to fail.",
  },
  {
    key: "plot_outline",
    label: "Plot outline",
    kind: "markdown",
    blurb: "Chapter by chapter. Every scene is caused by the one before it.",
  },
  {
    key: "setting",
    label: "Setting / world",
    kind: "markdown",
    blurb: "Where and when: a short summary, the key places, and the rules of the world.",
  },
  {
    key: "characters",
    label: "Characters",
    kind: "characters",
    blurb: "Full character sheets. Writers read these before the first sentence and track every change.",
  },
  {
    key: "relationships",
    label: "Relationships",
    kind: "relationships",
    blurb: "Who is bound to whom, and how they stand at the start.",
  },
  {
    key: "themes",
    label: "Themes",
    kind: "list",
    blurb: "What the story is about underneath the plot.",
  },
  {
    key: "endings",
    label: "Endings / routes / choices",
    proseLabel: "Ending",
    kind: "endings",
    blurb: "The routes a reader can take, the endings they lead to, and what unlocks each.",
    proseBlurb: "How the story ends: where the lead and the world are left, and what it cost.",
  },
  {
    key: "style_rules",
    label: "Style rules",
    kind: "style",
    blurb: "The built-in style guide every writer and reviewer follows, plus this story's own rules.",
  },
  {
    key: "banned_words",
    label: "Banned words",
    kind: "banned",
    blurb: "Words and phrases no chapter may use.",
  },
];

export const ELEMENT_KEYS = ELEMENTS.map((e) => e.key);

export function elementMeta(key) {
  return ELEMENTS.find((e) => e.key === key);
}

export function elementLabel(key, format) {
  const meta = elementMeta(key);
  if (!meta) return key;
  return format !== "vn" && meta.proseLabel ? meta.proseLabel : meta.label;
}

export function elementBlurb(key, format) {
  const meta = elementMeta(key);
  if (!meta) return "";
  return format !== "vn" && meta.proseBlurb ? meta.proseBlurb : meta.blurb;
}

export const FORMATS = [
  { value: "prose", label: "Prose novel" },
  { value: "vn", label: "Visual-novel script" },
];

export const GENRES = [
  "Urban fantasy",
  "Fantasy",
  "Epic fantasy",
  "Science fiction",
  "Space opera",
  "Cyberpunk",
  "Post-apocalyptic",
  "Mystery",
  "Crime",
  "Thriller",
  "Horror",
  "Paranormal",
  "Romance",
  "Romantasy",
  "Historical",
  "Literary",
  "Adventure",
  "Slice of life",
];

export const POVS = ["First person", "Second person", "Third person limited", "Third person omniscient", "Multiple POV (third limited)"];
export const TENSES = ["Present", "Past"];
export const TONES = ["Dark", "Gritty", "Tense", "Eerie", "Melancholic", "Bittersweet", "Hopeful", "Heartfelt", "Romantic", "Epic", "Cozy", "Light-hearted"];
export const AUDIENCES = ["Children (8–12)", "Young adult (13–17)", "New adult (18–25)", "Adult"];
export const RATINGS = ["All ages", "Teen (13+)", "Mature (16+)", "Adult (18+)"];
export const ROLES = [
  "Protagonist",
  "Deuteragonist",
  "Antagonist",
  "Love interest",
  "Mentor",
  "Ally",
  "Rival",
  "Foil",
  "Sidekick",
  "Supporting",
  "Minor",
];
export const EMOTIONS = [
  "Calm",
  "Hopeful",
  "Determined",
  "Curious",
  "Restless",
  "Anxious",
  "Afraid",
  "Angry",
  "Resentful",
  "Suspicious",
  "Grieving",
  "Guilty",
  "Ashamed",
  "Lonely",
  "Numb",
  "Desperate",
  "Content",
];
export const ATTITUDES = [
  "Trusting",
  "Friendly",
  "Admiring",
  "Protective",
  "Attracted",
  "Dependent",
  "Neutral",
  "Indifferent",
  "Curious",
  "Wary",
  "Suspicious",
  "Jealous",
  "Resentful",
  "Hostile",
  "Contemptuous",
  "Afraid",
];
export const RELATIONSHIP_KINDS = [
  "Family",
  "Siblings",
  "Parent / child",
  "Friends",
  "Best friends",
  "Romantic",
  "Exes",
  "Allies",
  "Colleagues",
  "Mentor / student",
  "Employer / employee",
  "Rivals",
  "Enemies",
  "Strangers",
];
export const ENDING_KINDS = [
  { value: "ending", label: "Ending" },
  { value: "route", label: "Route" },
];

/// The wizard's steps in order. Element steps use the element key as id.
export function wizardSteps(format) {
  return [
    { id: "about", label: "Story idea", group: "Setup" },
    { id: "basics", label: "Basics", group: "Setup" },
    { id: "modes", label: "Who writes what", group: "Setup" },
    ...ELEMENTS.map((e) => ({ id: e.key, label: elementLabel(e.key, format), group: "Story elements", element: true })),
    { id: "review", label: "Review & start", group: "Finish" },
  ];
}

// ── Generic helpers ──────────────────────────────────────────────────────

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/// JSON with object keys sorted, so two values compare equal regardless of
/// key order (the host's store hands documents back with sorted keys).
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return v === undefined ? "null" : JSON.stringify(v);
}

/// Same brief, ignoring the server-stamped `updated_at` and key order.
export function sameBrief(a, b) {
  const strip = (x) => (isObj(x) ? { ...x, updated_at: "" } : x);
  return canonical(strip(a)) === canonical(strip(b));
}

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// ── Normalizers (AI drafts can come back in odd shapes) ─────────────────

/// A text field: strings pass through, lists join, objects pretty-print.
export function asText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join(", ");
  return JSON.stringify(v, null, 2);
}

/// A list of strings: arrays map item-wise, a string splits into lines.
export function asStringList(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : asText(x)));
  if (typeof v === "string") {
    return v
      .split("\n")
      .map((s) => s.replace(/^\s*[-*•]\s+/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function asObjectList(v) {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (_e) {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter(isObj) : [];
}

export function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/// A fresh id not in `taken`: `<base>-1`, `<base>-2`, ...
export function freshId(base, taken) {
  const set = new Set(taken);
  for (let i = 1; ; i++) {
    const id = `${base}-${i}`;
    if (!set.has(id)) return id;
  }
}

const CHARACTER_TEXT = [
  "name",
  "role",
  "personality",
  "values",
  "fears",
  "flaws",
  "want",
  "need",
  "lie",
  "wound",
  "ghost",
  "speech_habit",
  "initial_emotion",
];

export function normalizeCharacters(v) {
  const list = asObjectList(v);
  const taken = new Set();
  return list.map((c, i) => {
    const out = { ...c };
    for (const f of CHARACTER_TEXT) out[f] = asText(c[f]);
    let id = typeof c.id === "string" && c.id ? c.id : slug(out.name) || `character-${i + 1}`;
    if (taken.has(id)) id = freshId(id, taken);
    taken.add(id);
    out.id = id;
    out.attitudes = asObjectList(c.attitudes).map((a) => ({
      ...a,
      toward: asText(a.toward),
      attitude: asText(a.attitude),
      reason: asText(a.reason),
    }));
    out.knows = asStringList(c.knows);
    if (c.notes !== undefined) out.notes = asText(c.notes);
    return out;
  });
}

export function newCharacter(existing) {
  const id = freshId("character", existing.map((c) => c.id));
  const c = { id, attitudes: [], knows: [] };
  for (const f of CHARACTER_TEXT) c[f] = "";
  return c;
}

/// The character `ref` (an id, or a name as AI drafts often write) points at.
export function findCharacter(chars, ref) {
  if (!ref) return null;
  const r = String(ref).trim().toLowerCase();
  return chars.find((c) => c.id === ref) || chars.find((c) => c.name.trim().toLowerCase() === r) || null;
}

/// `who`'s starting attitude toward `other` (matched by id or name).
export function attitudeToward(who, other) {
  const name = other.name.trim().toLowerCase();
  return (
    who.attitudes.find((a) => a.toward === other.id) ||
    who.attitudes.find((a) => name && a.toward.trim().toLowerCase() === name) ||
    null
  );
}

/// Set `who`'s attitude toward `other`, re-keying a name-matched entry to the id.
export function withAttitude(who, other, patch) {
  const existing = attitudeToward(who, other);
  const rest = who.attitudes.filter((a) => a !== existing);
  const next = { toward: other.id, attitude: "", reason: "", ...(existing || {}), ...patch };
  next.toward = other.id;
  return { ...who, attitudes: [...rest, next] };
}

/// Drop a removed character and every attitude/relationship pointing at it.
export function removeCharacter(chars, relationships, id) {
  const gone = chars.find((c) => c.id === id);
  const names = new Set([id, gone ? gone.name.trim().toLowerCase() : ""].filter(Boolean));
  const points = (ref) => names.has(ref) || names.has(String(ref || "").trim().toLowerCase());
  const nextChars = chars
    .filter((c) => c.id !== id)
    .map((c) => ({ ...c, attitudes: c.attitudes.filter((a) => !points(a.toward)) }));
  const nextRels = relationships.filter((r) => !points(r.a) && !points(r.b));
  return { characters: nextChars, relationships: nextRels };
}

export function normalizeRelationships(v) {
  const taken = new Set();
  return asObjectList(v).map((r, i) => {
    const out = { ...r, a: asText(r.a), b: asText(r.b), kind: asText(r.kind), description: asText(r.description) };
    let id = typeof r.id === "string" && r.id ? r.id : `relationship-${i + 1}`;
    if (taken.has(id)) id = freshId(id, taken);
    taken.add(id);
    out.id = id;
    return out;
  });
}

export function newRelationship(existing) {
  return { id: freshId("relationship", existing.map((r) => r.id)), a: "", b: "", kind: "", description: "" };
}

export function normalizeEndings(v) {
  const taken = new Set();
  return asObjectList(v).map((e, i) => {
    const out = {
      ...e,
      name: asText(e.name),
      kind: e.kind === "route" ? "route" : "ending",
      description: asText(e.description),
      conditions: asText(e.conditions),
    };
    let id = typeof e.id === "string" && e.id ? e.id : `ending-${i + 1}`;
    if (taken.has(id)) id = freshId(id, taken);
    taken.add(id);
    out.id = id;
    return out;
  });
}

export function newEnding(existing) {
  return { id: freshId("ending", existing.map((e) => e.id)), name: "", kind: "ending", description: "", conditions: "" };
}

/// Whether an element has any owner/AI content yet.
export function hasContent(key, value) {
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((x) => (typeof x === "string" ? x.trim() !== "" : isObj(x)));
  return false;
}

/// Remove blank list rows (left behind by "Add" buttons) before the brief
/// goes to the pipeline. Returns the element keys that changed.
export function stripBlankRows(brief) {
  const changed = [];
  for (const key of ["themes", "style_rules", "banned_words"]) {
    const list = brief.elements[key];
    if (!Array.isArray(list)) continue;
    const next = list.filter((s) => typeof s !== "string" || s.trim() !== "");
    if (next.length !== list.length) {
      brief.elements[key] = next;
      changed.push(key);
    }
  }
  if (Array.isArray(brief.elements.characters)) {
    let touched = false;
    const next = brief.elements.characters.map((c) => {
      if (!isObj(c) || !Array.isArray(c.knows)) return c;
      const knows = c.knows.filter((s) => typeof s !== "string" || s.trim() !== "");
      if (knows.length === c.knows.length) return c;
      touched = true;
      return { ...c, knows };
    });
    if (touched) {
      brief.elements.characters = next;
      changed.push("characters");
    }
  }
  return changed;
}
/// The provenance of an agent-added style rule (SW-16 story_add_style_rules),
/// matched by trimmed, case-insensitive text — null for the owner's own
/// rules (and for an agent rule the owner has since rewritten).
export function ruleSource(brief, text) {
  const sources = (brief && Array.isArray(brief.rule_sources) && brief.rule_sources) || [];
  const key = String(text || "").trim().toLowerCase();
  if (!key) return null;
  return sources.find((s) => s && String(s.rule || "").trim().toLowerCase() === key) || null;
}

// ── Element lifecycle view ───────────────────────────────────────────────

/// Everything the UI needs about one element's state: mode, status, whether
/// its AI card is running, and a status badge.
export function elementView(brief, engine, key) {
  const mode = (brief.modes && brief.modes[key]) || "write";
  const status = (brief.status && brief.status[key]) || "empty";
  const unit = engine && engine.units ? engine.units[`generate:${key}`] : null;
  const generating = !!unit && unit.status === "open";
  const filled = hasContent(key, brief.elements ? brief.elements[key] : undefined);
  const ai = mode === "draft" || mode === "generate";
  // awaiting_ai with no running card: the card was closed without a draft.
  // Irrelevant once the owner has switched the element to "I write it".
  const stale = ai && !generating && status === "awaiting_ai";

  let badge;
  if (generating) badge = { text: mode === "draft" ? "AI drafting…" : "AI generating…", tone: "busy" };
  else if (stale) badge = { text: "AI card closed", tone: "err" };
  else if (!ai) {
    if (key === "style_rules") {
      const edited = Object.keys(brief.lesson_overrides || {}).length > 0;
      badge = { text: filled || edited ? "Customized" : "Built-in guide", tone: "ok" };
    } else if (key === "banned_words") badge = { text: filled ? "Custom list" : "Built-in list", tone: "ok" };
    else badge = filled ? { text: "Written", tone: "ok" } : { text: "Empty", tone: "muted" };
  } else if (status === "approved") badge = { text: "Approved", tone: "ok" };
  else if (status === "ai_draft") badge = { text: "Review draft", tone: "warn" };
  else badge = { text: mode === "draft" ? "Not drafted" : "Not generated", tone: "muted" };

  return {
    key,
    mode,
    status,
    ai,
    generating,
    stale,
    filled,
    unit,
    badge,
    needsGenerate: ai && !generating && (status === "empty" || stale),
    needsReview: ai && !generating && status === "ai_draft",
  };
}

/// Why the pipeline can't start yet (mirrors /pipeline/start's gate plus
/// the two inputs every card leans on: a title and the story idea).
export function startBlockers(brief, engine, maxChapters) {
  const out = [];
  const fmt = brief.basics && brief.basics.format;
  if (!brief.about || !brief.about.trim()) out.push({ step: "about", text: "Say what the story is about." });
  if (!brief.basics || !brief.basics.title || !brief.basics.title.trim()) out.push({ step: "basics", text: "Give the story a title." });
  const n = brief.basics && brief.basics.chapter_count;
  if (!Number.isInteger(n) || n < 1 || n > maxChapters) {
    out.push({ step: "basics", text: `Chapter count must be 1–${maxChapters}.` });
  }
  for (const key of ELEMENT_KEYS) {
    const v = elementView(brief, engine, key);
    if (!v.ai) continue;
    const label = elementLabel(key, fmt);
    if (v.generating) out.push({ step: key, text: `${label}: the AI is still working on it.` });
    else if (v.stale) out.push({ step: key, text: `${label}: the AI card closed without a draft — try again or write it yourself.` });
    else if (v.status === "ai_draft") out.push({ step: key, text: `${label}: review and approve the AI draft.` });
    else if (v.status !== "approved") {
      out.push({ step: key, text: `${label}: ${v.mode === "draft" ? "let the AI draft it" : "generate it"}, then approve it.` });
    }
  }
  return out;
}

/// Soft warnings: things that won't stop the pipeline but probably should
/// be filled in.
export function startWarnings(brief) {
  const out = [];
  const fmt = brief.basics && brief.basics.format;
  for (const key of ["premise", "plot_outline", "setting", "characters"]) {
    if (brief.modes[key] !== "write") continue;
    if (!hasContent(key, brief.elements[key])) out.push({ step: key, text: `${elementLabel(key, fmt)} is empty.` });
  }
  const b = brief.basics || {};
  const missing = ["genre", "pov", "tense", "tone", "audience", "rating"].filter((f) => !b[f]);
  if (missing.length) out.push({ step: "basics", text: `Basics not set: ${missing.map((f) => (f === "pov" ? "POV" : f)).join(", ")}.` });
  return out;
}

// ── Save / merge bookkeeping ────────────────────────────────────────────
//
// The page autosaves only the paths the owner touched ("about",
// "basics.title", "modes.premise", "status.premise", "elements.characters",
// "lesson_overrides"). A refresh from the server (a store-write event) is
// merged in: the server's copy wins everywhere EXCEPT paths the owner has
// unsaved or in-flight edits on, so AI drafts and statuses land live without
// clobbering what's being typed.
//
// The style-rule list is the exception a worker also writes to
// (story_add_style_rules): a save of it carries `style_rules_base`, the
// server list the owner's edit started from, and the server keeps rules that
// arrived since (src/wizard.ts).

/// Every path the wizard writes — used for the first save, which creates
/// the brief.
export function allPaths(brief) {
  return [
    "about",
    ...Object.keys(brief.basics || {}).map((k) => `basics.${k}`),
    ...ELEMENT_KEYS.map((k) => `modes.${k}`),
    ...ELEMENT_KEYS.map((k) => `elements.${k}`),
    "lesson_overrides",
  ];
}

/// `rulesBase`: the server rule list the owner's unsaved rule edit started
/// from (null = none known), sent along with an `elements.style_rules` save.
export function buildPatch(brief, paths, rulesBase = null) {
  const patch = {};
  for (const p of paths) {
    const v = getPath(brief, p);
    if (v !== undefined) setPath(patch, p, clone(v));
  }
  if (Array.isArray(rulesBase) && patch.elements && patch.elements.style_rules !== undefined) {
    patch.style_rules_base = clone(rulesBase);
  }
  return patch;
}

export function mergeServer(local, server, owned) {
  const out = clone(server);
  for (const p of owned) {
    const v = getPath(local, p);
    if (v !== undefined) setPath(out, p, clone(v));
  }
  return out;
}

/// Element keys whose status just moved to `ai_draft` (an AI draft came back).
export function newDrafts(before, after) {
  const prev = (before && before.status) || {};
  const next = (after && after.status) || {};
  return ELEMENT_KEYS.filter((k) => next[k] === "ai_draft" && prev[k] !== "ai_draft");
}
