// Dashboard model: stage summaries, per-unit worker status, the per-chapter
// progress grid and the record viewers' tables, derived from what GET /state
// and GET /cards return. Pure functions only (no DOM, no bridge) so vitest
// can cover them.

// ── Catalogs ─────────────────────────────────────────────────────────────

export const PASSES = [
  { id: "structure", label: "Structure", short: "Struct." },
  { id: "character", label: "Character", short: "Char." },
  { id: "pacing", label: "Pacing", short: "Pacing" },
  { id: "line", label: "Line", short: "Line" },
  { id: "copyedit", label: "Copyedit", short: "Copy" },
  { id: "ai-tell", label: "AI-tell", short: "AI-tell" },
  { id: "echo-word", label: "Echo words", short: "Echo" },
  { id: "sentence-shape", label: "Sentence shape", short: "Shape" },
];

/// Cold-read item categories (src/types.ts COLD_READ_CATEGORIES). Every one
/// but "obvious" is a point of confusion; "obvious" (over-explained, §1D
/// "Don't state the obvious") is counted and filtered on its own.
export const COLD_CATEGORIES = [
  { id: "unexplained", label: "Unexplained name or term", hint: "Used before the text says who or what it is" },
  { id: "speaker", label: "Unclear speaker", hint: "Who is talking, or who a he, she or it is" },
  { id: "orientation", label: "Unclear place or time", hint: "Where we are, when, or how much time has passed" },
  { id: "motive", label: "Unexplained motive", hint: "Why someone does what they do" },
  { id: "reread", label: "Had to re-read", hint: "The reader had to guess, or read it twice" },
  { id: "contradiction", label: "Contradiction", hint: "Contradicts something earlier" },
  { id: "other", label: "Other confusion", hint: null },
  { id: "obvious", label: "Over-explained / obvious", hint: "Explains common sense, or repeats what the line before made clear" },
];

export function coldCategory(id) {
  return COLD_CATEGORIES.find((c) => c.id === id) || COLD_CATEGORIES.find((c) => c.id === "other");
}

/// C3: at most this many unexplained names/terms/rules per scene, and each
/// answered within this many chapters (the dashboard flags the rest).
export const UNEXPLAINED_CAP = 3;
export const UNANSWERED_LIMIT = 2;

export const STAGES = [
  {
    id: "records",
    label: "Records",
    blurb: "Character sheets, who-knows-what, setups and the rest of the story's memory, built before the first sentence.",
  },
  {
    id: "pilot",
    label: "Pilot chapter",
    blurb: "Chapter 1, written first so you can check the voice and direction before the rest of the book.",
  },
  {
    id: "cold_read",
    label: "Cold read",
    blurb: "A fresh reader who has never seen the brief, records or cards reads the pilot once, as a player would, and reports every point of confusion and every over-explained line.",
  },
  {
    id: "cold_fix",
    label: "Cold-read fix",
    blurb: "The writer fixes every item the cold reader reported — confusion is the text's fault — and records what changed for each. The pilot reaches you once every item is fixed.",
  },
  {
    id: "pilot_review",
    label: "Your review",
    blurb: "Read the pilot, then approve it or send feedback. Feedback on any chapter becomes a revision card, listed here.",
  },
  {
    id: "chapters",
    label: "Chapters",
    blurb: "The remaining chapters, written in parallel once you approve the pilot. Each gets its own cold read and cold-read fix before the review passes.",
  },
  {
    id: "review",
    label: "Review passes",
    blurb: "Each chapter goes through structure, character, pacing, line and copyedit passes, then the AI-tell, echo-word and sentence-shape passes.",
  },
  { id: "final", label: "Final", blurb: "Every chapter has been through every pass. Export the manuscript." },
];

const ORDER = ["setup", "records", "pilot", "pilot_review", "chapters", "review", "final"];

// The timeline splits the engine's "pilot" stage into the pilot draft and
// its cold-read chain (C1 read, C2 fix), which both run before your review.
const STEPS = ["setup", "records", "pilot", "cold_read", "cold_fix", "pilot_review", "chapters", "review", "final"];

export const STAGE_STATUS_LABEL = {
  done: "Done",
  active: "In progress",
  blocked: "Needs attention",
  waiting: "Waiting on you",
  pending: "Not started",
};

export function stageIndex(stage) {
  return ORDER.indexOf(stage);
}

export function stepIndex(step) {
  return STEPS.indexOf(step);
}

/// The timeline step the pipeline is on: the engine's stage, except that its
/// "pilot" stage reads as Pilot chapter -> Cold read -> Cold-read fix.
export function currentStep(state) {
  const e = engineOf(state);
  if (e.stage !== "pilot") return e.stage;
  const pilot = e.units.pilot;
  if (!pilot || pilot.status !== "done") return "pilot";
  const read = e.units["cold_read:1"];
  return read && read.status === "done" ? "cold_fix" : "cold_read";
}

function pl(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + "s"}`;
}

export function passLabel(pass) {
  const p = PASSES.find((x) => x.id === pass);
  return p ? p.label : String(pass || "");
}

// ── Basics ───────────────────────────────────────────────────────────────

export function engineOf(state) {
  const e = (state && state.engine) || {};
  return { stage: e.stage || "setup", approved: !!e.approved, finished: !!e.finished, units: e.units || {}, cursors: e.cursors || {}, note: e.note || null };
}

export function chapterCount(state) {
  const n = state && state.brief && state.brief.basics && state.brief.basics.chapter_count;
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function isVN(state) {
  return !!(state && state.brief && state.brief.basics && state.brief.basics.format === "vn");
}

export function chapterSummary(state, n) {
  return ((state && state.chapters) || []).find((c) => c.chapter === n) || null;
}

/// Engine units in pipeline order: records; then per chapter its draft,
/// cold read and cold-read fixes; reviews (by chapter, then pass);
/// revisions; ties by creation time.
export function sortedUnits(state) {
  const rank = { records: 0, pilot: 1, chapter: 1, cold_read: 1, cold_read_fix: 1, review: 3, revision: 4, generate: 5 };
  const within = { cold_read: 1, cold_read_fix: 2 };
  return Object.values(engineOf(state).units).sort((a, b) => {
    const ka = [rank[a.kind] ?? 9, a.chapter ?? 0, within[a.kind] ?? 0, passIndexOf(a), a.created_at || ""];
    const kb = [rank[b.kind] ?? 9, b.chapter ?? 0, within[b.kind] ?? 0, passIndexOf(b), b.created_at || ""];
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

function passIndexOf(u) {
  const pass = u.pass || (u.id && u.id.startsWith("revision:review:") ? u.id.split(":")[3] : null);
  const i = PASSES.findIndex((p) => p.id === pass);
  return i < 0 ? -1 : i;
}

export function isFeedbackRevision(u) {
  return !!(u && u.id && u.id.startsWith("revision:fb:"));
}

export function unitLabel(u) {
  switch (u.kind) {
    case "records":
      return "Story records";
    case "pilot":
      return "Pilot chapter";
    case "chapter":
      return `Chapter ${u.chapter}`;
    case "review":
      return `Chapter ${u.chapter} · ${passLabel(u.pass)} pass`;
    case "revision":
      if (isFeedbackRevision(u)) return `Chapter ${u.chapter} · revision from your feedback`;
      return `Chapter ${u.chapter} · ${passLabel(u.id.split(":")[3])} revision`;
    case "cold_read":
      return u.chapter === 1 ? "Pilot · cold read" : `Chapter ${u.chapter} · cold read`;
    case "cold_read_fix":
      return u.chapter === 1 ? "Pilot · cold-read fixes" : `Chapter ${u.chapter} · cold-read fixes`;
    case "generate":
      return `${String(u.element || "").replace(/_/g, " ")} draft`;
    default:
      return u.id;
  }
}

/// Which dashboard step a unit is listed under. The pilot's cold read and
/// fixes have their own steps; a later chapter's stay with Chapters.
/// Revisions from the owner's feedback (on the pilot or any chapter) live
/// under "Your review", the owner's stage; revisions a review pass asked
/// for stay with the review passes.
export function stageOfUnit(u) {
  switch (u.kind) {
    case "records":
      return "records";
    case "pilot":
      return "pilot";
    case "chapter":
      return "chapters";
    case "review":
      return "review";
    case "revision":
      return isFeedbackRevision(u) ? "pilot_review" : "review";
    case "cold_read":
      return u.chapter === 1 ? "cold_read" : "chapters";
    case "cold_read_fix":
      return u.chapter === 1 ? "cold_fix" : "chapters";
    default:
      return "setup";
  }
}

// ── Worker status ────────────────────────────────────────────────────────

/// Where one unit's card stands, combining the engine's view (open / done /
/// failed) with the board's (step, blocked, worker session). `cards` is the
/// GET /cards map, or null before it has loaded.
export function unitStatus(unit, cards) {
  if (!unit) return { key: "pending", tone: "muted", label: "Not started", detail: null, sessionId: null, card: null };
  const listed = unit.card_id && cards ? cards[unit.card_id] || null : null;
  const card = listed && !listed.missing ? listed : null;
  const sessionId = card ? card.worker_session_id || card.last_worker_session_id || null : null;
  const out = (key, tone, label, detail) => ({ key, tone, label, detail: detail || null, sessionId, card });
  if (unit.status === "failed") return out("failed", "err", "Failed", unit.note || "The card was closed without finishing.");
  if (unit.status === "done") return out("done", "ok", "Done");
  if (!unit.card_id) return out("queued", "muted", "Queued", "The card is created on the next pipeline run.");
  if (listed && listed.missing) return out("missing", "warn", "Card not found", "It may have been deleted from the board.");
  // Not in the last /cards listing (or none yet): created since then.
  if (!card) return out("open", "muted", "Open");
  if (card.blocked) return out("blocked", "warn", "Blocked", card.block_reason || null);
  if (card.worker_session_id) return out("working", "busy", card.step === "review" ? "Card in review" : "Working", null);
  return out("waiting", "muted", "Waiting for a worker", card.step ? `On the board: ${card.step.replace(/_/g, " ")}` : null);
}

export function failedUnits(state) {
  return sortedUnits(state).filter((u) => u.status === "failed" && u.kind !== "generate");
}

// ── Stages ───────────────────────────────────────────────────────────────

/// Passes finished per chapter (0..8), from the review cursors.
export function passesDone(state) {
  const { cursors, stage } = engineOf(state);
  if (stageIndex(stage) < stageIndex("review")) return 0;
  let done = 0;
  for (const c of Object.values(cursors)) done += c.waiting === "done" ? PASSES.length : Math.min(c.pass_index, PASSES.length);
  return done;
}

export function stageSummaries(state, cards) {
  const engine = engineOf(state);
  const at = stepIndex(currentStep(state));
  const n = chapterCount(state);
  const units = sortedUnits(state).filter((u) => u.kind !== "generate");
  const notes = (state && state.pipeline && state.pipeline.stages) || {};
  const cold = coldReadProgress(state, 1);
  return STAGES.map((s) => {
    const idx = stepIndex(s.id);
    const mine = units.filter((u) => stageOfUnit(u) === s.id);
    const failed = mine.filter((u) => u.status === "failed").length;
    const working = cards ? mine.filter((u) => unitStatus(u, cards).key === "working").length : 0;
    let status = idx < at ? "done" : idx === at ? "active" : "pending";
    if (s.id === "final" && engine.finished) status = "done";
    // The gate waits on the owner, except while a revision they asked for runs.
    if (status === "active" && s.id === "pilot_review" && !mine.some((u) => u.status === "open")) status = "waiting";
    if (failed && status !== "pending") status = "blocked";

    let done = 0;
    let total = 0;
    let sub = "";
    if (s.id === "records" || s.id === "pilot") {
      total = 1;
      done = mine.some((u) => u.kind === s.id && u.status === "done") || idx < at ? 1 : 0;
      sub = done ? "Done" : status === "pending" ? "" : working ? "Writing" : "In progress";
    } else if (s.id === "cold_read") {
      total = 1;
      done = cold.read && cold.read.status === "done" ? 1 : 0;
      // Pipelines started before cold reads existed went past without one.
      if (!cold.read) sub = status === "done" ? "Not run" : "";
      else if (done) sub = cold.total ? `${pl(cold.total, "item")} found` : "Nothing found";
      else if (status !== "pending") sub = working ? "Reading" : "Waiting for a reader";
    } else if (s.id === "cold_fix") {
      total = cold.total;
      done = cold.fixed;
      if (!cold.read || cold.read.status !== "done") sub = status === "done" ? "Not run" : "";
      else if (!cold.total) sub = "Nothing to fix";
      else sub = `${cold.fixed} / ${cold.total} fixed`;
    } else if (s.id === "pilot_review") {
      total = mine.length;
      done = mine.filter((u) => u.status === "done").length;
      const open = mine.filter((u) => u.status === "open").length;
      const plural = (k) => `${k} revision${k === 1 ? "" : "s"}`;
      if (engine.stage === "pilot_review") sub = open ? `Revising · ${open} open` : "Waiting on you";
      else if (engine.approved) sub = open ? `${plural(open)} open` : total ? `Approved · ${plural(total)}` : "Approved";
    } else if (s.id === "chapters") {
      total = Math.max(0, n - 1);
      done = mine.filter((u) => u.kind === "chapter" && u.status === "done").length;
      const reading = mine.filter((u) => (u.kind === "cold_read" || u.kind === "cold_read_fix") && u.status === "open").length;
      sub =
        total === 0
          ? "Single chapter"
          : status === "pending" && !mine.length
            ? `${total} to write`
            : reading && done === total
              ? `${reading} in cold read`
              : `${done} / ${total} written`;
    } else if (s.id === "review") {
      total = n * PASSES.length;
      done = passesDone(state);
      sub = status === "pending" ? `${total} passes` : `${done} / ${total} passes`;
    } else {
      sub = engine.finished ? "Ready to export" : "";
    }
    const noteKey = s.id === "cold_read" || s.id === "cold_fix" ? null : s.id;
    const note = noteKey && notes[noteKey] && notes[noteKey].note ? notes[noteKey].note : null;
    return { ...s, status, units: mine, failed, working, done, total, sub, note };
  });
}

// ── Owner gate ───────────────────────────────────────────────────────────

export function gateInfo(state) {
  const engine = engineOf(state);
  const n = chapterCount(state);
  const openPilotRevision = Object.values(engine.units).some((u) => u.kind === "revision" && u.chapter === 1 && u.status === "open");
  const active = engine.stage === "pilot_review";
  const cold = coldReadProgress(state, 1);
  // Pipelines started before cold reads existed reached the gate without one.
  const coldClear = cold.read ? cold.clear : true;
  // Written, but its cold read and fixes haven't cleared: the owner can read
  // the pilot, not approve it yet.
  const pilot = engine.units.pilot;
  const notReady = engine.stage === "pilot" && !!pilot && pilot.status === "done";
  return {
    active,
    notReady,
    cold,
    coldClear,
    openPilotRevision,
    canApprove: active && !openPilotRevision && coldClear,
    remaining: Math.max(0, n - 1),
    approved: engine.approved,
  };
}

/// Feedback is accepted from the owner gate onward, on the pilot or any
/// chapter that has text (the server enforces the same rule).
export function canGiveFeedback(state, chapter) {
  if (stageIndex(engineOf(state).stage) < stageIndex("pilot_review")) return false;
  return chapter === 1 || !!chapterSummary(state, chapter);
}

// ── Chapter grid ─────────────────────────────────────────────────────────

function cell(key, tone, label, detail, extra) {
  return { key, tone, label, detail: detail || null, ...(extra || {}) };
}

export function draftCell(state, n, cards) {
  const unit = engineOf(state).units[n === 1 ? "pilot" : `chapter:${n}`];
  const doc = chapterSummary(state, n);
  const st = unitStatus(unit, cards);
  const rev = doc ? `revision ${doc.revision}` : null;
  if (st.key === "failed") return cell("failed", "err", "Failed", st.detail, { unit, sessionId: st.sessionId });
  if (doc && (!unit || unit.status === "done")) return cell("done", "ok", "Written", rev, { unit, sessionId: st.sessionId });
  if (!unit) return cell("pending", "muted", "Not started", null);
  if (st.key === "working") return cell("working", "busy", "Writing", rev, { unit, sessionId: st.sessionId });
  return cell(st.key, st.tone, st.label, st.detail, { unit, sessionId: st.sessionId });
}

export function reviewOf(state, n, pass) {
  return ((state && state.reviews) || []).find((r) => r.chapter === n && r.pass === pass) || null;
}

export function passCell(state, n, passIdx, cards) {
  const { units, cursors } = engineOf(state);
  const pass = PASSES[passIdx].id;
  const cursor = cursors[String(n)] || null;
  const unit = units[`review:${n}:${pass}`];
  const revision = units[`revision:review:${n}:${pass}`];
  const doc = reviewOf(state, n, pass);
  const rounds = doc ? doc.rounds.length : 0;
  const last = rounds ? doc.rounds[rounds - 1] : null;
  const st = unitStatus(unit, cards);
  const extra = { unit, rounds, sessionId: st.sessionId };

  if (st.key === "failed") return cell("failed", "err", "Failed", st.detail, extra);
  if (revision && revision.status === "failed") return cell("failed", "err", "Revision failed", revision.note, { ...extra, unit: revision });
  if (cursor && cursor.pass_index === passIdx && cursor.waiting === "revision") {
    const rs = unitStatus(revision, cards);
    return cell("revising", "busy", "Revising", last ? last.notes : null, { ...extra, unit: revision, sessionId: rs.sessionId });
  }
  if (unit && unit.status === "open") {
    const round = cursor && cursor.pass_index === passIdx && cursor.round > 1 ? `round ${cursor.round}` : null;
    if (st.key === "working") return cell("working", "busy", "Reviewing", round, extra);
    return cell(st.key, st.tone, st.label, round || st.detail, extra);
  }
  const passed = !!cursor && (cursor.waiting === "done" || passIdx < cursor.pass_index);
  if (passed || (unit && unit.status === "done")) {
    if (last && last.verdict === "changes_requested") {
      return cell("changes", "warn", passed ? "Changes requested · moved on" : "Changes requested", last.notes, extra);
    }
    const after = rounds > 1 ? `Passed after ${rounds} rounds` : "Passed";
    return cell("passed", "ok", after, last ? last.notes : "No report filed", extra);
  }
  return cell("pending", "muted", "Not started", null, extra);
}

export function chapterRows(state, cards) {
  const n = chapterCount(state);
  const { units } = engineOf(state);
  const feedback = (state && state.feedback) || [];
  const rows = [];
  for (let c = 1; c <= n; c++) {
    const revisions = Object.values(units).filter((u) => u.kind === "revision" && u.chapter === c);
    const doc = chapterSummary(state, c);
    rows.push({
      chapter: c,
      pilot: c === 1,
      draft: draftCell(state, c, cards),
      cold: coldReadCell(state, c, cards),
      fix: coldFixCell(state, c, cards),
      passes: PASSES.map((_p, i) => passCell(state, c, i, cards)),
      revising: revisions.some((u) => u.status === "open"),
      revisions: revisions.length,
      feedback: feedback.filter((f) => f.chapter === c && f.source === "owner").length,
      written: !!doc,
      revision: doc ? doc.revision : 0,
      length: doc ? doc.length : 0,
    });
  }
  return rows;
}

// ── Cold read (C1) and cold-read fixes (C2) ───────────────────────────────

export function coldReadOf(state, n) {
  return ((state && state.cold_reads) || []).find((d) => d.chapter === n) || null;
}

function isFixed(item) {
  return item.fix !== null && item.fix !== undefined && String(item.fix).trim() !== "";
}

/// One chapter's cold-read chain: the read (C1) and fix (C2) units, the
/// report, and its item counts — confusion and over-explained apart.
/// `clear` = read, and nothing left to fix: the chapter may move on.
export function coldReadProgress(state, n) {
  const { units } = engineOf(state);
  const read = units[`cold_read:${n}`] || null;
  const fix = units[`cold_read_fix:${n}`] || null;
  const doc = coldReadOf(state, n);
  const items = (doc && doc.items) || [];
  const obvious = items.filter((i) => i.category === "obvious");
  const confusion = items.filter((i) => i.category !== "obvious");
  const fixed = items.filter(isFixed).length;
  const readDone = !!read && read.status === "done";
  const clear = readDone && !!doc && (items.length === 0 || (fixed === items.length && (!fix || fix.status === "done")));
  return {
    read,
    fix,
    doc,
    total: items.length,
    fixed,
    open: items.length - fixed,
    confusion: { total: confusion.length, fixed: confusion.filter(isFixed).length },
    obvious: { total: obvious.length, fixed: obvious.filter(isFixed).length },
    clear,
  };
}

function itemsDetail(p) {
  const parts = [];
  if (p.confusion.total) parts.push(pl(p.confusion.total, "confusion item"));
  if (p.obvious.total) parts.push(`${p.obvious.total} over-explained`);
  return parts.join(" · ");
}

export function coldReadCell(state, n, cards) {
  const p = coldReadProgress(state, n);
  const st = unitStatus(p.read, cards);
  const extra = { unit: p.read, sessionId: st.sessionId };
  if (!p.read) return cell("pending", "muted", "Not started", n === 1 ? "Starts once the pilot is written" : "Starts once the chapter is written", extra);
  if (st.key === "failed") return cell("failed", "err", "Failed", st.detail, extra);
  if (p.read.status === "done") {
    if (!p.total) return cell("passed", "ok", "Nothing found", "The cold reader reported no confusion and nothing over-explained", extra);
    // Once every item is fixed the read needs nothing more from anyone.
    if (!p.open) return cell("passed", "ok", `${pl(p.total, "item")} found · all fixed`, itemsDetail(p), extra);
    return cell("flagged", "warn", `${pl(p.total, "item")} found`, itemsDetail(p), extra);
  }
  if (st.key === "working") return cell("working", "busy", "Reading", null, extra);
  return cell(st.key, st.tone, st.label, st.detail, extra);
}

export function coldFixCell(state, n, cards) {
  const p = coldReadProgress(state, n);
  const st = unitStatus(p.fix, cards);
  const extra = { unit: p.fix, sessionId: st.sessionId };
  if (!p.read || p.read.status !== "done") return cell("pending", "muted", "Not started", "Starts after the cold read", extra);
  if (!p.total) return cell("passed", "ok", "Nothing to fix", null, extra);
  const progress = `${p.fixed} of ${p.total} fixed`;
  if (st.key === "failed") return cell("failed", "err", "Failed", st.detail, extra);
  if (p.fix && p.fix.status === "done") return cell("done", "ok", `All ${p.total} fixed`, itemsDetail(p), extra);
  if (!p.fix) return cell("queued", "muted", "Queued", progress, extra);
  if (st.key === "working") return cell("working", "busy", "Fixing", progress, extra);
  return cell(st.key, st.tone, st.label, st.detail ? `${progress} · ${st.detail}` : progress, extra);
}

/// The cold-read viewer: every item with its category and fix status,
/// filtered by category ("all", "confusion" = every kind but obvious,
/// "obvious", or one category id) and status ("all" / "open" / "fixed"),
/// plus the first-three-lines check and the first-appearance list.
export function coldReadView(state, n, filter) {
  const { category = "all", status = "all" } = filter || {};
  const p = coldReadProgress(state, n);
  const items = ((p.doc && p.doc.items) || []).map((i) => {
    const cat = coldCategory(i.category);
    return { ...i, cat, obvious: cat.id === "obvious", fixed: isFixed(i) };
  });
  const byCategory = {};
  for (const i of items) byCategory[i.cat.id] = (byCategory[i.cat.id] || 0) + 1;
  const inCategory = (i) => category === "all" || (category === "confusion" ? !i.obvious : i.cat.id === category);
  const pool = items.filter(inCategory);
  const shown = pool.filter((i) => status === "all" || (status === "fixed" ? i.fixed : !i.fixed));
  const f = p.doc && p.doc.first_three_lines;
  const checks = f
    ? [
        { key: "narrator", label: "Who the narrator is", ok: !!f.narrator },
        { key: "want", label: "What they want right now", ok: !!f.want },
        { key: "tension", label: "What the tension is", ok: !!f.tension },
        { key: "clear", label: "Clear overall", ok: !!f.clear },
      ]
    : [];
  return {
    ...p,
    items,
    shown,
    byCategory,
    counts: { all: pool.length, open: pool.filter((i) => !i.fixed).length, fixed: pool.filter((i) => i.fixed).length },
    checks,
    characters: (p.doc && p.doc.characters) || [],
  };
}

/// Chapters with a cold read under way or on file, in order.
export function coldReadChapters(state) {
  const n = chapterCount(state);
  const out = [];
  for (let c = 1; c <= n; c++) if (coldReadOf(state, c) || engineOf(state).units[`cold_read:${c}`]) out.push(c);
  return out;
}

// ── Characters (shared by every record viewer) ──────────────────────────

/// The cast: the living records' character sheets, or the wizard's before
/// the records stage has produced any.
export function castOf(state) {
  const recs = (state && state.records && state.records.characters) || [];
  if (recs.length) return { source: "records", list: recs };
  const fromBrief = (state && state.brief && state.brief.elements && state.brief.elements.characters) || [];
  return { source: "brief", list: fromBrief };
}

/// Resolves a character reference (an id or a name, any case) to a stable
/// key and a display name; unknown names keep their own text.
export function characterResolver(cast) {
  const byKey = new Map();
  for (const c of cast) {
    if (c.id) byKey.set(String(c.id).toLowerCase(), c);
    if (c.name) byKey.set(String(c.name).trim().toLowerCase(), c);
  }
  return (ref) => {
    const raw = String(ref == null ? "" : ref).trim();
    const c = byKey.get(raw.toLowerCase());
    if (c) return { key: `id:${c.id || c.name}`, name: c.name || c.id, known: true };
    return { key: `name:${raw.toLowerCase()}`, name: raw || "Unknown", known: false };
  };
}

function people(cast, resolve, refs) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (seen.has(p.key)) return;
    seen.add(p.key);
    out.push(p);
  };
  for (const c of cast) add(resolve(c.id || c.name));
  for (const r of refs) if (String(r || "").trim()) add(resolve(r));
  return out;
}

// ── Emotions & attitudes ─────────────────────────────────────────────────

export function chapterStates(state) {
  return ((state && state.records && state.records.chapter_state) || []).slice().sort((a, b) => a.chapter - b.chapter);
}

/// Characters (rows) × chapters with a recorded state (columns) → emotion.
export function emotionTimeline(state) {
  const cast = castOf(state).list;
  const resolve = characterResolver(cast);
  const states = chapterStates(state);
  const refs = [];
  for (const s of states) refs.push(...Object.keys(s.emotions || {}));
  const rows = people(cast, resolve, refs).map((p) => ({ ...p, cells: {} }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const s of states) {
    for (const [who, emotion] of Object.entries(s.emotions || {})) {
      const row = byKey.get(resolve(who).key);
      if (row) row.cells[s.chapter] = emotion;
    }
  }
  return { chapters: states.map((s) => s.chapter), rows };
}

/// Every from -> to attitude as of `chapter` (0 = the character sheets'
/// starting attitudes): the latest recorded one at or before it, flagged
/// `changed` when that chapter is where it was set.
export function attitudesAt(state, chapter) {
  const cast = castOf(state).list;
  const resolve = characterResolver(cast);
  const cells = new Map();
  const refs = [];
  for (const c of cast) {
    for (const a of c.attitudes || []) {
      refs.push(a.toward);
      cells.set(`${resolve(c.id || c.name).key}>${resolve(a.toward).key}`, { attitude: a.attitude || "", reason: a.reason || "", chapter: 0, changed: chapter === 0 });
    }
  }
  let current = null;
  for (const s of chapterStates(state)) {
    if (s.chapter > chapter) break;
    if (s.chapter === chapter) current = s;
    for (const a of s.attitudes || []) {
      refs.push(a.from, a.to);
      cells.set(`${resolve(a.from).key}>${resolve(a.to).key}`, { attitude: a.attitude || "", reason: a.reason || "", chapter: s.chapter, changed: s.chapter === chapter });
    }
  }
  const list = people(cast, resolve, refs);
  return {
    people: list,
    state: current,
    get: (fromKey, toKey) => cells.get(`${fromKey}>${toKey}`) || null,
  };
}

// ── Who knows what ───────────────────────────────────────────────────────

export function knowledgeRoutes(state) {
  const facts = (state && state.records && state.records.knowledge) || [];
  const routes = [];
  for (const f of facts) {
    const r = f.route || "common";
    if (r !== "common" && !routes.includes(r)) routes.push(r);
  }
  return routes;
}

/// Facts (rows) × characters (columns) for one route ("all", "common", or a
/// route name — a route's view includes the common facts) as of a chapter
/// (null = latest).
export function knowledgeMatrix(state, route, asOf) {
  const facts = ((state && state.records && state.records.knowledge) || []).filter((f) => {
    const r = f.route || "common";
    return route === "all" || r === route || (route !== "common" && r === "common");
  });
  const cast = castOf(state).list;
  const resolve = characterResolver(cast);
  const refs = [];
  for (const f of facts) for (const k of f.known_by || []) refs.push(k.character);
  const cols = people(cast, resolve, refs);
  const rows = facts.map((f) => {
    const cells = {};
    for (const k of f.known_by || []) {
      if (asOf !== null && asOf !== undefined && typeof k.since_chapter === "number" && k.since_chapter > asOf) continue;
      const key = resolve(k.character).key;
      const prev = cells[key];
      if (!prev || (k.since_chapter ?? 0) < (prev.since ?? 0)) cells[key] = { since: k.since_chapter ?? null, how: k.how || null };
    }
    return { id: f.id, fact: f.fact, route: f.route || "common", cells, count: Object.keys(cells).length };
  });
  return { cols, rows };
}

// ── Setups & payoffs ─────────────────────────────────────────────────────

export function setupList(state, filter) {
  const all = ((state && state.records && state.records.setups) || []).slice().sort((a, b) => (a.setup_chapter || 0) - (b.setup_chapter || 0));
  const counts = { all: all.length, open: 0, paid: 0, dropped: 0 };
  for (const s of all) if (counts[s.status] !== undefined) counts[s.status] += 1;
  const items = filter && filter !== "all" ? all.filter((s) => s.status === filter) : all;
  return {
    counts,
    items: items.map((s) => ({ ...s, progress: (s.progress || []).slice().sort((a, b) => a.chapter - b.chapter) })),
  };
}

// ── Choices map ──────────────────────────────────────────────────────────

export function choicesByChapter(state) {
  const choices = ((state && state.records && state.records.choices) || []).slice();
  const groups = new Map();
  for (const c of choices) {
    if (!groups.has(c.chapter)) groups.set(c.chapter, []);
    groups.get(c.chapter).push(c);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, list]) => ({ chapter, choices: list }));
}

/// Routes/endings (from the brief, plus any route a choice names) and the
/// choice options that lead to each.
export function routeMap(state) {
  const endings = (state && state.brief && state.brief.elements && state.brief.elements.endings) || [];
  const routes = endings.map((e) => ({ id: e.id, name: e.name || e.id, kind: e.kind || "ending", conditions: e.conditions || "", options: [] }));
  const find = (ref) => {
    const r = String(ref || "").trim().toLowerCase();
    return routes.find((x) => String(x.id).toLowerCase() === r || String(x.name).toLowerCase() === r);
  };
  for (const c of (state && state.records && state.records.choices) || []) {
    for (const o of c.options || []) {
      if (!o.route) continue;
      let route = find(o.route);
      if (!route) {
        route = { id: o.route, name: o.route, kind: "route", conditions: "", options: [], unlisted: true };
        routes.push(route);
      }
      route.options.push({ chapter: c.chapter, choice: c.id, label: o.label });
    }
  }
  return routes;
}

// ── Glossary & recaps ────────────────────────────────────────────────────

export function glossaryList(state, query) {
  const q = String(query || "").trim().toLowerCase();
  return ((state && state.records && state.records.glossary) || [])
    .filter((g) => !q || String(g.term).toLowerCase().includes(q) || String(g.definition).toLowerCase().includes(q))
    .sort((a, b) => String(a.term).localeCompare(String(b.term), undefined, { sensitivity: "base" }));
}

/// One entry per chapter: the records' recap, else the one submitted with
/// the chapter, else null (written without a recap / not written yet).
export function recapList(state) {
  const n = chapterCount(state);
  const recs = (state && state.records && state.records.recaps) || [];
  const out = [];
  for (let c = 1; c <= n; c++) {
    const r = recs.find((x) => x.chapter === c);
    const doc = chapterSummary(state, c);
    out.push({ chapter: c, recap: (r && r.recap) || (doc && doc.recap) || null, written: !!doc });
  }
  return out;
}

// ── Rules, overrides, feedback ───────────────────────────────────────────

/// The story's rules with where each came from: the wizard ("setup"), the
/// owner's feedback, or a review pass's durable rule.
export function storyRules(state) {
  const rules = (state && state.brief && state.brief.elements && state.brief.elements.style_rules) || [];
  const pool = ((state && state.feedback) || []).filter((f) => f.appended_to_rules);
  const used = new Set();
  return rules.map((text) => {
    const fb = pool.find((f) => !used.has(f.id) && f.text === text);
    if (fb) used.add(fb.id);
    return { text, source: fb ? fb.source : "setup", chapter: fb ? fb.chapter : null, at: fb ? fb.at : null };
  });
}

/// The per-story edits to the built-in style guide, with the section names
/// from the defaults catalog.
export function lessonOverrides(state, styleGuide) {
  const overrides = (state && state.brief && state.brief.lesson_overrides) || {};
  return Object.entries(overrides).map(([id, text]) => {
    const entry = (styleGuide || []).find((e) => e.id === id);
    return { id, title: entry ? entry.title : id, off: text === "", text, original: entry ? entry.text : null };
  });
}

export function feedbackRows(state, cards) {
  const { units } = engineOf(state);
  return ((state && state.feedback) || [])
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map((f) => {
      const unit = units[`revision:fb:${f.id}`] || null;
      return { ...f, unit, status: unit ? unitStatus(unit, cards) : null };
    });
}

// ── Header progress ──────────────────────────────────────────────────────

export function overall(state) {
  const n = chapterCount(state);
  return {
    chapters: n,
    written: ((state && state.chapters) || []).filter((c) => c.chapter >= 1 && c.chapter <= n).length,
    passes: passesDone(state),
    passesTotal: n * PASSES.length,
  };
}

export function wordCount(text) {
  const m = String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/// A file-name-safe slug for the export download.
export function fileSlug(title) {
  const s = String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "story";
}

// ── First introductions and unexplained names (C3) ─────────────────────────

/// A character's first introduction in the text (chapter, scene, exact
/// line), recorded by the chapter that introduces them; null until then.
export function firstIntro(c) {
  const f = c && c.first_intro;
  if (!f || !Number.isInteger(f.chapter)) return null;
  return { chapter: f.chapter, scene: String(f.scene || "").trim(), line: String(f.line || "").trim() };
}

/// Per-scene unexplained names, terms and rules (C3), each answered or
/// still open. A scene is flagged when it carries more than the cap, an
/// item when it's still unanswered UNANSWERED_LIMIT chapters later (counted
/// against the latest written chapter). `filter`: all / unanswered / flagged.
export function unexplainedList(state, filter) {
  const scenes = ((state && state.records && state.records.scene_sheets) || []).filter((s) => Array.isArray(s.unexplained) && s.unexplained.length);
  const latest = Math.max(0, ...((state && state.chapters) || []).map((c) => c.chapter));
  const rows = scenes
    .map((s) => {
      const items = s.unexplained.map((u) => {
        const answeredIn = u && u.answered_in && Number.isInteger(u.answered_in.chapter) ? u.answered_in : null;
        const age = Math.max(0, (answeredIn ? answeredIn.chapter : latest) - (s.chapter || 0));
        return { name: u.name, kind: u.kind || "term", answeredIn, answered: !!answeredIn, age, overdue: !answeredIn && age >= UNANSWERED_LIMIT };
      });
      const overCap = items.length > UNEXPLAINED_CAP;
      return { id: s.id, chapter: s.chapter, scene: s.scene, items, count: items.length, overCap, flagged: overCap || items.some((i) => i.overdue) };
    })
    .sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
  const all = rows.flatMap((r) => r.items);
  const counts = {
    scenes: rows.length,
    total: all.length,
    answered: all.filter((i) => i.answered).length,
    unanswered: all.filter((i) => !i.answered).length,
    overdue: all.filter((i) => i.overdue).length,
    overCap: rows.filter((r) => r.overCap).length,
    flagged: rows.filter((r) => r.flagged).length,
  };
  const pick = filter || "all";
  const shown = rows
    .map((r) => ({
      ...r,
      items: pick === "unanswered" ? r.items.filter((i) => !i.answered) : pick === "flagged" ? (r.overCap ? r.items : r.items.filter((i) => i.overdue)) : r.items,
    }))
    .filter((r) => r.items.length);
  return { rows: shown, counts, latest };
}