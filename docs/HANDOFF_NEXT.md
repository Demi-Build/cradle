# Handoff — dungeon crawler parity

## Start here

Read, in this order:

1. `~/.claude/plans/dungeon-crawler-parity.md` — the scoping doc for this epic.
   Decisions are **locked with the user**; don't re-litigate them. The four
   open questions in it are all **answered** — read the answers, they shrank
   the work considerably.
2. Persistent memory `project_cradle_platformer_editor.md` — the last entry is
   this epic. Earlier entries are the platformer editor you're generalizing
   FROM; skim rather than read.
3. `project_canon_engineering_chips.md` — gotchas that cost real cycles. Read
   before verifying anything.

## Repos

| repo | branch | role |
|---|---|---|
| `~/Documents/projects/canon-ai` | `cradle_editor_surface` | generator (Python) |
| `~/Documents/projects/cradle` | `feat/platformeditor` | editor (Tauri 2 / React 19 / Rust) |

**Start a new branch for this epic.** Use `.venv/bin/python` and
`.venv/bin/canon` in canon-ai. **The user handles all git — stop at the staging
boundary, never commit or push.** They commit between sessions, so check
`git status` rather than trusting any list.

## Verification

```bash
# canon (from canon-ai)
.venv/bin/python -m pytest tests/ -q --ignore=tests/test_backend_lyria.py   # 2374 passed, 4 skipped
# cradle (from cradle)
npx tsc --noEmit && npx vitest run && (cd src-tauri && cargo check)          # 176 tests
```

`test_backend_lyria` fails without `GOOGLE_API_KEY` — known, pre-existing.
Browser mock: `preview_start {name: "cradle-mock"}` → port 5199, real pack
data, no Tauri. **Rust changes need a full `tauri dev` restart** — HMR is
frontend only.

---

## THE WORK

Open an existing world in cradle and edit / generate / create levels, maps and
all the data the **pygame** engine reads; plus **new project → Dungeon
crawler** → author the data → build a game.

**Hard scope line (user, explicit):** create-project and DB editing **do not
touch gameplay**. You are only changing **the databases the engine reads**.
Game tuning is a separate, later surface. Do not drift into physics.

### Locked decisions

- **Generalize the platformer adapters** into a game-agnostic registry — one
  `apply-edit`, one `db update`, one journal, dispatching on pack type. NOT a
  parallel `dungeon_*` pair. Accepts an upfront refactor of working code.
- **Full spatial.** Rooms already carry grids (see findings).
- **"Intercept any stage" = the per-step rolls the platformer already has**
  (whole level, or map → items → monsters separately). MazeWorld already
  generates this way. **There is no new pipeline/pause capability to build.**
- **No migration.** Existing MazeWorld worlds stay MazeWorld; only NEW
  creations are dungeon crawlers. Needs a **read-both compat shim**, not a
  migrate verb.
- **All 9 entity types get full create / edit / write** — npcs, items,
  monsters, quests, rooms, events, classes, music, sfx. No read-only tier.

### Findings that shape it

- **Canon has NO write side for it.** `src/canon/adapters/` is
  `platformer_read.py` + `platformer_write.py` only. Every editing verb built
  this year is platformer-specific. **This epic is mostly a CANON build**,
  which is the opposite of what "parity with the editor surfaces" sounds like.
- **Cradle's read path is already generic** and `src-tauri/src/data.rs` already
  lists the 9 types. `NewProjectModal` already offers "Dungeon crawler" (beta).
- **Rooms are already spatial.** `rooms/rooms.json` → each room has
  `maze_ref: rooms/<id>/maze.json`, a 40×30 grid from `MazeLayoutPhase`, plus
  per-room `npcs`/`items`/`monsters`/`encounters`/`quests` arrays.
  **A maze grid is a tilemap and a room is a level** — this is what makes
  generalizing viable rather than a rewrite.
- **`data_canon/` is settled.** `MazeWorld/config.py:17` sets
  `DATA_DIR = "data_canon/"`; the old `data/` is commented out and legacy.
  pygame already reads exactly what canon writes. No translation step.
- **Create is spec-driven, not forms.** `RowEditor` renders from a roll-table
  schema (`schemas/<type>.json`, editable via `canon db schema`). Full create
  on all nine means **nine schemas**, not nine forms. Check which MazeWorld
  already has; authoring the missing ones is real work, not a footnote.

### Phasing (draft — agree it with the user first)

- **P0** Design the generalization seam. What is genuinely shared (DB rows,
  assets, journal, CAS) vs genuinely different (grids, placements). Produce the
  registry design **before touching code**.
- **P1** Naming + read-both compat shim.
- **P2** Generalize read — one export that serves both, so cradle renders a
  maze the way it renders a level.
- **P3** Generalize write — `apply-edit` / `db update` / `import-grids` become
  registry dispatch. **Platformer must stay byte-identical throughout.**
- **P4** Cradle surfaces — room/maze editor reusing the level canvas, plus
  per-step roll buttons mirroring 🪄 Layout / 🎲 Enemies / 🎲 Items.
- **P5** The **cradle-owned project store** (decide before the create flow
  ships): games created in cradle live under cradle's own projects dir; worlds
  opened from an external path are written back in place. `$CANON_LIBRARY`
  (`~/.canon/library`) is the precedent for a store outside any one pack.

---

## Debts from the last session

- **`RecentsRail` has no test.** The hero-exclusion, tier card counts and the
  "See all N" total are all pinnable. Small and worth doing.
- The start page's **meta-line font bump** (≥1600px tier) was verified only via
  the matching media query — the browser mock is a platformer pack with no
  `seed`/`rooms`/`events`, so it renders nothing there. Confirm on a real
  MazeWorld project.
- **E3 swim art** — the animation mechanism is built and tested (a pack opts in
  via one line of `animation.json` and swim is selected when submerged, both
  engines), but no pack has swim art. Needs a **paid leg the user runs**.
- The jump from a finished animate run to the Animation tab is wired but never
  exercised end to end (needs a real completed job).

## Doctrine

- **Extend existing machinery; don't build parallel systems.** Say what each
  change extends. This whole epic is that principle applied.
- **Cradle never writes pack files** — everything goes through a canon verb.
- **Paid legs are user-run.** Prep the command and hand it over; don't spend.
- **Disabled-with-a-reason beats hidden.**
- **Colour comes from `src/styles/tokens.css` only**; canvases resolve the same
  tokens via `lib/canvasTheme.ts`. Game *content* colours are deliberately
  literal.
- **Verify rendering by comparing both engines, never by trusting `PLAT_TRAJ`**
  — it is position-only and structurally blind to rendering and to animation
  selection.
