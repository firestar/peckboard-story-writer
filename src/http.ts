// HTTP surfaces: the served Story tab page (`http.request.before`) and the
// authenticated app-UI endpoints (`http.request.authed`) it drives. The page
// is sandboxed with no same-origin access — it goes through the standard
// parent-proxied fetch bridge — so these routes are the whole contract
// between the two halves of the plugin. Every authed route is PROJECT-scoped
// (the host resolves it from the `x-peckboard-project-id` header the project
// tab sends; see `requireProjectId`).

import { htmlResponse, jsonResponse, errMsg } from "./verdict";
import { PAGE } from "./page";
import { listModels, requireProjectId } from "./host";
import { getAllRecords, getBrief, getCards, getEngine, getFeedback, getPipelineState, listChapters, listReviews, putBrief } from "./docs";
import { MAX_CHAPTERS, PipelineConflict, assembleExport, requestApprove, requestFeedback, requestGenerate, requestRetry, requestStart } from "./pipeline";
import { DEFAULT_BANNED, styleGuide } from "./prompts";
import { mergeWizardUpdate, normalizeBrief } from "./wizard";
import { ELEMENT_KEYS, ELEMENT_MODE_LABELS, defaultBrief } from "./types";

const PAGE_PATH = "/plugin-api/v1/story-writer";
const API = "/api/plugin-ui/story-writer";

function up(v: unknown): string {
  return (typeof v === "string" ? v : "").toUpperCase();
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function parseBody(body: string): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error("invalid request body: " + errMsg(e));
  }
}

/// Serve the Story tab page (the project item opens this).
export function serveHttp(payload: any): string {
  if (up(payload?.method) === "GET" && str(payload?.path) === PAGE_PATH) {
    return htmlResponse(200, PAGE);
  }
  return htmlResponse(404, "<!doctype html><title>Not found</title><p>Not found.</p>");
}

/// Authenticated app-UI endpoints under /api/plugin-ui/story-writer/*.
export function serveAuthed(payload: any): string {
  const method = up(payload?.method);
  const path = str(payload?.path);
  const body = str(payload?.body);

  try {
    if (method === "GET" && path === `${API}/state`) {
      return jsonResponse(200, getState());
    }
    if (method === "GET" && path === `${API}/models`) {
      return jsonResponse(200, { models: listModels() });
    }
    if (method === "GET" && path === `${API}/defaults`) {
      return jsonResponse(200, getDefaults());
    }
    if (method === "POST" && path === `${API}/wizard`) {
      const b = parseBody(body);
      return jsonResponse(200, saveWizard(b));
    }
    if (method === "POST" && path === `${API}/pipeline/generate`) {
      return jsonResponse(200, pipelineGenerate(parseBody(body)));
    }
    if (method === "POST" && path === `${API}/pipeline/start`) {
      return jsonResponse(200, requestStart(requireProjectId()));
    }
    if (method === "POST" && path === `${API}/pipeline/approve`) {
      return jsonResponse(200, requestApprove(requireProjectId()));
    }
    if (method === "POST" && path === `${API}/pipeline/feedback`) {
      return jsonResponse(200, pipelineFeedback(parseBody(body)));
    }
    if (method === "POST" && path === `${API}/pipeline/retry`) {
      return jsonResponse(200, pipelineRetry(parseBody(body)));
    }
    if (method === "GET" && path === `${API}/export`) {
      return jsonResponse(200, assembleExport(requireProjectId()));
    }
  } catch (e) {
    return jsonResponse(e instanceof PipelineConflict ? 409 : 400, { error: errMsg(e) });
  }
  return jsonResponse(404, { error: "not found" });
}

function pipelineGenerate(body: any): any {
  const projectId = requireProjectId();
  const elements = Array.isArray(body?.elements) ? body.elements : undefined;
  return requestGenerate(projectId, elements);
}

function pipelineFeedback(body: any): any {
  const projectId = requireProjectId();
  const chapter = typeof body?.chapter === "number" ? body.chapter : undefined;
  return requestFeedback(projectId, chapter, str(body?.text));
}

function pipelineRetry(body: any): any {
  const projectId = requireProjectId();
  const unit = typeof body?.unit === "string" ? body.unit : undefined;
  return requestRetry(projectId, unit);
}

function getState(): any {
  const projectId = requireProjectId();
  // Chapter/review bodies can be large; the dashboard only needs a summary
  // per chapter (full text is fetched separately when a chapter is opened —
  // a later card's concern).
  const chapters = listChapters(projectId).map((c) => ({
    chapter: c.chapter,
    revision: c.revision,
    recap: c.recap,
    length: c.markdown.length,
    submitted_at: c.submitted_at,
  }));
  const brief = getBrief(projectId);
  return {
    project_id: projectId,
    brief: brief ? normalizeBrief(brief) : null,
    records: getAllRecords(projectId),
    engine: getEngine(projectId),
    pipeline: getPipelineState(projectId),
    chapters,
    reviews: listReviews(projectId),
    feedback: getFeedback(projectId),
    cards: getCards(projectId),
  };
}

/// Static wizard catalog: the starting brief, the editable built-in style
/// guide (lessons the owner can rewrite or turn off per story), the
/// always-banned words, and the chapter cap.
function getDefaults(): any {
  return {
    brief: defaultBrief(),
    elements: ELEMENT_KEYS,
    mode_labels: ELEMENT_MODE_LABELS,
    style_guide: styleGuide(),
    banned_words: DEFAULT_BANNED,
    max_chapters: MAX_CHAPTERS,
  };
}

/// Merge the wizard's partial brief update (only the fields the owner
/// changed) over the stored brief — see src/wizard.ts for the rules. Once
/// the pipeline has started, the story's shape (format, chapter count) is
/// fixed: the engine derives its chapter units from it.
function saveWizard(body: any): any {
  const projectId = requireProjectId();
  if (body?.brief === undefined) throw new Error("brief (object) is required");
  const engine = getEngine(projectId);
  const generating = (k: string) => engine.units[`generate:${k}`]?.status === "open";
  const stored = getBrief(projectId);
  const { brief, ignored } = mergeWizardUpdate(stored, body.brief, MAX_CHAPTERS, generating);
  if (engine.stage !== "setup" && stored) {
    const before = normalizeBrief(stored).basics;
    if (brief.basics.chapter_count !== before.chapter_count || brief.basics.format !== before.format) {
      throw new PipelineConflict(`format and chapter count are fixed once the pipeline has started (stage: ${engine.stage})`);
    }
  }
  putBrief(projectId, brief);
  return { ok: true, brief, ignored };
}
