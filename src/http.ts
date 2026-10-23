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
import { getAllRecords, getBrief, getFeedback, getPipelineState, listChapters, listReviews, putBrief } from "./docs";
import { Brief } from "./types";

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
    if (method === "POST" && path === `${API}/wizard`) {
      const b = parseBody(body);
      return jsonResponse(200, saveWizard(b));
    }
  } catch (e) {
    return jsonResponse(400, { error: errMsg(e) });
  }
  return jsonResponse(404, { error: "not found" });
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
  return {
    project_id: projectId,
    brief: getBrief(projectId),
    records: getAllRecords(projectId),
    pipeline: getPipelineState(projectId),
    chapters,
    reviews: listReviews(projectId),
    feedback: getFeedback(projectId),
  };
}

function saveWizard(body: any): any {
  const projectId = requireProjectId();
  const brief = body?.brief;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    throw new Error("brief (object) is required");
  }
  putBrief(projectId, brief as Brief);
  return { ok: true };
}
