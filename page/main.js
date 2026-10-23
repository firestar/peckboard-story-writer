// Story tab shell. Runs inside PeckBoard's sandboxed plugin iframe (opaque
// origin, no auth token) — all data flows through the parent-proxied
// postMessage bridge (bridge.js).
//
// Routes between the setup wizard (wizard.js — while the pipeline is in
// its "setup" stage) and the pipeline view once it has started (a minimal
// stage/unit summary for now; the live dashboard replaces it). The wizard
// stays reachable read-only from the pipeline view.

import { CSS } from "./style.js";
import { getJSON, onDataChange } from "./bridge.js";
import { h, clear } from "./dom.js";
import { mountWizard } from "./wizard.js";

const P = "/api/plugin-ui/story-writer";

// ── theme ────────────────────────────────────────────────────────────────────

const themeParam = new URLSearchParams(window.location.search).get("theme");
const mediaDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function stampTheme() {
  const theme = themeParam === "dark" || themeParam === "light" ? themeParam : mediaDark && mediaDark.matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
}
stampTheme();
// No explicit ?theme= means the host is on "auto": follow the OS live.
if (mediaDark && themeParam !== "dark" && themeParam !== "light" && mediaDark.addEventListener) {
  mediaDark.addEventListener("change", stampTheme);
}

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);

const root = h("div", { class: "sw-app" });
document.getElementById("app").appendChild(root);

// ── state & routing ──────────────────────────────────────────────────────────

let defaults = null;
let state = null;
let view = null; // { kind: "wizard", readOnly, ctrl } | { kind: "pipeline" }
let showSetup = false;

function stageOf(st) {
  return (st && st.engine && st.engine.stage) || (st && st.pipeline && st.pipeline.stage) || "setup";
}

function teardown() {
  if (view && view.ctrl) view.ctrl.destroy();
  view = null;
  clear(root);
}

function route() {
  const stage = stageOf(state);
  const wasKind = view && view.kind;
  if (stage === "setup" || showSetup) {
    const readOnly = stage !== "setup";
    if (view && view.kind === "wizard" && view.readOnly === readOnly) {
      view.ctrl.update(state);
      return;
    }
    teardown();
    window.scrollTo(0, 0);
    const ctrl = mountWizard(root, {
      defaults,
      state,
      readOnly,
      P,
      refresh,
      onClose: readOnly
        ? () => {
            showSetup = false;
            route();
          }
        : null,
    });
    view = { kind: "wizard", readOnly, ctrl };
    return;
  }
  // The pipeline view re-renders on every refresh; keep the scroll position
  // unless we just arrived from the wizard.
  const y = wasKind === "pipeline" ? window.scrollY : 0;
  teardown();
  view = { kind: "pipeline" };
  renderPipeline(state);
  window.scrollTo(0, y);
}
let refreshing = null;
let again = false;
let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 120);
}

/// Refetch /state and re-route. Coalesces: a refresh requested while one
/// is in flight runs once more after it.
function refresh() {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      state = await getJSON(`${P}/state`);
      route();
    } catch (e) {
      if (view && view.kind === "wizard") view.ctrl.notify(`Couldn't refresh: ${e.message || e}`, "err");
      else renderFatal(e);
    } finally {
      refreshing = null;
      if (again) {
        again = false;
        scheduleRefresh();
      }
    }
  })();
  return refreshing;
}

// Store-write notification (see usePluginDataForward): refetch state.
onDataChange(scheduleRefresh);

// ── pipeline view (placeholder until the dashboard lands) ────────────────────

const STAGES = [
  ["setup", "Setup"],
  ["records", "Records"],
  ["pilot", "Pilot chapter"],
  ["pilot_review", "Your review"],
  ["chapters", "Chapters"],
  ["review", "Review passes"],
  ["final", "Final"],
];

function renderPipeline(st) {
  const stage = stageOf(st);
  const at = STAGES.findIndex(([id]) => id === stage);
  const title = (st.brief && st.brief.basics && st.brief.basics.title) || "Story";
  const units = Object.values((st.engine && st.engine.units) || {}).sort((a, b) => a.created_at.localeCompare(b.created_at));
  root.appendChild(
    h(
      "header",
      { class: "sw-top" },
      h("div", { class: "sw-top-title" }, h("span", { class: "sw-kicker" }, "Story pipeline"), h("h1", { class: "sw-title" }, title)),
      h(
        "button",
        {
          class: "sw-btn secondary",
          type: "button",
          onclick: () => {
            showSetup = true;
            route();
          },
        },
        "View setup",
      ),
    ),
  );
  root.appendChild(
    h(
      "div",
      { class: "sw-card" },
      h("h2", null, "Stage"),
      h(
        "div",
        { class: "sw-stages" },
        STAGES.map(([id, label], i) => h("span", { class: `sw-stage${i === at ? " on" : i < at ? " done" : ""}` }, label)),
      ),
      st.engine && st.engine.note ? h("p", { class: "sw-muted" }, st.engine.note) : null,
    ),
  );
  root.appendChild(
    h(
      "div",
      { class: "sw-card" },
      h("h2", null, "Cards"),
      units.length
        ? h(
            "table",
            { class: "sw-table" },
            h("thead", null, h("tr", null, h("th", null, "Unit"), h("th", null, "Kind"), h("th", null, "Status"))),
            h(
              "tbody",
              null,
              units.map((u) =>
                h(
                  "tr",
                  null,
                  h("td", null, u.id),
                  h("td", { class: "sw-muted" }, u.kind),
                  h(
                    "td",
                    null,
                    h("span", { class: `sw-badge ${u.status === "done" ? "ok" : u.status === "failed" ? "err" : "busy"}` }, u.status),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "sw-muted" }, "No cards yet."),
    ),
  );
  root.appendChild(h("div", { class: "sw-card" }, h("h2", null, "Records"), h("pre", { class: "sw-pre" }, JSON.stringify(st.records || {}, null, 2))));
}

// ── boot ─────────────────────────────────────────────────────────────────────

function renderFatal(err) {
  teardown();
  root.appendChild(
    h(
      "div",
      { class: "sw-panel" },
      h("h2", null, "Story Writer"),
      h("p", { class: "sw-error" }, String(err && err.message ? err.message : err)),
      h("button", { class: "sw-btn", type: "button", onclick: boot }, "Try again"),
    ),
  );
}

async function boot() {
  teardown();
  root.appendChild(h("p", { class: "sw-muted" }, "Loading…"));
  try {
    const [d, s] = await Promise.all([getJSON(`${P}/defaults`), getJSON(`${P}/state`)]);
    defaults = d;
    state = s;
    teardown();
    route();
  } catch (e) {
    renderFatal(e);
  }
}

boot();
