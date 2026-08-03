<p align="center">
  <img src="public/demi-mark.svg" width="72" height="72" alt="Demi" />
</p>

# Cradle

> The agentic atelier for game development.

By **Demi** ([github.com/Demi-Build](https://github.com/Demi-Build)) — agentic atelier for game developers.

[![CI](https://github.com/Demi-Build/cradle/actions/workflows/ci.yml/badge.svg)](https://github.com/Demi-Build/cradle/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

![Cradle inspecting a MazeWorld-generated world](docs/screenshots/cradle_tour.gif)

Cradle reads worlds emitted by [canon](https://github.com/Demi-Build/canon-ai) (early development; public release coming soon) and renders them as a structured, navigable workspace. canon is a Python library that brings coherence tooling to AI-generated game content — generating a World Bible, 3-stage validation pipeline, retry-with-feedback. Cradle lets you walk that output without running the game, adding a taste-making layer for game developers, storytellers, and world builders.

**v0.1 shipped as a read-only inspector. v0.2 — in development on this branch — makes it an editor:** open a canon platformer pack and paint terrain, place enemies and items, wire a world map, drive generation, and play the result, all without leaving the app. Jump to [Operating cradle](#operating-cradle).

Two reference worlds: **MazeWorld**, an AI-orchestrated 2D RPG where every NPC, item, quest, portrait, music cue and SFX is generated from a single `STORY_SEED`, and canon's **platformer** packs — grid-first worlds of stages, levels, tilesets and enemy rosters, which are what the v0.2 editor works on.

## Download

Pre-built binaries live on the [Releases page](https://github.com/Demi-Build/cradle/releases/latest). v0.1 ships:

- **macOS (universal: Intel + Apple Silicon)** — `.dmg`, signed with a Developer ID and notarized by Apple. Double-click to install, no Gatekeeper bypass needed.
- **Windows (.msi)** — unsigned for v0.1; SmartScreen will warn on first run ("More info" → "Run anyway"). Code signing lands in v0.1.x.
- **Linux (.AppImage)** — unsigned, which is the norm for AppImages. `chmod +x` and run.

To run from source on any platform, see [Development](#development) below.

## Cradle Use Case

If you're an **indie developer** evaluating AI-content tooling, cradle lets you inspect the artifact before you commit to a content protocol. Open a world, click through every NPC, walk the dialogue graph, see how a generation actually hangs together end-to-end — without booting an engine.

If you're a **researcher** working on coherence in generative game content, cradle is a structured viewer for the primitives canon emits: World Bible, four-tree NPC dialogue with quest gates, validation reports, generation stats. The data layer is a single Rust trait (`DataSource`) so the viewer can sit on top of any source you can implement — filesystem today, server or blob store tomorrow.

## Development Goals

AI-generated game content needs a coherence protocol. canon defines it; cradle is the first tool built on it. Together these two surfaces will keep developing: live LLM dialogue against loaded NPCs, a data surface for fast iteration, and simulation adapters for environments, NPC AI, agentic-game testing, and game-engine co-development. v0.1 was the read-only core, v0.2 adds authoring — see the [roadmap](#roadmap) at the bottom for the milestones after that.

## Privacy

Cradle is currently for local development and consumes finished worlds emitted by canon. No telemetry, no network calls, no analytics — every world you load stays on your machine.

## Status

**v0.1 (released)** is a static inspector for MazeWorld-shaped worlds — everything under "v0.1 shipped" below.

**v0.2 (in development, this branch)** turns cradle into an **editor** for canon's platformer packs: paint terrain, place enemies and items, wire a world map, drive generation, and play the result without leaving the app. See [Operating cradle](#operating-cradle) for how to use it and [CHANGELOG.md](./CHANGELOG.md) for the full list.

The load-bearing rule: **cradle never writes pack files directly.** Every mutation shells out to a `canon` CLI verb, which is what keeps content hashes, provenance and validation consistent. That's why v0.2 needs canon on the machine — see [Two-repo setup](#two-repo-setup).

Cradle is local-first and makes no network calls at runtime unless you explicitly select a paid generator — see [PRIVACY.md](./PRIVACY.md).

---

## Operating cradle

### Two-repo setup

v0.2 drives canon as a subprocess, so you need both repos and an **editable** canon install (cradle locates canon's pipeline through the installed package).

```
git clone https://github.com/Demi-Build/canon-ai
git clone https://github.com/Demi-Build/cradle

cd canon-ai
python -m venv .venv && source .venv/bin/activate
pip install -e ".[cli,platformer,play]"        # add ,audio for Lyria music

cd ../cradle
npm install
```

Then point cradle at canon and run it:

```
export CANON_BIN=/path/to/canon-ai/.venv/bin/canon
npm run tauri dev
```

Windows contributors: see [WINDOWS_SETUP.md](./WINDOWS_SETUP.md) for the equivalent steps (`\.venv\Scripts\canon.exe`, MSVC + WebView2).

### Environment variables

| Variable         | Default                                           | What it does                                                                      |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CANON_BIN`      | `canon` on `PATH`                                 | The canon console script. Everything cradle writes goes through it.               |
| `CANON_REPO`     | derived from `CANON_BIN`                          | canon's repo root — used to launch the pygame playtest.                           |
| `CANON_ENV_FILE` | `<canon repo>/.env`                               | API keys for paid generators. canon never auto-reads `.env`; cradle hands it one. |
| `GODOT_BIN`      | `godot` on `PATH`, then `/Applications/Godot.app` | Used by **▶ Play game**.                                                          |

You only need `CANON_BIN`. The rest have working defaults.

### Your first world

1. **＋ New platformer project** (start screen, editor title bar, or `⌘N`). Pick the Platformer template, name it, choose how many stages and levels.
2. Leave every generator at its default for a **free** run — placeholder art, canned text, no API keys. The cost box reads `$0`.
3. Pick a location. Cradle generates a small, complete, playable world and opens it.

To spend real money, turn any generator up in step 2. Cradle shows a live estimate, names which generators are paid, and asks before it runs. Paid backends need their key in `CANON_ENV_FILE`; a missing one is refused up front with the variable named.

### The surfaces

| Where            | What it's for                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| **🗺 World map** | Place levels, group them into areas, wire the paths between them. The parent of the level editor.           |
| **Level editor** | Paint tiles, place enemies/items/checkpoints, carve music regions, validate, play.                          |
| **Entity views** | Enemies, items, player, tilesets, backdrops, audio — browse as cards or a table, edit rows, regenerate art. |
| **🗂 Library**   | A global asset store above per-pack assets: publish from one project, import into another.                  |
| **⚙ Jobs**       | Every generation run: queued/running/done, cost, duration, and whether it changed anything.                 |
| **💰 Cost**      | What this project has actually spent, by operation.                                                         |

### Editing a level

The map is the surface, and the render is a pure function of the level data — so the same edits drive **Blocks** (placeholder colours), **Art** (canon's real skinned render) and **Overlay** (art plus a collision tint) identically.

- **Arm a brush** from the dock, then click or drag to paint. Tiles are painted as _types_ — art is a skin bound to the type and swaps freely.
- **Right-click always erases**, whatever tool is armed.
- **Drag a placement** to move it; click one to inspect it in the tray.
- **`⌘S`** saves the batch. Edits are local and live-rendered until then; dirty layers are chipped in the toolbar.
- **`✓ Validate`** runs canon's real checks against the level on disk — reachability simulation, placement checks, secret rooms.
- **`▶ Play`** launches the level in pygame and follows your current view mode, so Blocks view plays without art.

New levels start as **drafts** and stay out of the progression until you publish them into a stage.

### Generating and improving

Generation is composable — terrain, enemies and items are separate operations, so any permutation works: paint terrain by hand and let canon place enemies into it, or generate the lot and fix it by hand.

- **🪄 Layout** re-authors the terrain blind.
- **✨ Improve** shows the LLM the current level plus your instruction and re-authors it in place, keeping placements by default.
- **🎲 Enemies / 🎲 Items** place into whatever terrain is there now.
- **✎ Edit prompt (advanced)**, on every generation gate, shows the exact system prompt about to be sent and lets you edit it for that one call.

Everything runs as a background job, so the window never blocks. The **⚙ Jobs** tray tells you whether a run actually changed anything — a run that produced identical bytes is reported as "no change" rather than leaving you guessing.

### Keyboard

| Key             | Action                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| `⌘K` / `Ctrl+K` | Command palette — every action, including greyed-out ones with a reason |
| `⌘N` / `⌘O`     | New project · Open a project from disk                                  |
| `⌘S`            | Save the level's pending edits                                          |
| `⌘B` / `⌘I`     | Collapse the sidebar · the inspector (or dock tray)                     |
| `⌘.`            | Focus mode — hide the chrome, give the map the window                   |
| `V` `B` `G` `E` | Level editor: Select · Paint · Fill · Erase                             |
| `V` `L` `P` `S` | World map: Select · Place level · Draw path · Path stops                |
| Space (held)    | World map: pan from anywhere                                            |
| `Esc`           | Cancel the current gesture, close an overlay                            |

`⌘` on macOS, `Ctrl` elsewhere; every hint renders the key you actually press. Shortcuts are skipped while a text input is focused.

---

## v0.1 shipped

**Shipped:**

- **Start screen** — atmospheric returning-user hero with last-world summary + recent project rail, or a first-run onboarding card if no history. Persisted to `localStorage` as `cradle.recents.v1`.
- **Recent projects page** — sortable/filterable grid + list views of every world opened, grouped by time (Today / Yesterday / Earlier this week / …).
- **Three-pane world shell** — title-bar breadcrumb + notes drawer + theme toggle; left nav with category subgroups (items by category, events by type) and clickable world-title as the Bible link; central detail pane with tabs.
- **Per-type detail views** — each entity type has a tailored Overview:
  - **NPCs:** big portrait + story/quest badges, stats grid next to portrait, backstory, hobby/personality/greeting/exhausted/portrait-prompt prose, personality-notes bullets, shop-inventory table, combat-form block (for `AggressiveNPC` types with `npc_monster` stats).
  - **Monsters:** D&D-style HP / AC / Damage stat block, element chips, abilities grid with weapon-card dice readouts.
  - **Rooms:** two-image hero (entry portrait + maze map), layout metadata, bible-beat story section, placed NPCs / items / events / quests as clickable lists.
  - **Items:** per-category stats table (weapon, food, drink, tool, spell-scroll) next to portrait.
  - **Events / Puzzles:** event stats; choices render in a dedicated Puzzle tab with Card + Graph modes, failure damage surfaced on the prompt.
  - **Classes:** portrait + starting weapon with looked-up attack dice + 4+3 stats grid + ability/spell pool cards with "starting" badges.
  - **Quests:** contract card — title + chips, description, Links (giver · in room · prereq), Objective (type-driven: escort / solve / combat / fetch), Contract (success xp/item vs failure hp), success/failure dialogue with "open in npc dialogue →" jump.
- **Dialogue system** — four trees per NPC (default · complete · incomplete · failed) woven into a single state machine with a Quest-gate node separating conversation branching from quest-state branching. Card mode (driver buttons between beats) and Graph mode (React Flow with dagre auto-layout, colored edges per beat kind).
- **Cross-linking** — any `giver_npc_id`, `room_id`, `monster_ids[]`, `item_id`, `prerequisite_quest_id`, `destination_room`, `target_event_id`, `target_npc_id`, etc. renders as a clickable pill that selects the referenced entity.
- **Lightbox** — click any portrait, map, or hero image to view full-screen; `portrait_prompt` is the hover tooltip on every image.
- **Design system** — token-based dark + light themes (Inter + JetBrains Mono, warm-neutral palette, oklch accent amber). Arc-style overlay scrollbars (hidden at rest, fade in on pane hover). Float layout for NPC/monster/event/class/quest so text wraps around the portrait.
- **Notes drawer** — slides in from the right; Changelog content editable at `src/components/start/NotesDrawer.tsx`.

**Still pending (blocked on canon emissions):**

- Validation bar wiring — needs `validation_report.json`.
- Generation trail tab (prompts · responses · retry history) — needs `generation_log.jsonl`.
- Monster base attack dice — `MonsterStatBlock` reads `attack_dice` / `damage_dice` / `damage` at the monster root when canon emits any of them; currently all monster damage flows through the abilities array.

**Still deferred:**

- **Auto-updater.** Tauri ships one, but it depends on signed builds across every target. Wires up alongside Windows code signing. The tray's Updates pane says so rather than pretending to check.
- **Windows code signing.** v0.1 ships an unsigned `.msi` (SmartScreen warning on first run). CI is already wired with `WINDOWS_CERTIFICATE` env-var TODOs.
- **Reveal on disk / duplicate / move to trash.** Present but disabled — they need a file-opener plugin (audited out of v0.1 as unused) and backend commands that don't exist yet.
- **Plugin / extension API.** Utilize Generative Model API endpoints as well as scaffold on-prem models for custom generation to extend / ideate within worlds.
- **Chat interface.** What's a modern dev tool without a friend?
- **Schema-typed canon dependency.** Once canon stabilizes its public schema.

## Nav keyboard reference

These work in the entity views, alongside the editor shortcuts in [Operating cradle](#keyboard). Skipped while a text input is focused; `⌘` / `Ctrl` held releases control to the native shortcut.

| Key                        | Action                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `↑` / `↓`                  | Cycle within the current entity type's list                        |
| `↑` at first / `↓` at last | Spill into the adjacent type (last of prev / first of next)        |
| `⌥↑` / `⌥↓`                | Skip-jump to previous / next type's first entity                   |
| `←`                        | From an entity, step up to the type view (cards/list)              |
| `→`                        | From a type view, step down into the first entity                  |
| `Tab` / `⇧Tab`             | Cycle tabs inside the detail pane (Overview → History → Raw, etc.) |
| `Esc`                      | Close the tray / dismiss the lightbox / disarm the current brush   |

(Why `⌥↑/↓` and not `⌘↑/↓`: `⌘↑/↓` is reserved by macOS for "go to parent folder" and "scroll to top/bottom of document". `⌥↑/↓` mirrors Slack and Discord's "jump between sidebar groups" convention.)

## Data layer

Cradle talks to a `DataSource` trait in `src-tauri/src/data.rs`. v0.1 ships one impl, `LocalFsDataSource`, which reads from a local world directory. A future `RemoteDataSource` (for a collaborative/server-hosted mode) can slot in behind the same trait without frontend changes — all IPC goes through typed wrappers in `src/lib/invoke.ts`.

Expected world layout (matches MazeWorld's output):

```
<world>/
  data/
    world_bible.json
    manifest.json
    narrative.json
    generation_stats.json
    npcs/npcs.json
    items/items.json
    monsters/monsters.json
    quests/quests.json
    events/events.json
    classes/classes.json
    classes/spell_pools.json
    rooms/<room_id>/maze.json
    portraits/
      npcs/npc_<id>.png
      monsters/mon_<name>.png
      items/item_<slug>.png
      events/evt_<id>.png
      classes/class_<idx>.png
      maps/room_<idx>_map.png
      environment_<idx>.png
      start_screen.png
    music/*.mp3
    sfx/*.mp3
```

Reference world ships in `bibles/mazeworld_5_room_demo/`.

The Tauri asset protocol resolves absolute portrait paths emitted by canon (including ones that point at MazeWorld's install path) by stripping the `data/portraits/…` prefix and re-rooting under the loaded world.

**Platformer packs** are a different shape — grid-first rather than prose-first — and cradle detects one by the presence of `manifest.json` plus a `level/` directory:

```
<pack>/
  manifest.json                    world, stages, tiles, palettes, world_map
  world.json                       the World bible + durable map overrides
  level/<stage>/<level>/
    level.json                     dims, spawn/exit, placements, music
    collision.npz                  tile-type physics grid
    terrain.npz                    autotile-baked tileset slot indices
    background.npz                 parallax bands
  stage/<stage>/stage.json         theme, biome, tileset + enemy roster
  enemy/*.json  item/*.json        definitions, referenced by placements
  sprite/  tileset/  backdrop/     art
  music/  sfx/                     audio
  review/<stage>/<level>.png       render used for map thumbnails
  .canon/journal.jsonl             provenance — every mutation, append-only
  .canon/objects/<sha256>          content-addressed store behind History
```

Cradle never parses the `.npz` grids itself. `canon level export` returns a render-ready JSON bundle, and writes go back through `canon level apply-edit` / `import-grids` — so numpy stays on canon's side of the line.

## Stack

- **Tauri 2** (Rust backend, native webview) — cross-platform; macOS and Windows bundles via `npm run tauri build`.
- **React 19 + TypeScript + Vite** frontend.
- **zustand v5** — store (selection / world / recents / theme / layout / jobs / commands / world map).
- **TanStack Table** — sortable filterable entity list view.
- **@xyflow/react** + **@dagrejs/dagre** — dialogue / puzzle graph views.
- **@tauri-apps/plugin-dialog** — native folder picker.
- **Canvas 2D** for the level and world-map renderers — each is a pure `drawX.ts` function plus an `XCanvas.tsx` React wrapper that owns the camera.
- **Inter + JetBrains Mono** bundled locally via [@fontsource-variable](https://fontsource.org/) — no runtime CDN call.
- **canon** — a Python subprocess, not a library dependency. v0.1 only _read_ canon's output; v0.2 also writes through its CLI. Schema typing lands once canon stabilizes its public schema.

## Development

### Prerequisites

- Node 20+
- Rust toolchain (install via [rustup](https://rustup.rs))
- Platform build deps for Tauri — see the [Tauri prerequisites](https://tauri.app/start/prerequisites/) page for your OS
- **For v0.2 editing:** Python 3.12+ and an editable [canon](https://github.com/Demi-Build/canon-ai) install — see [Two-repo setup](#two-repo-setup)

### Setup

```
npm install
npm run fetch-demo
```

`npm run fetch-demo` downloads the bundled MazeWorld 5-room demo (~1 GB, mostly portraits) from the [`demo-v0.1.0` GitHub Release](https://github.com/Demi-Build/cradle/releases/tag/demo-v0.1.0) into `bibles/mazeworld_5_room_demo/`. It's a separate step (not a `postinstall` hook) so first-time `npm install` doesn't surprise you with a 1 GB download. The script is idempotent — re-running is a no-op once the demo is in place.

### Run

```
npm run tauri dev
```

On first launch you'll see the first-run card. Click **＋ New platformer project** to generate one (free, no API keys), **Open world from disk** to pick an existing one, or **Try the bundled demo** to load the MazeWorld world fetched above. After that, the start screen's returning-user hero shows your last project and a recent-projects rail.

> **Rust changes need a full restart.** `npm run tauri dev` hot-reloads the frontend only — after touching `src-tauri/`, stop and re-run it, or you'll be testing the previous binary.

### Browser dev shim

Most of the UI can be driven in a plain browser against real pack data, without building the Rust side:

```
VITE_CRADLE_MOCK=1 npm run dev
```

`src/lib/devMock.ts` stands in for the Tauri backend. It's the fast loop for frontend work — but it is a _reimplementation_, so anything touching a write path should also be checked against the real CLI. A mock that reimplements a write can hide a genuine read/write split.

### Build

```
npm run tauri build
```

Produces a platform-native bundle in `src-tauri/target/release/bundle/` — `.dmg` / `.app` on macOS, `.msi` / `.exe` on Windows.

### Checks

```
npx tsc --noEmit                  # types
npx vitest run                    # frontend unit tests
npm run lint                      # eslint
cd src-tauri && cargo check       # Rust
```

Run all four before a PR — CI does.

## Layout

```
cradle/
  src/
    App.tsx                              routing, global shortcuts, job listener
    store.ts                             zustand store (+ LayoutPrefs, commands, jobs)
    lib/
      invoke.ts                          typed Tauri commands
      devMock.ts                         browser dev shim (VITE_CRADLE_MOCK=1)
      keys.ts                            cross-platform shortcuts (⌘ vs Ctrl)
      canvasTheme.ts                     design tokens resolved for <canvas>
      useDraggablePanel.ts               shared grip-drag for floating panels
      jobs.ts  cost.ts  validation.ts    background jobs · spend · verdicts
      recents.ts  refs.ts                recents storage · cross-link map
    styles/
      tokens.css                         THE colour source (both themes)
      start.css                          start / recents page styles
    components/
      TopBar · LeftNav · DetailPane · ValidationBar · CommandPalette
      JobTray · CostDashboard · Tooltip · Lightbox · ErrorBoundary
      level/     LevelDetail · LevelCanvas · drawLevel · Dock · ToolRail
                 Minimap · AudioLane · MusicPanel · gridOps
                 RegenerateLayoutModal · ImproveLayoutModal
      world/     WorldMapView · drawWorld · WorldSidebar · WorldToolRail
                 WorldInspector
      db/        RowEditor · SchemaEditor · TileSlotEditor
                 LineagePanel · LibraryPanel
      start/     StartScreen · ReturningHero · WorldGlance · RecentsRail
                 RecentTile · RecentMenu · DeleteProjectDialog
                 NewProjectModal · NotesDrawer (the tray) · Icons
      recents/ · dialogue/ · event/ · quest/ · room/ · monster/ · class/
                                           (MazeWorld views, unchanged)
  src-tauri/
    src/
      data.rs                            DataSource trait + LocalFsDataSource
      lib.rs                             Tauri commands + the serial job queue
    tauri.conf.json                      assetProtocol scope, dialog plugin
  bibles/                                reference fixture worlds
```

The two canvases follow one shape: a pure `drawX.ts` that renders `(data, mode, camera)` with no React in it, and an `XCanvas.tsx` wrapper that owns the camera and the pointer handling. The same function draws the main canvas and the minimap, so they can't disagree.

## Roadmap

- **v0.2** (current) — the platformer editor: terrain painting, placement, world map, generation, playtest, provenance. Canon schema types as a dependency once canon stabilizes them.
- **v0.2.x** — animation tab with QA badges, per-actor custom states, dust/VFX; a game-feel tuning panel (momentum, gravity, per-tile friction); an asset-library UX revisit.
- **v0.3** — live LLM dialogue against loaded NPCs; MazeWorld parity with the editor surfaces.
- **v0.4** — simulation adapters (combat, environment) via pluggable backends; broader game-engine targets.
- **Later** — collaborative mode (`RemoteDataSource`), multi-world diffing, training-data export from the provenance journal.
