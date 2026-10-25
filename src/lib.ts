// Hook + tool dispatch. Parses the `{ hook, payload }` envelope and routes
// each call to its handler. The wasm export functions live in `index.ts`.

import { skip, allow, cancel, errMsg } from "./verdict";
import { serveHttp, serveAuthed } from "./http";
import { onCardStepAfter, onTimerTick } from "./pipeline";
import {
  toolAddStyleRules,
  toolColdReadGetText,
  toolGetBrief,
  toolGetRecords,
  toolReportReview,
  toolSubmitChapter,
  toolSubmitColdRead,
  toolSubmitColdReadFixes,
  toolSubmitOwnerReviewFixes,
  toolSubmitRecords,
  toolUpdateState,
} from "./tools";

/// The agent-facing tools, keyed by the name declared in the manifest. Each
/// takes the caller `context` as its second argument — core builds it from
/// the verified mcp.tool.invoke context, so a tool cannot be called outside
/// its caller's own scope.
const TOOLS: Record<string, (args: any, context: any) => any> = {
  story_get_brief: toolGetBrief,
  story_get_records: toolGetRecords,
  story_submit_records: toolSubmitRecords,
  story_submit_chapter: toolSubmitChapter,
  story_update_state: toolUpdateState,
  story_add_style_rules: toolAddStyleRules,
  story_report_review: toolReportReview,
  story_cold_read_get_text: toolColdReadGetText,
  story_submit_cold_read: toolSubmitColdRead,
  story_submit_cold_read_fixes: toolSubmitColdReadFixes,
  story_submit_owner_review_fixes: toolSubmitOwnerReviewFixes,
};

export function dispatch(hook: string, payload: any): string {
  switch (hook) {
    case "mcp.tool.invoke":
      return handleInvoke(payload);
    case "http.request.before":
      return serveHttp(payload);
    case "http.request.authed":
      return serveAuthed(payload);
    case "card.step.after":
      return onCardStepAfter(payload);
    case "timer.tick":
      return onTimerTick(payload);
    default:
      return skip();
  }
}

function handleInvoke(payload: any): string {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return cancel("malformed invoke payload: not an object");
  }
  const tool: string = typeof payload.tool === "string" ? payload.tool : "";
  const args = payload.arguments ?? {};
  const context = payload.context ?? {};

  const fn = TOOLS[tool];
  if (!fn) {
    return cancel(`story-writer does not provide tool '${tool}'`);
  }
  try {
    return allow(fn(args, context));
  } catch (e) {
    // A handler error is a normal tool result (the agent sees the message and
    // can correct itself), not a plugin cancel.
    return allow({ error: errMsg(e) });
  }
}
