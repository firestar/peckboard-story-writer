// Story Writer data model: the setup-wizard brief, the living records, and
// the pipeline/feedback bookkeeping. Pure types + small constants — no host
// calls here, so this module is free to import from anywhere (tools, http,
// manifest, tests) without pulling in the Extism boundary.

/// Default writer model when the `writer_model` plugin setting is unset.
/// 2026-10-23 owner decision: GPT-5.6 Sol's prose was rejected ("plain
/// ugly"); judge any writer model by a pilot chapter the owner plays, and
/// switch models when a pilot fails, rather than adding more rules.
export const DEFAULT_WRITER_MODEL = "claude:claude-opus-5-5@acc_00efb018b53b417996c3ec27f7ecc333";

/// Per-element authoring mode, chosen in the setup wizard.
export type ElementMode = "write" | "draft" | "generate";

export const ELEMENT_MODES: ElementMode[] = ["write", "draft", "generate"];

export const ELEMENT_MODE_LABELS: Record<ElementMode, string> = {
  write: "I write it",
  draft: "AI drafts, I edit",
  generate: "AI generates",
};

/// The story elements the wizard collects a mode + content for.
export const ELEMENT_KEYS = [
  "premise",
  "plot_outline",
  "setting",
  "characters",
  "relationships",
  "themes",
  "endings",
  "style_rules",
  "banned_words",
] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];

/// Lifecycle of one element: empty -> (if "generate") awaiting_ai -> ai_draft
/// -> approved once the owner reviews/edits it in the wizard.
export type ElementStatus = "empty" | "awaiting_ai" | "ai_draft" | "approved";
export const ELEMENT_STATUSES: ElementStatus[] = ["empty", "awaiting_ai", "ai_draft", "approved"];

export const STORY_FORMATS = ["prose", "vn"] as const;
export type StoryFormat = (typeof STORY_FORMATS)[number];

export interface StoryBasics {
  title: string;
  genre: string;
  format: StoryFormat;
  chapter_count: number;
  pov: string;
  tense: string;
  tone: string;
  audience: string;
  rating: string;
}

export interface CharacterAttitude {
  toward: string;
  attitude: string;
  reason: string;
}

export interface CharacterFirstIntro {
  chapter: number;
  scene: string;
  line: string;
}

export interface CharacterSheet {
  id: string;
  name: string;
  role: string;
  personality: string;
  values: string;
  fears: string;
  flaws: string;
  want: string;
  need: string;
  lie: string;
  wound: string;
  ghost: string;
  speech_habit: string;
  initial_emotion: string;
  attitudes: CharacterAttitude[];
  knows: string[];
  first_intro?: CharacterFirstIntro;
  notes?: string;
}

export interface Relationship {
  id: string;
  a: string;
  b: string;
  kind: string;
  description: string;
  since_chapter?: number;
}

export interface Ending {
  id: string;
  name: string;
  kind: "ending" | "route";
  description: string;
  conditions?: string;
}

export interface StoryElements {
  premise: string;
  plot_outline: string;
  setting: string;
  characters: CharacterSheet[];
  relationships: Relationship[];
  themes: string[];
  endings: Ending[];
  style_rules: string[];
  banned_words: string[];
}

export interface Brief {
  about: string;
  basics: StoryBasics;
  modes: Record<ElementKey, ElementMode>;
  status: Partial<Record<ElementKey, ElementStatus>>;
  elements: StoryElements;
  /// Per-story edits to the built-in style guide, keyed by lesson id
  /// (src/prompts/lessons.ts): replacement markdown, or "" to drop that
  /// lesson from every card. Absent = all defaults.
  lesson_overrides?: Record<string, string>;
  updated_at: string;
}

/// Starting modes for a fresh wizard: the owner writes the style rules and
/// banned words (the built-in style guide already covers the defaults), the
/// AI drafts or generates the rest for owner review.
export const DEFAULT_MODES: Record<ElementKey, ElementMode> = {
  premise: "draft",
  plot_outline: "generate",
  setting: "generate",
  characters: "generate",
  relationships: "generate",
  themes: "draft",
  endings: "generate",
  style_rules: "write",
  banned_words: "write",
};

export function defaultBrief(): Brief {
  return {
    about: "",
    basics: { title: "", genre: "", format: "prose", chapter_count: 12, pov: "", tense: "", tone: "", audience: "", rating: "" },
    modes: { ...DEFAULT_MODES },
    status: {},
    elements: {
      premise: "",
      plot_outline: "",
      setting: "",
      characters: [],
      relationships: [],
      themes: [],
      endings: [],
      style_rules: [],
      banned_words: [],
    },
    lesson_overrides: {},
    updated_at: new Date(0).toISOString(),
  };
}

// ── Living records ───────────────────────────────────────────────────────

export interface KnownBy {
  character: string;
  since_chapter: number;
  how?: string;
}

export interface KnowledgeFact {
  id: string;
  fact: string;
  route: string; // "common" when not route-specific
  known_by: KnownBy[];
}

export interface ChoiceOption {
  label: string;
  consequence: string;
  route?: string;
  sets?: Record<string, unknown>;
}

export interface Choice {
  id: string;
  chapter: number;
  prompt?: string;
  options: ChoiceOption[];
}

export interface SetupPayoffProgress {
  chapter: number;
  note: string;
}

export interface SetupPayoff {
  id: string;
  promise: string;
  setup_chapter: number;
  progress: SetupPayoffProgress[];
  payoff_chapter?: number;
  payoff?: string;
  status: "open" | "paid" | "dropped";
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  first_chapter?: number;
}

export interface ChapterEmotionAttitude {
  from: string;
  to: string;
  attitude: string;
  reason: string;
}

export interface ChapterState {
  chapter: number;
  emotions: Record<string, string>;
  attitudes: ChapterEmotionAttitude[];
  location?: string;
  time?: string;
  notes?: string;
}

export interface UnexplainedTerm {
  name: string;
  kind: "name" | "term" | "rule";
  /// Required on submit (src/schemas.ts); optional here only because
  /// records stored before the schema required it may lack it.
  answered_in?: { chapter: number; scene?: string };
}

/// C3: cap the per-scene list of unexplained names/terms/rules so it can't
/// grow into an open-ended todo list — each is a question the reader
/// carries and must be answered in time.
export const MAX_UNEXPLAINED_PER_SCENE = 3;

export interface SceneSheet {
  id: string;
  chapter: number;
  scene: string;
  location: string;
  time?: string;
  present: string[];
  facts: string[];
  goal?: string;
  outcome?: string;
  unexplained?: UnexplainedTerm[];
}

export interface Recap {
  chapter: number;
  recap: string;
}

/// Every record section, each a flat array of identity-keyed items. See
/// `RECORD_ID_KEY` for the identity field used to upsert-merge each section.
export interface Records {
  characters: CharacterSheet[];
  relationships: Relationship[];
  knowledge: KnowledgeFact[];
  choices: Choice[];
  setups: SetupPayoff[];
  glossary: GlossaryEntry[];
  chapter_state: ChapterState[];
  scene_sheets: SceneSheet[];
  recaps: Recap[];
}

export const RECORD_SECTIONS = [
  "characters",
  "relationships",
  "knowledge",
  "choices",
  "setups",
  "glossary",
  "chapter_state",
  "scene_sheets",
  "recaps",
] as const;
export type RecordSection = (typeof RECORD_SECTIONS)[number];

/// The field that identifies one item within a record section, for
/// upsert-merge on `story_submit_records` / `story_submit_chapter`.
export const RECORD_ID_KEY: Record<RecordSection, string> = {
  characters: "id",
  relationships: "id",
  knowledge: "id",
  choices: "id",
  setups: "id",
  glossary: "term",
  chapter_state: "chapter",
  scene_sheets: "id",
  recaps: "chapter",
};
/// Fields a NEW item (no existing item with the same identity) must carry.
/// Updates to an existing item only need the identity field — the rest
/// shallow-merges over what is already stored.
export const RECORD_REQUIRED_FIELDS: Record<RecordSection, string[]> = {
  characters: ["id", "name"],
  relationships: ["id", "a", "b"],
  knowledge: ["id", "fact", "known_by"],
  choices: ["id", "chapter", "options"],
  setups: ["id", "promise", "setup_chapter"],
  glossary: ["term", "definition"],
  chapter_state: ["chapter"],
  scene_sheets: ["id", "chapter", "scene"],
  recaps: ["chapter", "recap"],
};


export function emptyRecords(): Records {
  return {
    characters: [],
    relationships: [],
    knowledge: [],
    choices: [],
    setups: [],
    glossary: [],
    chapter_state: [],
    scene_sheets: [],
    recaps: [],
  };
}

// ── Chapters & reviews ───────────────────────────────────────────────────

export interface ChapterDoc {
  chapter: number;
  markdown: string;
  recap: string | null;
  revision: number;
  submitted_at: string;
}

export const REVIEW_PASSES = [
  "structure",
  "character",
  "pacing",
  "line",
  "copyedit",
  "ai-tell",
  "echo-word",
  "sentence-shape",
] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

export type ReviewVerdict = "pass" | "changes_requested";

export interface ReviewRound {
  verdict: ReviewVerdict;
  notes: string;
  at: string;
}

export interface ReviewDoc {
  chapter: number;
  pass: ReviewPass;
  rounds: ReviewRound[];
}

/// What kind of problem a cold-read item is. Every kind but `obvious` is a
/// point of confusion (the cold-read card's checklist, in the same order);
/// `obvious` is the reverse failure (§1D "Don't state the obvious"): a line
/// that explains common-sense mechanics or repeats what follows from the
/// line before. The dashboard counts the two groups separately.
export const COLD_READ_CATEGORIES = ["unexplained", "speaker", "orientation", "motive", "reread", "contradiction", "other", "obvious"] as const;
export type ColdReadCategory = (typeof COLD_READ_CATEGORIES)[number];

export const COLD_READ_CATEGORY_LABELS: Record<ColdReadCategory, string> = {
  unexplained: "Name or term used before it's explained",
  speaker: "Unclear speaker or pronoun",
  orientation: "Unclear place, time or elapsed time",
  motive: "Unexplained motive",
  reread: "Had to guess or re-read",
  contradiction: "Contradicts earlier text",
  other: "Other confusion",
  obvious: "Over-explained / obvious",
};

export interface ColdReadItem {
  id: string;
  /// Missing on reports filed before categories existed — read as "other".
  category?: ColdReadCategory;
  text: string;
  quote?: string;
  /// Where in the chapter, in the reader's words ("scene 2, Jun's second line").
  location?: string;
  fix: string | null;
  fixed_at?: string;
}

export interface ColdReadCharacterSighting {
  name: string;
  said: string;
}

export interface ColdReadFirstThreeLines {
  narrator: boolean;
  want: boolean;
  tension: boolean;
  clear: boolean;
}

/// One chapter's cold-read (C1) report plus the writer's item -> fix map
/// (C2). `attempt`/`chapter_revision` tie a report to the pilot/chapter
/// draft it was read against, so a later redraft can't be judged fixed by
/// an earlier report.
export interface ColdReadDoc {
  chapter: number;
  attempt: number;
  chapter_revision: number;
  items: ColdReadItem[];
  first_three_lines: ColdReadFirstThreeLines | null;
  characters: ColdReadCharacterSighting[];
  submitted_at: string;
  fixes_at?: string;
}

// ── Pipeline state ───────────────────────────────────────────────────────

export const STAGES = ["setup", "records", "pilot", "pilot_review", "chapters", "review", "final"] as const;
export type StageId = (typeof STAGES)[number];

export type StageStatus = "pending" | "active" | "done" | "blocked";
export const STAGE_STATUSES: StageStatus[] = ["pending", "active", "done", "blocked"];

export interface StageProgress {
  status: StageStatus;
  note?: string;
  updated_at?: string;
}

export interface PipelineState {
  stage: StageId;
  stages: Partial<Record<StageId, StageProgress>>;
  note: string | null;
  data: Record<string, unknown>;
  updated_at: string;
}

export function defaultPipelineState(): PipelineState {
  return { stage: "setup", stages: {}, note: null, data: {}, updated_at: new Date(0).toISOString() };
}

// ── Pipeline cards ───────────────────────────────────────────────────────

/// A board card the pipeline engine created for one unit of work (a stage,
/// a chapter draft, a review pass), so it can track and advance it.
export interface CardRef {
  card_id: string;
  stage: StageId;
  kind: UnitKind;
  chapter?: number;
  pass?: ReviewPass;
  element?: ElementKey;
  status?: UnitStatus;
  created_at: string;
  updated_at?: string;
}

// ── Pipeline engine ──────────────────────────────────────────────────────

/// The eight kinds of pipeline card the engine creates. Same literal
/// values as `prompts.StageKind` (kept separate so types.ts doesn't depend
/// on the prompts module) — a Unit's `kind` is always a valid `renderCard`
/// input, except cold_read/cold_read_fix which are rendered directly by
/// src/prompts/coldRead.ts (SW-9), not through renderCard/StageKind, and
/// owner-review revisions, rendered by src/prompts/ownerReview.ts (SW-12).
export const UNIT_KINDS = ["records", "pilot", "chapter", "review", "revision", "generate", "cold_read", "cold_read_fix"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export type UnitStatus = "open" | "done" | "failed";

/// One unit of pipeline work, mapped to at most one open board card at a
/// time. `id` is a stable key (e.g. "records", "chapter:3",
/// "review:2:line") the engine never reuses for different work — a retry
/// resets this same record in place (bumping `attempt`, clearing
/// `card_id`) rather than minting a new id, so "does this unit already
/// have a card" is always a single lookup.
export interface Unit {
  id: string;
  kind: UnitKind;
  status: UnitStatus;
  card_id: string | null;
  attempt: number;
  chapter?: number;
  pass?: ReviewPass;
  element?: ElementKey;
  /// Owner-review revisions ("revision:owner:<chapter>:<round>"): the round
  /// whose notes the card addresses.
  round?: number;
  /// Owner-review revisions: the redraft's cold read was reset (the chain
  /// re-runs on the new draft) — `settled` once it cleared and the next
  /// round opened.
  cold_reset?: boolean;
  settled?: boolean;
  note?: string;
  created_at: string;
  updated_at: string;
}

export const MAX_REVIEW_ROUNDS = 2;

/// Where one chapter's structure->character->...->sentence-shape review
/// chain currently stands.
export interface ReviewCursor {
  chapter: number;
  pass_index: number; // index into REVIEW_PASSES
  round: number; // attempt at the current pass, 1-based, capped at MAX_REVIEW_ROUNDS
  waiting: "review" | "revision" | "done";
  /// The owner sent the chapter back for a redraft while its passes ran: they
  /// pause until the redraft clears its cold read, then restart from the
  /// first pass on the new text (SW-15).
  redraft?: boolean;
  /// After that restart: the chapter's review / review-revision unit ids from
  /// before it, each reset to a fresh card when its pass comes round again.
  stale?: string[];
}

export interface EngineState {
  stage: StageId;
  approved: boolean; // owner approved the pilot
  finished: boolean;
  units: Record<string, Unit>;
  cursors: Record<string, ReviewCursor>; // keyed by chapter number (as a string)
  note: string | null;
  // Persisted true just before a run's first card create and cleared when
  // the run ends; still true at the start of a run means the previous one
  // died mid-create, so cards are matched by marker before creating more.
  in_flight?: boolean;
  swept_at?: string | null; // last timer.tick full card-list reconcile
  updated_at: string;
}

export function defaultEngineState(): EngineState {
  return {
    stage: "setup",
    approved: false,
    finished: false,
    units: {},
    cursors: {},
    note: null,
    in_flight: false,
    swept_at: null,
    updated_at: new Date(0).toISOString(),
  };
}

// ── Feedback ─────────────────────────────────────────────────────────────

export interface Feedback {
  id: string;
  source: "owner" | "review";
  chapter: number | null;
  text: string;
  appended_to_rules: boolean;
  card_id?: string;
  /// Owner review notes (SW-12): line notes about this chapter only — later
  /// cards for other chapters don't carry them (the overall note, when added
  /// to the rules, already reaches every card through the rules).
  chapter_only?: boolean;
  round?: number;
  at: string;
}

// ── Owner review rounds (SW-12) ──────────────────────────────────────────
// Every draft that reaches the owner (the pilot at the gate, or any written
// chapter the owner opens) is reviewed in rounds: the owner anchors notes to
// lines of the chapter text, then approves or requests changes. Requesting
// changes sends every note to a writer card (addressed one by one, each with
// a recorded resolution, like cold-read fixes); the redraft is cold-read
// again and comes back as the next round. Earlier rounds stay as history.
// Same shape PeckBoard's own Review page uses for its annotations
// (docs/host-review-api.md), so a later switch to it (SW-14) keeps the model.

export const OWNER_NOTE_KINDS = ["comment", "suggest", "wrong", "expand", "shorten"] as const;
export type OwnerNoteKind = (typeof OWNER_NOTE_KINDS)[number];

export const OWNER_NOTE_KIND_LABELS: Record<OwnerNoteKind, string> = {
  comment: "Comment",
  suggest: "Suggest edit",
  wrong: "Mark wrong",
  expand: "Expand",
  shorten: "Shorten",
};

/// Expand/shorten carry their whole instruction in the verb; the rest need
/// a body to act on.
export const OWNER_NOTE_NEEDS_BODY: Record<OwnerNoteKind, boolean> = {
  comment: true,
  suggest: true,
  wrong: true,
  expand: false,
  shorten: false,
};

export const OWNER_NOTE_ACTIONS = ["fixed", "answered", "declined"] as const;
export type OwnerNoteAction = (typeof OWNER_NOTE_ACTIONS)[number];

export const MAX_OWNER_NOTES_PER_ROUND = 100;
export const MAX_OWNER_NOTE_CHARS = 4000;
export const MAX_OWNER_QUOTE_CHARS = 1000;
export const MAX_OWNER_SUMMARY_CHARS = 4000;

export interface OwnerNoteResolution {
  action: OwnerNoteAction;
  how: string;
  at: string;
}

export interface OwnerNote {
  id: string; // "n1", "n2", ... within its round
  kind: OwnerNoteKind;
  /// 1-based line range of the chapter markdown at `revision`.
  start_line: number;
  end_line: number;
  /// The passage as the owner saw it — the writer finds it by the quote if
  /// later edits moved the lines.
  quote: string;
  body: string;
  revision: number;
  created_at: string;
  updated_at?: string;
  resolution: OwnerNoteResolution | null;
}

/// open: the owner is reviewing (notes can be added, edited, deleted).
/// changes_requested: notes sent; the revision card, then the redraft's cold
/// read, are running. revised: the redraft cleared its cold read and the
/// next round opened on it. approved: the owner accepted this draft.
export type OwnerRoundStatus = "open" | "changes_requested" | "revised" | "approved";

export interface OwnerReviewRound {
  round: number;
  /// Chapter revision when the round opened.
  chapter_revision: number;
  status: OwnerRoundStatus;
  notes: OwnerNote[];
  /// Overall note sent with "Request changes" (the old free-text feedback).
  summary?: string;
  summary_to_rules?: boolean;
  feedback_id?: string;
  opened_at: string;
  decided_at?: string;
  /// Chapter revision the owner decided on — the writer's redraft must be
  /// newer than this.
  decided_revision?: number;
  fixes_at?: string;
  revised_revision?: number;
  revised_at?: string;
  /// PeckBoard Review page id, once the host supports it (SW-14).
  host_review_id?: string;
  /// Next note id number (note ids are never reused within a round).
  next_note?: number;
}

export interface OwnerReviewDoc {
  chapter: number;
  rounds: OwnerReviewRound[];
}

export function nowIso(): string {
  return new Date().toISOString();
}
