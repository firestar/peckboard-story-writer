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
.sw-app:has(> .sw-dash) { max-width: 1320px; }
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

/* ── dashboard ───────────────────────────────────────── */
html.sw-noscroll { overflow: hidden; }
.sw-ico { display: inline-grid; place-items: center; }
.sw-ico svg { width: 15px; height: 15px; }
.sw-btn.sm .sw-ico svg { width: 13px; height: 13px; }
.sw-spacer { flex: 1; }
.sw-dash-top { align-items: flex-start; flex-wrap: wrap; }
.sw-dash-top > .sw-btn { margin-top: 4px; }
.sw-dash-meta { font-size: .8125rem; color: var(--text2); margin-top: 2px; }
.sw-live { display: inline-flex; align-items: center; gap: 7px; font-size: .75rem; color: var(--text3); white-space: nowrap; margin-top: 12px; font-variant-numeric: tabular-nums; }
.sw-live .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px var(--success-bg); }

/* owner gate */
.sw-gate {
  display: flex; align-items: center; gap: 16px; padding: 16px 18px; margin-bottom: 14px; border-radius: 12px;
  background: var(--warning-bg); border: 1px solid var(--warning-border);
}
.sw-gate-icon { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); color: var(--warning-text); border: 1px solid var(--warning-border); }
.sw-gate-icon svg { width: 20px; height: 20px; }
.sw-gate-text { flex: 1; min-width: 240px; }
.sw-gate-text .sw-kicker { color: var(--warning-text); }
.sw-gate-text p { margin: 2px 0 0; font-size: .875rem; color: var(--text); max-width: 72ch; }
.sw-gate-actions, .sw-drawer-approve { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sw-confirm-text { font-size: .8125rem; font-weight: 600; color: var(--text); }

/* stat tiles */
.sw-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.sw-stat { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); min-width: 0; }
.sw-stat-label { font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); }
.sw-stat-value { font-size: 1.375rem; font-weight: 650; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-stat-value small { font-size: .875rem; font-weight: 500; color: var(--text3); }
.sw-stat-sub { font-size: .75rem; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-meter { height: 6px; border-radius: 999px; background: var(--surface3); overflow: hidden; margin-top: 6px; }
.sw-meter span { display: block; height: 100%; border-radius: 999px; background: var(--accent); min-width: 0; transition: width .3s ease; }

/* panels */
.sw-dash-panel { margin-top: 14px; }
.sw-dash-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.sw-dash-head-text { flex: 1; min-width: 0; }
.sw-dash-head h2 { font-size: 1rem; font-weight: 650; }
.sw-dash-head .sw-sub { margin-top: 2px; }
.sw-panel-note { margin: 0 0 12px; font-size: .8125rem; color: var(--text2); background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; }
.sw-empty-action { margin-top: 10px; }
.sw-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.sw-toolbar-count { font-size: .75rem; margin-left: auto; }
.sw-inline-field { display: inline-flex; align-items: center; gap: 8px; }
.sw-inline-label { font-size: .8125rem; font-weight: 600; color: var(--text2); white-space: nowrap; }
.sw-inline-field .sw-select { width: auto; min-width: 150px; }
button.sw-seg-opt { border: 0; background: transparent; font: inherit; font-size: .8125rem; }
button.sw-seg-opt:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-count {
  display: inline-block; min-width: 18px; padding: 0 6px; border-radius: 999px; line-height: 18px; text-align: center;
  font-size: .6875rem; font-weight: 650; background: var(--surface3); color: var(--text2); font-variant-numeric: tabular-nums;
}
.sw-seg-opt.on .sw-count, .sw-tab[aria-selected="true"] .sw-count { background: var(--accent-subtle); color: var(--accent-text); }
.sw-ch-chip {
  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 5px; line-height: 18px; font-size: .6875rem; font-weight: 600;
  background: var(--surface3); color: var(--text2); vertical-align: 1px; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.sw-tag { display: inline-flex; align-items: center; gap: 4px; font-size: .75rem; color: var(--success-text); }
.sw-tag .sw-ico svg { width: 12px; height: 12px; }
.sw-table-wrap { overflow-x: auto; }
.sw-loading { display: flex; align-items: center; gap: 10px; color: var(--text3); font-size: .8125rem; }

/* stage stepper */
.sw-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.sw-step { position: relative; min-width: 0; }
.sw-step:not(:first-child)::before {
  content: ""; position: absolute; top: 22px; left: calc(-50% + 22px); right: calc(50% + 22px); height: 2px; border-radius: 2px;
  background: var(--border-strong);
}
.sw-step.done + .sw-step::before { background: var(--success); }
.sw-step-btn {
  width: 100%; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 6px 10px; text-align: center;
  border: 1px solid transparent; border-radius: 10px; background: none; color: var(--text2); cursor: pointer;
}
.sw-step-btn:hover { background: var(--surface-hover); }
.sw-step-btn:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-step.sel .sw-step-btn { background: var(--surface2); border-color: var(--border); }
.sw-step-dot {
  position: relative; z-index: 1; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  font-size: .8125rem; font-weight: 650; background: var(--surface); border: 2px solid var(--border-strong); color: var(--text3);
}
.sw-step-dot svg { width: 16px; height: 16px; }
.sw-step.done .sw-step-dot { background: var(--success); border-color: var(--success); color: #fff; }
.sw-step.active .sw-step-dot { background: var(--accent-subtle); border-color: var(--accent); color: var(--accent-text); animation: sw-ring 2s ease-out infinite; }
.sw-step.waiting .sw-step-dot { background: var(--warning-bg); border-color: var(--warning); color: var(--warning-text); }
.sw-step.blocked .sw-step-dot { background: var(--danger-bg); border-color: var(--danger); color: var(--danger-text); }
@keyframes sw-ring { 0% { box-shadow: 0 0 0 0 hsla(220, 72%, 50%, .35); } 70%, 100% { box-shadow: 0 0 0 8px hsla(220, 72%, 50%, 0); } }
.sw-step-text { display: flex; flex-direction: column; min-width: 0; max-width: 100%; }
.sw-step-label { font-size: .8125rem; font-weight: 650; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-step.pending .sw-step-label { color: var(--text2); }
.sw-step-sub { font-size: .75rem; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.sw-step.waiting .sw-step-sub { color: var(--warning-text); font-weight: 600; }
.sw-step.blocked .sw-step-sub { color: var(--danger-text); }
.sw-stage-detail { margin-top: 12px; padding-top: 16px; border-top: 1px solid var(--border); }
.sw-stage-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
.sw-stage-head > div:first-child { flex: 1; min-width: 0; }
.sw-stage-head h3 { font-size: .9375rem; font-weight: 650; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sw-stage-head .sw-sub { margin-top: 3px; }
.sw-stage-actions { display: flex; gap: 8px; flex: none; }
.sw-stage-note { margin: 0 0 12px; padding: 9px 12px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); font-size: .8125rem; color: var(--text); }
.sw-stage-note-k { display: block; font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); margin-bottom: 2px; }
.sw-units-toggle { margin-bottom: 10px; }
.sw-units td { vertical-align: top; }
.sw-units td:first-child { min-width: 190px; font-weight: 550; }
.sw-unit-attempt { font-weight: 400; font-size: .75rem; }
.sw-unit-card { min-width: 200px; max-width: 360px; }
.sw-unit-title { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text2); }
.sw-step-chip { display: inline-block; margin-top: 3px; padding: 0 7px; border-radius: 5px; font-size: .6875rem; font-weight: 600; line-height: 18px; background: var(--surface3); color: var(--text2); text-transform: capitalize; }
.sw-unit-detail { margin-top: 4px; font-size: .75rem; color: var(--text3); max-width: 340px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sw-unit-actions { white-space: nowrap; }
.sw-unit-actions > * + * { margin-left: 6px; }
.sw-unit.failed td:first-child { color: var(--danger-text); }

/* chapter grid */
.sw-legend { list-style: none; margin: -4px 0 12px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .75rem; color: var(--text2); }
.sw-legend li { display: inline-flex; align-items: center; gap: 6px; }
.sw-cgrid-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
.sw-cgrid { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .8125rem; }
.sw-cgrid th, .sw-cgrid td { padding: 6px 4px; text-align: center; border-bottom: 1px solid var(--border); }
.sw-cgrid tbody tr:last-child th, .sw-cgrid tbody tr:last-child td { border-bottom: none; }
.sw-cgrid thead th { font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; color: var(--text3); background: var(--surface2); white-space: nowrap; vertical-align: bottom; }
.sw-cgrid thead tr:first-child th { padding-top: 9px; }
.sw-cgrid-group { border-bottom: 1px solid var(--border) !important; }
.sw-cgrid-pass { min-width: 58px; }
.sw-cgrid .sw-cgrid-ch { position: sticky; left: 0; z-index: 1; text-align: left; padding-left: 8px; background: var(--surface); border-right: 1px solid var(--border); min-width: 168px; }
.sw-cgrid thead .sw-cgrid-ch { background: var(--surface2); padding-left: 14px; }
.sw-cgrid-notes { text-align: left !important; padding-right: 12px !important; min-width: 120px; white-space: nowrap; }
.sw-cgrid tbody tr:hover th, .sw-cgrid tbody tr:hover td { background: var(--surface-hover); }
.sw-cgrid tbody tr.revising .sw-ch-num { background: var(--accent-subtle); color: var(--accent-text); }
.sw-ch-btn {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px; border: 1px solid transparent; border-radius: 7px;
  background: none; color: var(--text); cursor: pointer; text-align: left; font-weight: 600;
}
.sw-ch-btn:hover .sw-ch-name { color: var(--accent-text); text-decoration: underline; }
.sw-ch-btn:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-ch-num { flex: none; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; font-size: .75rem; background: var(--surface3); color: var(--text2); font-variant-numeric: tabular-nums; }
.sw-ch-name { white-space: nowrap; }
.sw-ch-tag { font-size: .6875rem; font-weight: 650; padding: 0 6px; line-height: 18px; border-radius: 5px; background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border); }
.sw-note-chip { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; font-size: .75rem; color: var(--text2); font-variant-numeric: tabular-nums; }
.sw-note-chip .sw-ico svg { width: 13px; height: 13px; }
.sw-cell {
  width: 30px; height: 30px; border-radius: 7px; display: inline-grid; place-items: center; vertical-align: middle; cursor: pointer;
  border: 1px solid var(--border); background: var(--surface2); color: var(--text3); padding: 0;
}
.sw-cell:hover { border-color: var(--text3); }
.sw-cell:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-cell .sw-cell-ico { display: grid; place-items: center; }
.sw-cell svg { width: 15px; height: 15px; }
.sw-cell .sw-spinner { width: 13px; height: 13px; }
.sw-cell.ok { background: var(--success-bg); border-color: var(--success-border); color: var(--success-text); }
.sw-cell.busy { background: var(--accent-subtle); border-color: var(--accent-muted); color: var(--accent-text); }
.sw-cell.warn { background: var(--warning-bg); border-color: var(--warning-border); color: var(--warning-text); }
.sw-cell.err { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-text); }
.sw-cell.k-pending { background: transparent; border-style: dashed; border-color: var(--border-strong); }
.sw-cell-sm { width: 18px; height: 18px; border-radius: 5px; cursor: default; }
.sw-cell-sm svg { width: 11px; height: 11px; }
.sw-cell-sm .sw-spinner { width: 9px; height: 9px; border-width: 1.5px; }
.sw-tip {
  position: fixed; z-index: 60; max-width: 300px; padding: 7px 10px; border-radius: 8px; pointer-events: none;
  background: var(--text); color: var(--bg); font-size: .75rem; line-height: 1.45; box-shadow: 0 6px 20px rgba(0, 0, 0, .2);
  display: flex; flex-direction: column; gap: 2px;
}
.sw-tip[hidden] { display: none; }
.sw-tip span { opacity: .8; }

/* tabs */
.sw-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin: 0 0 16px; overflow-x: auto; scrollbar-width: thin; }
.sw-tab {
  flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 11px; margin-bottom: -1px; white-space: nowrap;
  border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text2); font-size: .8125rem; font-weight: 550; cursor: pointer;
  border-radius: 6px 6px 0 0;
}
.sw-tab:hover { color: var(--text); background: var(--surface-hover); }
.sw-tab:focus-visible { outline: none; box-shadow: var(--focus); }
.sw-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.sw-tabs.sm { margin: 0; padding: 0 20px; }
.sw-tabs.sm .sw-tab { padding: 8px 10px; }

/* characters */
.sw-chars { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
.sw-char { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; background: var(--surface); display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.sw-char-head { display: flex; align-items: center; gap: 12px; }
.sw-char-head .sw-avatar { width: 38px; height: 38px; font-size: .875rem; }
.sw-char-id { flex: 1; min-width: 0; }
.sw-char-id h3 { font-size: .9375rem; font-weight: 650; }
.sw-char-id p { margin: 1px 0 0; font-size: .8125rem; color: var(--text3); }
.sw-char-lede { margin: 0; font-size: .8125rem; color: var(--text2); }
.sw-facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
.sw-facts dt { font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); }
.sw-facts dd { margin: 1px 0 0; font-size: .8125rem; }
.sw-char-sec .sw-subhead { margin-bottom: 6px; }
.sw-att-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: .8125rem; }
.sw-att-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.sw-att-val { font-weight: 600; color: var(--accent-text); }
.sw-bullets { margin: 0; padding-left: 18px; font-size: .8125rem; display: flex; flex-direction: column; gap: 3px; }
.sw-char-notes { margin: 0; font-size: .8125rem; }

/* matrices (emotions, attitudes, who-knows-what) */
.sw-matrix { border-collapse: separate; border-spacing: 0; font-size: .8125rem; min-width: 100%; border: 1px solid var(--border); border-radius: 10px; }
.sw-matrix th, .sw-matrix td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.sw-matrix td { border-left: 1px solid var(--border); min-width: 130px; }
.sw-matrix tbody tr:last-child th, .sw-matrix tbody tr:last-child td { border-bottom: none; }
.sw-matrix thead th { font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; color: var(--text3); background: var(--surface2); white-space: nowrap; border-left: 1px solid var(--border); }
.sw-matrix thead th:first-child { border-left: none; border-top-left-radius: 10px; }
.sw-matrix thead th:last-child { border-top-right-radius: 10px; }
.sw-matrix tbody th { position: sticky; left: 0; z-index: 1; background: var(--surface); font-weight: 600; white-space: nowrap; }
.sw-matrix .sw-matrix-corner { position: sticky; left: 0; z-index: 2; }
.sw-matrix-corner span { color: var(--text2); }
.sw-matrix-none { color: var(--text3); }
.sw-matrix-self { background: repeating-linear-gradient(135deg, var(--surface2), var(--surface2) 6px, var(--surface) 6px, var(--surface) 12px); }
.sw-att-matrix { table-layout: fixed; width: 100%; }
.sw-att-matrix thead th:first-child { width: 170px; }
.sw-att-matrix td .sw-att-val { display: block; }
.sw-att-why { display: block; margin-top: 2px; font-size: .75rem; color: var(--text2); }
.sw-att-since { display: block; margin-top: 3px; font-size: .6875rem; color: var(--text3); }
.sw-att-matrix td.changed { background: var(--accent-subtle); box-shadow: inset 3px 0 0 var(--accent); }
.sw-legend-note { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.sw-changed-dot { width: 12px; height: 12px; border-radius: 3px; background: var(--accent-subtle); box-shadow: inset 3px 0 0 var(--accent); }
.sw-know th[scope="row"] { white-space: normal; min-width: 260px; max-width: 420px; font-weight: 500; }
.sw-know td { min-width: 84px; text-align: center; vertical-align: middle; }
.sw-know thead th.sw-know-col { text-align: center; }
.sw-know-yes { color: var(--success-text); }
.sw-know-mark { display: inline-grid; vertical-align: -2px; }
.sw-know-mark svg { width: 14px; height: 14px; }
.sw-know-ch { margin-left: 4px; font-size: .6875rem; font-weight: 600; color: var(--text2); font-variant-numeric: tabular-nums; }
.sw-know-no::after { content: "·"; color: var(--border-strong); font-size: 1.25rem; line-height: 1; }
.sw-know-nobody th { color: var(--text2); }
.sw-know-note { font-weight: 400; }

/* setups & payoffs */
.sw-setups { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sw-setup {
  display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1.25fr) 18px minmax(0, 1fr) auto; gap: 12px; align-items: start;
  padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: 10px; background: var(--surface);
}
.sw-setup.open { border-left-color: var(--warning); }
.sw-setup.paid { border-left-color: var(--success); }
.sw-setup.dropped { opacity: .75; }
.sw-setup-col p { margin: 3px 0 0; font-size: .8125rem; }
.sw-setup-k { display: block; font-size: .6875rem; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); }
.sw-setup-arrow { color: var(--text3); padding-top: 14px; }
.sw-setup-arrow svg { width: 16px; height: 16px; }
.sw-progress { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: .8125rem; }
.sw-progress .sw-ch-chip { margin: 0 6px 0 0; }
.sw-setup-status { padding-top: 2px; }

/* choices map */
.sw-choices { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 18px; align-items: start; }
.sw-choices-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.sw-choice-ch { display: flex; flex-direction: column; gap: 8px; }
.sw-choice-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--surface); }
.sw-choice-q { margin: 0; font-weight: 600; font-size: .875rem; }
.sw-branches { list-style: none; margin: 10px 0 0; padding: 0 0 0 14px; border-left: 2px solid var(--accent-muted); display: flex; flex-direction: column; gap: 8px; }
.sw-branches li { display: grid; grid-template-columns: minmax(0, auto) 16px minmax(0, 1fr); gap: 8px; align-items: baseline; font-size: .8125rem; }
.sw-branch-label { font-weight: 600; background: var(--accent-subtle); color: var(--accent-text); padding: 2px 8px; border-radius: 6px; }
.sw-branch-arrow { color: var(--text3); align-self: center; display: grid; }
.sw-branch-arrow svg { width: 14px; height: 14px; }
.sw-branch-csq { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; color: var(--text2); }
.sw-set { font-family: "SF Mono", "Fira Code", ui-monospace, monospace; font-size: .6875rem; padding: 1px 6px; border-radius: 5px; background: var(--surface3); color: var(--text2); }
.sw-routes { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--surface2); display: flex; flex-direction: column; gap: 12px; }
.sw-routes .sw-subhead { margin: 0; }
.sw-route-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: .875rem; }
.sw-route p { margin: 3px 0 0; font-size: .75rem; }
.sw-route-opts { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: .8125rem; }
.sw-route-opts .sw-ch-chip { margin: 0 6px 0 0; }

/* glossary & recaps */
.sw-search { position: relative; display: block; flex: 1; max-width: 420px; }
.sw-search .sw-ico { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text3); }
.sw-search .sw-input { padding-left: 32px; }
.sw-glossary { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; }
.sw-glossary > div { padding: 10px 0; border-bottom: 1px solid var(--border); }
.sw-glossary dt { font-weight: 650; font-size: .875rem; }
.sw-glossary dd { margin: 2px 0 0; font-size: .8125rem; color: var(--text2); }
.sw-recaps { list-style: none; margin: 0; padding: 0; }
.sw-recaps li { padding: 10px 0; border-bottom: 1px solid var(--border); }
.sw-recaps li:last-child { border-bottom: none; }
.sw-recap-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: .875rem; }
.sw-recaps p { margin: 3px 0 0; font-size: .8125rem; max-width: 80ch; }

/* rules & feedback */
.sw-rules { display: flex; flex-direction: column; gap: 24px; }
.sw-rule-list { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 8px; font-size: .8125rem; }
.sw-rule-list li { padding-left: 2px; }
.sw-rule-list li::marker { color: var(--text3); font-variant-numeric: tabular-nums; }
.sw-rule-text { margin-right: 8px; }
.sw-chip.muted { color: var(--text3); }
.sw-details { margin-top: 10px; font-size: .8125rem; }
.sw-details summary { cursor: pointer; color: var(--text2); font-weight: 600; margin-bottom: 8px; }
.sw-fb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sw-fb-item { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--surface); }
.sw-fb-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .75rem; }
.sw-fb-text { margin: 6px 0 0; font-size: .8125rem; white-space: pre-wrap; }

/* chapter drawer */
.sw-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(15, 17, 23, .38); }
.sw-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 41; width: min(780px, 100vw); display: flex; flex-direction: column;
  background: var(--surface); border-left: 1px solid var(--border); box-shadow: -16px 0 48px rgba(0, 0, 0, .18);
}
.sw-backdrop.enter { animation: sw-fade .16s ease-out; }
.sw-drawer.enter { animation: sw-slide .2s ease-out; }
@keyframes sw-fade { from { opacity: 0; } }
@keyframes sw-slide { from { transform: translateX(28px); opacity: 0; } }
.sw-drawer-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 12px; }
.sw-drawer-title { flex: 1; min-width: 0; }
.sw-drawer-title h2 { font-size: 1.25rem; font-weight: 650; }
.sw-drawer-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; font-size: .8125rem; color: var(--text2); }
.sw-drawer-nav { display: flex; gap: 2px; }
.sw-drawer-body { flex: 1; overflow-y: auto; padding: 18px 20px 24px; outline: none; }
.sw-drawer-foot { border-top: 1px solid var(--border); padding: 12px 20px 16px; background: var(--surface2); }
.sw-fb { display: flex; flex-direction: column; gap: 6px; }
.sw-fb .sw-textarea { min-height: 64px; }
.sw-fb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.sw-fb-closed { margin: 0 0 8px; font-size: .8125rem; }
.sw-recap-box { margin: 0 auto 18px; max-width: 66ch; padding: 10px 14px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); }
.sw-recap-box p { margin: 3px 0 0; font-size: .8125rem; color: var(--text2); }
.sw-prose { max-width: 66ch; margin: 0 auto; font: 1rem/1.75 Charter, "Iowan Old Style", Georgia, "Palatino Linotype", serif; color: var(--text); }
.sw-prose p { margin: 0 0 1em; }
.sw-prose .sw-prose-h { font-family: inherit; font-size: 1.25rem; font-weight: 600; margin: .4em 0 1em; text-align: center; letter-spacing: 0; }
.sw-prose h4.sw-prose-h { font-size: 1.0625rem; text-align: left; }
.sw-prose hr { border: 0; border-top: 1px solid var(--border-strong); width: 30%; margin: 2em auto; }
.sw-prose blockquote { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid var(--border-strong); color: var(--text2); }
.sw-prose code { font: .875em "SF Mono", ui-monospace, monospace; background: var(--surface2); padding: 0 4px; border-radius: 4px; }
.sw-passes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.sw-pass { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.sw-pass-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: .8125rem; }
.sw-rounds { list-style: none; margin: 8px 0 0; padding: 0 0 0 26px; display: flex; flex-direction: column; gap: 8px; }
.sw-round-head { display: flex; align-items: center; gap: 8px; font-size: .75rem; }
.sw-round-notes { margin: 4px 0 0; font-size: .8125rem; white-space: pre-wrap; color: var(--text); }
.sw-scenes { display: flex; flex-direction: column; gap: 10px; }
.sw-scene { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.sw-scene h3 { font-size: .9375rem; font-weight: 650; }
.sw-scene p { margin: 4px 0 0; font-size: .8125rem; }
.sw-scene .sw-setup-k { display: inline; margin-right: 6px; }
.sw-scene-arc { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.sw-scene-arrow { color: var(--text3); display: inline-grid; align-self: center; }
.sw-scene-arrow svg { width: 14px; height: 14px; }
.sw-scene .sw-bullets { margin-top: 8px; }

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
  .sw-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sw-stats > :first-child { grid-column: 1 / -1; }
  .sw-dash-top .sw-top-title { flex-basis: 100%; }
  .sw-dash-top .sw-title { white-space: normal; }
  .sw-steps { grid-template-columns: 1fr; gap: 2px; }
  .sw-step:not(:first-child)::before { display: none; }
  .sw-step-btn { flex-direction: row; text-align: left; padding: 6px 8px; }
  .sw-step-text { flex-direction: row; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .sw-gate { flex-wrap: wrap; }
  .sw-stage-head { flex-direction: column; }
  .sw-chars, .sw-choices, .sw-glossary { grid-template-columns: 1fr; }
  .sw-facts { grid-template-columns: 1fr; }
  .sw-setup { grid-template-columns: 1fr; gap: 8px; }
  .sw-setup-arrow { display: none; }
  .sw-drawer-head, .sw-drawer-body, .sw-drawer-foot { padding-left: 14px; padding-right: 14px; }
  .sw-tabs.sm { padding: 0 14px; }
  .sw-fb .sw-label { flex-wrap: wrap; }
  .sw-live { order: 5; width: 100%; margin-top: 0; }
}
`;
