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
`main.js` (theme + routing: wizard while the stage is `setup`, a minimal
pipeline view after, setup read-only from there), `style.js` (PeckBoard's
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
  refer to characters by name are matched, unknown names are flagged.
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
tools (SW-2), the prompt pack (SW-3), the pipeline stage machine (SW-4) and
the setup wizard (SW-5): manifest, hook/tool dispatch, the six story_*
tools, the writing-lessons prompt pack with per-stage card templates, the
card-driven pipeline engine, and the Story tab's setup wizard described
above. The live pipeline dashboard lands in a later card.
