// Story Writer data model: the setup-wizard brief, the living records, and
// the pipeline/feedback bookkeeping. Pure types + small constants — no host
// calls here, so this module is free to import from anywhere (tools, http,
// manifest, tests) without pulling in the Extism boundary.

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
  updated_at: string;
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

// ── Feedback ─────────────────────────────────────────────────────────────

export interface Feedback {
  id: string;
  source: "owner" | "review";
  chapter: number | null;
  text: string;
  appended_to_rules: boolean;
  card_id?: string;
  at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}
