# Story Writer

A PeckBoard plugin: a per-project **Story** tab that runs a setup wizard
(what the story is about; basics; and per element — premise, plot outline,
setting/world, characters, relationships, themes, endings/routes/choices,
style rules, banned words — a mode of *I write it* / *AI drafts, I edit* /
*AI generates*), then drives the writing pipeline with cards: records ->
pilot chapter -> owner review gate -> chapters in parallel -> review passes
(structure, character, pacing, line, copyedit, plus AI-tell / echo-word /
sentence-shape) -> final export.

Worker sessions pull context and push results through six MCP tools —
`story_get_brief`, `story_get_records`, `story_submit_records`,
`story_submit_chapter`, `story_update_state`, `story_report_review` — and the
plugin stores everything (`data_store`) and mirrors chapters into the
project's `story/` folder (`project_files_write`).

Modelled on [PeckBoard/project-planner](https://github.com/PeckBoard/project-planner):
same TypeScript -> WASM build via `@extism/js-pdk` / `extism-js`, same
two-stage esbuild (sandboxed page bundle + plugin bundle), same vitest fake
host.

## Build

```sh
npm install
npm run build        # -> dist/plugin.wasm
```

`npm test` runs `node esbuild.js && vitest run` (the page bundle the wasm
embeds has to exist before the vitest suite that imports `src/http.ts` runs).

Requires `extism-js` on `PATH` — install it with:

```sh
curl -fsSL https://raw.githubusercontent.com/extism/js-pdk/main/install.sh -o install.sh
sudo bash install.sh
```

## Install (local PeckBoard)

1. Build `dist/plugin.wasm` (above).
2. Copy it into your PeckBoard data directory's plugin folder:
   `<dataDir>/plugins/story-writer.wasm` (the file's stem becomes the
   plugin id).
3. Restart PeckBoard (or use its plugin-reload action, if available) so it
   picks up the new file.
4. Open **Settings -> Plugins** and approve Story Writer's declared hooks
   and permissions — a plugin is inert until approved.
5. Open any project; a **Story** tab appears alongside the board.
6. Optionally set the `writer_model` / `reviewer_model` settings (model ids
   in `provider:model[@account]` form) — the pipeline assigns these to the
   cards it creates.

## Settings

| Key | Description |
| --- | --- |
| `writer_model` | Model assigned to pilot-chapter and chapter-drafting cards. |
| `reviewer_model` | Model assigned to the structure/character/pacing/line/copyedit review-pass cards. |

Both default to Claude Opus 5.5
(`claude:claude-opus-5-5@acc_00efb018b53b417996c3ec27f7ecc333`) — the owner rejected GPT-5.6 Sol's
prose. Judge any writer model by a pilot chapter the owner actually plays; switch models when a
pilot fails rather than adding more rules.

## Prompt pack

`src/prompts/` compiles the built-in writing craft into card templates:

- `docs/writing-lessons.md` is vendored from `content/writing-lessons.md` in
  [`firestar/visualnovel`](https://github.com/firestar/visualnovel) (branch
  `main`). Re-vendor it with:
  `gh api repos/firestar/visualnovel/contents/content/writing-lessons.md?ref=main --jq '.content' | base64 -d > docs/writing-lessons.md`.
  `esbuild.js` (stage 0) embeds it into `src/generated/lessons.ts` at build
  time — never committed, never read from disk at runtime.
- `src/prompts/lessons.ts` parses the doc into named sections (`process`,
  `memory.*`, `craft.*`, `research.*` / `research.1`..`research.36` /
  `owner.A`..`owner.E`, `style.*`, `english.*`, `choices`, `system-voice`,
  `mechanical`, `card-template`). An unmapped heading throws, so re-vendoring
  a changed doc fails loudly instead of silently dropping a section.
- `src/prompts/lessons.ts` also parses `## 1D` (introductions, openings, the reader's point of
  view) into `reader.*` ids — `reader.intro`, named subsections (`reader.openings`,
  `reader.checking`, ...) and coded items (`reader.O1`..`reader.X1`, `reader.K1`..`reader.K10`,
  `reader.M1`..`reader.M2`, `reader.C1`..`reader.C3`, `reader.V1`..`reader.V2`, `reader.X2`).
- `src/prompts/coldRead.ts` has the two cold-read templates, deliberately outside the
  `StageKind`/`renderCard` dispatcher: `renderColdReadCard` (a FRESH reviewer — no brief, no
  records, no rules, no feedback; only the chapter text via `story_cold_read_get_text`) and
  `renderColdReadFixCard` (the writer, with full context, fixing every item and recording
  item→fix). Wiring these into the live pipeline per chapter is SW-9.
- `src/prompts/contract.ts` has the "pull context / push results through
  story_* tools" text each card gets, per stage. Generate cards push their
  draft as `story_update_state {stage:"setup", data:{"draft_<element>": value}}`
  (`draftKey()`): one top-level key per element because `data` is
  shallow-merged.
- `src/prompts/templates.ts` renders one card per stage (`renderCard`):
  records, pilot, chapter N, each review pass (structure, character, pacing,
  line, copyedit, ai-tell, echo-word, sentence-shape), a revision from
  feedback, and an AI-generate-element draft. Each card gets the brief, owner
  feedback (budgeted to stay under the 48,000-char description cap, newest
  first), the story's rule/banned-word overrides, the tools contract, and
  only the lessons relevant to that stage — VN-only sections (choices,
  sprites/backgrounds, routes) are dropped for a prose-novel brief.
- `promptPack()` renders the whole default style guide (for `story_get_brief`)
  followed by the story's rules and banned words.
- Per-story overrides: pass `overrides: {"<lesson id>": "replacement text"}`
  (empty string omits the section) to `renderCard`/`renderLessons`/
  `promptPack`. An override on a sub-section (`english.conciseness`) also
  applies inside a card that embeds its whole parent (`english`). The
  wizard stores them as `brief.lesson_overrides`; the pipeline passes them
  to every card it renders.

## Setup wizard (Story tab)

`page/` is the sandboxed Story tab (vanilla JS, bundled by `esbuild.js`
stage 1): `bridge.js` (postMessage fetch bridge + `plugin-ui-event`
refresh; GETs are re-posted with backoff because a cold-loaded frame can
run before the host attaches its listener), `model.js` (pure catalogs,
normalizers, merge/gate logic — unit-tested), `wizard.js` (the wizard),
`dash-model.js` + `dashboard.js` (the pipeline dashboard, below),
`main.js` (theme + routing: wizard while the stage is `setup`, the
dashboard after, setup read-only from there), `style.js` (PeckBoard's
light/dark tokens, `?theme=` or `prefers-color-scheme`).

- Steps: story idea -> basics (title; genre, format, POV, tense, tone,
  audience, rating as dropdowns, "Other…" where a custom value makes
  sense; chapter count 1-40) -> who writes what (per element: *I write it*
  / *AI drafts, I edit* / *AI generates*) -> one step per element ->
  review & start.
- Characters: full sheets (role, personality, values/fears/flaws, want vs
  need, lie/wound/ghost, one speech habit, initial emotion, a starting
  attitude + reason toward every other character, what they know).
  Relationships pick both sides from the character list; AI drafts that
  refer to characters by name are matched; a name that isn't in the cast
  is flagged in the dropdown and with a note under the row.
- Style rules: the built-in style guide (style v2 blocks, English rules,
  and for VN the choice-label and system-voice sections) shown per section
  with Edit / Turn off / Reset (`lesson_overrides`), plus the story's own
  rule list. Banned words: the built-in list plus the story's own.
- AI elements: "Draft/Generate with AI" (or "Send N to the AI" on the
  review step) queues `/pipeline/generate`; the element locks while its
  card runs, the draft lands live, the owner edits and approves it. A card
  closed as won't-do shows "AI card closed" with Try again.
- Edits autosave (debounced) as partial `POST /wizard` updates of only the
  touched fields; the server (`src/wizard.ts`) validates and merges them,
  ignores edits to an element whose AI card is running, never lets the page
  set `awaiting_ai`, and resets a stale `awaiting_ai` on the owner's next
  edit. Live refreshes merge the server copy without clobbering unsaved
  typing or moving focus.
- `GET .../defaults` supplies the starting brief, the editable style
  guide, the built-in banned words and the chapter cap.
- Validation: an out-of-range or non-integer chapter count is marked on
  the field (`aria-invalid` + an alert) and never saved — the typed value
  and its error survive re-renders, and the save indicator reads "Fix the
  marked field to save it" until it's fixed. Review & start lists every
  blocker as a link to its step and keeps **Start pipeline…** disabled
  until none are left.
- Once the pipeline has started, format and chapter count are fixed:
  `POST /wizard` answers 409 if either changes. A tab that missed the start
  (started from another tab or device) gets that 409 on its next save, or
  "pipeline already started" on Start, and reloads into the pipeline view
  with a notice instead of offering a retry that can't succeed.

Screenshots (Playwright, local PeckBoard with the plugin installed):
[story idea](docs/screenshots/wizard-story-idea.png),
[basics with a chapter-count error](docs/screenshots/wizard-basics-chapter-error.png),
[who writes what](docs/screenshots/wizard-who-writes-what.png),
[premise AI draft to review](docs/screenshots/wizard-premise-ai-draft.png),
[characters](docs/screenshots/wizard-characters.png),
[relationships naming someone not in the cast](docs/screenshots/wizard-relationships-missing-character.png),
[style rules with an edited section](docs/screenshots/wizard-style-rules.png),
[review blockers](docs/screenshots/wizard-review-blockers.png),
[start confirmation](docs/screenshots/wizard-start-confirm.png),
[a stale tab after the 409](docs/screenshots/wizard-stale-tab-409.png),
[read-only setup after start](docs/screenshots/wizard-setup-read-only.png),
[dark theme at 420 px](docs/screenshots/wizard-dark-mobile.png).

## Pipeline dashboard (Story tab, once started)

`page/dashboard.js` renders the live pipeline; every derivation (stage
status, worker status, grid cells, record tables) lives in
`page/dash-model.js` and is unit-tested (`test/dashModel.test.ts`).

- Header: title, format / chapters / genre / POV, a live indicator,
  **Export** (downloads every written chapter as one Markdown file via
  `GET .../export`) and **View setup** (the wizard, read-only). Stat tiles:
  stage, chapters written, review passes done, cards with a worker right
  now, and the owner's feedback count.
- Owner gate: while the stage is `pilot_review` a banner offers **Read
  pilot**, **Send feedback** and **Approve pilot…** (confirm step; disabled
  while a pilot revision from feedback is still open). Failed cards get a
  banner with **Retry** / **Retry all** (`/pipeline/retry`); a finished
  story gets **Download manuscript**.
- Stage timeline: Records -> Pilot chapter -> Your review -> Chapters ->
  Review passes -> Final, each with its status and progress. Picking a
  stage lists its cards: the work, the board card (title + step), the
  worker status (queued / waiting for a worker / working / blocked / done
  / failed / card missing), **Open session** (posts
  `plugin-ui-open-session` so PeckBoard opens the worker's session tab) and
  **Retry**. Revisions from the owner's feedback are listed under "Your
  review"; review-pass revisions under "Review passes".
- Chapter grid: one row per chapter, a cell for the draft and each of the
  eight review passes (status icon + label + tooltip, never colour alone),
  plus revising / feedback notes. Any cell or chapter opens the reader.
- Chapter reader (side drawer): Text (`GET .../chapter?n=N`, rendered
  from a safe Markdown subset as DOM), Reviews (every round's verdict and
  notes), Scenes (scene-fact sheets), Feedback, and a feedback box that
  posts `/pipeline/feedback` (revision card + story rule); the pilot's
  reader also carries Approve. Esc closes, Tab is trapped, prev/next
  chapter buttons.
- Story records tabs: Characters (full sheets, attitudes toward the
  others, what they know), Emotions & attitudes (emotion per character per
  chapter; an attitude matrix as of any chapter, carried forward from the
  sheets, changes highlighted), Who knows what (facts x characters, per
  route, as of any chapter), Setups & payoffs (promise -> progress ->
  payoff, filter by status), Choices map (VN: choices per chapter with
  their consequences, routes/endings and the options that lead there),
  Glossary (search), Recaps, and Rules & feedback (story rules traced to
  setup / owner feedback / review, edits and switched-off sections of the
  built-in style guide, banned words, the full feedback history with each
  revision's status).
- Live: store writes arrive as `plugin-ui-event` and refetch `/state`;
  the board's side of each card (step, blocked, worker session) comes from
  `GET .../cards` — kept off `/state` because `list_cards` returns every
  card with its full description — polled every 20 s while the tab is
  visible and work is open, and soon after any unit changes. Renders keep
  focus, caret, scroll and the reader's place.

## Pipeline engine

`src/pipeline.ts` drives the stage machine: setup -> records -> pilot ->
pilot_review -> chapters -> review -> final. It owns one `EngineState` doc
per project (collection `"engine"`), keyed by stable unit ids (`"records"`,
`"chapter:3"`, `"review:2:line"`, ...) each mapped to at most one open board
card — the engine never creates a second card for the same id; a retry
resets the unit in place (new attempt, same id) rather than minting a new
one, and a card whose creation call succeeded but whose id got lost before
it was persisted (the run's write-ahead `in_flight` flag is still set) is
recovered by matching a hidden `story-writer:unit=...` marker in the
card's own description.

- The engine owns the top-level pipeline `stage` (mirrored into the
  `state` doc for the dashboard); `story_update_state` only records
  per-stage status/notes/data.
- `card.step.after` re-runs the engine when one of its cards reaches
  `done`/`wont_do`, reconciling from the event payload alone; `timer.tick`
  is the safety net, sweeping unfinished projects round-robin (from a small
  `engine_index` doc) until a 1 s deadline and resuming after the last one
  on the next tick, and re-listing a project's cards at most every 10
  minutes (`list_cards` returns every card with its full description).
- Parallel chapter cards (2..N) are created blocked as soon as the pilot
  starts, so they're visible before the owner approves it. Stories are
  capped at 40 chapters so each per-project doc stays under core's
  256 KiB limit.
- `POST .../pipeline/{generate,start,approve,feedback,retry}` and
  `GET .../export` (src/http.ts) are the owner/wizard actions: queue
  AI-generate-element cards, start the pipeline (gated on every
  draft/generate element being owner-approved), approve the pilot (unblocks
  the queued chapter cards), leave feedback on the pilot or any chapter
  (recorded, appended to style_rules, turned into a revision card), retry a
  failed unit, and assemble the final manuscript. A request the current
  stage doesn't allow (approve before pilot_review or with a pilot
  revision open, a second start, ...) answers 409.
- Each review pass allows up to `MAX_REVIEW_ROUNDS` (2) attempts
  (`changes_requested` -> a revision card -> the same pass again) before
  moving on regardless, so one stubborn pass can't stall a chapter forever.
- Every run is budgeted (a 1.2 s wall-clock deadline plus a
  max-creates-per-call cap) so one hook call stays inside core's 2 s
  default call budget; whatever doesn't fit resumes on the next event or
  tick.

## Status

This is the scaffold (SW-1), the data model, chunked store and worker MCP
tools (SW-2), the prompt pack (SW-3), the pipeline stage machine (SW-4),
the setup wizard (SW-5) and the pipeline dashboard (SW-6): manifest,
hook/tool dispatch, the six story_* tools, the writing-lessons prompt pack
with per-stage card templates, the card-driven pipeline engine, and the
Story tab's wizard and live dashboard described above. Screenshots
(Playwright, local PeckBoard with the plugin installed) are
`docs/screenshots/wizard-*.png` (listed under Setup wizard) and
`docs/screenshots/dashboard-*.png` — e.g.
[the owner gate](docs/screenshots/dashboard-pilot-gate.png),
[the chapter grid](docs/screenshots/dashboard-chapter-grid.png),
[who knows what](docs/screenshots/dashboard-who-knows-what.png),
[dark theme](docs/screenshots/dashboard-dark.png).
