// Parent-proxied fetch bridge. The Story tab runs in PeckBoard's sandboxed
// plugin iframe (opaque origin, no auth token), so every API call is a
// postMessage to the host page, which performs it with the user's session
// and the project-id header (peckboard/web/src/components/PluginFullPage.tsx)
// and posts the response back. Store writes arrive as `plugin-ui-event`
// messages so the page refreshes on change instead of polling.

const TIMEOUT_MS = 30000;
const RESEND_MS = 500;

const pending = new Map();
const listeners = new Set();
let seq = 0;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "plugin-ui-fetch-result" && pending.has(m.requestId)) {
    const cb = pending.get(m.requestId);
    pending.delete(m.requestId);
    cb(m);
    return;
  }
  if (m.type === "plugin-ui-event" && m.event === "plugin-data") {
    for (const fn of listeners) fn(m);
  }
});

export function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const requestId = ++seq;
    const message = {
      type: "plugin-ui-fetch",
      requestId,
      method,
      path,
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    // On a cold load the frame can run before the host page has attached
    // its message listener, and that first post is silently dropped. GETs
    // are safe to repeat, so re-post them with backoff until one is answered
    // (the host answers each with the same requestId; extras are ignored).
    // Writes are never repeated — they only happen after the page has heard
    // back from the host.
    let resend = null;
    let delay = RESEND_MS;
    const again = () => {
      resend = setTimeout(() => {
        window.parent.postMessage(message, "*");
        delay = Math.min(delay * 2, 8000);
        again();
      }, delay);
    };
    if (method === "GET") again();
    const timer = setTimeout(() => {
      clearTimeout(resend);
      pending.delete(requestId);
      reject(new ApiError("PeckBoard didn't answer — reload the tab and try again.", 0));
    }, TIMEOUT_MS);
    pending.set(requestId, (m) => {
      clearTimeout(timer);
      clearTimeout(resend);
      let data = null;
      try {
        data = m.body ? JSON.parse(m.body) : null;
      } catch (_e) {
        // non-JSON error body; fall through to the status check
      }
      if (m.status >= 200 && m.status < 300) resolve(data || {});
      else reject(new ApiError((data && data.error) || "request failed (HTTP " + m.status + ")", m.status));
    });
    window.parent.postMessage(message, "*");
  });
}

export const getJSON = (path) => api("GET", path);
export const postJSON = (path, body) => api("POST", path, body || {});

/// Subscribe to "this plugin's stored data changed" notifications.
export function onDataChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/// Ask PeckBoard to open a worker session as a tab (the host validates the
/// id and navigates; see PluginFullPage.tsx `plugin-ui-open-session`).
export function openSession(sessionId) {
  if (typeof sessionId === "string" && sessionId) window.parent.postMessage({ type: "plugin-ui-open-session", sessionId }, "*");
}