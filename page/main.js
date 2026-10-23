// Story tab shell. Runs inside PeckBoard's sandboxed plugin iframe (opaque
// origin, no auth token) — all data flows through the parent-proxied
// postMessage bridge (bridge.js).
//
// Routes between the setup wizard (wizard.js — while the pipeline is in
// its "setup" stage) and the live pipeline dashboard (dashboard.js) once it
// has started. The wizard stays reachable read-only from the dashboard.

import { CSS } from "./style.js";
import { getJSON, onDataChange } from "./bridge.js";
import { h, clear } from "./dom.js";
import { mountWizard } from "./wizard.js";
import { mountDashboard } from "./dashboard.js";

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
let view = null; // { kind: "wizard", readOnly, ctrl } | { kind: "dashboard", ctrl }
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
      // A write refused with 409 means this tab is behind (usually: the
      // pipeline started elsewhere). Refetch, re-route, then say why.
      onConflict: (text) =>
        refresh().then(() => {
          if (view) view.ctrl.notify(text, "warn");
        }),
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
  if (view && view.kind === "dashboard") {
    view.ctrl.update(state);
    return;
  }
  teardown();
  window.scrollTo(0, 0);
  const ctrl = mountDashboard(root, {
    defaults,
    state,
    P,
    refresh,
    onShowSetup: () => {
      showSetup = true;
      route();
    },
  });
  view = { kind: "dashboard", ctrl };

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
      if (view) view.ctrl.notify(`Couldn't refresh: ${e.message || e}`, "err");
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

// ── boot ───────────────────────────────────────────────────────────────────────

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
