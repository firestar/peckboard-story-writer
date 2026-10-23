// Story tab shell. Runs inside PeckBoard's sandboxed plugin iframe (opaque
// origin, no auth token) — all data flows through the parent-proxied
// postMessage fetch bridge (see peckboard/web/src/components/PluginFullPage.tsx).
//
// This scaffold renders: a stage badge, the brief (once the wizard has run)
// or a minimal JSON-brief form to seed one, and the current records/pipeline
// state. The full wizard (per-element modes, character sheets, etc.) and the
// pipeline dashboard (stage cards, per-chapter grid, viewers) are built out
// on top of this shell in later cards.

import { CSS } from "./style.js";

const P = "/api/plugin-ui/story-writer";

// ── theme ────────────────────────────────────────────────────────────────────

const mediaDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
(function stampTheme() {
  const q = new URLSearchParams(window.location.search).get("theme");
  const theme = q === "dark" || q === "light" ? q : mediaDark && mediaDark.matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();

// ── parent-proxied fetch bridge ──────────────────────────────────────────────

const pending = new Map();
let seq = 0;
window.addEventListener("message", (e) => {
  const m = e.data;
  if (m && m.type === "plugin-ui-fetch-result" && pending.has(m.requestId)) {
    const cb = pending.get(m.requestId);
    pending.delete(m.requestId);
    cb(m);
    return;
  }
  // Store-write notification (see usePluginDataForward): refetch state.
  if (m && m.type === "plugin-ui-event" && m.event === "plugin-data") {
    loadState();
  }
});

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const requestId = ++seq;
    pending.set(requestId, (m) => {
      let data = null;
      try {
        data = m.body ? JSON.parse(m.body) : null;
      } catch (_e) {
        // non-JSON error body; fall through to the status check
      }
      if (m.status >= 200 && m.status < 300) resolve(data || {});
      else reject(new Error((data && data.error) || "request failed (HTTP " + m.status + ")"));
    });
    parent.postMessage(
      {
        type: "plugin-ui-fetch",
        requestId,
        method,
        path,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      "*",
    );
  });
}
const getJSON = (path) => api("GET", path);
const postJSON = (path, body) => api("POST", path, body || {});

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function clear(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}

// ── screens ──────────────────────────────────────────────────────────────────

const style = el("style");
style.textContent = CSS;
document.head.appendChild(style);

const root = el("div", "sw-app");
document.getElementById("app").appendChild(root);

function renderLoading() {
  clear(root);
  root.appendChild(el("p", "sw-muted", "Loading…"));
}

function renderError(err) {
  clear(root);
  const header = el("div", "sw-header");
  header.appendChild(el("h1", null, "Story Writer"));
  root.appendChild(header);
  root.appendChild(el("p", "sw-error", String(err && err.message ? err.message : err)));
}

function renderState(state) {
  clear(root);

  const header = el("div", "sw-header");
  header.appendChild(el("h1", null, (state.brief && state.brief.title) || "Story Writer"));
  header.appendChild(el("span", "sw-stage", (state.pipeline && state.pipeline.stage) || "setup"));
  root.appendChild(header);

  if (!state.brief) {
    const card = el("div", "sw-card");
    card.appendChild(el("h2", null, "Set up this story"));
    card.appendChild(
      el(
        "p",
        "sw-muted",
        "No brief yet. The setup wizard (basics, premise, characters, style rules, …) lands " +
          "in a later card; paste a brief JSON here to seed one for testing.",
      ),
    );
    const textarea = el("textarea", "sw-input");
    textarea.placeholder = '{"title": "...", "genre": "...", "format": "prose"}';
    card.appendChild(textarea);
    const btn = el("button", "sw-btn", "Save brief");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const brief = JSON.parse(textarea.value || "{}");
        await postJSON(`${P}/wizard`, { brief });
        await loadState();
      } catch (e) {
        renderError(e);
      } finally {
        btn.disabled = false;
      }
    });
    card.appendChild(btn);
    root.appendChild(card);
    return;
  }

  const briefCard = el("div", "sw-card");
  briefCard.appendChild(el("h2", null, "Brief"));
  briefCard.appendChild(el("pre", "sw-pre", JSON.stringify(state.brief, null, 2)));
  root.appendChild(briefCard);

  const recordsCard = el("div", "sw-card");
  recordsCard.appendChild(el("h2", null, "Records"));
  recordsCard.appendChild(el("pre", "sw-pre", JSON.stringify(state.records || {}, null, 2)));
  root.appendChild(recordsCard);

  const pipelineCard = el("div", "sw-card");
  pipelineCard.appendChild(el("h2", null, "Pipeline"));
  pipelineCard.appendChild(el("pre", "sw-pre", JSON.stringify(state.pipeline || {}, null, 2)));
  root.appendChild(pipelineCard);
}

async function loadState() {
  renderLoading();
  try {
    const state = await getJSON(`${P}/state`);
    renderState(state);
  } catch (e) {
    renderError(e);
  }
}

loadState();
