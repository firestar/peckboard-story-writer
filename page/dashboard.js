// Story pipeline dashboard: the live view of the writing pipeline once the
// setup wizard has started it. A stage timeline (Records -> Pilot -> your
// review -> Chapters -> Review passes -> Final) with each stage's cards,
// worker status and "open session" links; a per-chapter progress grid; the
// owner's review (the gate banner, line notes on the chapter text, review
// rounds, Approve / Request changes); and viewers for the story records and
// the story's own rules.
//
// Store writes refetch /state (main.js -> update). The board's side of each
// card (step, blocked, worker session) comes from GET /cards, polled while
// the tab is visible and work is open — a worker picking up a card writes
// nothing to the plugin's store. Renders keep focus, caret and scroll.

import { h, clear } from "./dom.js";
import { getJSON, postJSON, openSession } from "./bridge.js";
import * as D from "./dash-model.js";

const CARDS_POLL_MS = 20000;
const CARDS_SOON_MS = 800;
const NOTICE_MS = 12000;

const svg = (body, sw = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  check: svg('<path d="M20 6 9 17l-5-5"/>', 2.5),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  open: svg('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  retry: svg('<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  dot: svg('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  left: svg('<path d="m15 6-6 6 6 6"/>'),
  right: svg('<path d="m9 6 6 6-6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  arrow: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
  pencil: svg('<path d="M16.5 3.5 20.5 7.5 8 20H4v-4z"/><path d="M4 21h16"/>'),
  xcircle: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  expand: svg('<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>'),
  shorten: svg('<path d="M10 4v6H4M14 20v-6h6M3 3l7 7M21 21l-7-7"/>'),
  send: svg('<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4z"/>'),
  note: svg('<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'),
};

// Grid cell glyph per status key; "working"/"revising" show a spinner,
// "pending" nothing.
const CELL_ICON = {
  done: "check",
  passed: "check",
  changes: "alert",
  flagged: "alert",
  failed: "x",
  missing: "alert",
  blocked: "lock",
  waiting: "clock",
  queued: "clock",
  open: "dot",
};

const STATUS_TONE = { done: "ok", active: "busy", blocked: "err", waiting: "warn", pending: "" };

const LEGEND = [
  ["passed", "ok", "Done"],
  ["working", "busy", "Working"],
  ["waiting", "muted", "Waiting"],
  ["blocked", "warn", "Blocked"],
  ["changes", "warn", "Changes requested / items found"],
  ["failed", "err", "Failed"],
  ["pending", "muted", "Not started"],
];

const TABS = [
  { id: "characters", label: "Characters" },
  { id: "coldreads", label: "Cold reads" },
  { id: "emotions", label: "Emotions & attitudes" },
  { id: "knowledge", label: "Who knows what" },
  { id: "unexplained", label: "Unexplained names" },
  { id: "setups", label: "Setups & payoffs" },
  { id: "choices", label: "Choices map", vn: true },
  { id: "glossary", label: "Glossary" },
  { id: "recaps", label: "Recaps" },
  { id: "rules", label: "Rules & feedback" },
];

const DRAWER_TABS = [
  { id: "text", label: "Text" },
  { id: "cold", label: "Cold read" },
  { id: "reviews", label: "Reviews" },
  { id: "scenes", label: "Scenes" },
  { id: "review", label: "Your review" },
];

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

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + "s"}`;
}

// ── chapter text (a small, safe subset of markdown, built as DOM) ─────────

function inline(s) {
  const out = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|`[^`\n]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(h("strong", null, t.slice(2, -2)));
    else if (t.startsWith("`")) out.push(h("code", null, t.slice(1, -1)));
    else out.push(h("em", null, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function joinLines(lines) {
  const out = [];
  lines.forEach((l, i) => {
    if (i) out.push(h("br"));
    out.push(...inline(l));
  });
  return out;
}

/// One block of chapter text as DOM, carrying its source line range so a
/// click or a selection resolves to the lines a review note anchors to.
function blockEl(b) {
  const at = { "data-line-start": String(b.start), "data-line-end": String(b.end) };
  if (b.type === "heading") return h(b.level <= 1 ? "h3" : "h4", { class: "sw-prose-h sw-block", ...at }, inline(b.text));
  if (b.type === "hr") return h("hr", { class: "sw-block", ...at });
  if (b.type === "quote") return h("blockquote", { class: "sw-block", ...at }, joinLines(b.lines));
  return h("p", { class: "sw-block", ...at }, joinLines(b.lines));
}

function renderProse(md) {
  return D.proseBlocks(md).map(blockEl);
}

/// A block's own text, for the quote a click (rather than a selection) puts
/// on a note — without the margin pin's count.
function blockText(el) {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1 && node.classList.contains("sw-pin")) continue;
    out += node.nodeType === 1 && node.tagName === "BR" ? "\n" : node.textContent || "";
  }
  return out.trim();
}

function blockOf(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return el ? el.closest("[data-line-start]") : null;
}
// ── the dashboard ────────────────────────────────────────────────────────

export function mountDashboard(container, opts) {
  const { defaults, P } = opts;
  let state = opts.state;
  let destroyed = false;

  // Live board status (GET /cards); null until the first load.
  let cards = null;
  let cardsSig = "";
  let cardsTimer = null;
  let cardsInflight = false;
  let cardsAt = null;
  let refreshedAt = new Date();
  let unitSig = unitSignature(state);

  // View state — survives every re-render.
  let stageSel = null; // null = follow the current stage
  let allUnits = false;
  let tab = "characters";
  let emoView = "emotions";
  let attChapter = null; // null = the latest chapter with a recorded state
  let kRoute = "all";
  let kAsOf = "latest";
  let setupFilter = "all";
  let glossaryQ = "";
  let crChapter = null; // records tab: null = the first chapter with open items
  let crCategory = "all"; // cold-read filters, shared by the drawer and the records tab
  let crStatus = "all";
  let unexFilter = "all";
  let notice = null; // {tone, text}
  let confirming = false; // the Approve confirmation is showing
  const busy = new Set(); // "approve", "export", "retry:<id>", "note", "note:<id>", "decide:<n>"
  // Owner review (SW-12): the note popover over a passage, the note being
  // edited, and the open "Request changes" form.
  let pop = null; // {chapter, start, end, quote, x, y, kind, draft, error}
  let editing = null; // {chapter, id, draft}
  let requesting = null; // {chapter, summary, toRules}
  let dragging = false; // a mouse button is held in the annotatable text (a selection in progress)
  let drawer = null; // {chapter, tab}
  let drawerOpenerFid = null;
  let drawerNotice = null;
  let drawerKey = null; // chapter:tab the drawer body's scroll belongs to
  const texts = new Map(); // chapter -> {revision, doc?, loading?, error?}
  let focusFid = null;

  const tip = h("div", { class: "sw-tip", role: "tooltip", hidden: true });
  document.body.appendChild(tip);

  // ── live data ──────────────────────────────────────────────────────────

  function unitSignature(st) {
    const units = (st && st.engine && st.engine.units) || {};
    return JSON.stringify(Object.values(units).map((u) => [u.id, u.status, u.card_id, u.attempt]));
  }

  /// Cards the engine points at that the last listing didn't include yet
  /// (created since) — worth a quick re-poll rather than the slow cadence.
  function unlisted() {
    return cards !== null && Object.values(D.engineOf(state).units).some((u) => u.card_id && !cards[u.card_id]);
  }

  function wantsCards() {
    const units = Object.values(D.engineOf(state).units);
    if (cards === null) return units.some((u) => u.card_id);
    return units.some((u) => u.card_id && (u.status === "open" || !cards[u.card_id]));
  }

  function scheduleCards(ms) {
    clearTimeout(cardsTimer);
    if (destroyed) return;
    cardsTimer = setTimeout(() => {
      if (destroyed) return;
      if (document.visibilityState !== "hidden" && wantsCards()) loadCards();
      else scheduleCards(CARDS_POLL_MS);
    }, ms);
  }

  async function loadCards() {
    if (destroyed || cardsInflight) return;
    cardsInflight = true;
    clearTimeout(cardsTimer);
    try {
      const r = await getJSON(`${P}/cards`);
      const next = (r && r.cards) || {};
      const sig = JSON.stringify(next);
      cardsAt = new Date();
      if (cards === null || sig !== cardsSig) {
        cards = next;
        cardsSig = sig;
        renderSoon();
      } else paintLive();
    } catch (_e) {
      // keep the last good snapshot; the next poll retries
    } finally {
      cardsInflight = false;
      scheduleCards(unlisted() ? CARDS_SOON_MS * 3 : CARDS_POLL_MS);
    }
  }

  function update(next) {
    if (destroyed) return;
    // A picked stage is about the moment; once the pipeline moves on, the
    // stage detail follows the new current stage again.
    if (D.currentStep(next) !== D.currentStep(state)) stageSel = null;
    state = next;
    refreshedAt = new Date();
    const sig = unitSignature(state);
    if (sig !== unitSig) {
      unitSig = sig;
      scheduleCards(CARDS_SOON_MS);
    }
    if (drawer) ensureText(drawer.chapter);
    renderSoon();
  }

  function ensureText(n) {
    const sum = D.chapterSummary(state, n);
    if (!sum) return;
    const cur = texts.get(n);
    if (cur && cur.revision === sum.revision && !cur.error) return;
    texts.set(n, { revision: sum.revision, loading: true });
    getJSON(`${P}/chapter?n=${n}`)
      .then((r) => texts.set(n, { revision: sum.revision, doc: r.chapter }))
      .catch((e) => texts.set(n, { revision: sum.revision, error: msg(e) }))
      .finally(() => renderSoon());
  }

  // ── actions ────────────────────────────────────────────────────────────

  /// Show an action's outcome. Successes fade after a while (they're about
  /// the moment); errors stay until dismissed.
  function say(n, inDrawer) {
    if (inDrawer && drawer) drawerNotice = n;
    else notice = n;
    if (n.tone !== "ok") return;
    setTimeout(() => {
      if (destroyed || (notice !== n && drawerNotice !== n)) return;
      if (notice === n) notice = null;
      if (drawerNotice === n) drawerNotice = null;
      renderSoon();
    }, NOTICE_MS);
  }

  async function act(key, run, okText, inDrawer) {
    if (busy.has(key)) return;
    busy.add(key);
    render();
    try {
      await run();
      say({ tone: "ok", text: okText }, inDrawer);
      await opts.refresh();
    } catch (e) {
      say({ tone: "err", text: msg(e) }, inDrawer);
    } finally {
      busy.delete(key);
      render();
    }
  }

  function approve(inDrawer) {
    const g = D.gateInfo(state);
    confirming = false;
    return act(
      "approve",
      () => postJSON(`${P}/pipeline/approve`),
      g.remaining
        ? `Pilot approved. The other ${plural(g.remaining, "chapter")} are being written in parallel.`
        : "Pilot approved. The review passes start next.",
      inDrawer,
    );
  }

  // ── owner review (SW-12) ───────────────────────────────────────────────────

  /// Open the note popover over a passage (lines start..end of chapter n).
  function openPop(n, start, end, quote, rect) {
    const text = String(quote || "").replace(/\s+/g, " ").trim().slice(0, 1000);
    pop = { chapter: n, start, end, quote: text, x: rect.left, y: rect.bottom + 6, h: rect.height, kind: null, draft: "", error: null };
    editing = null;
    focusFid = "pop.verb.0";
    render();
  }

  function closePop(back) {
    if (!pop) return;
    const start = pop.start;
    pop = null;
    if (back) focusFid = `blk.${start}`;
    render();
  }

  async function addNote() {
    if (!pop || busy.has("note")) return;
    const kind = D.noteKind(pop.kind);
    const body = String(pop.draft || "").trim();
    if (kind.needsBody && !body) {
      pop.error = "Say what should change.";
      focusFid = "pop.body";
      render();
      return;
    }
    const p = pop;
    busy.add("note");
    p.error = null;
    render();
    try {
      await postJSON(`${P}/review/note`, { chapter: p.chapter, kind: kind.id, start_line: p.start, end_line: p.end, quote: p.quote, body });
      if (pop === p) pop = null;
      focusFid = `blk.${p.start}`;
      await opts.refresh();
    } catch (e) {
      if (pop === p) {
        p.error = msg(e);
        focusFid = "pop.body";
      }
    } finally {
      busy.delete("note");
      render();
    }
  }

  async function noteCall(key, path, body, after) {
    if (busy.has(key)) return;
    busy.add(key);
    render();
    try {
      await postJSON(`${P}${path}`, body);
      if (after) after();
      await opts.refresh();
    } catch (e) {
      say({ tone: "err", text: msg(e) }, true);
    } finally {
      busy.delete(key);
      render();
    }
  }

  function saveEdit() {
    const e = editing;
    if (!e || !String(e.draft || "").trim() && D.noteKind(e.kind).needsBody) return;
    return noteCall(`note:${e.id}`, "/review/note/update", { chapter: e.chapter, id: e.id, body: e.draft }, () => {
      if (editing === e) editing = null;
    });
  }

  function deleteNote(n, id) {
    if (editing && editing.id === id) editing = null;
    return noteCall(`note:${id}`, "/review/note/delete", { chapter: n, id });
  }

  function approveChapter(n) {
    return act(`decide:${n}`, () => postJSON(`${P}/review/decide`, { chapter: n, decision: "approve" }), `Chapter ${n} approved.`, true);
  }

  function requestChanges(n) {
    const r = requesting;
    if (!r || r.chapter !== n) return;
    const info = D.reviewInfo(state, n, cards);
    const count = info.notes.length;
    if (!count && !String(r.summary || "").trim()) return;
    return act(
      `decide:${n}`,
      async () => {
        await postJSON(`${P}/review/decide`, { chapter: n, decision: "changes", summary: r.summary || "", add_to_rules: !!r.toRules });
        if (requesting === r) requesting = null;
      },
      `Sent ${count ? plural(count, "note") : "your note"} to the writer. The redraft is cold-read again, then comes back to you as round ${info.roundNo + 1}.`,
      true,
    );
  }

  function retry(unit) {
    return act(`retry:${unit || "all"}`, () => postJSON(`${P}/pipeline/retry`, unit ? { unit } : {}), "Retrying — a fresh card is on its way to the board.");
  }

  async function exportStory() {
    if (busy.has("export")) return;
    busy.add("export");
    render();
    try {
      const r = await getJSON(`${P}/export`);
      if (!r.markdown) {
        say({ tone: "warn", text: "Nothing to export yet — no chapter has been written." });
      } else {
        const title = (state.brief && state.brief.basics && state.brief.basics.title) || "story";
        download(`${D.fileSlug(title)}.md`, r.markdown);
        say({ tone: "ok", text: `Exported ${plural(r.chapters.length, "chapter")} as Markdown.` });
      }
    } catch (e) {
      say({ tone: "err", text: `Couldn't export: ${msg(e)}` });
    } finally {
      busy.delete("export");
      render();
    }
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = h("a", { href: url, download: name, hidden: true });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function openChapter(n, which, fromFid, focus, request) {
    drawerOpenerFid = fromFid || null;
    if (!drawer || drawer.chapter !== n) {
      pop = null;
      editing = null;
      requesting = null;
    }
    drawer = { chapter: n, tab: which || "text" };
    drawerNotice = null;
    confirming = false;
    if (request) requesting = requesting && requesting.chapter === n ? requesting : { chapter: n, summary: "", toRules: true };
    focusFid = focus || "drawer.close";
    ensureText(n);
    render();
  }

  function closeDrawer() {
    drawer = null;
    drawerNotice = null;
    confirming = false;
    pop = null;
    editing = null;
    requesting = null;
    focusFid = drawerOpenerFid;
    render();
  }

  // ── rendering ──────────────────────────────────────────────────────────

  /// Re-render once the current event has settled — but not while a
  /// <select> has focus (its popup may be open); wait for it to blur.
  function renderSoon() {
    setTimeout(() => {
      // Rebuilding the DOM mid-drag would drop the owner's half-made selection.
      if (dragging) {
        document.addEventListener("mouseup", renderSoon, { once: true });
        return;
      }
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
        sel = null;
      }
    }
    focusFid = null;
    const y = window.scrollY;
    const body = container.querySelector(".sw-drawer-body");
    const bodyY = body ? body.scrollTop : 0;
    const wrapX = Array.from(container.querySelectorAll("[data-scroll-key]")).map((n) => [n.dataset.scrollKey, n.scrollLeft]);
    hideTip();
    clear(container);
    container.appendChild(build());
    const key = drawer ? `${drawer.chapter}:${drawer.tab}` : null;
    if (drawer) for (const n of buildDrawer(!body)) container.appendChild(n);
    document.documentElement.classList.toggle("sw-noscroll", !!drawer);
    window.scrollTo(0, y);
    const nb = container.querySelector(".sw-drawer-body");
    if (nb && key === drawerKey) nb.scrollTop = bodyY;
    drawerKey = key;
    for (const [k, x] of wrapX) {
      const n = container.querySelector(`[data-scroll-key="${attrEscape(k)}"]`);
      if (n) n.scrollLeft = x;
    }
    placePop();
    // The drawer is modal: if the control that had focus went away (a form
    // that closed on send), keep focus inside it so Escape and Tab still work.
    const lost = !document.activeElement || document.activeElement === document.body;
    const fallback = () => {
      const body = drawer && document.activeElement === document.body ? container.querySelector(".sw-drawer-body") : null;
      if (body) body.focus({ preventScroll: true });
    };
    if (!fid) {
      if (lost) fallback();
      return;
    }
    const n = container.querySelector(`[data-fid="${attrEscape(fid)}"]`);
    if (!n) {
      if (lost) fallback();
      return;
    }
    if (!n) return;
    n.focus({ preventScroll: !!keepFid });
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
    const summaries = D.stageSummaries(state, cards);
    return h(
      "div",
      { class: "sw-dash" },
      buildHeader(),
      notice ? buildNotice() : null,
      buildGate(),
      buildProblems(),
      buildFinished(),
      buildStats(summaries),
      buildPipeline(summaries),
      buildChapters(),
      buildRecords(),
    );
  }

  // ── small pieces ───────────────────────────────────────────────────────

  function icon(name, cls) {
    return h("span", { class: cls || "sw-ico", "aria-hidden": "true", html: ICON[name] });
  }

  function badge(tone, text, spin) {
    return h("span", { class: `sw-badge ${tone || ""}` }, spin ? h("span", { class: "sw-spinner", "aria-hidden": "true" }) : null, text);
  }

  function statusBadge(st) {
    return badge(st.tone === "muted" ? "" : st.tone, st.label, st.key === "working" || st.key === "revising");
  }

  function banner(tone, text, actions, extra) {
    const ic = tone === "ok" ? ICON.check : tone === "info" ? ICON.info : ICON.alert;
    return h(
      "div",
      { class: `sw-banner ${tone}${extra ? " " + extra : ""}`, role: tone === "err" ? "alert" : "status" },
      h("span", { class: "sw-banner-icon", html: ic }),
      h("div", { class: "sw-banner-text" }, text),
      actions && actions.filter(Boolean).length ? h("div", { class: "sw-banner-actions" }, actions) : null,
    );
  }

  function dismiss(onClick) {
    return h("button", { class: "sw-icon-btn", type: "button", "aria-label": "Dismiss", html: ICON.x, onclick: onClick });
  }

  function sessionBtn(sessionId, label) {
    if (!sessionId) return null;
    return h(
      "button",
      { class: "sw-btn sm secondary", type: "button", title: "Open the worker's session in PeckBoard", onclick: () => openSession(sessionId) },
      icon("open"),
      label || "Open session",
    );
  }

  function retryBtn(unit) {
    const key = `retry:${unit.id}`;
    return h(
      "button",
      { class: "sw-btn sm", type: "button", disabled: busy.has(key), dataset: { fid: key }, onclick: () => retry(unit.id) },
      busy.has(key) ? h("span", { class: "sw-spinner" }) : icon("retry"),
      "Retry",
    );
  }

  function panelHead(id, title, sub, right) {
    return h(
      "div",
      { class: "sw-dash-head" },
      h("div", { class: "sw-dash-head-text" }, h("h2", { id }, title), sub ? h("p", { class: "sw-sub" }, sub) : null),
      right || null,
    );
  }

  function empty(text, action) {
    return h("div", { class: "sw-empty" }, text, action ? h("div", { class: "sw-empty-action" }, action) : null);
  }

  function seg(fidBase, value, options, onPick, label) {
    return h(
      "div",
      { class: "sw-seg", role: "radiogroup", "aria-label": label },
      options.map((o) =>
        h(
          "button",
          {
            class: `sw-seg-opt${o.value === value ? " on" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": o.value === value ? "true" : "false",
            dataset: { fid: `${fidBase}.${o.value}` },
            onclick: () => {
              focusFid = `${fidBase}.${o.value}`;
              onPick(o.value);
            },
          },
          o.label,
          o.count !== undefined ? h("span", { class: "sw-count" }, String(o.count)) : null,
        ),
      ),
    );
  }

  function selectBox(fid, labelText, value, options, onPick) {
    const id = `f-${fid.replace(/[^a-z0-9]+/gi, "-")}`;
    return h(
      "label",
      { class: "sw-inline-field", for: id },
      h("span", { class: "sw-inline-label" }, labelText),
      h(
        "select",
        {
          id,
          class: "sw-select",
          dataset: { fid },
          value: String(value),
          onchange: (e) => {
            onPick(e.target.value);
            render();
          },
        },
        options.map((o) => h("option", { value: String(o.value) }, o.label)),
      ),
    );
  }

  // ── header, banners, stats ─────────────────────────────────────────────

  function liveText() {
    const t = (cardsAt && cardsAt > refreshedAt ? cardsAt : refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `Live · updated ${t}`;
  }

  function paintLive() {
    const n = container.querySelector(".sw-live-text");
    if (n) n.textContent = liveText();
  }

  function buildHeader() {
    const b = (state.brief && state.brief.basics) || {};
    const o = D.overall(state);
    const meta = [b.format === "vn" ? "Visual novel" : "Prose novel", plural(o.chapters, "chapter"), b.genre, [b.pov, b.tense].filter(Boolean).join(", ")].filter(Boolean);
    const exporting = busy.has("export");
    return h(
      "header",
      { class: "sw-top sw-dash-top" },
      h(
        "div",
        { class: "sw-top-title" },
        h("span", { class: "sw-kicker" }, "Story pipeline"),
        h("h1", { class: "sw-title" }, (b.title || "").trim() || "Untitled story"),
        h("span", { class: "sw-dash-meta" }, meta.join(" · ")),
      ),
      h(
        "span",
        { class: "sw-live", title: "Updates when the story changes; card status refreshes every 20 seconds while work is open." },
        h("span", { class: "dot", "aria-hidden": "true" }),
        h("span", { class: "sw-live-text" }, liveText()),
      ),
      h(
        "button",
        { class: "sw-btn secondary", type: "button", disabled: o.written === 0 || exporting, dataset: { fid: "export" }, onclick: exportStory, title: o.written ? "Download every written chapter as one Markdown file" : "No chapter written yet" },
        exporting ? h("span", { class: "sw-spinner" }) : icon("download"),
        "Export",
      ),
      h("button", { class: "sw-btn secondary", type: "button", dataset: { fid: "setup" }, onclick: opts.onShowSetup }, "View setup"),
    );
  }

  function buildNotice() {
    return banner(
      notice.tone,
      notice.text,
      [
        dismiss(() => {
          notice = null;
          render();
        }),
      ],
      "sw-notice",
    );
  }

  /// Why Approve waits while the round has notes not sent (SW-15).
  function unsentHint(count) {
    const them = count === 1 ? "it" : "them";
    return `Send your ${plural(count, "note")} with Request changes, or delete ${them}, before approving.`;
  }

  function approveControls(where) {
    const g = D.gateInfo(state);
    const approving = busy.has("approve");
    if (confirming) {
      return [
        h(
          "span",
          { class: "sw-confirm-text" },
          g.remaining ? `Write the other ${plural(g.remaining, "chapter")} from this pilot?` : "Approve the pilot and start the review passes?",
        ),
        h(
          "button",
          { class: "sw-btn", type: "button", disabled: approving, dataset: { fid: `${where}.approve.yes` }, onclick: () => approve(where === "drawer") },
          approving ? h("span", { class: "sw-spinner" }) : icon("check"),
          "Approve pilot",
        ),
        h(
          "button",
          {
            class: "sw-btn secondary",
            type: "button",
            disabled: approving,
            dataset: { fid: `${where}.approve.no` },
            onclick: () => {
              confirming = false;
              focusFid = `${where}.approve`;
              render();
            },
          },
          "Cancel",
        ),
      ];
    }
    return [
      h(
        "button",
        {
          class: "sw-btn",
          type: "button",
          disabled: !g.canApprove || approving,
          title: g.redraft
            ? "The pilot is being redrafted from your notes — approve the new draft once it's back."
            : g.openPilotRevision
              ? "A pilot revision is still open — approve once it's in."
              : !g.coldClear
                ? "Opens once every cold-read item on the pilot is fixed."
                : g.unsent
                  ? unsentHint(g.unsent)
                  : null,
          dataset: { fid: `${where}.approve` },
          onclick: () => {
            confirming = true;
            focusFid = `${where}.approve.yes`;
            render();
          },
        },
        icon("check"),
        "Approve pilot…",
      ),
    ];
  }

  /// What the pilot's cold read found, in a phrase: "2 confusion items and 1
  /// over-explained line".
  function coldFound(p) {
    const parts = [];
    if (p.confusion.total) parts.push(plural(p.confusion.total, "confusion item"));
    if (p.obvious.total) parts.push(plural(p.obvious.total, "over-explained line"));
    return parts.join(" and ");
  }

  function gateColdLine(g) {
    const p = g.cold;
    if (!p.doc) return null;
    const text = p.total ? `Cold read: ${coldFound(p)} found — ${p.open ? `${p.fixed} of ${p.total} fixed` : "all fixed"}.` : "Cold read: a fresh reader found nothing to fix.";
    return h("span", { class: `sw-gate-cold ${p.open ? "open" : "clear"}` }, icon(p.open ? "alert" : "check"), text);
  }

  /// "Round 2 · 3 notes not sent yet · 1 earlier round" under the gate text.
  function roundLine(r) {
    if (!r.rounds.length) return null;
    const earlier = r.rounds.filter((x) => x.round < r.roundNo).length;
    const parts = [`Round ${r.roundNo}`, r.notes.length ? `${plural(r.notes.length, "note")} not sent yet` : "no notes yet"];
    if (earlier) parts.push(`${plural(earlier, "earlier round")} in Your review`);
    return h("span", { class: "sw-gate-round" }, icon("note"), parts.join(" · "));
  }

  function buildGate() {
    const g = D.gateInfo(state);
    if (g.notReady) return buildGateNotReady(g);
    if (!g.active) return null;
    if (g.redraft) return buildGateRedraft();
    const r = g.review;
    const unsent = r.notes.length;
    const text = g.openPilotRevision
      ? [h("strong", null, "The pilot is being revised from your feedback. "), "Read the new version once it's in, then approve it or request more changes."]
      : [
          h("strong", null, "Your pilot chapter is ready. "),
          "Read it and leave notes on any passage. ",
          unsent
            ? `You have ${plural(unsent, "note")} not sent yet — request changes to send ${unsent === 1 ? "it" : "them"} to the writer, or delete ${unsent === 1 ? "it" : "them"}, before approving.`
            : g.remaining
              ? `Approve it to write the other ${plural(g.remaining, "chapter")} in parallel — or request changes for a redraft first.`
              : "Approve it to start the review passes — or request changes for a redraft first.",
        ];
    return h(
      "section",
      { class: "sw-gate", "aria-label": "Your review" },
      h("span", { class: "sw-gate-icon", html: ICON.user }),
      h(
        "div",
        { class: "sw-gate-text" },
        h("span", { class: "sw-kicker" }, g.openPilotRevision ? "Your review · revision running" : `Waiting on you · round ${r.roundNo}`),
        h("p", null, text),
        h("div", { class: "sw-gate-lines" }, gateColdLine(g), roundLine(r)),
      ),
      h(
        "div",
        { class: "sw-gate-actions" },
        h(
          "button",
          { class: "sw-btn secondary", type: "button", dataset: { fid: "gate.read" }, onclick: () => openChapter(1, "text", "gate.read") },
          icon("book"),
          unsent ? "Review pilot" : "Read & review pilot",
        ),
        g.openPilotRevision
          ? null
          : h(
              "button",
              {
                class: "sw-btn secondary",
                type: "button",
                dataset: { fid: "gate.changes" },
                onclick: () => openChapter(1, "text", "gate.changes", "req.summary", true),
              },
              icon("send"),
              unsent ? `Request changes · ${unsent}` : "Request changes…",
            ),
        approveControls("gate"),
      ),
    );
  }

  /// The owner requested changes on the pilot: the writer's revision card,
  /// then the redraft's fresh cold read, run before it comes back as the
  /// next round. Readable, not approvable.
  function buildGateRedraft() {
    // gateInfo has no live card data; the phase needs it for the session.
    const r = D.reviewInfo(state, 1, cards);
    const ph = r.phase;
    const failed = ph.key === "failed";
    const sent = r.pending.notes.length;
    const what = [sent ? plural(sent, "note") : null, r.pending.summary ? "overall note" : null].filter(Boolean).join(" and ") || "notes";
    return h(
      "section",
      { class: `sw-gate redraft${failed ? " failed" : ""}`, "aria-label": "Your review — redraft running" },
      h("span", { class: "sw-gate-icon", html: failed ? ICON.alert : ICON.clock }),
      h(
        "div",
        { class: "sw-gate-text" },
        h("span", { class: "sw-kicker" }, `Your review · round ${r.pending.round} sent`),
        h(
          "p",
          null,
          h("strong", null, "The pilot is being redrafted from your review. "),
          `The writer works through your ${what}, then a fresh reader cold-reads the redraft. It comes back here as round ${r.pending.round + 1}.`,
        ),
        h(
          "span",
          { class: `sw-gate-phase${failed ? " failed" : ""}` },
          failed ? icon("alert") : h("span", { class: "sw-spinner", "aria-hidden": "true" }),
          `Now: ${ph.label}`,
          ph.status && ph.status.key !== "failed" ? statusBadge(ph.status) : null,
        ),
      ),
      h(
        "div",
        { class: "sw-gate-actions" },
        h("button", { class: "sw-btn secondary", type: "button", dataset: { fid: "gate.read" }, onclick: () => openChapter(1, "text", "gate.read") }, icon("book"), "Read pilot"),
        h("button", { class: "sw-btn secondary", type: "button", dataset: { fid: "gate.review" }, onclick: () => openChapter(1, "review", "gate.review") }, icon("note"), "Your review"),
        failed && ph.unit ? retryBtn(ph.unit) : sessionBtn(ph.status && ph.status.sessionId, "Open session"),
        h(
          "button",
          { class: "sw-btn", type: "button", disabled: true, title: "Opens once the redraft is back as the next round.", dataset: { fid: "gate.approve" } },
          icon("lock"),
          "Approve pilot…",
        ),
      ),
    );
  }

  /// The pilot is written but its cold read (C1) and fixes (C2) haven't
  /// cleared: shown as not ready — readable, not approvable.
  function buildGateNotReady(g) {
    const p = g.cold;
    const failed = (p.read && p.read.status === "failed") || (p.fix && p.fix.status === "failed");
    let detail;
    if (failed) detail = "The cold-read chain stopped — retry the failed card below to carry on.";
    else if (!p.read || p.read.status !== "done")
      detail = "A fresh reader who has never seen the brief, records or cards is cold-reading it first, as a player would.";
    else detail = `The writer is fixing what the cold reader found (${coldFound(p)}): ${p.fixed} of ${p.total} fixed. Approving opens once every item is fixed.`;
    return h(
      "section",
      { class: `sw-gate not-ready${failed ? " failed" : ""}`, "aria-label": "Your review — not ready yet" },
      h("span", { class: "sw-gate-icon", html: failed ? ICON.alert : ICON.clock }),
      h(
        "div",
        { class: "sw-gate-text" },
        h("span", { class: "sw-kicker" }, "Your review · not ready yet"),
        h("p", null, h("strong", null, "The pilot is written, but it isn't ready for your review. "), detail),
        p.total ? h("div", { class: "sw-gate-meter" }, meter(p.fixed, p.total, "Cold-read items fixed")) : null,
      ),
      h(
        "div",
        { class: "sw-gate-actions" },
        h("button", { class: "sw-btn secondary", type: "button", dataset: { fid: "gate.read" }, onclick: () => openChapter(1, "text", "gate.read") }, icon("book"), "Read pilot"),
        p.doc
          ? h(
              "button",
              { class: "sw-btn secondary", type: "button", dataset: { fid: "gate.cold" }, onclick: () => openChapter(1, "cold", "gate.cold") },
              icon("search"),
              "Cold-read report",
            )
          : null,
        h(
          "button",
          { class: "sw-btn", type: "button", disabled: true, title: "Opens once the pilot's cold read is done and every item is fixed.", dataset: { fid: "gate.approve" } },
          icon("lock"),
          "Approve pilot…",
        ),
      ),
    );
  }

  function buildProblems() {
    const out = [];
    const engine = D.engineOf(state);
    const failed = D.failedUnits(state);
    if (failed.length) {
      const names = failed.slice(0, 3).map(D.unitLabel).join(", ") + (failed.length > 3 ? `, and ${failed.length - 3} more` : "");
      const all = busy.has("retry:all");
      out.push(
        banner(
          "err",
          [h("strong", null, `${plural(failed.length, "card")} closed without finishing: `), names, ". The pipeline waits until they're retried."],
          [
            failed.length === 1
              ? retryBtn(failed[0])
              : h(
                  "button",
                  { class: "sw-btn sm", type: "button", disabled: all, dataset: { fid: "retry:all" }, onclick: () => retry(null) },
                  all ? h("span", { class: "sw-spinner" }) : icon("retry"),
                  `Retry all ${failed.length}`,
                ),
          ],
        ),
      );
    }
    if (engine.note && /engine error|failed to unblock/.test(engine.note)) {
      out.push(banner("warn", [h("strong", null, "Pipeline note: "), engine.note], null));
    }
    return out.length ? out : null;
  }

  function buildFinished() {
    if (!D.engineOf(state).finished) return null;
    return banner(
      "ok",
      [h("strong", null, "The story is finished. "), "Every chapter has been through every review pass."],
      [
        h(
          "button",
          { class: "sw-btn sm", type: "button", disabled: busy.has("export"), onclick: exportStory },
          busy.has("export") ? h("span", { class: "sw-spinner" }) : icon("download"),
          "Download manuscript",
        ),
      ],
    );
  }

  function meter(done, total, label) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return h(
      "div",
      { class: "sw-meter", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(done) },
      h("span", { style: { width: `${pct}%` } }),
    );
  }

  function buildStats(summaries) {
    const o = D.overall(state);
    const current = summaries.find((s) => s.id === D.currentStep(state)) || null;
    const units = Object.values(D.engineOf(state).units).filter((u) => u.kind !== "generate");
    const open = units.filter((u) => u.status === "open").length;
    const working = cards ? units.filter((u) => D.unitStatus(u, cards).key === "working").length : null;
    const rv = D.reviewTotals(state);
    const tile = (label, value, sub, extra) =>
      h("div", { class: "sw-stat" }, h("span", { class: "sw-stat-label" }, label), h("span", { class: "sw-stat-value" }, value), extra || null, sub ? h("span", { class: "sw-stat-sub" }, sub) : null);
    return h(
      "section",
      { class: "sw-stats", "aria-label": "Progress" },
      tile("Stage", current ? current.label : "—", current ? D.STAGE_STATUS_LABEL[current.status] : null),
      tile("Chapters written", h("span", null, String(o.written), h("small", null, ` / ${o.chapters}`)), null, meter(o.written, o.chapters, "Chapters written")),
      tile("Review passes", h("span", null, String(o.passes), h("small", null, ` / ${o.passesTotal}`)), null, meter(o.passes, o.passesTotal, "Review passes done")),
      tile("Working now", working === null ? "—" : String(working), `${plural(open, "card")} open`),
      tile(
        "Your review",
        h("span", null, String(rv.sent), h("small", null, " notes sent")),
        rv.redrafting
          ? `${plural(rv.redrafting, "redraft")} running`
          : rv.unsent
            ? `${plural(rv.unsent, "note")} not sent yet`
            : rv.sent
              ? "All redrafts in"
              : rv.approved
                ? `${plural(rv.approved, "draft")} approved`
                : "Nothing sent yet",
      ),
    );
  }

  // ── pipeline ───────────────────────────────────────────────────────────

  function buildPipeline(summaries) {
    const current = D.currentStep(state);
    const sel = stageSel || (current === "setup" ? "records" : current);
    const s = summaries.find((x) => x.id === sel) || summaries[0];
    return h(
      "section",
      { class: "sw-panel sw-dash-panel", "aria-labelledby": "sw-h-pipeline" },
      panelHead("sw-h-pipeline", "Pipeline", "Each stage runs on cards on the project board. Pick a stage to see its cards and workers."),
      h(
        "ol",
        { class: "sw-steps" },
        summaries.map((x, i) => stepItem(x, i, x.id === sel, x.id === current)),
      ),
      stageDetail(s),
    );
  }

  function stepItem(x, i, selected, current) {
    let dot;
    if (x.status === "done") dot = h("span", { class: "sw-step-dot", html: ICON.check });
    else if (x.status === "blocked") dot = h("span", { class: "sw-step-dot", html: ICON.alert });
    else if (x.status === "waiting") dot = h("span", { class: "sw-step-dot", html: ICON.user });
    else dot = h("span", { class: "sw-step-dot" }, String(i + 1));
    return h(
      "li",
      { class: `sw-step ${x.status}${selected ? " sel" : ""}`, "aria-current": current ? "step" : null },
      h(
        "button",
        {
          class: "sw-step-btn",
          type: "button",
          "aria-pressed": selected ? "true" : "false",
          "aria-controls": "sw-stage-detail",
          dataset: { fid: `stage.${x.id}` },
          onclick: () => {
            stageSel = x.id;
            allUnits = false;
            render();
          },
        },
        dot,
        h(
          "span",
          { class: "sw-step-text" },
          h("span", { class: "sw-step-label" }, x.label),
          h("span", { class: "sw-step-sub", title: x.sub || null }, x.sub || D.STAGE_STATUS_LABEL[x.status]),
          h("span", { class: "sw-sr" }, ` — ${D.STAGE_STATUS_LABEL[x.status]}`),
        ),
      ),
    );
  }

  function stageDetail(s) {
    const engine = D.engineOf(state);
    const g = D.gateInfo(state);
    let actions = null;
    if (s.id === "pilot_review" && g.active) {
      actions = h("div", { class: "sw-stage-actions" }, h("button", { class: "sw-btn secondary", type: "button", onclick: () => openChapter(1, "text") }, icon("book"), "Review pilot"));
    } else if ((s.id === "cold_read" || s.id === "cold_fix") && g.cold.doc) {
      actions = h(
        "div",
        { class: "sw-stage-actions" },
        h("button", { class: "sw-btn secondary", type: "button", dataset: { fid: `stage.${s.id}.report` }, onclick: () => openChapter(1, "cold", `stage.${s.id}.report`) }, icon("search"), "Cold-read report"),
      );
    } else if (s.id === "final" && engine.finished) {
      actions = h("div", { class: "sw-stage-actions" }, h("button", { class: "sw-btn", type: "button", disabled: busy.has("export"), onclick: exportStory }, icon("download"), "Download manuscript"));
    }
    return h(
      "div",
      { class: "sw-stage-detail", id: "sw-stage-detail", role: "region", "aria-label": `${s.label} — cards` },
      h(
        "div",
        { class: "sw-stage-head" },
        h(
          "div",
          null,
          h("h3", null, s.label, " ", badge(STATUS_TONE[s.status], D.STAGE_STATUS_LABEL[s.status], s.status === "active" && s.working > 0)),
          h("p", { class: "sw-sub" }, s.blurb),
        ),
        actions,
      ),
      s.note ? h("p", { class: "sw-stage-note" }, h("span", { class: "sw-stage-note-k" }, "Latest note"), s.note) : null,
      unitsTable(s),
    );
  }

  function unitsEmpty(s) {
    const engine = D.engineOf(state);
    const prev = D.STAGES[D.STAGES.findIndex((x) => x.id === s.id) - 1];
    if (s.id === "pilot_review") return "No revisions yet. When you request changes on the pilot or any chapter, the revision card shows up here.";
    if (s.id === "final") return engine.finished ? null : "Unlocks once every chapter has been through every review pass.";
    if ((s.id === "cold_read" || s.id === "cold_fix") && s.status === "done" && s.sub === "Not run")
      return "Not run for this story — its pilot reached your review before cold reads were part of the pipeline.";
    if (s.id === "cold_fix" && s.sub === "Nothing to fix") return "The cold reader reported nothing to fix, so no fix card was needed.";
    if (s.status === "pending") return prev ? `Starts after ${prev.label.toLowerCase()}.` : "Not started yet.";
    if (s.id === "chapters" && s.total === 0) return "This story has a single chapter — the pilot.";
    return "The first card is being created…";
  }

  function unitsTable(s) {
    if (!s.units.length) {
      const text = unitsEmpty(s);
      return text ? empty(text) : null;
    }
    const active = s.units.filter((u) => u.status !== "done");
    const long = s.units.length > 14;
    const shown = long && !allUnits ? active : s.units;
    const toggle = long
      ? h(
          "div",
          { class: "sw-units-toggle" },
          seg(
            "units",
            allUnits ? "all" : "active",
            [
              { value: "active", label: "Open & failed", count: active.length },
              { value: "all", label: "All", count: s.units.length },
            ],
            (v) => {
              allUnits = v === "all";
              render();
            },
            "Which cards to show",
          ),
        )
      : null;
    return h(
      "div",
      null,
      toggle,
      shown.length
        ? h(
            "div",
            { class: "sw-table-wrap" },
            h(
              "table",
              { class: "sw-table sw-units" },
              h(
                "thead",
                null,
                h("tr", null, h("th", null, "Work"), h("th", null, "Board card"), h("th", null, "Status"), h("th", null, h("span", { class: "sw-sr" }, "Actions"))),
              ),
              h("tbody", null, shown.map(unitRow)),
            ),
          )
        : empty(`All ${plural(s.units.length, "card")} in this stage are done.`),
    );
  }

  function unitRow(u) {
    const st = D.unitStatus(u, cards);
    const card = st.card;
    const fid = `unit.${u.id}`;
    const label = D.unitLabel(u);
    return h(
      "tr",
      { class: `sw-unit ${st.key}` },
      h(
        "td",
        null,
        u.chapter
          ? h("button", { class: "sw-linkbtn", type: "button", dataset: { fid }, onclick: () => openChapter(u.chapter, drawerTabFor(u), fid) }, label)
          : h("span", { class: "sw-unit-name" }, label),
        u.attempt > 1 ? h("span", { class: "sw-muted sw-unit-attempt" }, ` · attempt ${u.attempt}`) : null,
      ),
      h(
        "td",
        { class: "sw-unit-card" },
        card
          ? [h("span", { class: "sw-unit-title", title: card.title }, card.title), h("span", { class: "sw-step-chip" }, String(card.step || "").replace(/_/g, " "))]
          : h("span", { class: "sw-muted" }, u.card_id ? (st.key === "missing" ? "—" : "Loading…") : "Not on the board yet"),
      ),
      h("td", null, statusBadge(st), st.detail ? h("div", { class: "sw-unit-detail", title: st.detail }, st.detail) : null),
      h("td", { class: "sw-unit-actions" }, sessionBtn(st.sessionId), u.status === "failed" ? retryBtn(u) : null),
    );
  }

  function drawerTabFor(u) {
    if (u.kind === "review") return "reviews";
    if (u.kind === "cold_read" || u.kind === "cold_read_fix") return "cold";
    return "text";
  }

  // ── chapter grid ───────────────────────────────────────────────────────

  function cellIcon(c) {
    if (c.key === "working" || c.key === "revising") return h("span", { class: "sw-spinner", "aria-hidden": "true" });
    const name = CELL_ICON[c.key];
    return name ? h("span", { class: "sw-cell-ico", "aria-hidden": "true", html: ICON[name] }) : null;
  }

  function cellBtn(n, what, c, which) {
    const detail = c.detail ? String(c.detail).replace(/\s+/g, " ").slice(0, 180) : "";
    const fid = `cell.${n}.${what}`;
    return h(
      "button",
      {
        class: `sw-cell ${c.tone} k-${c.key}`,
        type: "button",
        "aria-label": `Chapter ${n}, ${what}: ${c.label}${detail ? `. ${detail}` : ""}`,
        dataset: { fid, tip: `${what} — ${c.label}`, tipDetail: detail || "" },
        onclick: () => openChapter(n, which, fid),
      },
      cellIcon(c),
    );
  }

  /// The grid's notes column: where your review of the chapter stands.
  function reviewChip(r) {
    const v = r.review;
    if (v.pending) {
      return v.phase && v.phase.key === "failed" ? badge("err", "Redraft stopped") : badge("busy", `Redrafting · round ${v.pending.round}`, true);
    }
    if (v.open && v.notes.length) {
      return h("span", { class: "sw-note-chip", title: `Round ${v.open.round}: ${plural(v.notes.length, "note")} not sent yet` }, icon("note"), String(v.notes.length));
    }
    if (v.approved) return h("span", { class: "sw-note-chip ok", title: `You approved this draft (round ${v.last.round})` }, icon("check"), "Approved");
    if (v.rounds.length) return h("span", { class: "sw-note-chip", title: plural(v.rounds.length, "review round") }, icon("note"), `R${v.roundNo}`);
    return null;
  }
  function buildChapters() {
    const rows = D.chapterRows(state, cards);
    const legend = h(
      "ul",
      { class: "sw-legend", "aria-label": "Legend" },
      LEGEND.map(([key, tone, label]) => h("li", null, h("span", { class: `sw-cell sw-cell-sm ${tone} k-${key}`, "aria-hidden": "true" }, cellIcon({ key })), label)),
    );
    return h(
      "section",
      { class: "sw-panel sw-dash-panel", "aria-labelledby": "sw-h-chapters" },
      panelHead(
        "sw-h-chapters",
        "Chapters",
        "Draft, cold read and review progress per chapter. Pick a chapter to read it, see its cold read and reviews, or leave your notes on it.",
      ),
      legend,
      h(
        "div",
        { class: "sw-cgrid-wrap", dataset: { scrollKey: "cgrid" } },
        h(
          "table",
          { class: "sw-cgrid" },
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h("th", { scope: "col", rowspan: "2", class: "sw-cgrid-ch" }, "Chapter"),
              h("th", { scope: "col", rowspan: "2" }, "Draft"),
              h("th", { scope: "colgroup", colspan: "2", class: "sw-cgrid-group sw-cgrid-cold" }, "Cold read"),
              h("th", { scope: "colgroup", colspan: String(D.PASSES.length), class: "sw-cgrid-group" }, "Review passes"),
              h("th", { scope: "col", rowspan: "2", class: "sw-cgrid-notes" }, "Notes"),
            ),
            h(
              "tr",
              null,
              h("th", { scope: "col", class: "sw-cgrid-pass sw-cgrid-cold", title: "A fresh reader reads the chapter cold, as a player would" }, "Read"),
              h("th", { scope: "col", class: "sw-cgrid-pass sw-cgrid-cold-end", title: "The writer fixes every item the cold reader found" }, "Fixes"),
              D.PASSES.map((p) => h("th", { scope: "col", class: "sw-cgrid-pass", title: `${p.label} pass` }, p.short)),
            ),
          ),
          h(
            "tbody",
            null,
            rows.map((r) =>
              h(
                "tr",
                { class: r.revising ? "revising" : null },
                h(
                  "th",
                  { scope: "row", class: "sw-cgrid-ch" },
                  h(
                    "button",
                    { class: "sw-ch-btn", type: "button", dataset: { fid: `ch.${r.chapter}` }, onclick: () => openChapter(r.chapter, "text", `ch.${r.chapter}`) },
                    h("span", { class: "sw-ch-num" }, String(r.chapter)),
                    h("span", { class: "sw-ch-name" }, `Chapter ${r.chapter}`),
                    r.pilot ? h("span", { class: "sw-ch-tag" }, "Pilot") : null,
                  ),
                ),
                h("td", null, cellBtn(r.chapter, "Draft", r.draft, "text")),
                h("td", { class: "sw-cgrid-cold" }, cellBtn(r.chapter, "Cold read", r.cold, "cold")),
                h("td", { class: "sw-cgrid-cold-end" }, cellBtn(r.chapter, "Cold-read fixes", r.fix, "cold")),
                r.passes.map((c, i) => h("td", null, cellBtn(r.chapter, `${D.PASSES[i].label} pass`, c, "reviews"))),
                h(
                  "td",
                  { class: "sw-cgrid-notes" },
                  r.revising ? badge("busy", "Revising", true) : null,
                  reviewChip(r),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── tooltip (grid cells) ───────────────────────────────────────────────

  function showTip(target) {
    tip.textContent = "";
    tip.appendChild(h("strong", null, target.dataset.tip));
    if (target.dataset.tipDetail) tip.appendChild(h("span", null, target.dataset.tipDetail));
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    let top = r.top - t.height - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  const onOver = (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
    if (t && container.contains(t)) showTip(t);
    else hideTip();
  };
  container.addEventListener("mouseover", onOver);
  container.addEventListener("focusin", onOver);
  container.addEventListener("mouseleave", hideTip);
  container.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, true);

  // ── records ────────────────────────────────────────────────────────────

  function visibleTabs() {
    const hasChoices = ((state.records && state.records.choices) || []).length > 0;
    return TABS.filter((t) => !t.vn || D.isVN(state) || hasChoices);
  }

  function tabCount(id) {
    const r = state.records || {};
    switch (id) {
      case "characters":
        return D.castOf(state).list.length;
      case "coldreads":
        return D.coldReadChapters(state).length;
      case "unexplained":
        return D.unexplainedList(state).counts.total;
      case "emotions":
        return (r.chapter_state || []).length;
      case "knowledge":
        return (r.knowledge || []).length;
      case "setups":
        return (r.setups || []).length;
      case "choices":
        return (r.choices || []).length;
      case "glossary":
        return (r.glossary || []).length;
      case "recaps":
        return D.recapList(state).filter((x) => x.recap).length;
      case "rules":
        return D.storyRules(state).length;
      default:
        return 0;
    }
  }

  function tabList(tabs, current, fidBase, onPick, label, small) {
    const ids = tabs.map((t) => t.id);
    return h(
      "div",
      {
        class: `sw-tabs${small ? " sm" : ""}`,
        role: "tablist",
        "aria-label": label,
        onkeydown: (e) => {
          const i = ids.indexOf(current);
          let j = -1;
          if (e.key === "ArrowRight") j = (i + 1) % ids.length;
          else if (e.key === "ArrowLeft") j = (i - 1 + ids.length) % ids.length;
          else if (e.key === "Home") j = 0;
          else if (e.key === "End") j = ids.length - 1;
          if (j < 0) return;
          e.preventDefault();
          focusFid = `${fidBase}.${ids[j]}`;
          onPick(ids[j]);
        },
      },
      tabs.map((t) =>
        h(
          "button",
          {
            class: "sw-tab",
            type: "button",
            role: "tab",
            id: `${fidBase}-${t.id}`,
            "aria-selected": t.id === current ? "true" : "false",
            "aria-controls": `${fidBase}-panel`,
            tabindex: t.id === current ? "0" : "-1",
            dataset: { fid: `${fidBase}.${t.id}` },
            onclick: () => {
              focusFid = `${fidBase}.${t.id}`;
              onPick(t.id);
            },
          },
          t.label,
          t.count !== undefined && t.count !== null ? h("span", { class: "sw-count" }, String(t.count)) : null,
        ),
      ),
    );
  }

  function buildRecords() {
    const tabs = visibleTabs().map((t) => ({ ...t, count: tabCount(t.id) }));
    if (!tabs.some((t) => t.id === tab)) tab = tabs[0].id;
    return h(
      "section",
      { class: "sw-panel sw-dash-panel", "aria-labelledby": "sw-h-records" },
      panelHead("sw-h-records", "Story records", "The story's living memory. Writers and reviewers read these before every chapter and update them as they go."),
      tabList(
        tabs,
        tab,
        "rtab",
        (id) => {
          tab = id;
          render();
        },
        "Story records",
      ),
      h("div", { class: "sw-tabpanel", role: "tabpanel", id: "rtab-panel", "aria-labelledby": `rtab-${tab}` }, recordsPanel()),
    );
  }

  function recordsPanel() {
    switch (tab) {
      case "characters":
        return charactersPanel();
      case "emotions":
        return emotionsPanel();
      case "knowledge":
        return knowledgePanel();
      case "setups":
        return setupsPanel();
      case "choices":
        return choicesPanel();
      case "glossary":
        return glossaryPanel();
      case "recaps":
        return recapsPanel();
      case "rules":
        return rulesPanel();
      case "coldreads":
        return coldReadsPanel();
      case "unexplained":
        return unexplainedPanel();
      default:
        return null;
    }
  }

  function charactersPanel() {
    const { source, list } = D.castOf(state);
    if (!list.length) return empty("No character sheets yet. The records stage builds them before the first chapter is written.");
    const resolve = D.characterResolver(list);
    const introduced = list.filter((c) => D.firstIntro(c)).length;
    return [
      source === "brief"
        ? h("p", { class: "sw-panel-note" }, "From the setup — the records stage hasn't produced character sheets yet.")
        : h(
            "p",
            { class: "sw-panel-note" },
            h("strong", null, `${introduced} of ${plural(list.length, "character")} introduced in the text so far. `),
            "The chapter that first names someone records where (chapter and scene) and the exact line that tells the reader who they are.",
          ),
      h("div", { class: "sw-chars" }, list.map((c) => charCard(c, resolve))),
    ];
  }

  /// Where and how the text first introduced a character (chapter, scene,
  /// the exact line), or that it hasn't yet.
  function introBlock(c) {
    const f = D.firstIntro(c);
    const fid = `intro.${c.id || c.name}`;
    return h(
      "div",
      { class: `sw-intro${f ? "" : " none"}` },
      h("span", { class: "sw-setup-k" }, "First introduction"),
      f
        ? [
            h(
              "div",
              { class: "sw-intro-where" },
              h("button", { class: "sw-linkbtn", type: "button", dataset: { fid }, onclick: () => openChapter(f.chapter, "text", fid) }, `Chapter ${f.chapter}`),
              f.scene ? h("span", null, ` · ${f.scene}`) : null,
            ),
            f.line ? h("blockquote", { class: "sw-intro-line" }, f.line) : null,
          ]
        : h("p", { class: "sw-muted" }, "Not introduced in the text yet."),
    );
  }

  function charCard(c, resolve) {
    const pairs = [
      ["Values", c.values],
      ["Fears", c.fears],
      ["Flaws", c.flaws],
      ["Wants", c.want],
      ["Needs", c.need],
      ["Lie", c.lie],
      ["Wound", c.wound],
      ["Ghost", c.ghost],
      ["Speech habit", c.speech_habit],
    ].filter(([, v]) => String(v || "").trim());
    const attitudes = (c.attitudes || []).filter((a) => a && (a.attitude || a.reason));
    const knows = (c.knows || []).filter((k) => String(k || "").trim());
    return h(
      "article",
      { class: "sw-char" },
      h(
        "header",
        { class: "sw-char-head" },
        h("span", { class: "sw-avatar", "aria-hidden": "true" }, initials(c.name || c.id)),
        h("div", { class: "sw-char-id" }, h("h3", null, c.name || c.id || "Unnamed"), c.role ? h("p", null, c.role) : null),
        c.initial_emotion ? h("span", { class: "sw-badge", title: "Initial emotion" }, c.initial_emotion) : null,
      ),
      c.personality ? h("p", { class: "sw-char-lede" }, c.personality) : null,
      introBlock(c),
      pairs.length ? h("dl", { class: "sw-facts" }, pairs.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))) : null,
      attitudes.length
        ? h(
            "div",
            { class: "sw-char-sec" },
            h("h4", { class: "sw-subhead" }, "Toward the others"),
            h(
              "ul",
              { class: "sw-att-list" },
              attitudes.map((a) =>
                h("li", null, h("strong", null, resolve(a.toward).name), h("span", { class: "sw-att-val" }, a.attitude || "—"), a.reason ? h("span", { class: "sw-muted" }, a.reason) : null),
              ),
            ),
          )
        : null,
      knows.length ? h("div", { class: "sw-char-sec" }, h("h4", { class: "sw-subhead" }, "Knows"), h("ul", { class: "sw-bullets" }, knows.map((k) => h("li", null, k)))) : null,
      c.notes ? h("p", { class: "sw-muted sw-char-notes" }, c.notes) : null,
    );
  }

  // ── cold reads (C1/C2) ─────────────────────────────────────────────────

  function coldReadsPanel() {
    const chapters = D.coldReadChapters(state);
    if (!chapters.length) {
      return empty(
        "No cold reads yet. Every chapter, pilot included, is read once by a fresh reader who has never seen the brief, records or cards — as a player would — and every item they report is fixed before the chapter moves on.",
      );
    }
    const sel = crChapter !== null && chapters.includes(crChapter) ? crChapter : (chapters.find((c) => D.coldReadProgress(state, c).open > 0) ?? chapters[0]);
    const count = (k) => (k.total ? [String(k.total), h("span", { class: "sw-muted" }, k.fixed === k.total ? " · all fixed" : ` · ${k.fixed} fixed`)] : h("span", { class: "sw-muted" }, "0"));
    return [
      h(
        "div",
        { class: "sw-table-wrap", dataset: { scrollKey: "cr-overview" } },
        h(
          "table",
          { class: "sw-table sw-cr-overview" },
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h("th", { scope: "col" }, "Chapter"),
              h("th", { scope: "col" }, "Cold read"),
              h("th", { scope: "col" }, "Confusion"),
              h("th", { scope: "col" }, "Over-explained"),
              h("th", { scope: "col" }, "Fixes"),
              h("th", { scope: "col" }, "First three lines"),
            ),
          ),
          h(
            "tbody",
            null,
            chapters.map((c) => {
              const p = D.coldReadProgress(state, c);
              const f = p.doc && p.doc.first_three_lines;
              const ok = f ? [f.narrator, f.want, f.tension, f.clear].filter(Boolean).length : null;
              return h(
                "tr",
                { class: c === sel ? "sel" : null },
                h(
                  "th",
                  { scope: "row" },
                  h(
                    "button",
                    {
                      class: "sw-linkbtn",
                      type: "button",
                      "aria-pressed": c === sel ? "true" : "false",
                      dataset: { fid: `cr.ch.${c}` },
                      onclick: () => {
                        crChapter = c;
                        render();
                      },
                    },
                    c === 1 ? "Chapter 1 · pilot" : `Chapter ${c}`,
                  ),
                ),
                h("td", null, statusBadge(D.coldReadCell(state, c, cards))),
                h("td", { class: "sw-num" }, p.doc ? count(p.confusion) : "—"),
                h("td", { class: "sw-num" }, p.doc ? count(p.obvious) : "—"),
                h("td", null, statusBadge(D.coldFixCell(state, c, cards))),
                h("td", { class: "sw-num" }, ok === null ? "—" : h("span", { class: ok === 4 ? "sw-ok-text" : "sw-warn-text" }, `${ok} / 4 clear`)),
              );
            }),
          ),
        ),
      ),
      h(
        "div",
        { class: "sw-cr-detail" },
        h(
          "div",
          { class: "sw-cr-detail-head" },
          h("h3", null, sel === 1 ? "Pilot · chapter 1" : `Chapter ${sel}`),
          D.chapterSummary(state, sel)
            ? h("button", { class: "sw-btn ghost sm", type: "button", dataset: { fid: "cr.read" }, onclick: () => openChapter(sel, "text", "cr.read") }, icon("book"), "Read chapter")
            : null,
        ),
        coldReadBody(sel, "rec"),
      ),
    ];
  }

  /// One chapter's cold read: what the reader found (confusion and
  /// over-explained counted apart), each item with its fix and status, the
  /// first-three-lines check and the first-appearance list. `where` keeps
  /// the drawer's and the records tab's controls apart.
  function coldReadBody(n, where) {
    const v = D.coldReadView(state, n, { category: crCategory, status: crStatus });
    const readSt = D.unitStatus(v.read, cards);
    const fixSt = D.unitStatus(v.fix, cards);
    if (!v.doc) {
      const c = D.coldReadCell(state, n, cards);
      const why = !v.read
        ? n === 1
          ? "The cold read starts once the pilot is written."
          : "The cold read starts once this chapter is written."
        : v.read.status === "failed"
          ? `The cold-read card closed without a report${v.read.note ? ` (${v.read.note})` : ""}. Retry it to read the chapter again.`
          : "A fresh reader is on it — their report shows up here as soon as they submit it.";
      return [
        h("div", { class: "sw-cr-meta" }, statusBadge(c), h("span", { class: "sw-spacer" }), sessionBtn(readSt.sessionId, "Reader's session"), v.read && v.read.status === "failed" ? retryBtn(v.read) : null),
        empty(why),
      ];
    }
    const tile = (label, k, cat) => {
      const on = crCategory === cat;
      const fid = `${where}.cr.tile.${cat}`;
      return h(
        "button",
        {
          class: `sw-cr-tile ${cat}${on ? " on" : ""}`,
          type: "button",
          "aria-pressed": on ? "true" : "false",
          title: on ? "Show every category" : `Show only ${label.toLowerCase()} items`,
          dataset: { fid },
          onclick: () => {
            crCategory = on ? "all" : cat;
            focusFid = fid;
            render();
          },
        },
        h("span", { class: "sw-stat-label" }, label),
        h("span", { class: "sw-stat-value" }, String(k.total)),
        h("span", { class: "sw-stat-sub" }, k.total ? (k.fixed === k.total ? "All fixed" : `${k.fixed} fixed · ${k.total - k.fixed} open`) : "None found"),
      );
    };
    const catOpts = [
      { value: "all", label: `All categories (${v.total})` },
      { value: "confusion", label: `Confusion — every kind (${v.confusion.total})` },
      ...D.COLD_CATEGORIES.map((c) => ({ value: c.id, label: `${c.id === "obvious" ? "" : "— "}${c.label} (${v.byCategory[c.id] || 0})` })),
    ];
    const resolve = D.characterResolver(D.castOf(state).list);
    return [
      h(
        "div",
        { class: "sw-cr-summary" },
        tile("Confusion", v.confusion, "confusion"),
        tile("Over-explained", v.obvious, "obvious"),
        h(
          "div",
          { class: "sw-cr-tile lines" },
          h("span", { class: "sw-stat-label" }, "First three lines"),
          v.checks.length
            ? h(
                "ul",
                { class: "sw-cr-checks" },
                v.checks.map((c) => h("li", { class: c.ok ? "ok" : "no" }, icon(c.ok ? "check" : "x"), c.label, h("span", { class: "sw-sr" }, c.ok ? ": clear" : ": not clear"))),
              )
            : h("p", { class: "sw-muted" }, "Not reported."),
        ),
      ),
      h(
        "div",
        { class: "sw-cr-meta" },
        h(
          "span",
          null,
          `Read ${fmtDate(v.doc.submitted_at)} · revision ${v.doc.chapter_revision}`,
          v.doc.attempt > 1 ? ` · report ${v.doc.attempt}` : "",
          v.doc.fixes_at ? ` · fixes ${fmtDate(v.doc.fixes_at)}` : "",
        ),
        h("span", { class: "sw-spacer" }),
        sessionBtn(readSt.sessionId, "Reader's session"),
        sessionBtn(fixSt.sessionId, "Writer's session"),
        v.fix && v.fix.status === "failed" ? retryBtn(v.fix) : null,
      ),
      v.total
        ? h(
            "div",
            { class: "sw-toolbar" },
            selectBox(`${where}.cr.cat`, "Category", crCategory, catOpts, (val) => (crCategory = val)),
            seg(
              `${where}.cr.status`,
              crStatus,
              [
                { value: "all", label: "All", count: v.counts.all },
                { value: "open", label: "Open", count: v.counts.open },
                { value: "fixed", label: "Fixed", count: v.counts.fixed },
              ],
              (val) => {
                crStatus = val;
                render();
              },
              "Fix status",
            ),
          )
        : null,
      v.total
        ? v.shown.length
          ? h("ol", { class: "sw-cr-items", "aria-label": "Cold-read items" }, v.shown.map(crItem))
          : empty("No items match this filter.")
        : empty("The cold reader found nothing to fix — no confusion and nothing over-explained."),
      h(
        "section",
        { class: "sw-cr-sec" },
        h("h3", { class: "sw-subhead" }, `Characters in order of first appearance · ${v.characters.length}`),
        h("p", { class: "sw-help" }, "Only what the text had said about each one at that point — what a player would know."),
        v.characters.length
          ? h(
              "ol",
              { class: "sw-cr-chars" },
              v.characters.map((c) =>
                h(
                  "li",
                  null,
                  h("strong", null, c.name),
                  resolve(c.name).known ? null : h("span", { class: "sw-badge warn", title: "No character sheet has this name" }, "No character sheet"),
                  h("span", { class: "sw-cr-said" }, c.said || "—"),
                ),
              ),
            )
          : h("p", { class: "sw-muted" }, "No characters listed."),
      ),
    ];
  }

  function crItem(i) {
    return h(
      "li",
      { class: `sw-cr-item${i.obvious ? " obvious" : ""}${i.fixed ? " fixed" : " open"}` },
      h(
        "div",
        { class: "sw-cr-head" },
        h("span", { class: `sw-cr-cat${i.obvious ? " obvious" : ""}`, title: i.cat.hint || null }, i.cat.label),
        h("span", { class: "sw-cr-id" }, i.id),
        i.location ? h("span", { class: "sw-cr-loc" }, i.location) : null,
        h("span", { class: "sw-spacer" }),
        badge(i.fixed ? "ok" : "warn", i.fixed ? "Fixed" : "Open"),
      ),
      i.quote ? h("blockquote", { class: "sw-cr-quote" }, i.quote) : null,
      h("p", { class: "sw-cr-text" }, i.text),
      h(
        "div",
        { class: `sw-cr-fix${i.fixed ? "" : " none"}` },
        h("span", { class: "sw-setup-k" }, i.obvious ? "Fix · cut, or replaced with the feeling" : "Fix"),
        i.fixed ? h("p", null, i.fix) : h("p", { class: "sw-muted" }, "Not fixed yet."),
      ),
    );
  }

  // ── unexplained names, terms and rules (C3) ───────────────────────────

  function unexplainedPanel() {
    const all = D.unexplainedList(state, "all");
    const c = all.counts;
    if (!c.total) {
      return empty(
        `No unexplained names, terms or rules recorded yet. Writers list, per scene, each one a reader meets before the text explains it — at most ${D.UNEXPLAINED_CAP} per scene — and the chapter that answers it.`,
      );
    }
    const flagged = D.unexplainedList(state, "flagged").rows.reduce((k, r) => k + r.items.length, 0);
    const list = D.unexplainedList(state, unexFilter);
    const why = [
      c.overCap ? `${plural(c.overCap, "scene")} over the cap of ${D.UNEXPLAINED_CAP}` : null,
      c.overdue ? `${plural(c.overdue, "question")} still unanswered ${D.UNANSWERED_LIMIT} or more chapters later` : null,
    ].filter(Boolean);
    return [
      h(
        "div",
        { class: "sw-toolbar" },
        seg(
          "unex",
          unexFilter,
          [
            { value: "all", label: "All", count: c.total },
            { value: "unanswered", label: "Unanswered", count: c.unanswered },
            { value: "flagged", label: "Flagged", count: flagged },
          ],
          (v) => {
            unexFilter = v;
            render();
          },
          "Filter unexplained names",
        ),
        h("span", { class: "sw-muted sw-toolbar-count" }, `Cap ${D.UNEXPLAINED_CAP} per scene · flagged when unanswered ${D.UNANSWERED_LIMIT}+ chapters later`),
      ),
      why.length ? banner("warn", [h("strong", null, "Too much for the reader to carry: "), `${why.join("; ")}.`], null) : null,
      list.rows.length ? h("div", { class: "sw-unex" }, list.rows.map(unexScene)) : empty(unexFilter === "flagged" ? "Nothing flagged." : "Every name, term and rule has been answered."),
    ];
  }

  const KIND_LABEL = { name: "Name", term: "Term", rule: "Rule" };

  function unexScene(r) {
    const fid = `unex.${r.id}`;
    return h(
      "article",
      { class: `sw-unex-scene${r.flagged ? " flagged" : ""}` },
      h(
        "header",
        { class: "sw-unex-head" },
        h("button", { class: "sw-linkbtn", type: "button", dataset: { fid }, onclick: () => openChapter(r.chapter, "scenes", fid) }, `Chapter ${r.chapter}`),
        h("span", { class: "sw-unex-scene-name" }, r.scene || r.id),
        h("span", { class: "sw-spacer" }),
        r.overCap ? badge("err", `Over the cap · ${r.count} / ${D.UNEXPLAINED_CAP}`) : h("span", { class: "sw-muted sw-unex-cap" }, `${r.count} / ${D.UNEXPLAINED_CAP}`),
      ),
      h("ul", { class: "sw-unex-items" }, r.items.map(unexItem)),
    );
  }

  function unexItem(i) {
    const status = i.answered
      ? badge("ok", `Answered · ch ${i.answeredIn.chapter}${i.answeredIn.scene ? ` · ${i.answeredIn.scene}` : ""}`)
      : badge(i.overdue ? "err" : "warn", i.age ? `Unanswered · ${plural(i.age, "chapter")}` : "Unanswered");
    return h(
      "li",
      { class: `sw-unex-item${i.overdue ? " overdue" : ""}` },
      h("span", { class: "sw-unex-name" }, h("strong", null, i.name), h("span", { class: "sw-unex-kind" }, KIND_LABEL[i.kind] || i.kind)),
      status,
    );
  }

  function emotionsPanel() {
    const states = D.chapterStates(state);
    const head = h(
      "div",
      { class: "sw-toolbar" },
      seg(
        "emo",
        emoView,
        [
          { value: "emotions", label: "Emotions by chapter" },
          { value: "attitudes", label: "Attitudes" },
        ],
        (v) => {
          emoView = v;
          render();
        },
        "View",
      ),
      emoView === "attitudes"
        ? selectBox(
            "att.chapter",
            "As of",
            attChapter === null ? (states.length ? states[states.length - 1].chapter : 0) : attChapter,
            [{ value: 0, label: "Start (character sheets)" }, ...states.map((s) => ({ value: s.chapter, label: `Chapter ${s.chapter}` }))],
            (v) => (attChapter = Number(v)),
          )
        : null,
    );
    return [head, emoView === "emotions" ? emotionTable() : attitudeMatrix(states)];
  }

  function emotionTable() {
    const tl = D.emotionTimeline(state);
    if (!tl.chapters.length || !tl.rows.length) return empty("Per-chapter emotions are recorded as each chapter is written.");
    return h(
      "div",
      { class: "sw-table-wrap", dataset: { scrollKey: "emo" } },
      h(
        "table",
        { class: "sw-matrix" },
        h("thead", null, h("tr", null, h("th", { scope: "col", class: "sw-matrix-corner" }, "Character"), tl.chapters.map((c) => h("th", { scope: "col" }, `Ch ${c}`)))),
        h(
          "tbody",
          null,
          tl.rows.map((r) =>
            h(
              "tr",
              null,
              h("th", { scope: "row" }, r.name),
              tl.chapters.map((c) => {
                const v = r.cells[c];
                return h("td", { class: v ? null : "sw-matrix-none", title: v || null }, v || "—");
              }),
            ),
          ),
        ),
      ),
    );
  }

  function attitudeMatrix(states) {
    const ch = attChapter === null ? (states.length ? states[states.length - 1].chapter : 0) : attChapter;
    const m = D.attitudesAt(state, ch);
    if (m.people.length < 2) return empty("Attitudes between characters appear once there are at least two character sheets.");
    const ctx = m.state ? [m.state.location, m.state.time].filter(Boolean).join(" · ") : "";
    return [
      ctx || (m.state && m.state.notes)
        ? h("p", { class: "sw-panel-note" }, ctx ? h("strong", null, ctx) : null, ctx && m.state.notes ? " — " : null, m.state.notes || null)
        : null,
      h(
        "div",
        { class: "sw-table-wrap", dataset: { scrollKey: "att" } },
        h(
          "table",
          { class: "sw-matrix sw-att-matrix", style: { minWidth: `${170 + m.people.length * 150}px` } },
          h(
            "thead",
            null,
            h("tr", null, h("th", { scope: "col", class: "sw-matrix-corner" }, h("span", null, "From"), " → ", h("span", null, "toward")), m.people.map((p) => h("th", { scope: "col" }, p.name))),
          ),
          h(
            "tbody",
            null,
            m.people.map((from) =>
              h(
                "tr",
                null,
                h("th", { scope: "row" }, from.name),
                m.people.map((to) => {
                  if (from.key === to.key) return h("td", { class: "sw-matrix-self", "aria-label": "same character" }, "");
                  const c = m.get(from.key, to.key);
                  if (!c) return h("td", { class: "sw-matrix-none" }, "—");
                  return h(
                    "td",
                    { class: c.changed && ch > 0 ? "changed" : null },
                    h("span", { class: "sw-att-val" }, c.attitude || "—"),
                    c.reason ? h("span", { class: "sw-att-why" }, c.reason) : null,
                    c.changed && ch > 0 ? h("span", { class: "sw-sr" }, " (changed this chapter)") : null,
                    !c.changed && c.chapter > 0 ? h("span", { class: "sw-att-since" }, `since ch ${c.chapter}`) : null,
                  );
                }),
              ),
            ),
          ),
        ),
      ),
      ch > 0 ? h("p", { class: "sw-help sw-legend-note" }, h("span", { class: "sw-changed-dot", "aria-hidden": "true" }), "Changed in this chapter") : null,
    ];
  }

  function knowledgePanel() {
    const facts = (state.records && state.records.knowledge) || [];
    if (!facts.length) return empty("No facts tracked yet. Writers record who learns what — and when — so characters only react to what they could know.");
    const routes = D.knowledgeRoutes(state);
    const n = D.chapterCount(state);
    const asOf = kAsOf === "latest" ? null : Number(kAsOf);
    if (kRoute !== "all" && kRoute !== "common" && !routes.includes(kRoute)) kRoute = "all";
    const m = D.knowledgeMatrix(state, kRoute, asOf);
    const chapterOpts = [{ value: "latest", label: "Latest" }];
    for (let c = 1; c <= n; c++) chapterOpts.push({ value: String(c), label: `After chapter ${c}` });
    return [
      h(
        "div",
        { class: "sw-toolbar" },
        routes.length || D.isVN(state)
          ? selectBox(
              "k.route",
              "Route",
              kRoute,
              [{ value: "all", label: "All routes" }, { value: "common", label: "Common only" }, ...routes.map((r) => ({ value: r, label: r }))],
              (v) => (kRoute = v),
            )
          : null,
        selectBox("k.asof", "As of", kAsOf, chapterOpts, (v) => (kAsOf = v)),
        h("span", { class: "sw-muted sw-toolbar-count" }, plural(m.rows.length, "fact")),
      ),
      m.rows.length
        ? h(
            "div",
            { class: "sw-table-wrap", dataset: { scrollKey: "know" } },
            h(
              "table",
              { class: "sw-matrix sw-know" },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  h("th", { scope: "col", class: "sw-matrix-corner" }, "Fact"),
                  routes.length ? h("th", { scope: "col" }, "Route") : null,
                  m.cols.map((p) => h("th", { scope: "col", class: "sw-know-col" }, p.name)),
                ),
              ),
              h(
                "tbody",
                null,
                m.rows.map((r) =>
                  h(
                    "tr",
                    { class: r.count ? null : "sw-know-nobody" },
                    h("th", { scope: "row" }, r.fact, r.count ? null : h("span", { class: "sw-muted sw-know-note" }, " — nobody yet")),
                    routes.length ? h("td", null, h("span", { class: `sw-badge${r.route === "common" ? "" : " busy"}` }, r.route)) : null,
                    m.cols.map((p) => {
                      const c = r.cells[p.key];
                      return c
                        ? h(
                            "td",
                            { class: "sw-know-yes", title: c.how ? `${p.name}: ${c.how}` : null },
                            h("span", { class: "sw-know-mark", html: ICON.check, "aria-hidden": "true" }),
                            h("span", { class: "sw-sr" }, `${p.name} knows`),
                            c.since !== null ? h("span", { class: "sw-know-ch", title: c.since === 0 ? "Knew before the story starts" : null }, c.since === 0 ? "start" : `ch ${c.since}`) : null,
                          )
                        : h("td", { class: "sw-know-no" }, h("span", { class: "sw-sr" }, `${p.name} doesn't know`));
                    }),
                  ),
                ),
              ),
            ),
          )
        : empty(kRoute === "all" ? "No facts known yet at this point." : "No facts on this route."),
    ];
  }

  function setupsPanel() {
    const { counts, items } = D.setupList(state, setupFilter);
    if (!counts.all) return empty("No setups tracked yet. Every promise the story makes is tracked here until it pays off.");
    const tone = { open: "warn", paid: "ok", dropped: "" };
    return [
      h(
        "div",
        { class: "sw-toolbar" },
        seg(
          "setups",
          setupFilter,
          [
            { value: "all", label: "All", count: counts.all },
            { value: "open", label: "Open", count: counts.open },
            { value: "paid", label: "Paid off", count: counts.paid },
            { value: "dropped", label: "Dropped", count: counts.dropped },
          ],
          (v) => {
            setupFilter = v;
            render();
          },
          "Filter setups",
        ),
      ),
      items.length
        ? h(
            "ol",
            { class: "sw-setups" },
            items.map((s) =>
              h(
                "li",
                { class: `sw-setup ${s.status}` },
                h(
                  "div",
                  { class: "sw-setup-col" },
                  h("span", { class: "sw-setup-k" }, "Promise", h("span", { class: "sw-ch-chip" }, `ch ${s.setup_chapter}`)),
                  h("p", null, s.promise),
                ),
                h("span", { class: "sw-setup-arrow", "aria-hidden": "true", html: ICON.arrow }),
                h(
                  "div",
                  { class: "sw-setup-col" },
                  h("span", { class: "sw-setup-k" }, "Progress"),
                  s.progress.length
                    ? h(
                        "ul",
                        { class: "sw-progress" },
                        s.progress.map((p) => h("li", null, h("span", { class: "sw-ch-chip" }, `ch ${p.chapter}`), p.note)),
                      )
                    : h("p", { class: "sw-muted" }, "None yet"),
                ),
                h("span", { class: "sw-setup-arrow", "aria-hidden": "true", html: ICON.arrow }),
                h(
                  "div",
                  { class: "sw-setup-col" },
                  h("span", { class: "sw-setup-k" }, "Payoff", s.payoff_chapter ? h("span", { class: "sw-ch-chip" }, `ch ${s.payoff_chapter}`) : null),
                  s.payoff ? h("p", null, s.payoff) : h("p", { class: "sw-muted" }, s.status === "dropped" ? "Dropped" : "Not paid off yet"),
                ),
                h("span", { class: "sw-setup-status" }, badge(tone[s.status] || "", s.status === "paid" ? "Paid off" : s.status === "dropped" ? "Dropped" : "Open")),
              ),
            ),
          )
        : empty("Nothing here."),
    ];
  }

  function choicesPanel() {
    const groups = D.choicesByChapter(state);
    const routes = D.routeMap(state);
    const routeName = (ref) => {
      const r = String(ref).toLowerCase();
      const hit = routes.find((x) => String(x.id).toLowerCase() === r || String(x.name).toLowerCase() === r);
      return hit ? hit.name : ref;
    };
    if (!groups.length && !routes.length) return empty("No choices recorded yet. Each choice and its consequences land here as chapters are written.");
    return h(
      "div",
      { class: "sw-choices" },
      h(
        "div",
        { class: "sw-choices-main" },
        groups.length
          ? groups.map((g) =>
              h(
                "div",
                { class: "sw-choice-ch" },
                h("h3", { class: "sw-subhead" }, `Chapter ${g.chapter}`),
                g.choices.map((c) =>
                  h(
                    "article",
                    { class: "sw-choice-card" },
                    h("p", { class: "sw-choice-q" }, c.prompt || `Choice ${c.id}`),
                    h(
                      "ul",
                      { class: "sw-branches" },
                      (c.options || []).map((o) =>
                        h(
                          "li",
                          null,
                          h("span", { class: "sw-branch-label" }, o.label),
                          h("span", { class: "sw-branch-arrow", "aria-hidden": "true", html: ICON.arrow }),
                          h(
                            "span",
                            { class: "sw-branch-csq" },
                            o.consequence,
                            o.route ? h("span", { class: "sw-badge busy", title: "Leads to this route" }, routeName(o.route)) : null,
                            Object.entries(o.sets || {}).map(([k, v]) => h("code", { class: "sw-set" }, `${k} = ${JSON.stringify(v)}`)),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            )
          : empty("No choices recorded yet."),
      ),
      h(
        "aside",
        { class: "sw-routes", "aria-label": "Routes and endings" },
        h("h3", { class: "sw-subhead" }, "Routes & endings"),
        routes.length
          ? routes.map((r) =>
              h(
                "div",
                { class: "sw-route" },
                h("div", { class: "sw-route-head" }, h("strong", null, r.name), badge(r.kind === "route" ? "busy" : "", r.kind === "route" ? "Route" : "Ending")),
                r.conditions ? h("p", { class: "sw-muted" }, r.conditions) : null,
                r.options.length
                  ? h(
                      "ul",
                      { class: "sw-route-opts" },
                      r.options.map((o) => h("li", null, h("span", { class: "sw-ch-chip" }, `ch ${o.chapter}`), `“${o.label}”`)),
                    )
                  : h("p", { class: "sw-muted" }, "No choice leads here yet."),
              ),
            )
          : h("p", { class: "sw-muted" }, "No routes defined."),
      ),
    );
  }

  function glossaryPanel() {
    const all = (state.records && state.records.glossary) || [];
    if (!all.length) return empty("No glossary terms yet. New names, places and world terms are explained here the first time they appear.");
    const list = D.glossaryList(state, glossaryQ);
    return [
      h(
        "div",
        { class: "sw-toolbar" },
        h(
          "label",
          { class: "sw-search", for: "f-glossary-q" },
          h("span", { class: "sw-sr" }, "Search the glossary"),
          icon("search"),
          h("input", {
            id: "f-glossary-q",
            class: "sw-input",
            type: "search",
            placeholder: "Search terms and definitions",
            value: glossaryQ,
            dataset: { fid: "glossary.q" },
            oninput: (e) => {
              glossaryQ = e.target.value;
              render();
            },
          }),
        ),
        h("span", { class: "sw-muted sw-toolbar-count" }, glossaryQ ? `${list.length} of ${all.length}` : plural(all.length, "term")),
      ),
      list.length
        ? h(
            "dl",
            { class: "sw-glossary" },
            list.map((g) =>
              h(
                "div",
                null,
                h("dt", null, g.term, g.first_chapter ? h("span", { class: "sw-ch-chip" }, `ch ${g.first_chapter}`) : null),
                h("dd", null, g.definition),
              ),
            ),
          )
        : empty(`No term matches “${glossaryQ}”.`),
    ];
  }

  function recapsPanel() {
    const list = D.recapList(state);
    return h(
      "ol",
      { class: "sw-recaps" },
      list.map((r) =>
        h(
          "li",
          { class: r.recap ? null : "none" },
          h(
            "div",
            { class: "sw-recap-head" },
            h("strong", null, `Chapter ${r.chapter}`),
            r.written
              ? h("button", { class: "sw-btn ghost sm", type: "button", dataset: { fid: `recap.${r.chapter}` }, onclick: () => openChapter(r.chapter, "text", `recap.${r.chapter}`) }, "Read")
              : null,
          ),
          h("p", { class: r.recap ? null : "sw-muted" }, r.recap || (r.written ? "Written without a recap." : "Not written yet.")),
        ),
      ),
    );
  }

  function sourceTag(r) {
    if (r.source === "owner") return badge("busy", r.chapter ? `Your feedback · ch ${r.chapter}` : "Your feedback");
    if (r.source === "review") return badge("warn", r.chapter ? `Review · ch ${r.chapter}` : "Review");
    return badge("", "Setup");
  }

  function rulesPanel() {
    const rules = D.storyRules(state);
    const overrides = D.lessonOverrides(state, defaults && defaults.style_guide);
    const own = (state.brief && state.brief.elements && state.brief.elements.banned_words) || [];
    const builtIn = (defaults && defaults.banned_words) || [];
    const fb = D.feedbackRows(state, cards);
    return h(
      "div",
      { class: "sw-rules" },
      h(
        "section",
        { class: "sw-rules-sec" },
        h("h3", { class: "sw-subhead" }, `Story rules · ${rules.length}`),
        rules.length
          ? h(
              "ol",
              { class: "sw-rule-list" },
              rules.map((r) => h("li", null, h("span", { class: "sw-rule-text" }, r.text), sourceTag(r))),
            )
          : h("p", { class: "sw-muted" }, "No story-specific rules. The built-in style guide applies."),
      ),
      h(
        "section",
        { class: "sw-rules-sec" },
        h("h3", { class: "sw-subhead" }, "Changes to the built-in style guide"),
        overrides.length
          ? h(
              "div",
              { class: "sw-lessons" },
              overrides.map((o) =>
                h(
                  "div",
                  { class: `sw-lesson${o.off ? " off" : ""}` },
                  h("div", { class: "sw-lesson-head" }, h("strong", null, o.title), badge(o.off ? "warn" : "busy", o.off ? "Turned off" : "Edited")),
                  o.off ? null : h("div", { class: "sw-lesson-preview" }, o.text),
                ),
              ),
            )
          : h("p", { class: "sw-muted" }, "None — this story uses the built-in style guide as is."),
      ),
      h(
        "section",
        { class: "sw-rules-sec" },
        h("h3", { class: "sw-subhead" }, "Banned words"),
        own.length ? h("div", { class: "sw-chips" }, own.map((w) => h("span", { class: "sw-chip fixed" }, w))) : h("p", { class: "sw-muted" }, "No story-specific banned words."),
        builtIn.length
          ? h(
              "details",
              { class: "sw-details" },
              h("summary", null, `Built-in list · ${builtIn.length}`),
              h("div", { class: "sw-chips" }, builtIn.map((w) => h("span", { class: "sw-chip fixed muted" }, w))),
            )
          : null,
      ),
      h(
        "section",
        { class: "sw-rules-sec" },
        h("h3", { class: "sw-subhead" }, `Feedback history · ${fb.length}`),
        fb.length ? h("ul", { class: "sw-fb-list" }, fb.map(feedbackItem)) : h("p", { class: "sw-muted" }, "No feedback yet."),
      ),
    );
  }

  function feedbackItem(f) {
    return h(
      "li",
      { class: `sw-fb-item ${f.source}` },
      h(
        "div",
        { class: "sw-fb-head" },
        badge(f.source === "owner" ? "busy" : "warn", f.source === "owner" ? "You" : "Review"),
        f.chapter ? h("button", { class: "sw-linkbtn", type: "button", onclick: () => openChapter(f.chapter, "review") }, `Chapter ${f.chapter}`) : null,
        h("span", { class: "sw-muted" }, fmtDate(f.at)),
        f.appended_to_rules ? h("span", { class: "sw-tag" }, icon("check"), "Added to rules") : null,
        h("span", { class: "sw-spacer" }),
        f.status ? statusBadge(f.status) : null,
        f.status ? sessionBtn(f.status.sessionId, "Session") : null,
      ),
      h("p", { class: "sw-fb-text" }, f.text),
    );
  }

  // ── chapter drawer ─────────────────────────────────────────────────────

  function buildDrawer(entering) {
    const n = drawer.chapter;
    const N = D.chapterCount(state);
    const rows = D.chapterRows(state, cards);
    const row = rows[n - 1] || rows[0];
    const sum = D.chapterSummary(state, n);
    const t = texts.get(n);
    const words = t && t.doc ? D.wordCount(t.doc.markdown) : null;
    const reviews = D.PASSES.filter((p) => D.reviewOf(state, n, p.id)).length;
    const scenes = ((state.records && state.records.scene_sheets) || []).filter((s) => s.chapter === n);
    const rinfo = D.reviewInfo(state, n, cards);
    const cold = D.coldReadOf(state, n);
    const counts = { cold: cold ? (cold.items || []).length : undefined, reviews, scenes: scenes.length, review: rinfo.notes.length || undefined };
    const go = (to) => () => openChapter(to, drawer.tab, drawerOpenerFid, `drawer.go.${to > n ? "next" : "prev"}`);
    const trap = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pop) closePop(true);
        else if (editing) {
          focusFid = `note.edit.${editing.id}`;
          editing = null;
          render();
        } else if (requesting) {
          requesting = null;
          focusFid = "req.open";
          render();
        } else closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;
      const f = Array.from(e.currentTarget.querySelectorAll("button:not([disabled]), textarea:not([disabled]), select, input, [tabindex='0']")).filter(
        (x) => x.offsetParent !== null,
      );
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    return [
      h("div", { class: `sw-backdrop${entering ? " enter" : ""}`, onclick: closeDrawer }),
      h(
        "aside",
        { class: `sw-drawer${entering ? " enter" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": "sw-drawer-title", onkeydown: trap },
        h(
          "header",
          { class: "sw-drawer-head" },
          h(
            "div",
            { class: "sw-drawer-title" },
            h("span", { class: "sw-kicker" }, n === 1 ? `Pilot · chapter 1 of ${N}` : `Chapter ${n} of ${N}`),
            h("h2", { id: "sw-drawer-title" }, `Chapter ${n}`),
            h(
              "div",
              { class: "sw-drawer-meta" },
              statusBadge(row.draft),
              sum ? h("span", null, `Revision ${sum.revision}`) : null,
              words !== null ? h("span", null, `${words.toLocaleString()} words`) : null,
              row.revising ? badge("busy", "Revision in progress", true) : null,
              rinfo.pending ? badge("warn", `Round ${rinfo.pending.round} sent · redrafting`, true) : null,
              rinfo.approved ? badge("ok", "Approved by you") : null,
              sessionBtn(row.draft.sessionId, "Writer's session"),
            ),
          ),
          h(
            "div",
            { class: "sw-drawer-nav" },
            h("button", { class: "sw-icon-btn", type: "button", "aria-label": "Previous chapter", disabled: n <= 1, dataset: { fid: "drawer.go.prev" }, html: ICON.left, onclick: go(n - 1) }),
            h("button", { class: "sw-icon-btn", type: "button", "aria-label": "Next chapter", disabled: n >= N, dataset: { fid: "drawer.go.next" }, html: ICON.right, onclick: go(n + 1) }),
            h("button", { class: "sw-icon-btn", type: "button", "aria-label": "Close", dataset: { fid: "drawer.close" }, html: ICON.x, onclick: closeDrawer }),
          ),
        ),
        tabList(
          DRAWER_TABS.map((x) => ({ ...x, count: counts[x.id] })),
          drawer.tab,
          "dtab",
          (id) => {
            drawer = { ...drawer, tab: id };
            render();
          },
          `Chapter ${n}`,
          true,
        ),
        h(
          "div",
          { class: "sw-drawer-body", role: "tabpanel", id: "dtab-panel", "aria-labelledby": `dtab-${drawer.tab}`, tabindex: "-1" },
          drawerNotice
            ? banner(drawerNotice.tone, drawerNotice.text, [
                dismiss(() => {
                  drawerNotice = null;
                  render();
                }),
              ])
            : null,
          drawerPanel(n, sum, t, row, scenes),
        ),
        h("footer", { class: "sw-drawer-foot" }, reviewBar(n)),
        pop && pop.chapter === n ? buildPop() : null,
      ),
    ];
  }

  function drawerPanel(n, sum, t, row, scenes) {
    switch (drawer.tab) {
      case "cold":
        return coldReadBody(n, "drawer");
      case "reviews":
        return reviewsTab(n, row);
      case "scenes":
        return scenesTab(scenes);
      case "review":
        return reviewTab(n);
      default:
        return textTab(n, sum, t, row);
    }
  }

  function textTab(n, sum, t, row) {
    if (!sum) {
      return empty(row.draft.key === "pending" ? "Not written yet." : `Not written yet — ${row.draft.label.toLowerCase()}${row.draft.detail ? `: ${row.draft.detail}` : ""}.`);
    }
    if (!t || t.loading) return h("p", { class: "sw-loading" }, h("span", { class: "sw-spinner" }), "Loading chapter…");
    if (t.error) {
      return banner("err", `Couldn't load the chapter: ${t.error}`, [
        h(
          "button",
          {
            class: "sw-btn sm",
            type: "button",
            onclick: () => {
              texts.delete(n);
              ensureText(n);
              render();
            },
          },
          "Try again",
        ),
      ]);
    }
    if (!t.doc) return empty("Not written yet.");
    const recap = t.doc.recap;
    const info = D.reviewInfo(state, n, cards);
    const canNote = info.canReview;
    const blocks = D.proseBlocks(t.doc.markdown);
    const placed = D.placeNotes(blocks, canNote ? info.notes : []);
    const picked = pop && pop.chapter === n ? pop : null;
    return [
      reviewStrip(n, info),
      recap ? h("div", { class: "sw-recap-box" }, h("span", { class: "sw-setup-k" }, "Recap"), h("p", null, recap)) : null,
      h(
        "article",
        {
          class: `sw-prose${canNote ? " annotatable" : ""}`,
          "aria-label": `Chapter ${n} text`,
          onmouseup: canNote ? (e) => onProseUp(e, n) : null,
          onkeydown: canNote ? (e) => onProseKey(e, n) : null,
        },
        blocks.map((b, i) => {
          const el = blockEl(b);
          const notes = placed[i];
          if (!canNote) return el;
          el.tabIndex = 0;
          el.dataset.fid = `blk.${b.start}`;
          if (notes.length) {
            el.classList.add("noted");
            el.appendChild(h("span", { class: "sw-pin", "aria-hidden": "true" }, String(notes.length)));
          }
          if (picked && b.start <= picked.end && b.end >= picked.start) el.classList.add("sel");
          if (!notes.length) return el;
          const whole = b.lines.join(" ");
          return [el, h("ul", { class: "sw-inline-notes", "aria-label": `Your notes on ${D.lineLabel({ start_line: b.start, end_line: b.end })}` }, notes.map((x) => noteItem(n, x, true, !sameText(x.quote, whole))))];
        }),
      ),
    ];
  }

  /// Whether a note's quote is just the whole block (then the block itself,
  /// right above, says it — no need to repeat it).
  function sameText(a, b) {
    const norm = (s) => String(s || "").replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
    return norm(a) === norm(b);
  }

  /// The strip above the chapter text: how to leave notes in this round,
  /// that a redraft is running, or why the text can't be reviewed yet.
  function reviewStrip(n, info) {
    if (info.pending) {
      return h(
        "div",
        { class: "sw-review-hint redraft" },
        icon("clock"),
        h(
          "span",
          null,
          h("strong", null, `Round ${info.pending.round} sent — being redrafted. `),
          `You'll review the new draft as round ${info.pending.round + 1} once its cold read is done. `,
          h(
            "button",
            {
              class: "sw-linkbtn",
              type: "button",
              onclick: () => {
                drawer = { ...drawer, tab: "review" };
                render();
              },
            },
            "See your notes",
          ),
        ),
      );
    }
    if (!info.canReview) return info.why ? h("div", { class: "sw-review-hint closed" }, icon("info"), h("span", null, info.why)) : null;
    const count = info.notes.length;
    return h(
      "div",
      { class: "sw-review-hint" },
      icon("note"),
      h(
        "span",
        null,
        h("strong", null, `Round ${info.roundNo} · draft revision ${info.revision}. `),
        "Select a passage — or click a paragraph, or press Enter on it — to leave a note.",
        count ? ` ${plural(count, "note")} so far; they go to the writer when you request changes.` : "",
      ),
    );
  }

  function reviewsTab(n, row) {
    return h(
      "ol",
      { class: "sw-passes" },
      D.PASSES.map((p, i) => {
        const c = row.passes[i];
        const doc = D.reviewOf(state, n, p.id);
        const rounds = doc ? doc.rounds : [];
        return h(
          "li",
          { class: "sw-pass" },
          h(
            "div",
            { class: "sw-pass-head" },
            h("span", { class: `sw-cell sw-cell-sm ${c.tone} k-${c.key}`, "aria-hidden": "true" }, cellIcon(c)),
            h("strong", null, `${p.label} pass`),
            statusBadge(c),
            h("span", { class: "sw-spacer" }),
            sessionBtn(c.sessionId, "Session"),
            c.key === "failed" && c.unit ? retryBtn(c.unit) : null,
          ),
          rounds.length
            ? h(
                "ol",
                { class: "sw-rounds" },
                rounds.map((r, k) =>
                  h(
                    "li",
                    null,
                    h(
                      "div",
                      { class: "sw-round-head" },
                      h("span", { class: "sw-muted" }, `Round ${k + 1}`),
                      badge(r.verdict === "pass" ? "ok" : "warn", r.verdict === "pass" ? "Passed" : "Changes requested"),
                      h("span", { class: "sw-muted" }, fmtDate(r.at)),
                    ),
                    r.notes ? h("p", { class: "sw-round-notes" }, r.notes) : null,
                  ),
                ),
              )
            : null,
        );
      }),
    );
  }

  function scenesTab(scenes) {
    if (!scenes.length) return empty("No scene sheets for this chapter yet. Writers fill one per scene: where, when, who's there and what's true.");
    const resolve = D.characterResolver(D.castOf(state).list);
    const unex = new Map(D.unexplainedList(state).rows.map((r) => [r.id, r]));
    return h(
      "div",
      { class: "sw-scenes" },
      scenes.map((s) =>
        h(
          "article",
          { class: "sw-scene" },
          h("h3", null, s.scene),
          h("p", { class: "sw-muted" }, [s.location, s.time].filter(Boolean).join(" · ")),
          (s.present || []).length ? h("p", null, h("span", { class: "sw-setup-k" }, "Present"), (s.present || []).map((x) => resolve(x).name).join(", ")) : null,
          s.goal || s.outcome
            ? h(
                "p",
                { class: "sw-scene-arc" },
                s.goal ? [h("span", { class: "sw-setup-k" }, "Goal"), s.goal] : null,
                s.goal && s.outcome ? h("span", { class: "sw-scene-arrow", "aria-hidden": "true", html: ICON.arrow }) : null,
                s.outcome ? [h("span", { class: "sw-setup-k" }, "Outcome"), s.outcome] : null,
              )
            : null,
          (s.facts || []).length ? h("ul", { class: "sw-bullets" }, s.facts.map((f) => h("li", null, f))) : null,
          unex.has(s.id)
            ? h(
                "div",
                { class: `sw-scene-unex${unex.get(s.id).flagged ? " flagged" : ""}` },
                h(
                  "div",
                  { class: "sw-unex-head" },
                  h("span", { class: "sw-setup-k" }, "Unexplained names, terms and rules"),
                  h("span", { class: "sw-spacer" }),
                  unex.get(s.id).overCap
                    ? badge("err", `Over the cap · ${unex.get(s.id).count} / ${D.UNEXPLAINED_CAP}`)
                    : h("span", { class: "sw-muted sw-unex-cap" }, `${unex.get(s.id).count} / ${D.UNEXPLAINED_CAP}`),
                ),
                h("ul", { class: "sw-unex-items" }, unex.get(s.id).items.map(unexItem)),
              )
            : null,
        ),
      ),
    );
  }

  // ── owner review: notes, rounds, decisions (SW-12) ─────────────────────

  /// The block just before `el` in the text (a selection that ends at the
  /// very start of a block didn't actually take any of it).
  function prevBlock(el) {
    let x = el.previousElementSibling;
    while (x && !x.hasAttribute("data-line-start")) x = x.previousElementSibling;
    return x;
  }

  /// A selection inside the text quotes exactly what was highlighted (and
  /// spans every block it touches); a plain click takes the whole block.
  function onProseUp(e, n) {
    if (e.button !== 0) return;
    const root = e.currentTarget;
    if (e.target.closest(".sw-inline-notes, button, a, textarea, input")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const a = blockOf(range.startContainer);
      let b = blockOf(range.endContainer);
      if (b && b !== a && range.endOffset === 0) b = prevBlock(b) || b;
      const text = sel.toString().trim();
      if (a && b && root.contains(a) && root.contains(b) && text) {
        const start = Math.min(Number(a.dataset.lineStart), Number(b.dataset.lineStart));
        const end = Math.max(Number(a.dataset.lineEnd), Number(b.dataset.lineEnd));
        openPop(n, start, end, text, range.getBoundingClientRect());
        return;
      }
    }
    const block = blockOf(e.target);
    if (!block || !root.contains(block)) return;
    openPop(n, Number(block.dataset.lineStart), Number(block.dataset.lineEnd), blockText(block), block.getBoundingClientRect());
  }

  function onProseKey(e, n) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const block = e.target;
    if (!block.hasAttribute || !block.hasAttribute("data-line-start")) return;
    e.preventDefault();
    openPop(n, Number(block.dataset.lineStart), Number(block.dataset.lineEnd), blockText(block), block.getBoundingClientRect());
  }

  const KIND_ICON = { comment: "chat", suggest: "pencil", wrong: "xcircle", expand: "expand", shorten: "shorten" };

  /// The popover over a picked passage: the five kinds of note PeckBoard's
  /// Review page offers, then the note's text. A bottom sheet on phones.
  function buildPop() {
    const p = pop;
    const kind = p.kind ? D.noteKind(p.kind) : null;
    const saving = busy.has("note");
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closePop(true);
    };
    const back = () => {
      p.kind = null;
      p.error = null;
      focusFid = "pop.verb.0";
      render();
    };
    return h(
      "div",
      { class: "sw-pop", role: "dialog", "aria-label": "Note on this passage", style: { left: `${p.x}px`, top: `${p.y}px` }, onkeydown: onKey },
      h(
        "div",
        { class: "sw-pop-head" },
        h("span", { class: "sw-kicker" }, p.end > p.start ? `Lines ${p.start}–${p.end}` : `Line ${p.start}`),
        h("button", { class: "sw-icon-btn", type: "button", "aria-label": "Close", html: ICON.x, dataset: { fid: "pop.close" }, onclick: () => closePop(true) }),
      ),
      p.quote ? h("p", { class: "sw-pop-quote" }, p.quote) : null,
      !kind
        ? h(
            "div",
            { class: "sw-pop-verbs", role: "group", "aria-label": "Kind of note" },
            D.NOTE_KINDS.map((k, i) =>
              h(
                "button",
                {
                  class: "sw-pop-verb",
                  type: "button",
                  dataset: { fid: `pop.verb.${i}` },
                  onclick: () => {
                    p.kind = k.id;
                    p.error = null;
                    focusFid = "pop.body";
                    render();
                  },
                },
                icon(KIND_ICON[k.id]),
                k.label,
              ),
            ),
          )
        : h(
            "form",
            {
              class: "sw-pop-editor",
              onsubmit: (e) => {
                e.preventDefault();
                addNote();
              },
            },
            h("label", { class: "sw-label", for: "sw-pop-body" }, icon(KIND_ICON[kind.id]), kind.label, kind.needsBody ? null : h("span", { class: "sw-hint" }, "text optional")),
            h("textarea", {
              id: "sw-pop-body",
              class: "sw-textarea sm",
              rows: 3,
              value: p.draft,
              disabled: saving,
              placeholder: kind.placeholder,
              dataset: { fid: "pop.body" },
              oninput: (e) => {
                p.draft = e.target.value;
              },
              onkeydown: (e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  addNote();
                }
              },
            }),
            p.error ? h("p", { class: "sw-error sw-pop-error", role: "alert" }, p.error) : null,
            h(
              "div",
              { class: "sw-pop-actions" },
              h("button", { class: "sw-btn secondary sm", type: "button", disabled: saving, onclick: back }, "Back"),
              h("button", { class: "sw-btn sm", type: "submit", disabled: saving, dataset: { fid: "pop.add" } }, saving ? h("span", { class: "sw-spinner" }) : icon("check"), "Add note"),
            ),
          ),
    );
  }

  /// Keep the popover on screen: flip it above the passage when there's no
  /// room below, clamp it to the window. (Phones get a bottom sheet.)
  function placePop() {
    const el = container.querySelector(".sw-pop");
    if (!el || !pop) return;
    if (window.matchMedia && window.matchMedia("(max-width: 640px)").matches) return;
    const r = el.getBoundingClientRect();
    const M = 8;
    let left = Math.min(pop.x, window.innerWidth - r.width - M);
    let top = pop.y;
    if (top + r.height > window.innerHeight - M) top = pop.y - 12 - r.height - (pop.h || 0);
    left = Math.max(M, left);
    top = Math.max(M, Math.min(top, window.innerHeight - r.height - M));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function resolutionBox(res) {
    const info = D.RESOLUTIONS[res.action] || { label: res.action, tone: "" };
    return h("div", { class: `sw-res ${res.action}` }, h("span", { class: "sw-res-k" }, `Writer: ${info.label.toLowerCase()}`), h("p", null, res.how));
  }

  /// One note: its kind, lines, quote and text; Edit/Delete while its round
  /// is still open; the writer's resolution once the redraft is in.
  function noteItem(n, note, editable, showQuote) {
    const k = D.noteKind(note.kind);
    const sum = D.chapterSummary(state, n);
    const stale = sum && note.revision !== sum.revision;
    const isEditing = editable && editing && editing.chapter === n && editing.id === note.id;
    const key = `note:${note.id}`;
    const working = busy.has(key);
    let body;
    if (isEditing) {
      const save = (e) => {
        e.preventDefault();
        saveEdit();
      };
      body = h(
        "form",
        { class: "sw-note-edit", onsubmit: save },
        h("textarea", {
          class: "sw-textarea sm",
          rows: 3,
          value: editing.draft,
          disabled: working,
          "aria-label": `Edit note ${note.id}`,
          placeholder: k.placeholder,
          dataset: { fid: `note.edit.body.${note.id}` },
          oninput: (e) => {
            editing.draft = e.target.value;
          },
          onkeydown: (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(e);
          },
        }),
        h(
          "div",
          { class: "sw-note-actions" },
          h(
            "button",
            {
              class: "sw-btn secondary sm",
              type: "button",
              disabled: working,
              onclick: () => {
                editing = null;
                focusFid = `note.edit.${note.id}`;
                render();
              },
            },
            "Cancel",
          ),
          h("button", { class: "sw-btn sm", type: "submit", disabled: working }, working ? h("span", { class: "sw-spinner" }) : icon("check"), "Save"),
        ),
      );
    } else {
      body = note.body
        ? h("p", { class: "sw-note-body" }, note.body)
        : h("p", { class: "sw-note-body sw-muted" }, note.kind === "shorten" ? "Shorten this passage." : note.kind === "expand" ? "Expand this passage." : "(no text)");
    }
    return h(
      "li",
      { class: `sw-note k-${note.kind}${note.resolution ? ` res-${note.resolution.action}` : ""}`, dataset: { noteId: note.id } },
      h(
        "div",
        { class: "sw-note-head" },
        h("span", { class: "sw-note-kind" }, icon(KIND_ICON[note.kind] || "chat"), k.label),
        h("span", { class: "sw-note-lines" }, `${note.id} · ${D.lineLabel(note)}`),
        stale ? h("span", { class: "sw-muted", title: `Written on draft revision ${note.revision}` }, `· revision ${note.revision}`) : null,
        h("span", { class: "sw-spacer" }),
        editable && !isEditing
          ? [
              h(
                "button",
                {
                  class: "sw-btn ghost sm",
                  type: "button",
                  disabled: working,
                  dataset: { fid: `note.edit.${note.id}` },
                  onclick: () => {
                    editing = { chapter: n, id: note.id, kind: note.kind, draft: note.body };
                    pop = null;
                    focusFid = `note.edit.body.${note.id}`;
                    render();
                  },
                },
                "Edit",
              ),
              h(
                "button",
                { class: "sw-btn danger-ghost sm", type: "button", disabled: working, dataset: { fid: `note.del.${note.id}` }, onclick: () => deleteNote(n, note.id) },
                working ? h("span", { class: "sw-spinner" }) : null,
                "Delete",
              ),
            ]
          : null,
      ),
      showQuote && note.quote ? h("blockquote", { class: "sw-note-quote" }, note.quote) : null,
      body,
      note.resolution ? resolutionBox(note.resolution) : null,
    );
  }

  /// "Your review": every round of this chapter, newest first — its draft
  /// revision, notes, status, and how the writer handled each note.
  function reviewTab(n) {
    const info = D.reviewInfo(state, n, cards);
    const rows = D.roundRows(state, n, cards);
    if (!rows.length) {
      const go = info.canReview
        ? h(
            "button",
            {
              class: "sw-btn secondary sm",
              type: "button",
              onclick: () => {
                drawer = { ...drawer, tab: "text" };
                render();
              },
            },
            icon("book"),
            "Go to the text",
          )
        : null;
      return empty(info.canReview ? "No notes yet. Open the text, then select a passage — or click a paragraph — to leave your first note." : info.why || "Nothing to review yet.", go);
    }
    return h("ol", { class: "sw-round-list" }, rows.map((r) => roundCard(n, r, info)));
  }

  function roundCard(n, r, info) {
    const open = r.status === "open";
    const pending = r.status === "changes_requested";
    const res = [r.fixed && `${r.fixed} fixed`, r.answered && `${r.answered} answered`, r.declined && `${r.declined} declined`].filter(Boolean).join(" · ");
    let sum;
    if (open) sum = r.notes.length ? `${plural(r.notes.length, "note")} not sent yet — they go to the writer when you request changes.` : "No notes yet.";
    else if (r.status === "approved") sum = r.notes.length ? `Approved with ${plural(r.notes.length, "note")} not sent.` : "You approved this draft.";
    else sum = `${r.notes.length ? `${plural(r.notes.length, "note")} sent` : "Overall note sent"}${res ? ` · ${res}` : r.unresolved ? " · waiting for the writer" : ""}.`;
    return h(
      "li",
      { class: `sw-round-card ${r.status}` },
      h(
        "div",
        { class: "sw-round-card-head" },
        h("strong", null, `Round ${r.round}`),
        badge(r.statusInfo.tone, r.statusInfo.label),
        h("span", { class: "sw-muted" }, `Draft revision ${r.draftRevision}`),
        r.revised_revision ? h("span", { class: "sw-muted" }, `→ redraft: revision ${r.revised_revision}`) : null,
        h("span", { class: "sw-spacer" }),
        h("span", { class: "sw-muted" }, fmtDate(r.decided_at || r.opened_at)),
      ),
      h("p", { class: "sw-round-sum" }, sum),
      pending && info.phase
        ? h(
            "div",
            { class: `sw-round-unit${info.phase.key === "failed" ? " failed" : ""}` },
            info.phase.key === "failed" ? icon("alert") : h("span", { class: "sw-spinner", "aria-hidden": "true" }),
            h("span", null, `Now: ${info.phase.label}`),
            h("span", { class: "sw-spacer" }),
            info.phase.key === "failed" && info.phase.unit ? retryBtn(info.phase.unit) : sessionBtn(info.phase.status && info.phase.status.sessionId, "Open session"),
          )
        : null,
      r.notes.length ? h("ul", { class: "sw-note-list" }, r.notes.map((note) => noteItem(n, note, open, true))) : null,
      r.summary
        ? h(
            "div",
            { class: "sw-round-overall" },
            h("span", { class: "sw-setup-k" }, "Overall note"),
            h("p", null, r.summary),
            r.summary_to_rules ? h("span", { class: "sw-tag" }, icon("check"), "Added to the story's rules") : null,
          )
        : null,
    );
  }

  /// The drawer footer: this round's note count with Request changes and
  /// Approve (the pilot gate's own approval at the gate); the redraft's
  /// progress while one runs; why not, when the chapter isn't reviewable.
  function reviewBar(n) {
    const info = D.reviewInfo(state, n, cards);
    const g = D.gateInfo(state);
    const gate = n === 1 && g.active;
    if (info.pending) {
      const ph = info.phase;
      const failed = ph.key === "failed";
      return h(
        "div",
        { class: "sw-review-bar" },
        h(
          "span",
          { class: `sw-review-status${failed ? " failed" : ""}` },
          failed ? icon("alert") : h("span", { class: "sw-spinner", "aria-hidden": "true" }),
          h("span", null, h("strong", null, `Round ${info.pending.round} sent. `), `${ph.label}.`),
        ),
        h("span", { class: "sw-spacer" }),
        failed && ph.unit ? retryBtn(ph.unit) : sessionBtn(ph.status && ph.status.sessionId, "Open session"),
        gate ? approveControls("drawer") : null,
      );
    }
    if (!info.canReview) {
      return [h("p", { class: "sw-muted sw-fb-closed" }, info.why), gate ? h("div", { class: "sw-drawer-approve" }, approveControls("drawer")) : null];
    }
    if (requesting && requesting.chapter === n) return requestForm(n, info);
    const count = info.notes.length;
    return h(
      "div",
      { class: "sw-review-bar" },
      h(
        "span",
        { class: "sw-review-count" },
        icon("note"),
        h(
          "span",
          null,
          h("strong", null, `Round ${info.roundNo}`),
          ` · ${count ? `${plural(count, "note")} not sent yet` : "no notes yet"}`,
          // Approve waits for them (SW-15): say so where the count is.
          count ? h("span", { class: "sw-approve-hint" }, `Send or delete ${count === 1 ? "it" : "them"} to approve.`) : null,
        ),
      ),
      h("span", { class: "sw-spacer" }),
      gate && g.openPilotRevision
        ? null
        : h(
            "button",
            {
              class: "sw-btn secondary",
              type: "button",
              dataset: { fid: "req.open" },
              onclick: () => {
                requesting = { chapter: n, summary: "", toRules: true };
                confirming = false;
                focusFid = "req.summary";
                render();
              },
            },
            icon("send"),
            count ? `Request changes · ${count}` : "Request changes…",
          ),
      gate ? approveControls("drawer") : approveChapterControls(n, info),
    );
  }

  /// Approve chapter. Waits while the round has notes not sent (SW-15):
  /// they reach the writer only through Request changes, so the owner sends
  /// or deletes them first — the server refuses an approval with them too.
  function approveChapterControls(n, info) {
    const key = `decide:${n}`;
    const count = info.notes.length;
    if (info.approved && !count) return badge("ok", `Approved · revision ${info.revision}`);
    return h(
      "button",
      {
        class: "sw-btn",
        type: "button",
        disabled: busy.has(key) || count > 0,
        title: count ? unsentHint(count) : null,
        dataset: { fid: "ch.approve" },
        onclick: () => approveChapter(n),
      },
      busy.has(key) ? h("span", { class: "sw-spinner" }) : icon("check"),
      "Approve chapter",
    );
  }

  /// "Request changes": an optional overall note (added to the story's
  /// rules unless unticked) sent with every note of the round.
  function requestForm(n, info) {
    const r = requesting;
    const count = info.notes.length;
    const sending = busy.has(`decide:${n}`);
    const can = count > 0 || !!String(r.summary || "").trim();
    const submit = (e) => {
      e.preventDefault();
      requestChanges(n);
    };
    return h(
      "form",
      { class: "sw-fb sw-req", onsubmit: submit },
      h(
        "label",
        { class: "sw-label", for: `sw-req-${n}` },
        `Request changes on ${n === 1 ? "the pilot" : `chapter ${n}`}`,
        h(
          "span",
          { class: "sw-hint" },
          count
            ? `Your ${plural(count, "note")} go to the writer, anchored to their lines. The redraft is cold-read again and comes back as round ${info.roundNo + 1}.`
            : `No line notes yet — the overall note goes to the writer. The redraft comes back as round ${info.roundNo + 1}.`,
        ),
      ),
      h("textarea", {
        id: `sw-req-${n}`,
        class: "sw-textarea sm",
        rows: 3,
        value: r.summary,
        disabled: sending,
        placeholder: "Overall note (optional) — anything about the whole chapter, e.g. “Keep Mara cold until the last scene.”",
        dataset: { fid: "req.summary" },
        oninput: (e) => {
          r.summary = e.target.value;
          const b = container.querySelector('[data-fid="req.send"]');
          if (b) b.disabled = !(count > 0 || e.target.value.trim());
        },
        onkeydown: (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        },
      }),
      h(
        "label",
        { class: "sw-check" },
        h("input", {
          type: "checkbox",
          checked: r.toRules,
          disabled: sending,
          dataset: { fid: "req.rules" },
          onchange: (e) => {
            r.toRules = e.target.checked;
          },
        }),
        "Also add the overall note to the story's rules, so every later chapter follows it",
      ),
      h(
        "div",
        { class: "sw-fb-actions" },
        h(
          "button",
          {
            class: "sw-btn secondary",
            type: "button",
            disabled: sending,
            dataset: { fid: "req.cancel" },
            onclick: () => {
              requesting = null;
              focusFid = "req.open";
              render();
            },
          },
          "Cancel",
        ),
        h("span", { class: "sw-spacer" }),
        h(
          "button",
          { class: "sw-btn", type: "submit", disabled: sending || !can, dataset: { fid: "req.send" } },
          sending ? h("span", { class: "sw-spinner" }) : icon("send"),
          count ? `Send ${plural(count, "note")}` : "Send",
        ),
      ),
    );
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  const onVisible = () => {
    if (document.visibilityState === "visible" && wantsCards()) scheduleCards(CARDS_SOON_MS);
  };
  document.addEventListener("visibilitychange", onVisible);
  // A press outside the note popover (and outside the text it annotates)
  // closes it, the way PeckBoard's Review page does.
  const onDocDown = (e) => {
    if (!e.target || !e.target.closest) return;
    dragging = e.button === 0 && !!e.target.closest(".sw-prose.annotatable");
    if (!pop) return;
    if (e.target.closest(".sw-pop") || e.target.closest(".sw-prose.annotatable")) return;
    pop = null;
    render();
  };
  const onDocUp = () => {
    dragging = false;
  };
  document.addEventListener("mousedown", onDocDown);
  document.addEventListener("mouseup", onDocUp, true);

  render();
  if (wantsCards()) loadCards();
  else scheduleCards(CARDS_POLL_MS);

  return {
    update,
    notify(text, tone) {
      notice = { tone: tone || "info", text };
      render();
    },
    destroy() {
      destroyed = true;
      clearTimeout(cardsTimer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("mouseup", onDocUp, true);
      window.removeEventListener("scroll", hideTip, true);
      container.removeEventListener("mouseover", onOver);
      container.removeEventListener("focusin", onOver);
      container.removeEventListener("mouseleave", hideTip);
      container.removeEventListener("focusout", hideTip);
      document.documentElement.classList.remove("sw-noscroll");
      tip.remove();
    },
  };
}
