# Changelog

All notable changes to cradle are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**v0.2 — editing.** Cradle stops being a read-only inspector and becomes an editor for canon's platformer packs: paint terrain, place enemies and items, wire a world map, drive generation, and play the result. Everything below is cradle-side; the canon verbs it calls are documented in that repo.

Cradle still never writes pack files itself — every mutation goes through a `canon` CLI verb, which is what keeps hashes, provenance and validation consistent.

### Added

#### Platformer editor

- **Level editor** — the map is the surface. Three render modes (**Blocks** placeholder colours · **Art** mirroring canon's skinned render · **Overlay** art + collision tint), a camera with wheel/pinch zoom and drag-pan, and a fixed viewport that fills its pane.
- **Construction kit** — arm a brush from the palette and paint tile _types_; place and erase enemies, items and checkpoints; drag placements to move them; resize the grid. Right-click always erases, whatever tool is armed (matching Godot's TileMap editor).
- **Batch save model** — every edit mutates the local bundle and marks its layer dirty; `⌘S` / `Ctrl+S` persists, with dirty chips and a beforeunload guard. Drafts stay drafts until you publish them into a stage.
- **Tool rail** — Select · Paint · Fill · Erase, plus Bounds / Minimap / Music toggles. Floating, movable by its grip, position remembered.
- **Bottom dock** — three panes (armed brush · tabbed swatch strip · property tray) under the canvas, so selecting something no longer shrinks the map you're editing.
- **Minimap** — whole-level overview with a draggable viewport rectangle, drawn by the same renderer as the main canvas so the two can never disagree. Collapsible and movable.
- **Audio lane** — music regions carved _spatially_ along the level (`[start, end)` in cells), not temporally. Opens with the Music tool.
- **Bounds overlay + tile rulers** — ceiling, accent floor line, dashed kill plane, drop columns, and cell rulers that stay upright and constant-size at any zoom.
- **Focus mode** (`⌘.` / `Ctrl+.`) — hides the nav and tab header and floats the dock, for ~60% more canvas.
- **Collapsible side panels** — the nav (`⌘B`) and the right-hand panel (`⌘I`: the world map's inspector, the level editor's dock tray). Persisted app-wide.

#### World map

- **World map screen** — place levels, group them into areas, wire typed paths. Two canvas treatments over one graph (**Schematic** and **Overworld**), switched from the header.
- **Durable authoring** — the map is recomputed from the seed on every generation run, so hand placements are written as overrides that survive it. The header shows `Layout: agent · N human edits`, with a lock and a Re-run that hands your placements back.
- **Tools** — Select (V) · Place level (L) · Draw path (P) · Path stops (S). Placing drops a flat draft level into whichever area you clicked; Generate builds it.
- **Area-centric sidebar** — areas with their level rooms and secret-room children, unassigned and unplaced groups.
- **Inspector** — per level, area and path: thumbnails, sizes and placement counts, the defaults each level inherits from its area, and the connections list.

#### Generation, cost and jobs

- **New project** from the start screen — scaffolds a small, playable starter world. Free by default; five generator dropdowns turn individual stages up to paid backends.
- **Level generation** — blank draft or fully generated (terrain, enemies, items), each step separately runnable so any permutation works: paint terrain by hand then let canon place enemies, or generate everything and fix by hand.
- **Regenerate layout** (blind re-author) and **Improve** (the LLM sees the current level plus your instruction and re-authors it in place, keeping placements by default).
- **Background job queue + tray** — generation runs off the UI thread. Previously every generate blocked the whole window. The tray shows queued/running/done, cost, duration, and a **change indicator** so "did that actually do anything?" has an answer.
- **Cost dashboard + pre-run estimates** — live estimates before any paid run, a confirm gate, and a durable per-pack spend ledger. Backends left at their `$0` defaults estimate and cost nothing.
- **Per-call prompt override** — "✎ Edit prompt (advanced)" on every generation gate shows the exact system prompt about to be sent and lets you edit it for that one call. Collapsed, it sends nothing and changes nothing.
- **Provider key pre-flight** — a paid job is refused up front with the missing variable named, instead of failing deep inside the provider.

#### Data, assets and provenance

- **Database editing** — create and edit enemy/item rows with spec-driven forms (roll buttons for choice fields, derived lookups, locks on anchored values), a tile-slot editor, and a roll-table schema editor.
- **Asset Replace / Switch** — overwrite an asset's bytes, or repoint a placement at a different definition.
- **History tab** — per-artifact lineage tree from the provenance journal, with thumbnails, the prompt an asset was generated from, usage badges, side-by-side compare with an onion-skin blend, and restore-to-any-version (nothing is deleted; restore branches).
- **Asset library** — a global store above per-pack assets: publish from any project, browse, import into another. _(Set aside pending a UX revisit — see the roadmap.)_
- **Level revision id** — a composite hash of a level's nine state files with a human last-change label (`⬡ a1b2c3d4 · Improved · 2m ago`), so you can tell at a glance what a level is and what last touched it.

#### Playtesting

- **▶ Play** a single level (pygame) — follows the current view mode, so Blocks view plays without art.
- **▶ Play game** (Godot) — the whole loop: splash → world map → progression.
- **✓ Validate** — runs canon's real checks against the level on disk, including reachability simulation and secret rooms, and surfaces problems in a panel and the status bar.
- **Animation preview** — play a sprite's animation states side by side in pygame or Godot, because "does it look right" means right in both.

#### Chrome

- **Command palette** (`⌘K` / `Ctrl+K`) — surfaces register their own actions on mount and withdraw on unmount. Unavailable actions stay visible and greyed with the reason.
- **Tooltips** on every icon button — name, shortcut and a sentence of description.
- **Start page** — recent-project card menus where **removing from recents is not deleting** (hidden cards are kept, revealed by a header toggle, and the status bar says the project is still on disk), a tray with What's new / Updates / Links, a "World at a glance" schematic preview of the last project, and a two-step new-project modal (template → generation form).

### Changed

- **Design system rebuilt against the handoff spec** — chrome primitives (`.btn`, `.tool`, `.chip`, `.seg`, `.kbd`, `.tip`) replace ad-hoc inline styles, and the sidebar is 208px to match.
- **Colour is fully centralized in `src/styles/tokens.css`.** Canvases can't read CSS variables, so `drawWorld`/`drawLevel` used to carry their own dark-theme hex — which is why the map stayed dark in light mode. They now resolve the same tokens at draw time via `src/lib/canvasTheme.ts`. Two semantic tokens (`--info`, `--special`) were added and ~60 one-off colours across 16 files mapped onto tokens. Game _content_ colours (tile palettes, spawn/exit markers, element chips) stay literal on purpose.
- **Cross-platform keyboard handling** — every shortcut accepts ⌘ on macOS and Ctrl elsewhere, and every hint renders the key the reader actually presses.
- **The nav shows what the pack has** — platformer packs expose Levels / Actors (Player · Enemies) / Items / Tilesets / Backdrops / Audio; MazeWorld packs are unchanged. Secret rooms sort next to their parent level with a `↳` prefix.
- The notes drawer became the design's tray (What's new / Updates / Links) rather than a second slide-over beside it.

### Fixed

- **Animation frames clipped mid-jump.** Each animation state was sized independently, so an actor changed size the moment its state changed — the player lost 66% of its pixels on the descending half of every jump. Frames are now squared once across all states and facings. `canon asset animate --renormalize` re-seats already-generated art (honest limit: it can't recover baked proportions — re-animating on the fixed pipeline is the real repair), and a new cross-state check catches it going forward.
- **Godot ignored `AtlasTexture.margin`'s vertical offset**, drawing trimmed frames too high while pygame drew them correctly — a real cross-surface rendering disagreement in gameplay, not just the preview. Godot now reconstitutes full transparent frames exactly as pygame does.
- **Paid operations failed with "missing key" even when the key was set** — cradle passed no env file unless `CANON_ENV_FILE` was exported. It now falls back to `<canon repo>/.env`, so a plain `npm run tauri dev` works.
- **Windows: level playback used a Unix venv path.** Now picks `Scripts\python.exe` on Windows.
- Palette thumbnails rendered as colour blocks in the native webview (absolute paths need `convertFileSrc`).
- The level editor scrolled as a page, so the dock fell below the fold; and the canvas's resize observer only ever fired once, leaving it stuck at its first measured size.
- Light mode: every editor chip, button and rail rendered on a hardcoded dark fallback because 16 components referenced design tokens that no longer existed.

### Known gaps

- **Reveal on disk**, **Duplicate project** and **Move to trash** are present but disabled — they need a file-opener plugin (audited out in v0.1) and backend commands that don't exist yet.
- The tray's **Links** have no destinations configured (`LINKS` in `src/components/start/NotesDrawer.tsx`).
- **Auto-update** is not wired; the Updates pane says so rather than pretending to check.
- Rust command changes need a full `npm run tauri dev` restart — HMR only reloads the frontend.

## [0.1.0] - 2026-04-30

Initial public release. Read-only desktop inspector for canon-emitted worlds.

### Added

- **Start screen** — atmospheric returning-user hero with last-world summary + recent project rail, or a first-run onboarding card if no history. Persisted to `localStorage` as `cradle.recents.v1`.
- **Recent projects page** — sortable/filterable grid + list views of every world opened, grouped by time (Today / Yesterday / Earlier this week / ...).
- **Three-pane world shell** — title-bar breadcrumb + notes drawer + theme toggle; left nav with category subgroups (items by category, events by type) and clickable world-title as the Bible link; central detail pane with tabs.
- **Per-type detail views** — tailored Overview pages for NPCs, Monsters, Rooms, Items, Events / Puzzles, Classes, and Quests.
  - **NPCs:** big portrait + story/quest badges, stats grid, backstory, hobby/personality/greeting/exhausted/portrait-prompt prose, personality-notes bullets, shop-inventory table, combat-form block (for `AggressiveNPC` types with `npc_monster` stats).
  - **Monsters:** D&D-style HP / AC / Damage stat block, element chips, abilities grid with weapon-card dice readouts.
  - **Rooms:** two-image hero (entry portrait + maze map), layout metadata, bible-beat story section, placed NPCs / items / events / quests as clickable lists.
  - **Items:** per-category stats table (weapon, food, drink, tool, spell-scroll) next to portrait.
  - **Events / Puzzles:** event stats; choices render in a dedicated Puzzle tab with Card + Graph modes, failure damage surfaced on the prompt.
  - **Classes:** portrait + starting weapon with looked-up attack dice + 4+3 stats grid + ability/spell pool cards with "starting" badges.
  - **Quests:** contract card -- title + chips, description, Links (giver / in room / prereq), Objective (escort / solve / combat / fetch), Contract (success xp/item vs failure hp), success/failure dialogue with "open in npc dialogue" jump.
- **Dialogue system** — four trees per NPC (default / complete / incomplete / failed) woven into a single state machine with a Quest-gate node separating conversation branching from quest-state branching. Card mode (driver buttons between beats) and Graph mode (React Flow with dagre auto-layout, colored edges per beat kind).
- **Cross-linking** — any `giver_npc_id`, `room_id`, `monster_ids[]`, `item_id`, `prerequisite_quest_id`, `destination_room`, `target_event_id`, `target_npc_id`, etc. renders as a clickable pill that selects the referenced entity.
- **Lightbox** — click any portrait, map, or hero image to view full-screen; `portrait_prompt` is the hover tooltip on every image.
- **Design system** — token-based dark + light themes (Inter + JetBrains Mono, warm-neutral palette, oklch accent amber). Arc-style overlay scrollbars (hidden at rest, fade in on pane hover). Float layout for NPC/monster/event/class/quest so text wraps around the portrait.
- **Notes drawer** — slides in from the right; Changelog content editable at `src/components/start/NotesDrawer.tsx`.
- **Keyboard navigation** — arrow keys for entity cycling, `⌥↑/↓` for type-jumps, `Tab` for in-pane tabs, `Esc` to dismiss overlays. Held `⌘` / `Ctrl` releases control to the native shortcut.
- `PRIVACY.md` documenting the local-first / no-telemetry posture.
- `CHANGELOG.md` (this file).
- `.github/CODEOWNERS`, issue templates, and PR template.
- Expanded `SECURITY.md` with private-reporting-first policy, safe-harbor language, disclosure timeline, a what-to-include checklist, and a threat-model section explaining the `assetProtocol.scope = "**"` containment guarantee.
- `CODE_OF_CONDUCT.md` ships the canonical Contributor Covenant 2.1 Enforcement Guidelines ladder and a conflict-of-interest fallback to GitHub Trust & Safety.
- `src-tauri/capabilities/README.md` documenting the Tauri permission inventory and explicit deny-list.
- GitHub Actions release workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) — tag-triggered builds for macOS universal (signed + notarized via tauri-action), Windows .msi (unsigned, signing in v0.1.x), and Linux .AppImage (unsigned).
- `scripts/fetch-demo.sh` + `npm run fetch-demo` — fetches the bundled MazeWorld 5-room demo from a dedicated `demo-v*` GitHub Release on demand. CI release builds run the same script before bundling.
- PR CI now runs `cargo build --release` and `npm run format:check` to catch release-mode breakage and formatting drift on PRs instead of at release time.

### Changed

- Inter and JetBrains Mono now ship bundled in the app via `@fontsource-variable` (SIL OFL-1.1) instead of being fetched from Google Fonts at runtime. The app makes zero network calls during normal use. See [PRIVACY.md](./PRIVACY.md).

### Removed

- `tauri-plugin-opener` — was unused. Audited out as part of the permission inventory in [src-tauri/capabilities/README.md](src-tauri/capabilities/README.md).

### Pending (blocked on canon emissions)

- Validation bar wiring -- needs `validation_report.json`.
- Generation trail tab (prompts / responses / retry history) -- needs `generation_log.jsonl`.
- Monster base attack dice -- `MonsterStatBlock` reads `attack_dice` / `damage_dice` / `damage` at the monster root when canon emits any of them; currently all monster damage flows through the abilities array.

[Unreleased]: https://github.com/Demi-Build/cradle/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Demi-Build/cradle/releases/tag/v0.1.0
