// Story tab styles. Colours, radii and type mirror PeckBoard's own design
// tokens (web/src/index.css) so the iframe reads as part of the app; the
// theme comes from the host's ?theme= (or prefers-color-scheme) and is
// stamped on <html data-theme>.
export const CSS = `
:root, :root[data-theme="light"] {
  color-scheme: light;
  --bg: #f8f9fb; --surface: #ffffff; --surface2: #f3f4f6; --surface3: #e9ebef; --surface-hover: #f0f1f4;
  --text: #1a1d23; --text2: #4b5563; --text3: #616875;
  --accent: hsl(220, 72%, 50%); --accent-hover: hsl(220, 72%, 44%);
  --accent-subtle: hsl(220, 60%, 95%); --accent-muted: hsl(220, 40%, 88%); --accent-text: hsl(220, 72%, 42%);
  --danger: #ef4444; --danger-bg: #fef2f2; --danger-border: #fecaca; --danger-text: #b91c1c;
  --success: #10b981; --success-bg: #ecfdf5; --success-border: #a7f3d0; --success-text: #047857;
  --warning: #f59e0b; --warning-bg: #fffbeb; --warning-border: #fde68a; --warning-text: #b45309;
  --border: #e5e7eb; --border-strong: #d1d5db;
  --shadow: 0 1px 2px rgba(16, 24, 40, .05);
  --focus: 0 0 0 3px hsla(220, 72%, 50%, .18);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1117; --surface: #1a1d27; --surface2: #22252f; --surface3: #2a2d38; --surface-hover: #2f323e;
  --text: #e5e7eb; --text2: #9ca3af; --text3: #8f97a5;
  --accent: hsl(220, 65%, 62%); --accent-hover: hsl(220, 65%, 56%);
  --accent-subtle: hsl(220, 30%, 16%); --accent-muted: hsl(220, 25%, 22%); --accent-text: hsl(220, 80%, 74%);
  --danger: #f87171; --danger-bg: rgba(239, 68, 68, .1); --danger-border: rgba(239, 68, 68, .25); --danger-text: #fca5a5;
  --success: #34d399; --success-bg: rgba(16, 185, 129, .1); --success-border: rgba(16, 185, 129, .25); --success-text: #6ee7b7;
  --warning: #fbbf24; --warning-bg: rgba(245, 158, 11, .1); --warning-border: rgba(245, 158, 11, .28); --warning-text: #fcd34d;
  --border: #2a2d38; --border-strong: #3a3d48;
  --shadow: none;
  --focus: 0 0 0 3px hsla(220, 65%, 62%, .25);
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
h1, h2, h3 { margin: 0; line-height: 1.3; }
.sw-app { padding: 20px 24px 56px; max-width: 1180px; margin: 0 auto; }
.sw-muted { color: var(--text3); }
.sw-error { color: var(--danger-text); }
.sw-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ── top bar ─────────────────────────────────────────── */
.sw-top { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; min-height: 36px; }
.sw-top-title { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.sw-title { font-size: 1.25rem; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-kicker { font-size: .75rem; color: var(--text3); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.sw-save { display: inline-flex; align-items: center; gap: 6px; font-size: .8125rem; color: var(--text3); white-space: nowrap; }
.sw-save .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text3); }
.sw-save.saved .dot { background: var(--success); }
.sw-save.saving .dot { background: var(--accent); animation: sw-pulse 1s ease-in-out infinite; }
.sw-save.dirty .dot { background: var(--warning); }
.sw-save.error { color: var(--danger-text); }
.sw-save.error .dot { background: var(--danger); }
@keyframes sw-pulse { 50% { opacity: .35; } }

/* ── layout ──────────────────────────────────────────── */
.sw-wiz { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 22px; align-items: start; }
.sw-rail { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 2px; }
.sw-rail-group { font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .07em; color: var(--text3); padding: 12px 10px 4px; }
.sw-rail-group:first-child { padding-top: 0; }
.sw-rail-item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 7px 10px;
  border: 1px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; color: var(--text2);
}
.sw-rail-item:hover { background: var(--surface-hover); color: var(--text); }
.sw-rail-item[aria-current="step"] { background: var(--surface); border-color: var(--border); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
.sw-rail-item:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-rail-num {
  flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
  font-size: .6875rem; font-weight: 650; background: var(--surface3); color: var(--text2);
}
.sw-rail-item[aria-current="step"] .sw-rail-num { background: var(--accent); color: #fff; }
.sw-rail-num.ok { background: var(--success-bg); color: var(--success-text); }
.sw-rail-num.warn { background: var(--warning-bg); color: var(--warning-text); }
.sw-rail-num.busy { background: var(--accent-subtle); color: var(--accent-text); }
.sw-rail-num.err { background: var(--danger-bg); color: var(--danger-text); }
.sw-rail-num svg { width: 12px; height: 12px; }
.sw-rail-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .8125rem; }
.sw-rail-mode { font-size: .6875rem; color: var(--text3); white-space: nowrap; }
.sw-main { min-width: 0; }
.sw-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; box-shadow: var(--shadow); }
.sw-panel + .sw-panel { margin-top: 14px; }
.sw-step-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 18px; }
.sw-step-head > div { flex: 1; min-width: 0; }
.sw-step-head > :not(div) { flex: none; }
.sw-step-head > .sw-select { width: auto; min-width: 180px; }
.sw-step-head h2 { font-size: 1.125rem; font-weight: 650; }
.sw-sub { margin: 4px 0 0; color: var(--text2); font-size: .8125rem; max-width: 70ch; }
.sw-section { margin-top: 22px; }
.sw-section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.sw-section-head h3 { font-size: .875rem; font-weight: 650; flex: 1; }
.sw-section-head .sw-sub { margin: 0; }
.sw-footer { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.sw-footer .sw-spacer { flex: 1; }

/* ── form controls ───────────────────────────────────── */
.sw-grid { display: grid; gap: 14px 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sw-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sw-grid .span-all { grid-column: 1 / -1; }
.sw-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.sw-label { font-size: .8125rem; font-weight: 600; color: var(--text); display: flex; gap: 6px; align-items: baseline; }
.sw-label .sw-hint { font-weight: 400; color: var(--text3); font-size: .75rem; }
.sw-help { font-size: .75rem; color: var(--text3); }
.sw-field-error { font-size: .75rem; color: var(--danger-text); }
.sw-input, .sw-select, .sw-textarea {
  width: 100%; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 6px;
  padding: 7px 10px; min-height: 34px; transition: border-color .12s, box-shadow .12s;
}
.sw-textarea { resize: vertical; min-height: 84px; line-height: 1.55; }
.sw-textarea.tall { min-height: 320px; }
.sw-textarea.lg { min-height: 170px; }
.sw-textarea.sm { min-height: 58px; }
.sw-step-head h2:focus { outline: none; }
.sw-textarea.mono { font-family: "SF Mono", "Fira Code", "JetBrains Mono", ui-monospace, monospace; font-size: .8125rem; }
.sw-select { appearance: none; padding-right: 30px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--text3) 50%), linear-gradient(135deg, var(--text3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
.sw-input:hover, .sw-select:hover, .sw-textarea:hover { border-color: var(--text3); }
.sw-input:focus, .sw-select:focus, .sw-textarea:focus { outline: none; border-color: var(--accent); box-shadow: var(--focus); }
.sw-input:disabled, .sw-select:disabled, .sw-textarea:disabled { background: var(--surface2); color: var(--text2); cursor: not-allowed; }
.sw-input::placeholder, .sw-textarea::placeholder { color: var(--text3); opacity: .8; }
.sw-choice { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
.sw-number { display: flex; align-items: center; gap: 6px; }
.sw-number .sw-input { width: 90px; text-align: center; }

/* ── buttons ─────────────────────────────────────────── */
.sw-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
  background: var(--accent); color: #fff; border: 1px solid transparent; border-radius: 6px;
  padding: 7px 14px; font-size: .8125rem; font-weight: 600; cursor: pointer; min-height: 34px;
}
.sw-btn:hover { background: var(--accent-hover); }
.sw-btn:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-btn:disabled { opacity: .5; cursor: not-allowed; }
.sw-btn.secondary { background: var(--surface); color: var(--text); border-color: var(--border-strong); }
.sw-btn.secondary:hover { background: var(--surface-hover); }
.sw-btn.ghost { background: transparent; color: var(--accent-text); border-color: transparent; }
.sw-btn.ghost:hover { background: var(--accent-subtle); }
.sw-btn.danger { background: var(--danger); }
.sw-btn.danger-ghost { background: transparent; color: var(--danger-text); }
.sw-btn.danger-ghost:hover { background: var(--danger-bg); }
.sw-btn.sm { padding: 4px 10px; min-height: 28px; font-size: .75rem; }
.sw-btn.lg { padding: 10px 20px; min-height: 42px; font-size: .875rem; }
.sw-btn svg { width: 15px; height: 15px; }
.sw-icon-btn {
  flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 6px;
  border: 1px solid transparent; background: transparent; color: var(--text3); cursor: pointer;
}
.sw-icon-btn:hover { background: var(--surface-hover); color: var(--text); }
.sw-icon-btn.danger:hover { background: var(--danger-bg); color: var(--danger-text); }
.sw-icon-btn:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.sw-icon-btn svg { width: 15px; height: 15px; }

/* ── mode switch ─────────────────────────────────────── */
.sw-seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--surface2); border: 1px solid var(--border); border-radius: 9px; flex-wrap: wrap; }
.sw-seg-opt {
  position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px;
  font-size: .8125rem; color: var(--text2); cursor: pointer; user-select: none; white-space: nowrap;
}
.sw-seg-opt:hover { color: var(--text); }
.sw-seg-opt input { position: absolute; opacity: 0; pointer-events: none; }
.sw-seg-opt.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 0 0 1px var(--border); }
.sw-seg-opt.on .sw-seg-icon { color: var(--accent); }
.sw-seg-opt:has(input:focus-visible) { box-shadow: var(--focus); }
.sw-seg-opt.disabled { cursor: not-allowed; opacity: .6; }
.sw-seg-icon { display: inline-grid; width: 15px; height: 15px; }
.sw-seg-icon svg { width: 15px; height: 15px; }

/* ── badges & banners ────────────────────────────────── */
.sw-badge {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; white-space: nowrap;
  font-size: .75rem; font-weight: 600; border: 1px solid var(--border); background: var(--surface2); color: var(--text2);
}
.sw-badge.ok { background: var(--success-bg); color: var(--success-text); border-color: var(--success-border); }
.sw-badge.warn { background: var(--warning-bg); color: var(--warning-text); border-color: var(--warning-border); }
.sw-badge.busy { background: var(--accent-subtle); color: var(--accent-text); border-color: var(--accent-muted); }
.sw-badge.err { background: var(--danger-bg); color: var(--danger-text); border-color: var(--danger-border); }
.sw-spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: sw-spin .8s linear infinite; flex: none; }
@keyframes sw-spin { to { transform: rotate(360deg); } }
.sw-banner {
  display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 8px; margin-bottom: 16px;
  border: 1px solid var(--border); background: var(--surface2); color: var(--text2); font-size: .8125rem;
}
.sw-banner-text { flex: 1; min-width: 0; }
.sw-banner-text strong { color: var(--text); }
.sw-banner-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.sw-banner.info { background: var(--accent-subtle); border-color: var(--accent-muted); color: var(--text); }
.sw-banner.ok { background: var(--success-bg); border-color: var(--success-border); color: var(--text); }
.sw-banner.warn { background: var(--warning-bg); border-color: var(--warning-border); color: var(--text); }
.sw-banner.busy { background: var(--accent-subtle); border-color: var(--accent-muted); color: var(--text); }
.sw-banner.err { background: var(--danger-bg); border-color: var(--danger-border); color: var(--text); }
.sw-banner-icon { flex: none; width: 18px; height: 18px; display: grid; place-items: center; }
.sw-banner.ok .sw-banner-icon { color: var(--success-text); }
.sw-banner.warn .sw-banner-icon { color: var(--warning-text); }
.sw-banner.info .sw-banner-icon, .sw-banner.busy .sw-banner-icon { color: var(--accent-text); }
.sw-banner.err .sw-banner-icon { color: var(--danger-text); }
.sw-banner-icon svg { width: 18px; height: 18px; }
.sw-notice { box-shadow: var(--shadow); }

/* ── modes overview ──────────────────────────────────── */
.sw-modes { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.sw-mode-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; align-items: center; padding: 12px 16px; }
.sw-mode-row + .sw-mode-row { border-top: 1px solid var(--border); }
.sw-mode-row h3 { font-size: .875rem; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.sw-mode-row p { margin: 2px 0 0; font-size: .75rem; color: var(--text3); }

/* ── list editors ────────────────────────────────────── */
.sw-list { display: flex; flex-direction: column; gap: 8px; }
.sw-list-row { display: flex; gap: 6px; align-items: flex-start; }
.sw-list-row > .sw-input, .sw-list-row > .sw-textarea { flex: 1; }
.sw-list-row .sw-textarea { min-height: 38px; }
.sw-list-num { flex: none; width: 22px; padding-top: 7px; text-align: right; color: var(--text3); font-size: .75rem; font-variant-numeric: tabular-nums; }
.sw-empty { padding: 18px; border: 1px dashed var(--border-strong); border-radius: 10px; text-align: center; color: var(--text3); font-size: .8125rem; }
.sw-add-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

/* ── item cards (characters, endings) ───────────────── */
.sw-items { display: flex; flex-direction: column; gap: 12px; }
.sw-item { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.sw-item-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; }
.sw-item.open .sw-item-head { border-bottom: 1px solid var(--border); }
.sw-item-title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
.sw-item-title strong { font-size: .9375rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-item-title .sw-muted { font-size: .8125rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-avatar { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: .8125rem; background: var(--accent-subtle); color: var(--accent-text); }
.sw-item-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.sw-subhead { font-size: .75rem; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); margin-bottom: 8px; }
.sw-att { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1.4fr); gap: 8px; align-items: start; }
.sw-att + .sw-att { margin-top: 8px; }
.sw-att-name { padding-top: 7px; font-weight: 600; font-size: .8125rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-att .sw-choice { grid-template-columns: 1fr; }
.sw-rel { display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.sw-rel-desc { grid-column: 1 / -2; }
.sw-rel-arrow { color: var(--text3); text-align: center; }
.sw-rel-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: grid; gap: 8px; }
.sw-end-head { display: flex; gap: 12px; align-items: flex-end; }
.sw-end-head > .sw-field:first-child { flex: 1; }
.sw-end-head > .sw-field + .sw-field { width: 170px; flex: none; }
.sw-end-head > .sw-icon-btn, .sw-end-head > .sw-confirm { margin-bottom: 2px; }
.sw-confirm { display: inline-flex; gap: 6px; align-items: center; font-size: .75rem; color: var(--danger-text); }

/* ── style guide ─────────────────────────────────────── */
.sw-lessons { display: flex; flex-direction: column; gap: 10px; }
.sw-lesson { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--surface); }
.sw-lesson.off { background: var(--surface2); }
.sw-lesson.off .sw-lesson-preview { text-decoration: line-through; opacity: .6; }
.sw-lesson-head { display: flex; align-items: center; gap: 8px; }
.sw-lesson-head strong { flex: 1; font-size: .875rem; }
.sw-lesson-preview {
  margin-top: 8px; font-size: .8125rem; color: var(--text2); white-space: pre-wrap; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}
.sw-lesson .sw-textarea { margin-top: 10px; min-height: 200px; }

/* ── chips (banned words) ───────────────────────────── */
.sw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sw-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border-radius: 999px;
  background: var(--surface2); border: 1px solid var(--border); font-size: .8125rem;
}
.sw-chip.fixed { padding-right: 10px; color: var(--text2); }
.sw-chip button { width: 20px; height: 20px; border-radius: 50%; border: none; background: transparent; color: var(--text3); cursor: pointer; display: grid; place-items: center; }
.sw-chip button svg { width: 12px; height: 12px; }
.sw-chip button:hover { background: var(--danger-bg); color: var(--danger-text); }
.sw-chip-input { display: flex; gap: 8px; margin-top: 12px; max-width: 520px; }

/* ── review ──────────────────────────────────────────── */
.sw-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 18px; margin: 0; }
.sw-summary div { min-width: 0; }
.sw-summary dt { font-size: .6875rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); font-weight: 650; }
.sw-summary dd { margin: 2px 0 0; font-size: .875rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-table { width: 100%; border-collapse: collapse; font-size: .8125rem; }
.sw-table th { text-align: left; font-size: .6875rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); font-weight: 650; padding: 0 10px 8px; border-bottom: 1px solid var(--border); }
.sw-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.sw-table tr:last-child td { border-bottom: none; }
.sw-table td:last-child { text-align: right; }
.sw-linkbtn { background: none; border: none; padding: 0; color: var(--accent-text); cursor: pointer; font-weight: 600; font-size: inherit; }
.sw-linkbtn:hover { text-decoration: underline; }
.sw-checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sw-checklist li { display: flex; gap: 8px; align-items: baseline; font-size: .8125rem; }
.sw-checklist li::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); transform: translateY(-1px); }
.sw-checklist.warn li::before { background: var(--warning); }
.sw-start { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.sw-start p { margin: 0; flex: 1; min-width: 220px; color: var(--text2); font-size: .8125rem; }

/* ── pipeline placeholder (until the dashboard lands) ─ */
.sw-stages { display: flex; flex-wrap: wrap; gap: 6px; }
.sw-stage {
  display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--surface2); color: var(--text3);
  font-size: .75rem; border: 1px solid var(--border);
}
.sw-stage.on { background: var(--accent); color: #fff; border-color: transparent; }
.sw-stage.done { background: var(--success-bg); color: var(--success-text); border-color: var(--success-border); }
.sw-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; margin-bottom: 12px; }
.sw-card h2 { font-size: .75rem; margin: 0 0 10px; color: var(--text3); text-transform: uppercase; letter-spacing: .06em; }
pre.sw-pre { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 10px; overflow: auto; font-size: .75rem; margin: 0; max-height: 360px; }

@media (max-width: 820px) {
  .sw-app { padding: 14px 14px 40px; }
  .sw-wiz { grid-template-columns: 1fr; }
  .sw-rail { position: static; flex-direction: row; overflow-x: auto; gap: 4px; padding-bottom: 4px; }
  .sw-rail-group, .sw-rail-mode { display: none; }
  .sw-rail-item { width: auto; flex: none; }
  .sw-grid, .sw-grid.three, .sw-summary { grid-template-columns: 1fr; }
  .sw-att { grid-template-columns: 1fr; }
  .sw-rel { grid-template-columns: 1fr; }
  .sw-rel-arrow { display: none; }
  .sw-panel { padding: 16px; }
}
`;
