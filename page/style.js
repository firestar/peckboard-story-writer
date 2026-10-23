// Minimal light/dark theme for the Story tab shell. Expanded as the wizard
// and dashboard screens are built out.
export const CSS = `
:root[data-theme="light"] {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #666666; --border: #dddddd;
  --card: #f7f7f8; --accent: #4f46e5;
}
:root[data-theme="dark"] {
  --bg: #15151a; --fg: #e8e8ea; --muted: #9b9ba3; --border: #2e2e36;
  --card: #1e1e26; --accent: #818cf8;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.sw-app { padding: 20px; max-width: 920px; margin: 0 auto; }
.sw-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; }
.sw-header h1 { font-size: 18px; margin: 0; }
.sw-stage {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  background: var(--card); color: var(--muted); font-size: 12px;
  border: 1px solid var(--border);
}
.sw-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px; margin-bottom: 12px;
}
.sw-card h2 { font-size: 13px; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.sw-muted { color: var(--muted); }
.sw-error { color: #d14343; }
.sw-btn {
  background: var(--accent); color: #fff; border: none; border-radius: 6px;
  padding: 7px 14px; font-size: 13px; cursor: pointer;
}
.sw-btn:disabled { opacity: .5; cursor: default; }
textarea.sw-input {
  width: 100%; min-height: 90px; background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 6px; padding: 8px; font: inherit;
}
pre.sw-pre {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px; overflow: auto; font-size: 12px; margin: 0;
}
`;
