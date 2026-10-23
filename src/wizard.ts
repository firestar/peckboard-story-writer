// Setup-wizard saves (POST /wizard): validate a partial brief update from
// the Story tab and merge it over the stored brief. The page autosaves only
// the fields the owner changed, so the merge is per field — basics/modes/
// status/elements per key — and never clobbers what another writer (an
// AI-generate card's draft, a review's appended rule) put there meanwhile.
//
// The server, not the page, owns the AI half of an element's lifecycle: an
// element whose generate card is still running can't be edited or
// re-statused from the wizard, and the wizard can never set `awaiting_ai`
// itself (only /pipeline/generate does). An `awaiting_ai` element whose card
// is NOT running any more (closed as won't-do) is stale: the owner's next
// edit to it resets it to `empty`.

import { lessons } from "./prompts";
import {
  Brief,
  ELEMENT_KEYS,
  ELEMENT_MODES,
  ElementKey,
  ElementStatus,
  STORY_FORMATS,
  StoryBasics,
  defaultBrief,
  nowIso,
} from "./types";

const TOP_LEVEL = new Set(["about", "basics", "modes", "status", "elements", "lesson_overrides", "updated_at"]);
const BASICS_TEXT = ["title", "genre", "pov", "tense", "tone", "audience", "rating"] as const;
const TEXT_ELEMENTS: ElementKey[] = ["premise", "plot_outline", "setting"];
const LIST_ELEMENTS: ElementKey[] = ["themes", "style_rules", "banned_words"];
const OWNER_STATUSES: ElementStatus[] = ["empty", "ai_draft", "approved"];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isElementKey(k: string): k is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(k);
}

/// A stored brief (possibly written by an older version, or by a test) with
/// every field the wizard relies on filled in from the defaults.
export function normalizeBrief(stored: Partial<Brief> | null | undefined): Brief {
  const d = defaultBrief();
  if (!isObj(stored)) return d;
  return {
    ...d,
    ...stored,
    basics: { ...d.basics, ...(isObj(stored.basics) ? stored.basics : {}) } as StoryBasics,
    modes: { ...d.modes, ...(isObj(stored.modes) ? stored.modes : {}) },
    status: { ...(isObj(stored.status) ? stored.status : {}) },
    elements: { ...d.elements, ...(isObj(stored.elements) ? stored.elements : {}) },
    lesson_overrides: { ...(isObj(stored.lesson_overrides) ? (stored.lesson_overrides as Record<string, string>) : {}) },
  };
}

function checkElement(key: ElementKey, value: unknown): void {
  const where = `elements.${key}`;
  if (TEXT_ELEMENTS.includes(key)) {
    if (typeof value !== "string") throw new Error(`${where}: expected a string`);
    return;
  }
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  if (LIST_ELEMENTS.includes(key)) {
    value.forEach((v, i) => {
      if (typeof v !== "string") throw new Error(`${where}[${i}]: expected a string`);
    });
  } else {
    value.forEach((v, i) => {
      if (!isObj(v)) throw new Error(`${where}[${i}]: expected an object`);
    });
  }
}

/// Validate `update` and merge it over `existing`. `generating(k)` says
/// whether element k's AI-generate card is still open. Returns the merged
/// brief plus the element keys whose edits were dropped because an
/// AI-generate card owns them right now.
export function mergeWizardUpdate(
  existing: Brief | null,
  update: unknown,
  maxChapters: number,
  generating: (k: ElementKey) => boolean = () => false,
): { brief: Brief; ignored: ElementKey[] } {
  if (!isObj(update)) throw new Error("brief (object) is required");
  for (const key of Object.keys(update)) {
    if (!TOP_LEVEL.has(key)) throw new Error(`unknown brief field: ${key}`);
  }

  const base = normalizeBrief(existing);
  const next: Brief = {
    ...base,
    basics: { ...base.basics },
    modes: { ...base.modes },
    status: { ...base.status },
    elements: { ...base.elements },
    lesson_overrides: { ...(base.lesson_overrides ?? {}) },
  };
  const ignored = new Set<ElementKey>();

  if (update.about !== undefined) {
    if (typeof update.about !== "string") throw new Error("about: expected a string");
    next.about = update.about;
  }

  if (update.basics !== undefined) {
    if (!isObj(update.basics)) throw new Error("basics: expected an object");
    for (const [k, v] of Object.entries(update.basics)) {
      if ((BASICS_TEXT as readonly string[]).includes(k)) {
        if (typeof v !== "string") throw new Error(`basics.${k}: expected a string`);
        (next.basics as unknown as Record<string, unknown>)[k] = v;
      } else if (k === "format") {
        if (!(STORY_FORMATS as readonly unknown[]).includes(v)) {
          throw new Error(`basics.format: must be one of ${STORY_FORMATS.join(", ")}`);
        }
        next.basics.format = v as StoryBasics["format"];
      } else if (k === "chapter_count") {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > maxChapters) {
          throw new Error(`basics.chapter_count: must be a whole number from 1 to ${maxChapters}`);
        }
        next.basics.chapter_count = v;
      } else {
        throw new Error(`unknown basics field: ${k}`);
      }
    }
  }

  if (update.modes !== undefined) {
    if (!isObj(update.modes)) throw new Error("modes: expected an object");
    for (const [k, v] of Object.entries(update.modes)) {
      if (!isElementKey(k)) throw new Error(`modes.${k}: unknown element`);
      if (!(ELEMENT_MODES as readonly unknown[]).includes(v)) {
        throw new Error(`modes.${k}: must be one of ${ELEMENT_MODES.join(", ")}`);
      }
      next.modes[k] = v as Brief["modes"][ElementKey];
    }
  }

  if (update.elements !== undefined) {
    if (!isObj(update.elements)) throw new Error("elements: expected an object");
    for (const [k, v] of Object.entries(update.elements)) {
      if (!isElementKey(k)) throw new Error(`elements.${k}: unknown element`);
      checkElement(k, v);
      if (generating(k)) {
        // Only an actual change counts as a dropped edit (a full-brief save
        // echoes every element back).
        if (JSON.stringify(v) !== JSON.stringify(base.elements[k])) ignored.add(k);
        continue;
      }
      if (JSON.stringify(v) === JSON.stringify(base.elements[k])) continue;
      (next.elements as unknown as Record<string, unknown>)[k] = v;
      if (base.status[k] === "awaiting_ai") next.status[k] = "empty"; // stale: its card closed without a draft
    }
  }
  if (update.status !== undefined) {
    if (!isObj(update.status)) throw new Error("status: expected an object");
    for (const [k, v] of Object.entries(update.status)) {
      if (!isElementKey(k)) throw new Error(`status.${k}: unknown element`);
      if (generating(k)) {
        if (v !== "awaiting_ai") ignored.add(k);
        continue;
      }
      if (v === base.status[k]) continue;
      if (v === "awaiting_ai") {
        // A stale page echoing a status the server has since moved past.
        ignored.add(k);
        continue;
      }
      if (!(OWNER_STATUSES as readonly unknown[]).includes(v)) {
        throw new Error(`status.${k}: must be one of ${OWNER_STATUSES.join(", ")}`);
      }
      next.status[k] = v as ElementStatus;
    }
  }

  if (update.lesson_overrides !== undefined) {
    if (!isObj(update.lesson_overrides)) throw new Error("lesson_overrides: expected an object");
    const known = lessons();
    const overrides: Record<string, string> = {};
    for (const [id, text] of Object.entries(update.lesson_overrides)) {
      if (!known.has(id)) throw new Error(`lesson_overrides.${id}: unknown lesson`);
      if (typeof text !== "string") throw new Error(`lesson_overrides.${id}: expected a string`);
      overrides[id] = text;
    }
    next.lesson_overrides = overrides;
  }

  next.updated_at = nowIso();
  return { brief: next, ignored: Array.from(ignored) };
}
