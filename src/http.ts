// HTTP surfaces: the served Story tab page (`http.request.before`) and the
// authenticated app-UI endpoints (`http.request.authed`) it drives. The page
// is sandboxed with no same-origin access — it goes through the standard
// parent-proxied fetch bridge — so these routes are the whole contract
// between the two halves of the plugin. Every authed route is PROJECT-scoped
// (the host resolves it from the `x-peckboard-project-id` header the project
// tab sends; see `requireProjectId`).

import { htmlResponse, jsonResponse, errMsg } from "./verdict";
import { PAGE } from "./page";
import { listCards, listModels, requireProjectId } from "./host";
import { getAllRecords, getBrief, getCards, getChapter, getEngine, getFeedback, getPipelineState, listChapters, listColdReads, listReviews, putBrief } from "./docs";
import { MAX_CHAPTERS, PipelineConflict, assembleExport, modelFor, requestApprove, requestFeedback, requestGenerate, requestRetry, requestStart } from "./pipeline";
import { DEFAULT_BANNED, styleGuide } from "./prompts";
import { mergeWizardUpdate, normalizeBrief } from "./wizard";
import { DEFAULT_WRITER_MODEL, ELEMENT_KEYS, ELEMENT_MODE_LABELS, defaultBrief } from "./types";

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
    if (method === "GET" && path === `${API}/cards`) {
      return jsonResponse(200, getLiveCards());
    }
    if (method === "GET" && path === `${API}/chapter`) {
      return jsonResponse(200, getChapterText(str(payload?.query)));
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
  // Chapter bodies can be large; the dashboard only needs a summary per
  // chapter (the reader fetches one chapter's text from /chapter).
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
    cold_reads: listColdReads(projectId),
  };
}

/// Live board status of the pipeline's own cards (step, blocked, worker
/// session) for the dashboard's worker-status column and "open session"
/// links. Kept off /state: list_cards returns every card in the project
/// with its full description, so the page polls this on its own slower
/// cadence instead of paying for it on every store write. A card the engine
/// still points at but the board no longer has comes back `missing: true`
/// (an id absent from the map just means "created after this listing").
function getLiveCards(): any {
  const projectId = requireProjectId();
  const owned = new Set<string>();
  for (const u of Object.values(getEngine(projectId).units)) if (u.card_id) owned.add(u.card_id);
  const cards: Record<string, unknown> = {};
  if (owned.size > 0) {
    for (const c of listCards(projectId)) {
      if (!owned.has(c.id)) continue;
      cards[c.id] = {
        id: c.id,
        title: c.title,
        step: c.step,
        blocked: !!c.blocked,
        block_reason: c.block_reason ?? null,
        worker_session_id: typeof c.worker_session_id === "string" ? c.worker_session_id : null,
        last_worker_session_id: typeof c.last_worker_session_id === "string" ? c.last_worker_session_id : null,
        model: c.model ?? null,
        updated_at: typeof c.updated_at === "string" ? c.updated_at : null,
      };
    }
    for (const id of owned) if (!cards[id]) cards[id] = { id, missing: true };
  }
  return { cards };
}

/// One chapter's full text for the dashboard's reader (`?n=<chapter>`);
/// `chapter: null` until a worker has submitted it.
function getChapterText(query: string): any {
  const projectId = requireProjectId();
  const raw = queryParam(query, "n");
  if (raw === null || !/^\d{1,3}$/.test(raw)) throw new Error("n (chapter number) is required");
  return { chapter: getChapter(projectId, Number(raw)) };
}

function queryParam(query: string, key: string): string | null {
  for (const part of query.replace(/^\?/, "").split("&")) {
    const eq = part.indexOf("=");
    if ((eq < 0 ? part : part.slice(0, eq)) !== key) continue;
    try {
      return decodeURIComponent((eq < 0 ? "" : part.slice(eq + 1)).replace(/\+/g, " "));
    } catch (_e) {
      return null;
    }
  }
  return null;
}

/// Static wizard catalog: the starting brief, the editable built-in style
/// guide (lessons the owner can rewrite or turn off per story), the
/// always-banned words, the chapter cap, and which models the pipeline's
/// cards will run on (plugin settings, shown read-only).
function getDefaults(): any {
  return {
    brief: defaultBrief(),
    elements: ELEMENT_KEYS,
    mode_labels: ELEMENT_MODE_LABELS,
    style_guide: styleGuide(),
    banned_words: DEFAULT_BANNED,
    max_chapters: MAX_CHAPTERS,
    models: pipelineModels(),
  };
}

/// "claude:claude-opus-5-5@acc_…" -> "Claude Opus 5.5" when the host's model
/// list doesn't name it (an account that's offline, a model since removed).
function modelName(id: string): string {
  const bare = id.replace(/^[^:]*:/, "").replace(/@.*$/, "");
  const words: string[] = [];
  for (const part of bare.split(/[-_\s]+/).filter(Boolean)) {
    const prev = words.length - 1;
    if (/^\d+$/.test(part) && prev >= 0 && /\d$/.test(words[prev])) words[prev] += `.${part}`;
    else words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return words.join(" ") || id;
}

function pipelineModels(): any {
  let known: { id: string; display_name: string }[] = [];
  try {
    known = listModels();
  } catch (_e) {
    // models_read unavailable: fall back to names derived from the ids
  }
  const describe = (id: string | undefined, isDefault: boolean) => {
    if (!id) return { id: null, name: null, is_default: isDefault };
    const hit = known.find((m) => m.id === id);
    return { id, name: hit?.display_name || modelName(id), is_default: isDefault };
  };
  const writer = modelFor("writer");
  const reviewer = modelFor("reviewer");
  return { writer: describe(writer, writer === DEFAULT_WRITER_MODEL), reviewer: describe(reviewer, !reviewer) };
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
