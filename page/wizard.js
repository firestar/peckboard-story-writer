// Story setup wizard: what the story is about, the basics, who writes each
// story element (I write it / AI drafts, I edit / AI generates), an editor
// per element, and a review step that gates "Start pipeline".
//
// Edits autosave (debounced) as partial updates — only the paths the owner
// touched — to POST /wizard. Store-write events refetch /state; the
// server's copy is merged in except where the owner has unsaved/in-flight
// edits (src/wizard.ts and model.js mergeServer), so AI drafts and status
// changes land live without clobbering typing. Re-renders keep focus and
// the caret on the control the owner was using.

import { h, clear } from "./dom.js";
import { postJSON } from "./bridge.js";
import * as M from "./model.js";

const SAVE_DELAY_MS = 700;

const svg = (body, sw = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  check: svg('<path d="M20 6 9 17l-5-5"/>', 2.5),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  up: svg('<path d="m18 15-6-6-6 6"/>'),
  spark: M.MODES[2].icon,
};

function msg(e) {
  return e && e.message ? e.message : String(e);
}

function attrEscape(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/// Lesson markdown as plain preview text, minus a first line that only
/// repeats the section's title.
function plain(md, title) {
  const lines = String(md || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .split("\n");
  if (title && lines.length && lines[0].trim().toLowerCase() === title.trim().toLowerCase()) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.join("\n");
}

export function mountWizard(container, opts) {
  const { defaults, P } = opts;
  const readOnly = !!opts.readOnly;
  const maxChapters = defaults.max_chapters;

  let server = opts.state;
  let draft = M.clone(server.brief || defaults.brief);
  let hasServerBrief = !!server.brief;
  const dirty = new Set();
  let inflight = new Set();
  let saving = null;
  let saveTimer = null;
  let saveError = null;
  let destroyed = false;

  let step = server.brief ? "review" : "about";
  let notice = null; // {tone, text, action?: {label, step}}
  let confirm = null; // "start" | "regen:<key>" | "char:<id>" | "rel:<id>" | "end:<id>"
  let focusFid = null; // focus this control after the next render
  const busy = new Set(); // "gen:<key>", "approve:<key>", "start"
  const otherOpen = new Set(); // choice controls showing their "Other…" input
  const collapsed = new Set(); // collapsed character cards
  const editingLessons = new Set();
  const fieldErrors = {};

  const fmt = () => draft.basics.format;
  const view = (key) => M.elementView(draft, server.engine, key);
  const label = (key) => M.elementLabel(key, fmt());
  const labels = (keys) => keys.map(label).join(", ");

  // ── saving ─────────────────────────────────────────────────────────────

  function markDirty(path) {
    if (readOnly || destroyed) return;
    dirty.add(path);
    saveError = null;
    paintSave();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave().catch(() => {}), SAVE_DELAY_MS);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    while (saving) await saving.catch(() => {});
    if (readOnly || destroyed) return;
    if (dirty.size === 0 && hasServerBrief) return;
    // The first save creates the brief, so it carries everything.
    const paths = hasServerBrief ? Array.from(dirty) : M.allPaths(draft).concat(Array.from(dirty));
    dirty.clear();
    inflight = new Set(paths);
    paintSave();
    const run = (async () => {
      try {
        const res = await postJSON(`${P}/wizard`, { brief: M.buildPatch(draft, paths) });
        inflight = new Set();
        hasServerBrief = true;
        saveError = null;
        server = { ...server, brief: res.brief };
        const merged = M.mergeServer(draft, res.brief, dirty);
        const changed = !M.sameBrief(merged, draft);
        draft = merged;
        if (res.ignored && res.ignored.length) {
          notice = { tone: "warn", text: `The AI is still working on ${labels(res.ignored)} — your edits there weren't saved.` };
          render();
        } else if (changed) render();
        else paintSave();
      } catch (e) {
        for (const p of paths) dirty.add(p);
        inflight = new Set();
        saveError = msg(e);
        paintSave();
        throw e;
      }
    })();
    saving = run;
    try {
      await run;
    } finally {
      if (saving === run) saving = null;
    }
  }

  function saveIndicator() {
    let cls = "";
    let text;
    if (readOnly) text = "Read-only";
    else if (saveError) (cls = "error"), (text = "Couldn't save");
    else if (inflight.size) (cls = "saving"), (text = "Saving…");
    else if (dirty.size) (cls = "dirty"), (text = "Unsaved changes");
    else if (!hasServerBrief) text = "Not saved yet";
    else (cls = "saved"), (text = "All changes saved");
    return h(
      "span",
      { class: `sw-save ${cls}`, role: "status", title: saveError || null },
      h("span", { class: "dot", "aria-hidden": "true" }),
      text,
      saveError ? h("button", { class: "sw-btn sm secondary", type: "button", onclick: () => flushSave().catch(() => {}) }, "Retry") : null,
    );
  }

  function paintSave() {
    const old = container.querySelector(".sw-save");
    if (old) old.replaceWith(saveIndicator());
  }

  function paintTitle() {
    const t = container.querySelector(".sw-title");
    if (t) t.textContent = draft.basics.title.trim() || "New story";
  }

  /// Repaint a character's name wherever it's shown (card header, initials,
  /// other cards' attitude rows) without re-rendering the form.
  function paintName(id, name) {
    const sel = (attr) => container.querySelectorAll(`[${attr}="${attrEscape(id)}"]`);
    for (const n of sel("data-name-of")) n.textContent = name.trim() || "Unnamed character";
    for (const n of sel("data-initials-of")) n.textContent = initials(name);
    for (const n of container.querySelectorAll("[data-aria-tpl]")) {
      if (n.dataset.ariaTpl.includes(`{{${id}}}`)) n.setAttribute("aria-label", fillTpl(n.dataset.ariaTpl));
    }
  }

  // ── server refresh ─────────────────────────────────────────────────────

  function generateUnits(engine) {
    const units = (engine && engine.units) || {};
    return JSON.stringify(
      Object.values(units)
        .filter((u) => u.kind === "generate")
        .map((u) => [u.id, u.status, u.card_id, u.attempt]),
    );
  }

  function update(state) {
    if (destroyed) return;
    const prevBrief = server.brief;
    const prevUnits = (server.engine && server.engine.units) || {};
    const prevSnap = generateUnits(server.engine);
    server = state;
    let changed = false;
    if (state.brief) {
      const owned = new Set([...dirty, ...inflight]);
      const merged = M.mergeServer(draft, state.brief, owned);
      changed = !M.sameBrief(merged, draft);
      draft = merged;
      hasServerBrief = true;
      const fresh = M.newDrafts(prevBrief, state.brief);
      if (fresh.length) {
        changed = true;
        notice = {
          tone: "ok",
          text: `AI draft ready: ${labels(fresh)}. Review it, then approve it.`,
          action: fresh.length === 1 && step !== fresh[0] ? { label: "Review it", step: fresh[0] } : null,
        };
      }
    }
    if (generateUnits(state.engine) !== prevSnap) {
      changed = true;
      const units = (state.engine && state.engine.units) || {};
      const failed = Object.values(units).filter(
        (u) => u.kind === "generate" && u.status === "failed" && prevUnits[u.id] && prevUnits[u.id].status === "open",
      );
      if (failed.length) {
        notice = { tone: "err", text: `The AI card for ${labels(failed.map((u) => u.element))} closed without a draft.` };
      }
    }
    if (changed) render();
  }

  // ── actions ────────────────────────────────────────────────────────────

  function goTo(id) {
    // A notice is about the moment it appeared; leaving the step retires it
    // (unless it's a "review it" pointer to somewhere else).
    if (notice && (!notice.action || notice.action.step === id)) notice = null;
    step = id;
    confirm = null;
    focusFid = "step-heading";
    render();
    window.scrollTo(0, 0);
  }

  function setMode(key, mode) {
    draft.modes = { ...draft.modes, [key]: mode };
    markDirty(`modes.${key}`);
    render();
  }

  async function generate(keys) {
    if (readOnly || keys.length === 0) return;
    for (const k of keys) busy.add(`gen:${k}`);
    notice = null;
    render();
    try {
      await flushSave();
      const res = await postJSON(`${P}/pipeline/generate`, { elements: keys });
      const queued = res.queued || [];
      notice = queued.length
        ? {
            tone: "info",
            text: `Sent to the AI: ${labels(queued)}. ${queued.length === 1 ? "The draft comes" : "Drafts come"} back here for your review.`,
          }
        : { tone: "warn", text: "Nothing was sent — only elements set to an AI mode can be generated." };
      if (opts.refresh) await opts.refresh();
    } catch (e) {
      notice = { tone: "err", text: `Couldn't send to the AI: ${msg(e)}` };
    } finally {
      for (const k of keys) busy.delete(`gen:${k}`);
      render();
    }
  }

  async function approve(key) {
    if (notice && notice.tone === "ok") notice = null; // the "draft ready" nudge is done
    busy.add(`approve:${key}`);
    draft.status = { ...draft.status, [key]: "approved" };
    markDirty(`status.${key}`);
    render();
    try {
      await flushSave();
    } catch (e) {
      notice = { tone: "err", text: `Couldn't approve ${label(key)}: ${msg(e)}` };
    } finally {
      busy.delete(`approve:${key}`);
      render();
    }
  }

  async function start() {
    busy.add("start");
    render();
    try {
      for (const k of M.stripBlankRows(draft)) markDirty(`elements.${k}`);
      await flushSave();
      await postJSON(`${P}/pipeline/start`);
      confirm = null;
      if (opts.refresh) await opts.refresh();
    } catch (e) {
      confirm = null;
      notice = { tone: "err", text: `Couldn't start the pipeline: ${msg(e)}` };
    } finally {
      busy.delete("start");
      render();
    }
  }

  // ── rendering ──────────────────────────────────────────────────────────

  /// Re-render once the current event has settled and focus has landed —
  /// but not while a <select> has focus (its popup may be opening; tearing
  /// it out of the DOM would close it). Then wait for that select to blur.
  function renderSoon() {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.tagName === "SELECT" && container.contains(a)) {
        a.addEventListener("blur", renderSoon, { once: true });
        return;
      }
      render();
    }, 0);
  }
  function render() {
    if (destroyed) return;
    const active = document.activeElement;
    const keepFid = !focusFid && active && container.contains(active) && active.dataset ? active.dataset.fid : null;
    const fid = focusFid || keepFid;
    let sel = null;
    if (keepFid && typeof active.selectionStart === "number") {
      try {
        sel = [active.selectionStart, active.selectionEnd, active.scrollTop];
      } catch (_e) {
        sel = null; // number inputs don't expose a selection
      }
    }
    const jump = !!focusFid;
    focusFid = null;
    const y = window.scrollY;
    clear(container);
    container.appendChild(build());
    window.scrollTo(0, y);
    if (!fid) return;
    const n = container.querySelector(`[data-fid="${attrEscape(fid)}"]`);
    if (!n) return;
    n.focus({ preventScroll: !jump || fid === "step-heading" });
    if (sel) {
      try {
        n.setSelectionRange(sel[0], sel[1]);
        n.scrollTop = sel[2];
      } catch (_e) {
        // not a text control
      }
    }
  }

  function build() {
    return h(
      "div",
      { class: "sw-wizard" },
      h(
        "header",
        { class: "sw-top" },
        h(
          "div",
          { class: "sw-top-title" },
          h("span", { class: "sw-kicker" }, readOnly ? "Story setup · read-only" : "Story setup"),
          h("h1", { class: "sw-title" }, draft.basics.title.trim() || "New story"),
        ),
        saveIndicator(),
        opts.onClose ? h("button", { class: "sw-btn secondary", type: "button", onclick: opts.onClose }, "Back to pipeline") : null,
      ),
      h(
        "div",
        { class: "sw-wiz" },
        buildRail(),
        h(
          "main",
          { class: "sw-main" },
          notice ? buildNotice() : null,
          readOnly && step !== "review"
            ? banner("info", "The pipeline has started, so the setup is read-only.", null)
            : null,
          buildStep(),
          buildFooter(),
        ),
      ),
    );
  }

  function badge(b) {
    return h("span", { class: `sw-badge ${b.tone}` }, b.tone === "busy" ? h("span", { class: "sw-spinner", "aria-hidden": "true" }) : null, b.text);
  }

  function banner(tone, text, actions, extra) {
    const icon = tone === "ok" ? ICON.check : tone === "info" ? ICON.info : ICON.alert;
    return h(
      "div",
      { class: `sw-banner ${tone}${extra ? " " + extra : ""}`, role: tone === "err" ? "alert" : "status" },
      tone === "busy"
        ? h("span", { class: "sw-banner-icon" }, h("span", { class: "sw-spinner" }))
        : h("span", { class: "sw-banner-icon", html: icon }),
      h("div", { class: "sw-banner-text" }, text),
      actions && actions.filter(Boolean).length ? h("div", { class: "sw-banner-actions" }, actions) : null,
    );
  }

  function buildNotice() {
    const n = notice;
    return banner(
      n.tone,
      n.text,
      [
        n.action
          ? h(
              "button",
              {
                class: "sw-btn sm",
                type: "button",
                onclick: () => {
                  notice = null;
                  goTo(n.action.step);
                },
              },
              n.action.label,
            )
          : null,
        h("button", {
          class: "sw-icon-btn",
          type: "button",
          "aria-label": "Dismiss",
          html: ICON.x,
          onclick: () => {
            notice = null;
            render();
          },
        }),
      ],
      "sw-notice",
    );
  }

  function buildRail() {
    const steps = M.wizardSteps(fmt());
    const items = [];
    let group = null;
    steps.forEach((s, i) => {
      if (s.group !== group) {
        group = s.group;
        items.push(h("div", { class: "sw-rail-group" }, group));
      }
      let tone = "";
      let mode = null;
      if (s.element) {
        const v = view(s.id);
        tone = v.badge.tone === "muted" ? "" : v.badge.tone;
        mode = M.MODES.find((m) => m.value === v.mode).short;
      } else if (s.id === "about") tone = draft.about.trim() ? "ok" : "";
      else if (s.id === "basics") tone = draft.basics.title.trim() ? "ok" : "";
      const current = step === s.id;
      const num =
        current || !tone
          ? h("span", { class: "sw-rail-num" }, String(i + 1))
          : tone === "busy"
            ? h("span", { class: "sw-rail-num busy" }, h("span", { class: "sw-spinner" }))
            : h("span", { class: `sw-rail-num ${tone}`, html: tone === "ok" ? ICON.check : ICON.alert });
      items.push(
        h(
          "button",
          { class: "sw-rail-item", type: "button", "aria-current": current ? "step" : null, onclick: () => goTo(s.id) },
          num,
          h("span", { class: "sw-rail-label", title: s.label }, s.label),
          mode ? h("span", { class: "sw-rail-mode" }, mode) : null,
        ),
      );
    });
    return h("nav", { class: "sw-rail", "aria-label": "Setup steps" }, items);
  }

  function buildFooter() {
    const steps = M.wizardSteps(fmt());
    const i = steps.findIndex((s) => s.id === step);
    const prev = steps[i - 1];
    const next = steps[i + 1];
    return h(
      "div",
      { class: "sw-footer" },
      prev ? h("button", { class: "sw-btn secondary", type: "button", onclick: () => goTo(prev.id) }, "← ", prev.label) : null,
      h("span", { class: "sw-spacer" }),
      next ? h("button", { class: "sw-btn", type: "button", onclick: () => goTo(next.id) }, "Next: ", next.label, " →") : null,
    );
  }

  function buildStep() {
    switch (step) {
      case "about":
        return stepAbout();
      case "basics":
        return stepBasics();
      case "modes":
        return stepModes();
      case "review":
        return stepReview();
      default:
        return stepElement(step);
    }
  }

  function stepHead(title, sub, right) {
    return h(
      "div",
      { class: "sw-step-head" },
      h("div", null, h("h2", { tabindex: "-1", dataset: { fid: "step-heading" } }, title), sub ? h("p", { class: "sw-sub" }, sub) : null),
      right || null,
    );
  }

  // ── form helpers ───────────────────────────────────────────────────────

  function field(text, forId, control, o = {}) {
    return h(
      "div",
      { class: `sw-field${o.span ? " span-all" : ""}` },
      h(forId ? "label" : "span", { class: "sw-label", for: forId || null }, text, o.hint ? h("span", { class: "sw-hint" }, o.hint) : null),
      control,
      o.help ? h("span", { class: "sw-help" }, o.help) : null,
    );
  }

  function textField(fid, text, value, onValue, o = {}) {
    const id = `f-${fid.replace(/[^a-z0-9]+/gi, "-")}`;
    const common = {
      id,
      dataset: { fid },
      disabled: o.disabled,
      value,
      placeholder: o.placeholder,
      oninput: (e) => onValue(e.target.value),
      onchange: o.onchange,
    };
    const control = o.input
      ? h("input", { ...common, class: "sw-input" })
      : h("textarea", { ...common, class: `sw-textarea${(o.rows || 3) <= 2 ? " sm" : ""}`, rows: o.rows || 3 });
    return field(text, id, control, { hint: o.hint, span: o.span, help: o.help });
  }

  /// An aria-label that names characters is a template: "{{<character id>}}"
  /// resolves to that character's current name, and paintName refreshes it
  /// in place as the name is typed.
  function fillTpl(tpl) {
    const chars = M.normalizeCharacters(draft.elements.characters);
    return tpl.replace(/\{\{([^}]+)\}\}/g, (_m, id) => {
      const c = chars.find((x) => x.id === id);
      return (c && c.name.trim()) || "Unnamed character";
    });
  }

  function ariaOf(o, suffix = "") {
    if (o.ariaTpl) return fillTpl(o.ariaTpl + suffix);
    if (o.ariaLabel) return o.ariaLabel + suffix;
    return suffix ? `Value${suffix}` : undefined;
  }

  function withTpl(dataset, o, suffix = "") {
    return o.ariaTpl ? { ...dataset, ariaTpl: o.ariaTpl + suffix } : dataset;
  }

  /// A plain <select>; an unknown current value (older data, an AI draft)
  /// stays selectable instead of silently disappearing.
  function select(fid, value, options, onPick, o = {}) {
    const list = options.map((x) => (typeof x === "string" ? { value: x, label: x } : x));
    const known = !value || list.some((x) => x.value === value);
    return h(
      "select",
      {
        id: o.id,
        class: "sw-select",
        dataset: withTpl({ fid }, o),
        disabled: o.disabled,
        "aria-label": ariaOf(o),
        value: value || "",
        onchange: (e) => onPick(e.target.value),
      },
      o.placeholder === null ? null : h("option", { value: "" }, o.placeholder || "Choose…"),
      known ? null : h("option", { value }, o.unknownLabel ? o.unknownLabel(value) : value),
      list.map((x) => h("option", { value: x.value }, x.label)),
    );
  }

  /// A <select> of common values plus "Other…", which reveals a text box
  /// for anything not in the list.
  function choice(fid, value, options, onPick, o = {}) {
    value = value || "";
    const list = options.map((x) => (typeof x === "string" ? { value: x, label: x } : x));
    const custom = value !== "" && !list.some((x) => x.value === value);
    const other = otherOpen.has(fid) || custom;
    const sel = h(
      "select",
      {
        id: o.id,
        class: "sw-select",
        dataset: withTpl({ fid }, o),
        disabled: o.disabled,
        "aria-label": ariaOf(o),
        value: other ? "__other" : value,
        onchange: (e) => {
          const v = e.target.value;
          if (v === "__other") {
            otherOpen.add(fid);
            focusFid = `${fid}.other`;
            render();
            return;
          }
          otherOpen.delete(fid);
          onPick(v, false);
        },
      },
      h("option", { value: "" }, o.placeholder || "Choose…"),
      list.map((x) => h("option", { value: x.value }, x.label)),
      h("option", { value: "__other" }, "Other…"),
    );
    if (!other) return sel;
    return h(
      "div",
      { class: "sw-choice" },
      sel,
      h("input", {
        class: "sw-input",
        dataset: withTpl({ fid: `${fid}.other` }, o, " (your own)"),
        disabled: o.disabled,
        value,
        placeholder: "Type your own",
        "aria-label": ariaOf(o, " (your own)"),
        oninput: (e) => onPick(e.target.value, true),
      }),
    );
  }

  /// An editable list of strings. `o.get()` reads the live list (handlers
  /// outlive the render that made them); `onChange(next, typing)`.
  function stringList(fid, items, onChange, o) {
    const add = (at) => {
      const next = o.get().slice();
      next.splice(at, 0, "");
      focusFid = `${fid}.${at}`;
      onChange(next, false);
    };
    const rows = items.map((it, i) =>
      h(
        "div",
        { class: "sw-list-row" },
        h("span", { class: "sw-list-num", "aria-hidden": "true" }, `${i + 1}.`),
        h(o.multiline ? "textarea" : "input", {
          class: o.multiline ? "sw-textarea sm" : "sw-input",
          rows: o.multiline ? 2 : null,
          dataset: { fid: `${fid}.${i}` },
          disabled: o.disabled,
          value: it,
          placeholder: o.placeholder,
          "aria-label": `${o.itemLabel} ${i + 1}`,
          oninput: (e) => {
            const next = o.get().slice();
            next[i] = e.target.value;
            onChange(next, true);
          },
          onkeydown: o.multiline
            ? null
            : (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(i + 1);
                }
              },
        }),
        o.disabled
          ? null
          : h("button", {
              class: "sw-icon-btn danger",
              type: "button",
              "aria-label": `Remove ${o.itemLabel} ${i + 1}`,
              html: ICON.x,
              onclick: () => onChange(o.get().filter((_, j) => j !== i), false),
            }),
      ),
    );
    return h(
      "div",
      null,
      items.length ? h("div", { class: "sw-list" }, rows) : h("div", { class: "sw-empty" }, o.emptyText),
      o.disabled
        ? null
        : h(
            "div",
            { class: "sw-add-row" },
            h(
              "button",
              { class: "sw-btn ghost sm", type: "button", onclick: () => add(o.get().length) },
              h("span", { class: "sw-seg-icon", html: ICON.plus }),
              `Add ${o.itemLabel}`,
            ),
          ),
    );
  }

  function removeControl(key, what, onRemove) {
    if (confirm === key) {
      return h(
        "span",
        { class: "sw-confirm" },
        `Remove ${what}?`,
        h(
          "button",
          {
            class: "sw-btn sm danger",
            type: "button",
            onclick: () => {
              confirm = null;
              onRemove();
            },
          },
          "Remove",
        ),
        h(
          "button",
          {
            class: "sw-btn sm secondary",
            type: "button",
            onclick: () => {
              confirm = null;
              render();
            },
          },
          "Keep",
        ),
      );
    }
    return h("button", {
      class: "sw-icon-btn danger",
      type: "button",
      "aria-label": `Remove ${what}`,
      title: `Remove ${what}`,
      html: ICON.trash,
      onclick: () => {
        confirm = key;
        render();
      },
    });
  }

  function modeControl(key) {
    const v = view(key);
    const disabled = readOnly || v.generating;
    return h(
      "div",
      { class: "sw-seg", role: "radiogroup", "aria-label": `Who writes ${label(key)}` },
      M.MODES.map((m) => {
        const on = v.mode === m.value;
        return h(
          "label",
          {
            class: `sw-seg-opt${on ? " on" : ""}${disabled ? " disabled" : ""}`,
            title: v.generating ? "The AI is working on this — wait for its draft." : null,
          },
          h("input", {
            type: "radio",
            name: `mode-${key}-${step}`,
            value: m.value,
            checked: on,
            disabled,
            dataset: { fid: `mode.${key}.${m.value}` },
            onchange: () => setMode(key, m.value),
          }),
          h("span", { class: "sw-seg-icon", html: m.icon }),
          m.label,
        );
      }),
    );
  }

  // ── steps: setup ───────────────────────────────────────────────────────

  function stepAbout() {
    return h(
      "section",
      { class: "sw-panel" },
      stepHead(
        "What is the story about?",
        "Pitch it the way you would to a friend: who it follows, what happens to them, and why it's worth reading. Every card the pipeline creates starts from this.",
      ),
      field(
        "Story idea",
        "f-about",
        h("textarea", {
          id: "f-about",
          class: "sw-textarea lg",
          rows: 9,
          dataset: { fid: "about" },
          disabled: readOnly,
          value: draft.about,
          placeholder:
            "A courier in a drowned city is hired to deliver a letter addressed to her future self. Everyone who has carried it before her is dead…",
          oninput: (e) => {
            draft.about = e.target.value;
            markDirty("about");
          },
        }),
        { help: "A paragraph or two is plenty. Anything you leave open, the AI can fill in for you to review." },
      ),
    );
  }

  function stepBasics() {
    const b = draft.basics;
    const set = (key, value, typing) => {
      draft.basics = { ...draft.basics, [key]: value };
      markDirty(`basics.${key}`);
      if (key === "title") paintTitle();
      if (!typing) render();
    };
    return h(
      "section",
      { class: "sw-panel" },
      stepHead("Basics", "The frame every chapter is written in."),
      h(
        "div",
        { class: "sw-grid" },
        field(
          "Title",
          "f-title",
          h("input", {
            id: "f-title",
            class: "sw-input",
            dataset: { fid: "basics.title" },
            disabled: readOnly,
            value: b.title,
            placeholder: "Working title",
            oninput: (e) => set("title", e.target.value, true),
          }),
          { span: true },
        ),
        field("Genre", "f-genre", choice("basics.genre", b.genre, M.GENRES, (v, t) => set("genre", v, t), { id: "f-genre", disabled: readOnly, ariaLabel: "Genre" })),
        field(
          "Format",
          "f-format",
          select("basics.format", b.format, M.FORMATS, (v) => set("format", v), { id: "f-format", disabled: readOnly, placeholder: null }),
          { help: b.format === "vn" ? "Scenes, sprites, backgrounds and reader choices." : "Chapters of narrative prose." },
        ),
        field("Chapters", "f-chapters", chapterInput(), {
          help: `The pilot chapter comes first; once you approve it, the rest are written in parallel. Up to ${maxChapters}.`,
        }),
        field("Point of view", "f-pov", choice("basics.pov", b.pov, M.POVS, (v, t) => set("pov", v, t), { id: "f-pov", disabled: readOnly, ariaLabel: "Point of view" })),
        field("Tense", "f-tense", select("basics.tense", b.tense, M.TENSES, (v) => set("tense", v), { id: "f-tense", disabled: readOnly })),
        field("Tone", "f-tone", choice("basics.tone", b.tone, M.TONES, (v, t) => set("tone", v, t), { id: "f-tone", disabled: readOnly, ariaLabel: "Tone" })),
        field("Audience", "f-audience", select("basics.audience", b.audience, M.AUDIENCES, (v) => set("audience", v), { id: "f-audience", disabled: readOnly })),
        field("Rating", "f-rating", select("basics.rating", b.rating, M.RATINGS, (v) => set("rating", v), { id: "f-rating", disabled: readOnly })),
      ),
    );
  }

  function chapterInput() {
    const fid = "basics.chapter_count";
    const n = draft.basics.chapter_count;
    const setN = (v) => {
      draft.basics = { ...draft.basics, chapter_count: v };
      delete fieldErrors[fid];
      markDirty(fid);
    };
    const bump = (d) => {
      const cur = Number.isInteger(n) ? n : 1;
      setN(Math.min(maxChapters, Math.max(1, cur + d)));
      render();
    };
    const paintError = () => {
      const node = container.querySelector(`[data-errfor="${fid}"]`);
      if (node) node.textContent = fieldErrors[fid] || "";
    };
    return h(
      "div",
      null,
      h(
        "div",
        { class: "sw-number" },
        h("button", {
          class: "sw-icon-btn",
          type: "button",
          "aria-label": "Fewer chapters",
          disabled: readOnly || n <= 1,
          html: ICON.minus,
          onclick: () => bump(-1),
        }),
        h("input", {
          id: "f-chapters",
          class: "sw-input",
          type: "number",
          min: 1,
          max: maxChapters,
          step: 1,
          inputmode: "numeric",
          dataset: { fid },
          disabled: readOnly,
          value: String(n),
          oninput: (e) => {
            const raw = e.target.value.trim();
            const v = Number(raw);
            if (raw !== "" && Number.isInteger(v) && v >= 1 && v <= maxChapters) setN(v);
            else fieldErrors[fid] = `Enter a whole number from 1 to ${maxChapters}.`;
            paintError();
          },
        }),
        h("button", {
          class: "sw-icon-btn",
          type: "button",
          "aria-label": "More chapters",
          disabled: readOnly || n >= maxChapters,
          html: ICON.plus,
          onclick: () => bump(1),
        }),
      ),
      h("span", { class: "sw-field-error", role: "alert", dataset: { errfor: fid } }, fieldErrors[fid] || ""),
    );
  }

  function stepModes() {
    return h(
      "section",
      { class: "sw-panel" },
      stepHead(
        "Who writes what?",
        "Choose who writes each part. AI drafts and generated parts come back to you for review and approval before the pipeline starts.",
        readOnly
          ? null
          : select(
              "modes.all",
              "",
              M.MODES.map((m) => ({ value: m.value, label: m.label })),
              (v) => {
                if (!v) return;
                for (const k of M.ELEMENT_KEYS) {
                  if (view(k).generating || draft.modes[k] === v) continue;
                  draft.modes = { ...draft.modes, [k]: v };
                  markDirty(`modes.${k}`);
                }
                render();
              },
              { placeholder: "Set all to…", ariaLabel: "Set every element to one mode" },
            ),
      ),
      h(
        "div",
        { class: "sw-modes" },
        M.ELEMENTS.map((e) =>
          h(
            "div",
            { class: "sw-mode-row" },
            h(
              "div",
              null,
              h(
                "h3",
                null,
                h("button", { class: "sw-linkbtn", type: "button", onclick: () => goTo(e.key) }, label(e.key)),
                badge(view(e.key).badge),
              ),
              h("p", null, M.elementBlurb(e.key, fmt())),
            ),
            modeControl(e.key),
          ),
        ),
      ),
    );
  }

  // ── steps: elements ────────────────────────────────────────────────────

  function stepElement(key) {
    const v = view(key);
    const meta = M.elementMeta(key);
    // "AI generates" hides the editor until there's something to review.
    const show = v.mode !== "generate" || v.filled || v.status === "ai_draft" || v.status === "approved";
    const disabled = readOnly || v.generating;
    const modeBlock = h(
      "div",
      null,
      h("div", { class: "sw-section-head" }, modeControl(key)),
      aiBanner(key, v),
    );
    let body;
    switch (meta.kind) {
      case "style":
        body = styleEditor(show, disabled, modeBlock);
        break;
      case "banned":
        body = bannedEditor(show, disabled, modeBlock);
        break;
      default:
        body = [modeBlock, show ? simpleEditor(key, meta.kind, disabled) : null];
    }
    return h("section", { class: "sw-panel" }, stepHead(label(key), M.elementBlurb(key, fmt()), badge(v.badge)), body);
  }

  function aiBanner(key, v) {
    if (readOnly || v.mode === "write") return null;
    const genBusy = busy.has(`gen:${key}`);
    const drafting = v.mode === "draft";
    const genBtn = (text) =>
      h(
        "button",
        { class: "sw-btn sm", type: "button", disabled: genBusy, onclick: () => generate([key]) },
        genBusy ? h("span", { class: "sw-spinner" }) : h("span", { class: "sw-seg-icon", html: ICON.spark }),
        text,
      );
    const regen = () => {
      if (confirm === `regen:${key}`) {
        return h(
          "span",
          { class: "sw-confirm" },
          "Send it back to the AI?",
          h(
            "button",
            {
              class: "sw-btn sm",
              type: "button",
              onclick: () => {
                confirm = null;
                generate([key]);
              },
            },
            drafting ? "Redraft" : "Regenerate",
          ),
          h(
            "button",
            {
              class: "sw-btn sm secondary",
              type: "button",
              onclick: () => {
                confirm = null;
                render();
              },
            },
            "Cancel",
          ),
        );
      }
      return h(
        "button",
        {
          class: "sw-btn sm secondary",
          type: "button",
          disabled: genBusy,
          onclick: () => {
            confirm = `regen:${key}`;
            render();
          },
        },
        drafting ? "Redraft…" : "Regenerate…",
      );
    };
    if (v.generating) {
      return banner("busy", [
        h("strong", null, drafting ? "The AI is drafting this." : "The AI is generating this."),
        " A card on the project board is working on it; the result comes back here for your review.",
      ]);
    }
    if (v.stale) {
      return banner(
        "err",
        [h("strong", null, "The AI card closed without a draft."), " Try again, or switch to “I write it”."],
        [genBtn("Try again")],
      );
    }
    if (v.status === "ai_draft") {
      return banner(
        "warn",
        [h("strong", null, "AI draft ready."), " Review and edit it below, then approve it."],
        [
          h(
            "button",
            {
              class: "sw-btn sm",
              type: "button",
              disabled: !v.filled || busy.has(`approve:${key}`),
              title: v.filled ? null : "Nothing to approve yet",
              onclick: () => approve(key),
            },
            h("span", { class: "sw-seg-icon", html: ICON.check }),
            "Approve",
          ),
          regen(),
        ],
      );
    }
    if (v.status === "approved") {
      return banner("ok", [h("strong", null, "Approved."), " The pipeline uses this as written. You can still edit it."], [regen()]);
    }
    if (drafting) {
      return banner(
        "info",
        [
          h("strong", null, "AI drafts, you edit."),
          " Add notes or a rough start below if you like, then let the AI draft it. You review the draft before the pipeline starts.",
        ],
        [
          genBtn("Draft with AI"),
          v.filled
            ? h(
                "button",
                { class: "sw-btn sm secondary", type: "button", disabled: busy.has(`approve:${key}`), onclick: () => approve(key) },
                "Use mine as is",
              )
            : null,
        ],
      );
    }
    return banner(
      "info",
      [
        h("strong", null, "AI generates."),
        " It works from your story idea, the basics and the other elements. You review the result before the pipeline starts.",
      ],
      [genBtn("Generate with AI")],
    );
  }

  function simpleEditor(key, kind, disabled) {
    switch (kind) {
      case "text":
      case "markdown":
        return textElement(key, kind, disabled);
      case "list":
        return themesEditor(disabled);
      case "characters":
        return charactersEditor(disabled);
      case "relationships":
        return relationshipsEditor(disabled);
      case "endings":
        return endingsEditor(disabled);
      default:
        return null;
    }
  }

  const TEXT_HINTS = {
    premise: {
      label: "Premise",
      placeholder: "When … , a … must … — or …",
      help: "Two or three sentences.",
    },
    plot_outline: {
      label: "Outline (markdown)",
      placeholder: "## Chapter 1: The letter\n- Mara takes the job nobody else will touch.\n- …\n\n## Chapter 2: …",
      help: null,
    },
    setting: {
      label: "Setting (markdown)",
      placeholder: "A drowned city, a hundred years after the flood…\n\n## Places\n- The Sunken Market — …\n\n## Rules\n- …",
      help: "Summary, key places (name + what it looks, sounds and smells like), and the world's rules.",
    },
  };

  function textElement(key, kind, disabled) {
    const t = TEXT_HINTS[key];
    const help =
      key === "plot_outline"
        ? `Cover all ${draft.basics.chapter_count} chapters: one “## Chapter N: title” heading each, scenes as bullets.`
        : t.help;
    return field(
      t.label,
      `f-${key}`,
      h("textarea", {
        id: `f-${key}`,
        class: `sw-textarea ${kind === "markdown" ? "tall mono" : "lg"}`,
        dataset: { fid: `elements.${key}` },
        disabled,
        value: M.asText(draft.elements[key]),
        placeholder: t.placeholder,
        oninput: (e) => {
          draft.elements = { ...draft.elements, [key]: e.target.value };
          markDirty(`elements.${key}`);
        },
      }),
      { help },
    );
  }

  function themesEditor(disabled) {
    const get = () => M.asStringList(draft.elements.themes);
    return stringList(
      "elements.themes",
      get(),
      (next, typing) => {
        draft.elements = { ...draft.elements, themes: next };
        markDirty("elements.themes");
        if (!typing) render();
      },
      { get, itemLabel: "theme", placeholder: "e.g. Loyalty that costs more than it gives", disabled, emptyText: "No themes yet." },
    );
  }

  function charactersEditor(disabled) {
    const chars = M.normalizeCharacters(draft.elements.characters);
    const commit = (next, typing) => {
      draft.elements = { ...draft.elements, characters: next };
      markDirty("elements.characters");
      if (!typing) render();
    };
    const mutate = (fn, typing) => {
      const list = M.normalizeCharacters(draft.elements.characters);
      fn(list);
      commit(list, typing);
    };
    const remove = (id) => {
      const r = M.removeCharacter(
        M.normalizeCharacters(draft.elements.characters),
        M.normalizeRelationships(draft.elements.relationships),
        id,
      );
      const relsBefore = M.normalizeRelationships(draft.elements.relationships).length;
      draft.elements = { ...draft.elements, characters: r.characters };
      markDirty("elements.characters");
      if (r.relationships.length !== relsBefore) {
        draft.elements = { ...draft.elements, relationships: r.relationships };
        markDirty("elements.relationships");
      }
      render();
    };
    const add = () =>
      mutate((list) => {
        const c = M.newCharacter(list);
        list.push(c);
        collapsed.delete(c.id);
        focusFid = `char.${c.id}.name`;
      });
    const allCollapsed = chars.length > 0 && chars.every((c) => collapsed.has(c.id));
    return h(
      "div",
      null,
      h(
        "div",
        { class: "sw-section-head" },
        h("h3", null, `${chars.length} character${chars.length === 1 ? "" : "s"}`),
        chars.length > 1
          ? h(
              "button",
              {
                class: "sw-btn ghost sm",
                type: "button",
                onclick: () => {
                  for (const c of chars) allCollapsed ? collapsed.delete(c.id) : collapsed.add(c.id);
                  render();
                },
              },
              allCollapsed ? "Expand all" : "Collapse all",
            )
          : null,
      ),
      chars.length === 0
        ? h("div", { class: "sw-empty" }, "No characters yet. Start with the lead.")
        : h("div", { class: "sw-items" }, chars.map((c) => characterCard(c, chars, disabled, mutate, remove))),
      disabled
        ? null
        : h(
            "div",
            { class: "sw-add-row" },
            h("button", { class: "sw-btn secondary", type: "button", onclick: add }, h("span", { class: "sw-seg-icon", html: ICON.plus }), "Add character"),
          ),
    );
  }

  function characterCard(c, chars, disabled, mutate, remove) {
    const open = !collapsed.has(c.id);
    const name = c.name.trim() || "Unnamed character";
    const edit = (patch, typing) =>
      mutate((list) => {
        const i = list.findIndex((x) => x.id === c.id);
        if (i >= 0) list[i] = { ...list[i], ...patch };
      }, typing);
    const t = (key, text, o = {}) => textField(`char.${c.id}.${key}`, text, c[key] || "", (v) => edit({ [key]: v }, true), { disabled, ...o });
    const head = h(
      "div",
      { class: "sw-item-head" },
      h(
        "div",
        { class: "sw-item-title" },
        h("span", { class: "sw-avatar", "aria-hidden": "true", dataset: { initialsOf: c.id } }, initials(c.name)),
        h("strong", { dataset: { nameOf: c.id } }, name),
        c.role ? h("span", { class: "sw-muted" }, c.role) : null,
      ),
      disabled ? null : removeControl(`char:${c.id}`, name, () => remove(c.id)),
      h("button", {
        class: "sw-icon-btn",
        type: "button",
        "aria-expanded": open ? "true" : "false",
        "aria-label": `${open ? "Collapse" : "Expand"} ${name}`,
        html: open ? ICON.up : ICON.down,
        onclick: () => {
          if (open) collapsed.add(c.id);
          else collapsed.delete(c.id);
          render();
        },
      }),
    );
    if (!open) return h("div", { class: "sw-item" }, head);

    const others = chars.filter((o) => o.id !== c.id);
    const attitudes = others.map((o) => {
      const a = M.attitudeToward(c, o) || { attitude: "", reason: "" };
      const setA = (patch, typing) =>
        mutate((list) => {
          const i = list.findIndex((x) => x.id === c.id);
          const other = list.find((x) => x.id === o.id);
          if (i >= 0 && other) list[i] = M.withAttitude(list[i], other, patch);
        }, typing);
      const oname = o.name.trim() || "Unnamed character";
      return h(
        "div",
        { class: "sw-att" },
        h("div", { class: "sw-att-name", title: oname }, "→ ", h("span", { dataset: { nameOf: o.id } }, oname)),
        choice(`char.${c.id}.att.${o.id}`, a.attitude, M.ATTITUDES, (v, typing) => setA({ attitude: v }, typing), {
          disabled,
          placeholder: "Attitude…",
          ariaTpl: `{{${c.id}}}'s attitude to {{${o.id}}}`,
        }),
        h("input", {
          class: "sw-input",
          dataset: { fid: `char.${c.id}.why.${o.id}`, ariaTpl: `Why {{${c.id}}} feels that way about {{${o.id}}}` },
          disabled,
          value: a.reason,
          placeholder: "Why?",
          "aria-label": fillTpl(`Why {{${c.id}}} feels that way about {{${o.id}}}`),
          oninput: (e) => setA({ reason: e.target.value }, true),
        }),
      );
    });

    const getKnows = () => {
      const cur = M.normalizeCharacters(draft.elements.characters).find((x) => x.id === c.id);
      return cur ? cur.knows : [];
    };

    return h(
      "div",
      { class: "sw-item open" },
      head,
      h(
        "div",
        { class: "sw-item-body" },
        h(
          "div",
          { class: "sw-grid" },
          // Names show in this card's header and other cards' attitude rows:
          // repaint those live while typing, and re-render (labels that
          // mention the name) once focus has left the field — deferred, so
          // the render keeps focus wherever Tab/click moved it.
          textField(
            `char.${c.id}.name`,
            "Name",
            c.name,
            (v) => {
              edit({ name: v }, true);
              paintName(c.id, v);
            },
            { input: true, disabled, placeholder: "Full name", onchange: renderSoon },
          ),
          field(
            "Role",
            null,
            choice(`char.${c.id}.role`, c.role, M.ROLES, (v, typing) => edit({ role: v }, typing), { disabled, ariaTpl: `{{${c.id}}}'s role` }),
          ),
          t("personality", "Personality", { span: true, rows: 2, placeholder: "How they come across, and how they act under pressure" }),
        ),
        h(
          "div",
          { class: "sw-grid three" },
          t("values", "Values", { input: true, placeholder: "What they'd defend" }),
          t("fears", "Fears", { input: true, placeholder: "What they avoid" }),
          t("flaws", "Flaws", { input: true, placeholder: "What trips them up" }),
        ),
        h(
          "div",
          { class: "sw-grid" },
          t("want", "Want", { rows: 2, hint: "what they chase" }),
          t("need", "Need", { rows: 2, hint: "what they actually need" }),
        ),
        h(
          "div",
          { class: "sw-grid three" },
          t("lie", "Lie", { rows: 2, hint: "they believe" }),
          t("wound", "Wound", { rows: 2, hint: "that taught it" }),
          t("ghost", "Ghost", { rows: 2, hint: "the past event" }),
        ),
        h(
          "div",
          { class: "sw-grid" },
          t("speech_habit", "Speech habit", { input: true, hint: "just one", placeholder: "e.g. answers questions with questions" }),
          field(
            "Initial emotion",
            null,
            choice(`char.${c.id}.initial_emotion`, c.initial_emotion, M.EMOTIONS, (v, typing) => edit({ initial_emotion: v }, typing), {
              disabled,
              ariaTpl: `{{${c.id}}}'s initial emotion`,
            }),
          ),
        ),
        h(
          "div",
          null,
          h("div", { class: "sw-subhead" }, "Starting attitude to each other character"),
          others.length ? attitudes : h("p", { class: "sw-help" }, "Add more characters to set how this one sees them."),
        ),
        h(
          "div",
          null,
          h("div", { class: "sw-subhead" }, "What they know at the start"),
          stringList(`char.${c.id}.knows`, c.knows, (next, typing) => edit({ knows: next }, typing), {
            get: getKnows,
            itemLabel: "fact",
            placeholder: "e.g. Her brother is alive",
            disabled,
            emptyText: "Nothing yet. Add the secrets and facts this character starts with.",
          }),
        ),
        t("notes", "Notes", { rows: 2, hint: "optional" }),
      ),
    );
  }

  function relationshipsEditor(disabled) {
    const chars = M.normalizeCharacters(draft.elements.characters);
    const rels = M.normalizeRelationships(draft.elements.relationships);
    const commit = (next, typing) => {
      draft.elements = { ...draft.elements, relationships: next };
      markDirty("elements.relationships");
      if (!typing) render();
    };
    const edit = (id, patch, typing) => {
      const list = M.normalizeRelationships(draft.elements.relationships);
      const i = list.findIndex((r) => r.id === id);
      if (i >= 0) list[i] = { ...list[i], ...patch };
      commit(list, typing);
    };
    const options = chars.map((c) => ({ value: c.id, label: c.name.trim() || "Unnamed character" }));
    const ref = (r) => {
      const c = M.findCharacter(chars, r);
      return c ? c.id : r;
    };
    const unknownLabel = (v) => `${v} (not in Characters)`;
    const nameOf = (r) => {
      const c = M.findCharacter(chars, r);
      return c ? c.name.trim() || "Unnamed character" : r || "?";
    };
    const add = () => {
      const list = M.normalizeRelationships(draft.elements.relationships);
      const r = M.newRelationship(list);
      list.push(r);
      focusFid = `rel.${r.id}.a`;
      commit(list);
    };
    return h(
      "div",
      null,
      chars.length < 2 ? h("p", { class: "sw-help" }, "Relationships connect two characters — add at least two on the Characters step first.") : null,
      rels.length === 0
        ? h("div", { class: "sw-empty" }, "No relationships yet.")
        : h(
            "div",
            { class: "sw-items" },
            rels.map((r) =>
              h(
                "div",
                { class: "sw-rel-card" },
                h(
                  "div",
                  { class: "sw-rel" },
                  select(`rel.${r.id}.a`, ref(r.a), options, (v) => edit(r.id, { a: v }), { disabled, placeholder: "Character…", ariaLabel: "First character", unknownLabel }),
                  h("span", { class: "sw-rel-arrow", "aria-hidden": "true" }, "↔"),
                  select(`rel.${r.id}.b`, ref(r.b), options, (v) => edit(r.id, { b: v }), { disabled, placeholder: "Character…", ariaLabel: "Second character", unknownLabel }),
                  choice(`rel.${r.id}.kind`, r.kind, M.RELATIONSHIP_KINDS, (v, typing) => edit(r.id, { kind: v }, typing), {
                    disabled,
                    placeholder: "Kind…",
                    ariaLabel: "Kind of relationship",
                  }),
                  disabled
                    ? h("span")
                    : removeControl(`rel:${r.id}`, `${nameOf(r.a)} ↔ ${nameOf(r.b)}`, () =>
                        commit(M.normalizeRelationships(draft.elements.relationships).filter((x) => x.id !== r.id)),
                      ),
                ),
                h("input", {
                  class: "sw-input",
                  dataset: { fid: `rel.${r.id}.description` },
                  disabled,
                  value: r.description,
                  placeholder: "Where they stand at the start, and why",
                  "aria-label": "Relationship description",
                  oninput: (e) => edit(r.id, { description: e.target.value }, true),
                }),
              ),
            ),
          ),
      disabled
        ? null
        : h(
            "div",
            { class: "sw-add-row" },
            h(
              "button",
              { class: "sw-btn secondary", type: "button", disabled: chars.length < 2, onclick: add },
              h("span", { class: "sw-seg-icon", html: ICON.plus }),
              "Add relationship",
            ),
          ),
    );
  }

  function endingsEditor(disabled) {
    const vn = fmt() === "vn";
    const endings = M.normalizeEndings(draft.elements.endings);
    const commit = (next, typing) => {
      draft.elements = { ...draft.elements, endings: next };
      markDirty("elements.endings");
      if (!typing) render();
    };
    const edit = (id, patch, typing) => {
      const list = M.normalizeEndings(draft.elements.endings);
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list[i] = { ...list[i], ...patch };
      commit(list, typing);
    };
    const add = () => {
      const list = M.normalizeEndings(draft.elements.endings);
      const e = M.newEnding(list);
      list.push(e);
      focusFid = `end.${e.id}.name`;
      commit(list);
    };
    const noun = vn ? "ending or route" : "ending";
    return h(
      "div",
      null,
      endings.length === 0
        ? h("div", { class: "sw-empty" }, vn ? "No routes or endings yet." : "No ending yet.")
        : h(
            "div",
            { class: "sw-items" },
            endings.map((e) =>
              h(
                "div",
                { class: "sw-rel-card" },
                h(
                  "div",
                  { class: "sw-end-head" },
                  textField(`end.${e.id}.name`, "Name", e.name, (v) => edit(e.id, { name: v }, true), {
                    input: true,
                    disabled,
                    placeholder: vn ? "e.g. The Drowned Crown" : "e.g. Low tide",
                  }),
                  vn
                    ? field(
                        "Kind",
                        `f-end-${e.id}-kind`,
                        select(`end.${e.id}.kind`, e.kind, M.ENDING_KINDS, (v) => edit(e.id, { kind: v }), {
                          id: `f-end-${e.id}-kind`,
                          disabled,
                          placeholder: null,
                        }),
                      )
                    : null,
                  disabled
                    ? null
                    : removeControl(`end:${e.id}`, e.name.trim() || `this ${noun}`, () =>
                        commit(M.normalizeEndings(draft.elements.endings).filter((x) => x.id !== e.id)),
                      ),
                ),
                textField(`end.${e.id}.description`, "What happens", e.description, (v) => edit(e.id, { description: v }, true), {
                  rows: 3,
                  disabled,
                  placeholder: "Where the lead and the world are left, and what it cost",
                }),
                vn
                  ? textField(`end.${e.id}.conditions`, "Unlocked by", e.conditions, (v) => edit(e.id, { conditions: v }, true), {
                      input: true,
                      disabled,
                      placeholder: "The choices or flags that lead here",
                    })
                  : null,
              ),
            ),
          ),
      disabled
        ? null
        : h(
            "div",
            { class: "sw-add-row" },
            h("button", { class: "sw-btn secondary", type: "button", onclick: add }, h("span", { class: "sw-seg-icon", html: ICON.plus }), `Add ${noun}`),
          ),
    );
  }

  function styleEditor(show, disabled, modeBlock) {
    const vn = fmt() === "vn";
    const entries = defaults.style_guide.filter((e) => vn || !e.vn_only);
    const overrides = draft.lesson_overrides || {};
    const changed = entries.filter((e) => overrides[e.id] !== undefined).length;
    const get = () => M.asStringList(draft.elements.style_rules);
    return [
      h(
        "div",
        { class: "sw-section" },
        h(
          "div",
          { class: "sw-section-head" },
          h(
            "div",
            { style: { flex: "1" } },
            h("h3", null, "Built-in style guide"),
            h(
              "p",
              { class: "sw-sub" },
              "Learned the hard way on earlier AI-written novels. Each writer and reviewer card gets the sections relevant to it. Rewrite a section for this story, or turn it off.",
            ),
          ),
          changed ? h("span", { class: "sw-badge busy" }, `${changed} changed`) : null,
        ),
        h("div", { class: "sw-lessons" }, entries.map((e) => lessonCard(e, overrides))),
      ),
      h(
        "div",
        { class: "sw-section" },
        h(
          "div",
          { class: "sw-section-head" },
          h(
            "div",
            { style: { flex: "1" } },
            h("h3", null, "This story's rules"),
            h(
              "p",
              { class: "sw-sub" },
              "Extra rules on top of the guide; they win where the two disagree. Feedback you give on the pilot or any chapter is added here too.",
            ),
          ),
        ),
        modeBlock,
        show
          ? stringList(
              "elements.style_rules",
              get(),
              (next, typing) => {
                draft.elements = { ...draft.elements, style_rules: next };
                markDirty("elements.style_rules");
                if (!typing) render();
              },
              {
                get,
                itemLabel: "rule",
                multiline: true,
                placeholder: "e.g. Mara never swears; she goes quiet instead.",
                disabled,
                emptyText: "No story-specific rules yet — the built-in guide applies as is.",
              },
            )
          : null,
      ),
    ];
  }

  function lessonCard(e, overrides) {
    const own = overrides[e.id];
    const state = own === undefined ? "default" : own === "" ? "off" : "edited";
    const editing = editingLessons.has(e.id) && state !== "off";
    const text = state === "edited" ? own : e.text;
    const set = (value, typing) => {
      const next = { ...(draft.lesson_overrides || {}) };
      if (value === undefined) delete next[e.id];
      else next[e.id] = value;
      draft.lesson_overrides = next;
      markDirty("lesson_overrides");
      if (!typing) render();
    };
    const btn = (text, onclick) => h("button", { class: "sw-btn ghost sm", type: "button", onclick }, text);
    return h(
      "div",
      { class: `sw-lesson ${state}` },
      h(
        "div",
        { class: "sw-lesson-head" },
        h("strong", null, e.title),
        h(
          "span",
          { class: `sw-badge${state === "edited" ? " busy" : ""}` },
          state === "default" ? "Default" : state === "off" ? "Off for this story" : "Edited",
        ),
        readOnly
          ? null
          : [
              state !== "off"
                ? btn(editing ? "Done" : "Edit", () => {
                    if (editing) editingLessons.delete(e.id);
                    else {
                      editingLessons.add(e.id);
                      focusFid = `lesson.${e.id}`;
                    }
                    render();
                  })
                : null,
              btn(state === "off" ? "Turn on" : "Turn off", () => {
                editingLessons.delete(e.id);
                set(state === "off" ? undefined : "");
              }),
              state === "edited" ? btn("Reset", () => set(undefined)) : null,
            ],
      ),
      editing
        ? h("textarea", {
            class: "sw-textarea mono",
            dataset: { fid: `lesson.${e.id}` },
            value: text,
            "aria-label": `${e.title} (style guide text)`,
            oninput: (ev) => {
              const value = ev.target.value;
              set(value === e.text ? undefined : value, true);
            },
          })
        : h("div", { class: "sw-lesson-preview" }, plain(text, e.title)),
    );
  }

  function bannedEditor(show, disabled, modeBlock) {
    const words = M.asStringList(draft.elements.banned_words);
    const commit = (next) => {
      draft.elements = { ...draft.elements, banned_words: next };
      markDirty("elements.banned_words");
      render();
    };
    const onAdd = (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const incoming = input.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!incoming.length) return;
      const cur = M.asStringList(draft.elements.banned_words);
      const builtIn = new Set(defaults.banned_words.map((w) => w.toLowerCase()));
      const seen = new Set(cur.map((w) => w.toLowerCase()));
      const next = cur.slice();
      const already = [];
      for (const w of incoming) {
        const k = w.toLowerCase();
        if (builtIn.has(k)) already.push(w);
        if (seen.has(k) || builtIn.has(k)) continue;
        seen.add(k);
        next.push(w);
      }
      notice = already.length ? { tone: "info", text: `Already banned by the built-in list: ${already.join(", ")}.` } : null;
      focusFid = "banned.input";
      commit(next);
    };
    return [
      h(
        "div",
        { class: "sw-section" },
        h(
          "div",
          { class: "sw-section-head" },
          h("div", { style: { flex: "1" } }, h("h3", null, "Always banned"), h("p", { class: "sw-sub" }, "Built in: the words AI prose leans on most.")),
        ),
        h("div", { class: "sw-chips" }, defaults.banned_words.map((w) => h("span", { class: "sw-chip fixed" }, w))),
      ),
      h(
        "div",
        { class: "sw-section" },
        h("div", { class: "sw-section-head" }, h("h3", null, "This story's banned words")),
        modeBlock,
        show
          ? [
              words.length
                ? h(
                    "div",
                    { class: "sw-chips" },
                    words.map((w, i) =>
                      h(
                        "span",
                        { class: "sw-chip" },
                        w,
                        disabled
                          ? null
                          : h("button", {
                              type: "button",
                              "aria-label": `Remove “${w}”`,
                              html: ICON.x,
                              onclick: () => commit(M.asStringList(draft.elements.banned_words).filter((_, j) => j !== i)),
                            }),
                      ),
                    ),
                  )
                : h("div", { class: "sw-empty" }, "None yet — only the built-in list applies."),
              disabled
                ? null
                : h(
                    "form",
                    { class: "sw-chip-input", onsubmit: onAdd },
                    h("input", {
                      class: "sw-input",
                      dataset: { fid: "banned.input" },
                      placeholder: "Add a word or phrase (comma-separate several)",
                      "aria-label": "Banned word or phrase",
                    }),
                    h("button", { class: "sw-btn secondary", type: "submit" }, "Add"),
                  ),
            ]
          : null,
      ),
    ];
  }

  // ── step: review ───────────────────────────────────────────────────────

  function stepReview() {
    const engine = server.engine;
    const blockers = M.startBlockers(draft, engine, maxChapters);
    const warnings = M.startWarnings(draft);
    const pending = M.ELEMENT_KEYS.filter((k) => view(k).needsGenerate);
    const anyBusy = pending.some((k) => busy.has(`gen:${k}`));
    const b = draft.basics;
    const formatLabel = (M.FORMATS.find((f) => f.value === b.format) || { label: b.format }).label;
    const item = (dt, dd) => h("div", null, h("dt", null, dt), h("dd", { title: dd || null }, dd || "—"));
    const modeLabel = (m) => (M.MODES.find((x) => x.value === m) || { label: m }).label;
    const action = (k, v) => {
      if (readOnly) return null;
      if (v.needsReview) return h("button", { class: "sw-btn sm", type: "button", onclick: () => goTo(k) }, "Review");
      if (v.needsGenerate) {
        return h(
          "button",
          { class: "sw-btn sm secondary", type: "button", disabled: busy.has(`gen:${k}`), onclick: () => generate([k]) },
          busy.has(`gen:${k}`) ? h("span", { class: "sw-spinner" }) : null,
          v.mode === "draft" ? "Draft" : "Generate",
        );
      }
      return h("button", { class: "sw-btn ghost sm", type: "button", onclick: () => goTo(k) }, "Open");
    };
    return h(
      "div",
      null,
      h(
        "section",
        { class: "sw-panel" },
        stepHead(
          "Review & start",
          "Check the setup, approve the AI's drafts, then start the pipeline: story records first, then a pilot chapter for you to approve before the rest are written.",
        ),
        h(
          "dl",
          { class: "sw-summary" },
          item("Title", b.title),
          item("Genre", b.genre),
          item("Format", formatLabel),
          item("Chapters", String(b.chapter_count)),
          item("Point of view", b.pov),
          item("Tense", b.tense),
          item("Tone", b.tone),
          item("Audience · rating", [b.audience, b.rating].filter(Boolean).join(" · ")),
        ),
        readOnly
          ? null
          : h(
              "div",
              { class: "sw-footer" },
              h("button", { class: "sw-btn ghost sm", type: "button", onclick: () => goTo("about") }, "Edit story idea"),
              h("button", { class: "sw-btn ghost sm", type: "button", onclick: () => goTo("basics") }, "Edit basics"),
            ),
      ),
      h(
        "section",
        { class: "sw-panel" },
        h(
          "div",
          { class: "sw-section-head" },
          h("h3", null, "Story elements"),
          pending.length && !readOnly
            ? h(
                "button",
                { class: "sw-btn sm", type: "button", disabled: anyBusy, onclick: () => generate(pending) },
                anyBusy ? h("span", { class: "sw-spinner" }) : h("span", { class: "sw-seg-icon", html: ICON.spark }),
                `Send ${pending.length} to the AI`,
              )
            : null,
        ),
        h(
          "table",
          { class: "sw-table" },
          h(
            "thead",
            null,
            h("tr", null, h("th", null, "Element"), h("th", null, "Who writes it"), h("th", null, "Status"), h("th", null, h("span", { class: "sw-sr" }, "Action"))),
          ),
          h(
            "tbody",
            null,
            M.ELEMENT_KEYS.map((k) => {
              const v = view(k);
              return h(
                "tr",
                null,
                h("td", null, h("button", { class: "sw-linkbtn", type: "button", onclick: () => goTo(k) }, label(k))),
                h("td", { class: "sw-muted" }, modeLabel(v.mode)),
                h("td", null, badge(v.badge)),
                h("td", null, action(k, v)),
              );
            }),
          ),
        ),
      ),
      h(
        "section",
        { class: "sw-panel" },
        blockers.length && !readOnly
          ? [
              h("div", { class: "sw-section-head" }, h("h3", null, "Before you can start")),
              h(
                "ul",
                { class: "sw-checklist" },
                blockers.map((x) => h("li", null, h("button", { class: "sw-linkbtn", type: "button", onclick: () => goTo(x.step) }, x.text))),
              ),
            ]
          : null,
        warnings.length && !readOnly
          ? h(
              "div",
              { class: blockers.length ? "sw-section" : null },
              h("div", { class: "sw-section-head" }, h("h3", null, "Worth a look")),
              h(
                "ul",
                { class: "sw-checklist warn" },
                warnings.map((x) => h("li", null, h("button", { class: "sw-linkbtn", type: "button", onclick: () => goTo(x.step) }, x.text))),
              ),
            )
          : null,
        h("div", { class: blockers.length || warnings.length ? "sw-section" : null }, startArea(blockers)),
      ),
    );
  }

  function startArea(blockers) {
    if (readOnly) return h("p", { class: "sw-muted" }, "The pipeline is running with this setup.");
    const starting = busy.has("start");
    if (confirm === "start") {
      return h(
        "div",
        { class: "sw-start" },
        h(
          "p",
          null,
          h("strong", null, "Start writing? "),
          "This creates the first card on the project board (the story records) and the pipeline takes it from there. The setup becomes read-only.",
        ),
        h(
          "button",
          { class: "sw-btn lg", type: "button", disabled: starting, onclick: start, dataset: { fid: "start.confirm" } },
          starting ? h("span", { class: "sw-spinner" }) : null,
          "Start pipeline",
        ),
        h(
          "button",
          {
            class: "sw-btn secondary lg",
            type: "button",
            disabled: starting,
            onclick: () => {
              confirm = null;
              render();
            },
          },
          "Cancel",
        ),
      );
    }
    const left = blockers.length;
    return h(
      "div",
      { class: "sw-start" },
      h("p", null, left ? `${left} thing${left === 1 ? "" : "s"} left before you can start.` : "Everything's ready."),
      h(
        "button",
        {
          class: "sw-btn lg",
          type: "button",
          disabled: left > 0,
          onclick: () => {
            confirm = "start";
            focusFid = "start.confirm";
            render();
          },
        },
        "Start pipeline…",
      ),
    );
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  const onHide = () => {
    if (document.visibilityState === "hidden" && dirty.size) flushSave().catch(() => {});
  };
  document.addEventListener("visibilitychange", onHide);

  render();

  return {
    update,
    notify(text, tone) {
      notice = { tone: tone || "info", text };
      render();
    },
    destroy() {
      destroyed = true;
      clearTimeout(saveTimer);
      document.removeEventListener("visibilitychange", onHide);
    },
  };
}
