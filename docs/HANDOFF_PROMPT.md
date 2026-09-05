# Handoff prompt (paste into a fresh Claude Code session)

We're evolving **cradle** (~/Documents/projects/cradle — Tauri2/React19/Rust) into a
Mario-Maker-style editor over **canon-ai** (~/Documents/projects/canon-ai — Python
generator). Read persistent memory FIRST: project_cradle_platformer_editor.md in
your auto-memory dir has every decision, shipped detail, and gotcha. Session task
board: DB editing / design-doc / Play+Validate done, Library (#3) mostly done,
rest = roadmap. A copy of this prompt lives at cradle/docs/HANDOFF_PROMPT.md.

ARCHITECTURE (locked): cradle shells out to the `canon` CLI for ALL reads/writes/
generation. Every mutation journals to .canon/journal.jsonl + CAS object store
(op taxonomy in canon-ai/docs/provenance_traceability_spec.md). Anchored
generation: user fields = locked constraints. The user handles ALL git — stop at
the staging boundary.

STATE: a LARGE body of work sits UNCOMMITTED in both repos, suites green
(canon 61: test_platformer_ops + test_platformer_import_grids + mazeworld smoke;
cradle: tsc + cargo check + 137 vitest). Shipped this session, all adversarially
reviewed (3 workflow fleets: 26+18+14 confirmed findings, ALL fixed — details in
memory):
1. DB editing: `canon db update` (rows / tile:<stage>/<name> gameplay knobs) +
   `canon db schema` (pack-local roll-table overrides; pipeline phases resolve
   them at run time) + RowEditor edit-mode / TileSlotEditor / SchemaEditor.
2. Play+Validate: `canon level validate` (real jump-arc sim under the level's
   own physics, swim anchors, box overlay, rooms, cycle-guarded) → chips/panel/
   status bar; ▶ Play = detached pygame per level (PLAT_PLAIN=1 = blocks mode —
   the button follows the editor view), ▶ Play game = godot (--path pack root);
   Rust reaper thread emits "play-exited" → UI clears the playing note.
3. Library A (lineage): `canon asset lineage/versions/restore` + `object cat`;
   History tab = layered DAG (nodes=content hashes w/ facets, edges=ops,
   prompts on generated row nodes, usage badges, restore branches never
   delete, same-facet compare w/ onion skin).
4. Library C (global): src/canon/library.py — $CANON_LIBRARY (~/.canon/library):
   publish (composite bundles, dedup by content, op=keep) / list (--project =
   pack path) / import (fresh ids ALWAYS, stats.library_ref stamp, manifest
   path rewriting — play surfaces read paths EMBEDDED in frames/atlas.json,
   not stats.animation!) / cat; `canon asset assign` = copy art bundle between
   rows (sprite-facet event hashes → lineage shows the shared node). Cradle:
   🗂 LIBRARY nav surface (all/this-project scope by PACK PATH, kind filter,
   debounced search, import), ⬆ Publish in GenActions.
NEXT USER STEP: native hand-test (script provided last session), then user
commits.

RUN: CANON_ENV_FILE=~/Documents/projects/canon-ai/.env
CANON_BIN=~/Documents/projects/canon-ai/.venv/bin/canon npm run tauri dev
(browser mock: canon-ai/.claude/launch.json has a "cradle-mock" entry —
VITE_CRADLE_MOCK=1 vite on port 5199; mockdata already built in cradle/public).
Suites: cradle `npm test` + `npx tsc --noEmit` + `cargo check`; canon
.venv/bin/python -m pytest tests/test_platformer_ops.py tests/test_platformer_import_grids.py

DO NEXT (in order, unless the user redirects):
1. Fix anything the user's hand-test surfaced.
2. Finish Library remainder: Piece B badges (status/version-count chips on the
   type views — browsing already exists), art-phase prompt journaling (sprite
   nodes should carry prompts like row nodes do), an in-app gesture for
   `asset assign` (CLI-only today), update-propagation op (library_ref
   enables "re-import everywhere"), style bundles = first v2 library kind.
3. Then per the board: generate whole levels from the create flow, MazeWorld
   parity epic, game-feel tuning panel (user wants momentum/gravity/LOCAL
   FRICTION knobs — the tile `friction` param seam already exists), QA/keep op
   (auto-suggest publish on keep is user-approved), new-game wizard + cost
   dashboard, training-data export.

KEY GOTCHAS (many more in memory — read it): play surfaces read animation from
paths EMBEDDED in frames.json/atlas.json; DetailPane branches must precede the
payload-null guard for payload-less panels; world.name in cradle = pack DIR
BASENAME (use worldPath for project identity); window.confirm flows can't be
tested in the headless browser pane; the browser console buffer is sticky and
the a11y tree names inputs by placeholder; PLAT_* env vars hijack the play
harness (Rust strips them; PLAT_PLAIN/PLAT_LEVEL are deliberate); CANON_LIBRARY
env isolates library tests; canon never auto-reads .env; zsh chokes on inline
# comments; adversarial review workflows caught 58 real bugs across 3 passes —
keep using them on substantive diffs.
