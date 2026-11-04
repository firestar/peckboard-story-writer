// Writer model pickers (Story tab): one searchable combobox per writer slot
// (pilot, chapter) over the host's model catalog (GET /models), saving the
// story's pick to POST /models/story. Used by the wizard ("Who writes and
// reviews") and the dashboard ("Writer models" panel).
//
// The wizard and dashboard rebuild their whole DOM on every render, so each
// picker keeps its own state (typed query, open, highlighted option) here
// and rebuilds from it; the input carries a data-fid, which both renderers
// already use to restore focus and caret. Typing repaints just the picker.

import { h } from "./dom.js";
import { getJSON, postJSON } from "./bridge.js";
import * as M from "./model.js";

// One catalog load per page: it's the host's whole model list.
let catalog = null; // [{id, display_name}] once loaded
let catalogError = null;
let catalogLoad = null;
const catalogWaiters = new Set();

function loadCatalog(P) {
  if (catalog || catalogLoad) return;
  catalogError = null;
  catalogLoad = getJSON(`${P}/models`)
    .then((r) => {
      catalog = M.filterModels(r && r.models, "", Infinity);
    })
    .catch((e) => {
      catalogError = (e && e.message) || String(e);
    })
    .finally(() => {
      catalogLoad = null;
      for (const fn of catalogWaiters) fn();
    });
}

let seq = 0;

/// opts: { P, fidPrefix, getView: () => state.models, onSaved(slot, res),
///         notify(text, tone) }
export function createModelPickers(opts) {
  const { P, fidPrefix } = opts;
  const uid = `swm${++seq}`;
  const pickers = {};
  for (const { slot } of M.WRITER_SLOTS) pickers[slot] = { query: null, open: false, active: -1, saving: false, error: null };
  const onCatalog = () => {
    for (const slot of Object.keys(pickers)) if (pickers[slot].open) repaint(slot);
  };
  catalogWaiters.add(onCatalog);

  const view = () => opts.getView() || {};
  const fid = (slot) => `${fidPrefix}.${slot}`;
  const listId = (slot) => `${uid}-${slot}-list`;
  const optId = (slot, i) => `${uid}-${slot}-opt-${i}`;

  /// The listbox rows: the slot's default first (clears this story's pick),
  /// then the catalog matches.
  function options(slot) {
    const st = pickers[slot];
    const v = view()[slot] || {};
    const fb = v.fallback || {};
    const rows = [
      {
        kind: "default",
        id: "",
        name: `Default — ${fb.name || fb.id || "the board's model"}`,
        sub: M.MODEL_SOURCES[fb.source] || "",
      },
    ];
    for (const m of M.filterModels(catalog || [], st.query || "")) rows.push({ kind: "model", id: m.id, name: m.display_name || m.id, sub: m.id });
    return rows;
  }

  function current(slot) {
    const story = view().story || {};
    return story[slot] || "";
  }

  // ── actions ──────────────────────────────────────────────────────────

  function openList(slot) {
    const st = pickers[slot];
    if (st.open) return;
    st.open = true;
    st.active = -1;
    loadCatalog(P);
  }

  function close(slot, revert) {
    const st = pickers[slot];
    st.open = false;
    st.active = -1;
    if (revert) st.query = null;
  }

  async function save(slot, id) {
    const st = pickers[slot];
    const next = (id || "").trim();
    close(slot, false);
    if (next === current(slot)) {
      st.query = null;
      repaint(slot);
      return;
    }
    st.saving = true;
    st.error = null;
    repaint(slot);
    try {
      const res = await postJSON(`${P}/models/story`, { [slot]: next });
      st.query = null;
      st.saving = false;
      if (opts.onSaved) opts.onSaved(slot, res);
    } catch (e) {
      st.saving = false;
      st.error = (e && e.message) || String(e);
    }
    repaint(slot);
  }

  function choose(slot, row) {
    save(slot, row.kind === "default" ? "" : row.id);
  }

  // ── events ───────────────────────────────────────────────────────────

  function onKey(slot, e) {
    const st = pickers[slot];
    const rows = st.open ? options(slot) : [];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!st.open) openList(slot);
      const n = options(slot).length;
      if (n) st.active = e.key === "ArrowDown" ? (st.active + 1) % n : st.active <= 0 ? n - 1 : st.active - 1;
      repaint(slot);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (st.open && st.active >= 0 && rows[st.active]) choose(slot, rows[st.active]);
      else if (st.query !== null) save(slot, st.query);
    } else if (e.key === "Escape") {
      if (st.open || st.query !== null) {
        e.preventDefault();
        e.stopPropagation();
        close(slot, true);
        repaint(slot);
      }
    } else if (e.key === "Tab") {
      close(slot, false);
    }
  }

  function onInput(slot, e) {
    const st = pickers[slot];
    st.query = e.target.value;
    st.error = null;
    openList(slot);
    st.active = -1;
    repaint(slot);
  }

  /// Leaving the field commits a typed id (an id the catalog doesn't list
  /// can still be entered). A render that rebuilt the picker restores focus
  /// to the same data-fid, so check where focus actually ended up.
  function onBlur(slot) {
    setTimeout(() => {
      const st = pickers[slot];
      const a = document.activeElement;
      if (st.saving || (a && a.dataset && a.dataset.fid === fid(slot))) return;
      if (st.query !== null && st.query.trim() !== current(slot)) save(slot, st.query);
      else if (st.open || st.query !== null) {
        close(slot, true);
        repaint(slot);
      }
    }, 0);
  }

  // ── rendering ────────────────────────────────────────────────────────

  /// Swap just this picker's DOM, keeping focus and caret in its input.
  function repaint(slot) {
    const old = document.querySelector(`[data-picker="${uid}.${slot}"]`);
    if (!old) return;
    const input = old.querySelector("input");
    const focused = input && document.activeElement === input;
    const sel = focused ? [input.selectionStart, input.selectionEnd] : null;
    const next = buildOne(slot);
    old.replaceWith(next);
    if (focused) {
      const n = next.querySelector("input");
      n.focus({ preventScroll: true });
      try {
        n.setSelectionRange(sel[0], sel[1]);
      } catch (_e) {
        // not a text control
      }
    }
    const act = next.querySelector('[aria-selected="true"]');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest" });
  }

  function buildOne(slot) {
    const meta = M.WRITER_SLOTS.find((s) => s.slot === slot);
    const st = pickers[slot];
    const v = view()[slot] || {};
    const fb = v.fallback || {};
    const pick = current(slot);
    const typed = st.query !== null;
    const rows = st.open ? options(slot) : [];
    const notInCatalog = !!pick && v.source === "story" && catalog !== null ? !catalog.some((m) => m.id === pick) : !!pick && v.source === "story" && v.in_catalog === false;
    const fieldId = `${uid}-${slot}-input`;
    return h(
      "div",
      { class: "sw-field sw-model-pick", dataset: { picker: `${uid}.${slot}` } },
      h("label", { class: "sw-label", for: fieldId }, meta.label),
      h("p", { class: "sw-help sw-model-help", id: `${uid}-${slot}-help` }, meta.help),
      h(
        "div",
        { class: "sw-combo" },
        h("input", {
          id: fieldId,
          class: "sw-input sw-combo-input",
          type: "text",
          role: "combobox",
          autocomplete: "off",
          spellcheck: "false",
          "aria-autocomplete": "list",
          "aria-expanded": st.open ? "true" : "false",
          "aria-controls": listId(slot),
          "aria-describedby": `${uid}-${slot}-help ${uid}-${slot}-using`,
          "aria-activedescendant": st.open && st.active >= 0 ? optId(slot, st.active) : null,
          "aria-invalid": st.error ? "true" : null,
          placeholder: `Default — ${fb.name || fb.id || "the board's model"}`,
          value: typed ? st.query : pick,
          readOnly: st.saving,
          "aria-busy": st.saving ? "true" : null,
          dataset: { fid: fid(slot) },
          onclick: () => {
            if (!st.open) {
              openList(slot);
              repaint(slot);
            }
          },
          oninput: (e) => onInput(slot, e),
          onkeydown: (e) => onKey(slot, e),
          onblur: () => onBlur(slot),
        }),
        st.saving ? h("span", { class: "sw-spinner sw-combo-spin", "aria-hidden": "true" }) : h("span", { class: "sw-combo-caret", "aria-hidden": "true" }),
        st.open
          ? h(
              "ul",
              { class: "sw-combo-list", id: listId(slot), role: "listbox", "aria-label": `${meta.label} model` },
              rows.map((row, i) =>
                h(
                  "li",
                  {
                    id: optId(slot, i),
                    role: "option",
                    class: `sw-combo-opt${row.kind === "default" ? " default" : ""}${(row.kind === "default" ? !pick : row.id === pick) ? " current" : ""}`,
                    "aria-selected": i === st.active ? "true" : "false",
                    // Choose on press, not click: a render landing between
                    // press and release (live refresh) would swallow the click.
                    // preventDefault keeps focus in the input.
                    onmousedown: (e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      choose(slot, row);
                    },
                    // Hover moves the highlight in place — rebuilding the
                    // list under the pointer would detach the hovered row.
                    onmousemove: (e) => {
                      if (st.active === i) return;
                      st.active = i;
                      const list = e.currentTarget.parentNode;
                      for (const o of list.querySelectorAll('[role="option"]')) o.setAttribute("aria-selected", o === e.currentTarget ? "true" : "false");
                      const input = list.parentNode.querySelector("input");
                      if (input) input.setAttribute("aria-activedescendant", e.currentTarget.id);
                    },
                  },
                  h("span", { class: "sw-combo-name" }, row.name),
                  row.sub ? h("span", { class: row.kind === "default" ? "sw-combo-src" : "sw-combo-id" }, row.sub) : null,
                ),
              ),
              catalog === null && !catalogError ? h("li", { class: "sw-combo-note", role: "presentation" }, "Loading models…") : null,
              catalogError ? h("li", { class: "sw-combo-note err", role: "presentation" }, `Couldn't load the model list: ${catalogError}`) : null,
              catalog !== null && rows.length === 1 && st.query ? h("li", { class: "sw-combo-note", role: "presentation" }, `No catalog model matches. Press Enter to use “${st.query.trim()}” as typed.`) : null,
            )
          : null,
      ),
      st.error
        ? h("p", { class: "sw-field-error", role: "alert" }, st.error)
        : h(
            "p",
            { class: "sw-model-using", id: `${uid}-${slot}-using` },
            "Using ",
            h("strong", { title: v.id || null }, v.name || v.id || "the board's default model"),
            v.source ? h("span", { class: "sw-muted" }, ` · ${M.MODEL_SOURCES[v.source] || v.source}`) : null,
            notInCatalog ? h("span", { class: "sw-badge warn sw-model-missing" }, "Not in catalog") : null,
          ),
    );
  }

  return {
    build() {
      return h("div", { class: "sw-model-picks" }, M.WRITER_SLOTS.map(({ slot }) => buildOne(slot)));
    },
    destroy() {
      catalogWaiters.delete(onCatalog);
    },
  };
}
