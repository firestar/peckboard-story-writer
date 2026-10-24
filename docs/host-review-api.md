# Host change: let plugins drive Document Review

Status: **proposed** (SW-13). Owner decision 2026-10-24 (SW-12, option A+B):
the Story Writer plugin should open every owner review on PeckBoard's own
Review page (Document Review, `/review/<id>`). Until this lands, the plugin
ships its own Review-style pane (SW-12, option B) on the same round model, so
switching over (SW-14) only replaces where the notes are written.

## Why a host change

Checked against PeckBoard 0.1.100 (`_ref/peckboard`):

- No plugin host function touches `doc_reviews` (`src/plugin/host.rs`
  `host_functions`), and no Document Review event is in `ALLOWED_HOOKS`
  (`src/plugin/manager.rs`).
- `/api/doc-reviews/*` sits behind `require_auth` (a user's login token) —
  even the `http_request` permission (which can reach loopback) gets 401.
- The plugin page bridge only fetches `/api/plugin-ui/<own id>/` and can only
  open a session, a terminal or another plugin's page (`PluginFullPage.tsx`),
  not `/review/<id>`.
- `get_review_doc` / `submit_review_revision` only work inside the built-in
  doc-review assistant session; no worker tool creates a review or reads its
  notes.
- "Run pass" hands the notes to the built-in assistant, which rewrites the
  document itself; a plugin needs the notes handed to *its* writer instead.

## Proposed host surface

### Permission

`doc_reviews` — create and read Document Reviews on files inside the calling
project's folder, owned by the calling plugin.

### Host functions

| Function | Input | Output |
| --- | --- | --- |
| `peckboard_doc_review_create` | `{project_id, path: "story/chapters/chapter-01.md", title?, owner_ref?}` — path relative to the project folder, `.md` only | `{review}` (`owner_plugin` = caller, `owner_ref` echoed) |
| `peckboard_doc_review_get` | `{review_id, comments: "all" \| "open"}` | `{review, versions: [{version, created_at, source}], comments: [...]}` — comments as stored (`id, version, start_line, end_line, quote, kind, body, status, resolution_note`) |
| `peckboard_doc_review_add_version` | `{review_id, path?}` (re-reads the file) or `{review_id, markdown}`; `resolutions?: [{comment_id, action: fixed\|declined\|answered, note}]` | `{version}` — the next round's draft as a new version of the SAME review, so every round stays in History/diff |
| `peckboard_doc_review_set_status` | `{review_id, status: annotating\|approved\|changes_requested}` | `{review}` |

Only reviews whose `owner_plugin` is the caller are reachable.

### Review page, for plugin-owned reviews

- Replace **Run pass** with **Approve** and **Request changes** (with an
  optional overall note). The built-in assistant never runs on a
  plugin-owned review.
- Both actions set the status and fire a new hook, `doc_review.decided`:
  `{review_id, owner_ref, decision: "approve" | "changes", note?,
  project_id}`. Add it to `ALLOWED_HOOKS`. (Plugins may also poll
  `peckboard_doc_review_get` on `timer.tick`.)
- Comment statuses: `pending` until the decision, `sent` after it,
  `fixed` / `declined` / `answered` once `add_version` carries resolutions.

### Plugin page bridge

`{type: "plugin-ui-open-review", reviewId}` in `PluginFullPage.tsx` →
navigate the app to `/review/<id>`, only for reviews the frame's plugin owns.

## How Story Writer uses it (SW-14)

1. A round opens (pilot at the owner gate, or the owner opens any written
   chapter): `doc_review_create` on `story/chapters/chapter-NN.md` the first
   time, `doc_review_add_version` for later rounds. Store `host_review_id` on
   the round.
2. `doc_review.decided`:
   - `approve` → same as `POST /review/decide {decision: "approve"}` today.
   - `changes` → read the comments with `doc_review_get`, copy them into the
     round's notes (same fields), then the same path as
     `POST /review/decide {decision: "changes"}`.
3. When the writer's `story_submit_owner_review_fixes` lands and the fresh
   cold read clears, `doc_review_add_version` with the per-note resolutions →
   the owner sees round N+1 on the same review page with round N resolved.
4. Dashboard "Open review" posts `plugin-ui-open-review`. The plugin's own
   pane stays as the fallback when the permission isn't granted.
