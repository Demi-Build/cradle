# Changelog

All notable changes to cradle are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Inter and JetBrains Mono now ship bundled in the app via `@fontsource-variable` (SIL OFL-1.1) instead of being fetched from Google Fonts at runtime. The app now makes zero network calls during normal use. See [PRIVACY.md](./PRIVACY.md).

### Added

- `PRIVACY.md` documenting the local-first / no-telemetry posture.
- `CHANGELOG.md` (this file).
- `.github/CODEOWNERS`, issue templates, and PR template.
- Expanded `SECURITY.md` with private-reporting-first policy, safe-harbor language, disclosure timeline, and a what-to-include checklist.
- `CODE_OF_CONDUCT.md` now ships the canonical Contributor Covenant 2.1 Enforcement Guidelines ladder and a conflict-of-interest fallback to GitHub Trust & Safety.

## [0.1.0] - 2026-04-24

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

### Pending (blocked on canon emissions)

- Validation bar wiring -- needs `validation_report.json`.
- Generation trail tab (prompts / responses / retry history) -- needs `generation_log.jsonl`.
- Monster base attack dice -- `MonsterStatBlock` reads `attack_dice` / `damage_dice` / `damage` at the monster root when canon emits any of them; currently all monster damage flows through the abilities array.

[Unreleased]: https://github.com/Demi-Build/cradle/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Demi-Build/cradle/releases/tag/v0.1.0
