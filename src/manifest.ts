// The plugin manifest JSON body — identity, hooks, permissions, the project
// "Story" tab, its authenticated data routes, and the six MCP tools worker
// sessions use to pull story context and push results.

// Single source of truth for the version: package.json. Bundled in by
// esbuild/vitest (resolveJsonModule) — never hardcode a version string here;
// a manifest that self-reports an old version makes the registry's
// "upgrade available" chip permanent.
import { version as VERSION } from "../package.json";
import { SCHEMAS } from "./schemas";

const REPOSITORY = "https://github.com/firestar/peckboard-story-writer";

const DESCRIPTION =
  "Story Writer: a per-project Story tab that runs a setup wizard (what the story is " +
  "about, basics, and — per element: premise, plot outline, setting/world, characters, " +
  "relationships, themes, endings/routes/choices, style rules, banned words — a mode of " +
  "'I write it' / 'AI drafts, I edit' / 'AI generates') and then drives the writing " +
  "pipeline with cards: records -> pilot chapter -> owner review gate -> chapters in " +
  "parallel -> review passes (structure, character, pacing, line, copyedit, plus " +
  "AI-tell / echo-word / sentence-shape) -> final export. The dashboard shows each " +
  "stage's cards, worker status, per-chapter progress, character sheets, the " +
  "per-chapter emotion/attitude matrix, who-knows-what, setup/payoff tracking, the " +
  "choices map, a glossary, and chapter recaps. Feedback on the pilot or any chapter " +
  "becomes a revision card and can be appended to the story's style rules. Worker " +
  "sessions pull context and push results through story_get_brief, story_get_records, " +
  "story_submit_records, story_submit_chapter, story_update_state and " +
  "story_report_review; the writer and reviewer models are configurable below.";

// Inline SVG (lucide "book") for the project tab icon; rendered sandboxed.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>' +
  '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

export function manifestJson(): string {
  const manifest = {
    description: DESCRIPTION,
    version: VERSION,
    repository: REPOSITORY,

    hooks: ["mcp.tool.invoke", "http.request.before", "http.request.authed", "card.step.after", "timer.tick"],

    permissions: [
      "contribute_sidebar", // the project_items tab below
      "data_store", // brief / records / per-chapter docs / pipeline state
      "cards_write", // advance pipeline cards (peckboard_update_card)
      "provide_mcp_tools", // the six worker-facing story_* tools
      "project_files_read", // read story/ files already written
      "project_files_write", // write chapters/records into story/ (tool-invocation only)
      "models_read", // model picker in the wizard UI
      "user_authority", // serve the authenticated Story tab data routes
    ],

    // The project's "Story" tab — the wizard and pipeline dashboard live here.
    project_items: [
      {
        id: "story-writer",
        label: "Story",
        icon: ICON,
        path: "/plugin-api/v1/story-writer",
      },
    ],

    http_routes: ["GET /plugin-api/v1/story-writer"],

    ui_routes: [
      "GET /api/plugin-ui/story-writer/state",
      "GET /api/plugin-ui/story-writer/models",
      "POST /api/plugin-ui/story-writer/wizard",
      "POST /api/plugin-ui/story-writer/pipeline/generate",
      "POST /api/plugin-ui/story-writer/pipeline/start",
      "POST /api/plugin-ui/story-writer/pipeline/approve",
      "POST /api/plugin-ui/story-writer/pipeline/feedback",
      "POST /api/plugin-ui/story-writer/pipeline/retry",
      "GET /api/plugin-ui/story-writer/export",
    ],

    settings: [
      {
        key: "writer_model",
        title: "Writer model",
        description:
          "Model id (provider:model[@account]) the pipeline assigns to pilot-chapter and " +
          "chapter-drafting cards. Example: claude:claude-opus-5-5@<account>.",
        required: false,
        type: "string",
        placeholder: "claude:claude-opus-5-5@<account>",
      },
      {
        key: "reviewer_model",
        title: "Reviewer model",
        description:
          "Model id (provider:model[@account]) the pipeline assigns to the structure / " +
          "character / pacing / line / copyedit review-pass cards.",
        required: false,
        type: "string",
        placeholder: "claude:claude-opus-5-5@<account>",
      },
    ],

    // The agent-facing contract. Workers pull story context through the
    // story_get_* tools and push results through story_submit_* /
    // story_update_state / story_report_review; the plugin stores everything
    // (data_store) and mirrors chapter/record files into story/ under the
    // project (project_files_write). Every input_schema here is the exact
    // schema src/tools.ts validates calls against (src/schemas.ts) — the
    // declared and enforced contracts cannot drift apart.
    mcp_tools: [
      {
        name: "story_get_brief",
        description:
          "Get this story's brief: the setup-wizard answers (title, genre, format, chapter " +
          "count, POV/tense, tone, audience/rating, premise, plot outline, setting/world, " +
          "characters, relationships, themes, endings/routes/choices, style rules, banned " +
          "words), its current style rules, any owner/review feedback recorded so far, and the " +
          "pipeline state. Call this first in any story-writing or reviewing turn.",
        input_schema: SCHEMAS.story_get_brief,
        worker_allowed: true,
      },
      {
        name: "story_get_records",
        description:
          "Get the story's living records: character sheets, relationships, who-knows-what " +
          "per route, choices, the setup/payoff list (promise -> progress -> payoff), the " +
          "glossary, per-chapter state (the emotion/attitude matrix), scene-fact sheets, and " +
          "prior chapter recaps. Call before drafting or reviewing a chapter so reactions only " +
          "come from characters who could know. Optionally limit to some sections and/or cap " +
          "chapter-indexed sections to a given chapter.",
        input_schema: SCHEMAS.story_get_records,
        worker_allowed: true,
      },
      {
        name: "story_submit_records",
        description:
          "Save updated story records after drafting or reviewing a chapter: character " +
          "sheets, relationships, who-knows-what, choices, setup/payoff progress, glossary, " +
          "per-chapter state, scene sheets, or recaps. Pass only the sections that changed; " +
          "items are upsert-merged by identity (id, or term/chapter for glossary/chapter_state/" +
          "recaps) so untouched items and fields are kept.",
        input_schema: SCHEMAS.story_submit_records,
        worker_allowed: true,
      },
      {
        name: "story_submit_chapter",
        description:
          "Submit a chapter's full text (pilot or any later chapter). Stored and mirrored to " +
          "story/chapters/ in the project repo. Include a short recap for the next chapter's " +
          "context and any records update (who-knows-what, setup/payoff, scene sheets) the " +
          "chapter caused.",
        input_schema: SCHEMAS.story_submit_chapter,
        worker_allowed: true,
      },
      {
        name: "story_update_state",
        description:
          "Report progress on a pipeline stage: its status, a short status note for the " +
          "dashboard, and any structured data (e.g. an element draft). The current stage itself " +
          "is owned by the plugin's stage machine (driven by card.step.after / timer.tick) — " +
          "this tool never moves it.",
        input_schema: SCHEMAS.story_update_state,
        worker_allowed: true,
      },
      {
        name: "story_report_review",
        description:
          "Report the result of one review pass on one chapter (structure, character, " +
          "pacing, line, copyedit, ai-tell, echo-word, or sentence-shape). A 'changes_requested' " +
          "verdict's notes are recorded as feedback; an optional 'rule' is additionally " +
          "appended to the story's style rules as a durable owner/review decision.",
        input_schema: SCHEMAS.story_report_review,
        worker_allowed: true,
      },
    ],
  };
  return JSON.stringify(manifest);
}
