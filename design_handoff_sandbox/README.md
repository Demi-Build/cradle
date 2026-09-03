# Handoff: Cradle Phase 2 — Sandbox Stages

Interaction spec for the Phase 2 surfaces: character tuning, zone painting, the 2D pixel editor, the dialogue live scene, play-session controls, and the asset library — plus flow boards for the seven processes that cross them. The PRD finalises against this package.

Precedents this follows: `design_handoff_agent_panel/` (agent panel, plan cards, cost language) and `design_handoff_dialogue/` (graph editor, docked tester, mode colour). Aesthetic and shell metrics from `design_handoff_editor_worldmap_start/PLAN.md`.

## About the design files

The `.dc.html` files are **design references written in HTML** — intended look, layout, copy and behaviour. They are not production code. Recreate them in cradle's React + TypeScript environment with its own components and CSS classes (`src/App.css`, `src/styles/tokens.css`); where a prototype disagrees with `App.css`, `App.css` wins.

Prototype-only conventions to drop when porting:

1. Styles are inlined so each board opens standalone. The real implementation uses existing classes — `.chip`, `.btn`, `.tool`, `.kbd`, `.seg-btn`, `.tool-rail`, `.validation`, `.dock`.
2. The dashed pills in the titlebar (`theme`, `session: live · click to cycle`) are **review affordances**, not app chrome.
3. Boards set a 1440px minimum width so the three-column shell survives a small preview window by scrolling. In the app the columns are fixed and the canvas absorbs the remainder.

Grounding data: `bibles/mazeworld_5_room_demo` (levels `l1r2` The Long Gap, `l1r3` Cistern) and `bibles/mazeworld_scifi` (Whisper-Tam, NPC 1023, verbatim lines).

## Boards

| File | Screen | Theme | Agent panel |
|---|---|---|---|
| `15 Generation routing.dc.html` | M — which door routes to which destination | dark | — |
| `16 Sandbox place and adjust.dc.html` | N — add / place / adjust, the testing shape | dark | — |
| `09 Character editor.dc.html` | G — character authoring + on-page generation | dark | expanded 412 |
| `10 Animation tab.dc.html` | H — Animation tab, Phase 2 additions | dark | railed 40 |
| `11 AnimateModal.dc.html` | I — one state with guidance, 3 modal states | dark | — |
| `12 3D anchor.dc.html` | J — 3D blockout, pose, render, generate-from-pose | light | — |
| `13 History.dc.html` | K — history timeline + lineage + paused plan | dark | — |
| `14 Command palette.dc.html` | L — Phase 2 palette entries, 2 states | dark | — |
| `01 Character mode - flat.dc.html` | A — feel tuning, flat knob list | dark | expanded 412 |
| `02 Character mode - traversal.dc.html` | A — traversal-grouped concept | light | railed 40 |
| `03 Zone painting.dc.html` | B — typed zones on the grid | dark | expanded 412 |
| `04 Pixel editor - sprite.dc.html` | C — sprite mode | dark | railed 40 |
| `05 Pixel editor - tileset and joins.dc.html` | C — tileset mode + join workflow | light | expanded 412 |
| `06 Dialogue live scene.dc.html` | D — tester driving a live session | dark | railed 40 |
| `07 Session controls.dc.html` | E — chip, popover, registry, chip states | light | n/a (global) |
| `08 Asset library.dc.html` | F — bundles, import with palette adaptation | dark | expanded 412 |
| `P1-flow-swimlanes.dc.html` | P1 — character creation & consistency | dark | — |
| `P2-flow-guided-animation.dc.html` | P2 — guided animation generation | dark | — |
| `P3-flow-recolour-reskin.dc.html` | P3 — region recolour / reskin | dark | — |
| `P4-flow-tileset-joins.dc.html` | P4 — tileset joins | dark | — |
| `P5-flow-cascade.dc.html` | P5 — the cascade moment | dark | — |
| `P6-flow-expression-sheets.dc.html` | P6 — expression sheets for dialogue | dark | — |
| `P7-flow-library-reuse.dc.html` | P7 — library reuse | dark | — |
| `P1-flow-storyboard.dc.html` | P1, alternative board style — **not adopted** | dark | — |

Flow boards read in three lanes: **user** (decides, approves), **cradle** (does the work), **spend & QA** (where money and gates sit). Read down a column to see who waits on whom.

## Design tokens

No new tokens. Everything from `src/styles/tokens.css`.

| Role | Token | Use in Phase 2 |
|---|---|---|
| Accent (amber) | `--accent` / `--accent-ink` | Active tool, selection, staged values, primary buttons, paid-action outline |
| OK | `--ok` | Live session, QA pass, palette conformance, approved variants |
| Warn | `--warn` | Level override shadowing a pack value, stale session, stale artifact, unapplied edits, repetition, off-band |
| Error | `--err` | Off-palette pixels, kill plane, crashed session, destructive confirm |
| Info | `--info` | **Anything owned by another surface**: spawn tool, live viewport, deep links to the agent, cross-surface handoffs, test mode |
| Special | `--special` | Skins, join variants, moods, music zones, added things |

Two colour rules carry meaning and must survive the port:

- **`--warn` means "this value is not what the pack says."** Level overrides, stale sessions, stale artifacts and unapplied edits are all the same idea: the thing you are looking at diverges from the source of truth. One colour, one meaning.
- **`--info` means "this belongs to another surface too."** The spawn picker (session), the live viewport (engine), "open in agent", the PixEd handoff from Animate. Blue is always a bridge.

Type follows the house split: **Inter for prose, JetBrains Mono for every key, id, count, band, cost and shortcut.** A knob row reads `jump_height` in mono beside *level override* in caps mono and the value in mono — the numbers are the content.

---

## The two halves

Cradle splits cleanly, and every screen belongs to one side:

- **Editors — where content is made.** Character editor (G), Animation tab (H), AnimateModal (I), 3D (J), PixEd (C1, C2), zones (B), dialogue graph. Generation lives here, on the page, with the estimate on the button.
- **Sandbox — where content is tuned and played.** Character mode (A), the live session strip and controls (E), the dialogue live scene (D). No generation happens here; the sandbox changes numbers and plays the result.

The two never merge: an editor answers "what is this character", the sandbox answers "how does it feel". Screen A's header states the split and links across; the character editor's does the reverse.

## Four rules that hold across every screen

These were settled in review and every board obeys them.

### 1. Needs review, not stale

When an edit leaves a generated artifact out of date, it is flagged **NR — needs review** (an eye glyph plus `NR`, tooltip: `Needs review — generated before the current anchor. It still works in game; replace it when you are ready.`). It keeps working, keeps shipping, and nothing regenerates on its own. The word *stale* is reserved for nothing; a session that is running older code than the pack is **behind** (`behind · 3 keys`), which restart fixes for free. Two different consequences, two different words.

### 2. Many doors, four destinations

Generation is offered **wherever the base thing is visible** — a character, an enemy, an item, a tile, a level, a dialogue line. Flexibility there is the point. What does not multiply is destinations:

| Kind | Destination | Doors |
|---|---|---|
| Image — portrait, sprite, tile, item | **Composer**, inline on the thing's own page | entity page, tileset slot, item row, ⌘K, agent |
| Animation — a state's frames | **Animate** modal | state card, Animation tab, composer tick, ⌘K, agent |
| Audio — music, SFX | **Music editor** (board P) and **SFX editor** (board Q) for the assets + **Audio dock** (board O) for binding | music zone, level, animation state, dialogue line, ⌘K, agent |
| Level — layout | **Layout** modals (exist today) | level canvas, world-map planned node, ⌘K, agent |

Invariants: the estimate is on the door, not only in the destination; a door never runs a paid job silently — it opens the destination staged; results land where the thing lives; and **the agent drives the same destination you would**, so its progress is watched there, not in chat. Board M is the map.

### 3. Focused by default, Advanced for everything

Panels open with the three or four controls the current job needs and one **Advanced** disclosure holding the rest of the schema. On generation surfaces, Advanced holds generation options only. On testing surfaces, the panel is three sections: **Add** (what this level can contain) → **Place** (the armed thing and its variants) → **Adjust** (whatever is selected). Board N is the pattern; Screen A's tuning panel follows it, with the derived "can he make the jump" readout pinned above the knobs and eight secondary movement keys behind Advanced.

### 4. Three commit verbs

**Save** writes an edit (frames, timing, tileset, proxy, zones). **Apply** is used only where a write also hot-swaps a running session (tuning, placements). **Keep** / **Approve** appear only when choosing between generated candidates. `Lock` remains its own thing — it is a gate, not a write.

---

## Screen O — Audio

Audio has two clocks, so the destination has two timelines. Both are **dock panes**, never a modal — neither music nor a footstep can be judged without the thing playing.

### Music — a timeline along the level

- The x-axis is **cells, not seconds**. The playhead follows the player in the live session.
- Lanes: `music` (regions), `ambience` (level-wide beds), `stingers` (point events fired by zones or the kill plane).
- **Music regions are the level's music zones** — this pane is a second view of the same objects, and dragging an edge here moves the zone on the canvas. Crossfades render as an overlap band with the duration on it.
- Region inspector: volume, crossfade in, loop, then `Advanced · 6 keys`. Generation is per region, and candidates **audition in place** so you judge the transition rather than the track.
- `no track · silence` is a valid state for a region, not an error.

### SFX — three bindings, one pane

A sound is bound one of three ways, and the pane keeps its shape while swapping its axis:

| Binding | Axis | For |
|---|---|---|
| **Frame** | the state's filmstrip | anything that reads as part of a motion — footsteps, wing beats, the thud at the end of a fall |
| **Event** | a table, no timeline | the entity's own events — chest opened, plate stepped on, breakable destroyed, player landed hard, hurt |
| **Place** | the level's cells | emitters placed like anything else — a point with radius and falloff, or a region that fades in as you enter |

Event bindings are edited on the thing itself and gathered here for the whole level at once; place bindings are dropped with the sandbox's **Add ▸ Sound** and tuned in Adjust or here. So this screen is never the only route — it is the one place all three are visible together.

### Frame binding — pinned to a state's frames

- The x-axis is the **filmstrip** — the same component as the Animation tab. An event belongs to *frame 2*, not to 0.166 s.
- Events drag between frames; layers stack (`footstep`, `cloth`, and so on). A layer can also loop for the whole state rather than firing on a frame.
- Event inspector: volume, pitch variance, surface, offset in ms, then `Advanced · 5 keys`.
- **Because events are frame-pinned, changing fps or `run_speed` moves the sound with the animation.** The panel states the relationship it can measure — `step interval 0.25 s vs stride 0.31 s — steps land early` — instead of letting it sound wrong in game.
- Candidates audition pinned to their frame with the loop running, at the level's volume.

Opens from: a music zone (Music pane, region selected), a state in the Animation tab or character editor (SFX pane, frame binding), an entity's event row (SFX pane, event binding), a placed emitter (SFX pane, place binding), a dialogue line, or ⌘K / the agent (same pane, staged).

## Screen P — Music editor

A track is a pack asset with the same shape as a character: its own page, versions, lineage, and publish. Authoring happens here; **where** it plays is set on the level.

- **Sections** are the only music structure the engine understands — it can start at one, loop one, and cross to another on a condition (`intro · on entering the zone`, `loop · always`, `tension · enemy chasing`). Anything finer belongs inside the audio, not in the manifest.
- **Variants** are the same track at different weights — full, sparse for stealth, muffled for water zones — generated from the track so they stay in key and tempo.
- **Generation** carries length, tempo, key, seamless-loop, and an optional reference (pack palette, another track, or your own file). Candidates **audition in the level they are used in**, at that region's volume and crossfade — the art rule applied to audio.
- **Used in** lists the regions and levels playing it; replacing the track updates them all, and a large blast radius opens the plan card first.

## Screen R — Moodboards

Reference material was scattered across the package as one-off options — "your example frames" in Animate, "another track as reference", "your own audio file", plus the style bible doing invisible work in every prompt. This is the one home for all of it.

- **A board is a named set** (`Cistern look`, `Salvager cast`, `Submerged score`, `Wet stone sounds`, `Tone & voice`). A reference can sit on several boards and be on in one, off in another; there is one copy of the file.
- **References come from three places**: uploads (image, audio, or a text note), **kept generations** (a result promoted to a reference — including rejected candidates worth keeping), and **pack assets** (the style palette appears here rather than hiding inside prompts; it cannot be switched off because QA meters against it).
- **Two states people confuse, kept separate.** *On the board* = visible and curated. *Steering* = a switch with a weight. A wall you are still thinking about must not silently change every prompt.
- **Steering is scoped per kind** — art, levels, music, SFX, story — because a photograph helps a tileset and does nothing for a footstep.
- **Traceability**: every generation records which references steered it (`used by 11 generations · last: cistern-tiles joins`), so a look you liked is findable and a look you did not can be switched off and regenerated.
- **Per-screen curation, no hidden global state**: each generation surface names its active board in one line beside the brief — `board: Cistern look · 6 on` — with a click to swap or open it.
- Everything here is **free**. References never generate on their own.

This replaces the ad-hoc "reference" pickers in Animate, the Music editor and the SFX editor: those keep their controls, but the options come from the boards.

### Three strengths of influence

The same library supports three different verbs, and keeping them distinct is what stops a tool from steering with everything you ever uploaded:

| Verb | What it does | Cost |
|---|---|---|
| **Curated** | on a board, visible, changing nothing | free |
| **Steering** | included in the prompt at a weight, per kind | free |
| **Source** | the image the result is generated **from** — img2img | the generation's own price |

### Source tray and splicing

Picking references as **source** fills a tray with per-item weights. One source is a variant; several is a **splice** — the multi-source img2img that makes a boss out of two enemies and a photograph. The result is an ordinary entity whose lineage names its parts (`spliced from scrap-hound, husk`), and locking its anchor starts its own consistency chain.

That lineage is what lets influence travel: the tray's **Send to SFX** and **Send to Music** actions carry the boss *and its parts* into those briefs, so an attack sound can be "a hound's grit plus a husk's hollow" without anyone retyping it. Board P8 walks the whole chain.

**For the build session:** whether the provider supports true multi-source img2img with weights, or a splice must be composed locally and sent as a single image. The design reads the same either way; cost and quality do not.

## Screen Q — SFX editor

A sound is a pack asset with the same shape as a track or a character.

- **The sample**: trim handles, attack, release, gain, pitch variance. Not a DAW — the copy says so.
- **Variant set**: the engine rotates through variants so a run cycle never repeats the same sample twice; a variant can be generated from the sample so it keeps surface and length.
- **Start from**: generate, record from mic (free), import a file (free), or vary an existing sound.
- **Where it is bound** is read-only here and grouped by binding kind (frame / event / place) — bindings belong to the thing that fires them, and each row deep-links into the dock.

### In-place generation — the rule

**You make a sound where you hear it needed, while it is playing.** During a jump, scrub to the takeoff frame and the empty lane offers a popover right there: a brief, length and surface, `Pick from library` beside `Generate · $0.04–$0.12`. Each candidate **drops onto that frame and plays in the running loop as it lands**, so you judge the takeoff inside the jump rather than in isolation. Keep one and it becomes a real SFX asset (named from the state, filed by category, with its own page); keep none and nothing is written.

The same popover appears on an event row (`chest · opened`) and on a placed emitter. The editor exists for authoring depth — it is never the only route, and never the first one.

## Screen N — Sandbox: add, place, adjust

The shape every play/test surface uses.

- **Add** (left nav) lists what a level can contain — enemy, item, tile, zone, dialogue, timer/trigger, kill-plane step. Picking one **arms** it; it never opens a form.
- **Place** (panel top) shows the armed thing's variants as a small grid, with `+ new` routing to generation (board M) rather than generating in place.
- **Adjust** (panel body) is whatever is selected: three or four knobs, then `Advanced · 14 keys`. Rows below it switch the subject without hunting on the canvas — player feel, zones, kill plane, timers.
- The screen states its own boundary in the footer: `add · place · adjust — the sandbox never generates`.

## Screen G — Character editor

The authoring home for a character, and the answer to "where do I make one".

- **Generation is on the page**, not behind a modal: a brief field showing the composed prompt, tickboxes for what is actually missing (a swim state, three unfilled moods, an optional 3D proxy), one estimate on one button, and a live job panel beside it with elapsed time, count, per-item results as they land, and Stop.
- **Nothing already generated is ticked by default**, so an estimate never quietly includes work that exists.
- **The anchor section** shows the four turnaround views plus the 3D proxy, with the lock explained in place: everything below was conditioned on it, so re-anchoring is a named action with a plan card (P5).
- **State cards** carry a filmstrip, a QA chip, and three actions — Play, PixEd, Animate… — plus a dashed card for a state the pack needs and the character lacks.
- **Expressions and skins** sit below: moods mid-generation with the two unfilled ones dashed, skins as colour maps with `+ Skin in PixEd`.
- `AnimateModal` (I) is reserved for one state with detailed guidance; the composer covers batches and gaps.

## Screen H — Animation tab (extended)

Phase 1's tab, with the Phase 2 additions marked `+` on the board.

- Existing: state selector, filmstrip scrubber, offset nudge pad, timing edits, per-frame hold, loop mode.
- **`+` In-level playback** — the loop plays beside a level fragment at the level's real speed and along the tuned jump arc, because a jump animation is only right relative to its physics.
- **`+` Physics link** panel — state duration versus airtime at the current `jump_height`, and the mismatch stated (`+0.18 s held on frame 6`) with a link to the sandbox. This is the one place the two halves of the product meet.
- **`+` Drift chips per frame** in the filmstrip, and a provenance block naming what generated the state and how many frames were hand-edited.
- Frame add/duplicate/reorder/delete are here; pixels are PixEd's job. Copy states it: `frames are the whole model, no part layers`.

## Screen I — AnimateModal

Three states on one board.

1. **Compose** — what is wrong with it in one line, guidance that stacks (stored motion spec / your example frames / another asset's motion), frame count (allowed to exceed the current count, priced accordingly), candidate count defaulting to 3 (`two is not a comparison`), and the composed prompt, editable.
2. **Running** — per-candidate filmstrips filling in as frames land, elapsed and count only, `Run in background` handing off to the existing JobTray, `Stop` keeping what finished.
3. **Compare & keep** — current plus three candidates playing together at real fps, measured facts (drift, conformance, hang frames, duration vs airtime) with **no ranking**, then `Keep none` · `Keep a & nudge in PixEd` · `Keep a`.

Failure states on the board: guidance refused before spend (wrong resolution), and no locked anchor (the modal opens as an explanation, not a form).

## Screen J — 3D anchor & blockout

3D editing is in scope, bounded: **the model serves the sprite and never ships.**

- **Blockout, not sculpting** — boxes and capsules, select/move/scale/rotate, add part, mirror across the spine. Dimensions are stated **in sprite pixels**, so the blockout and the 32×32 sheet cannot drift apart.
- **Three modes** — Blockout, Pose, Render. Pose saves named per-part poses (`idle`, `run`, `apex`, `hurt`); Render produces flat-shaded views at sprite resolution for the angles you pick, free, using our renderer.
- **Generate from pose** — the paid step, `$0.16–$0.60`: img2img conditioned on the render instead of on words.
- **Proportion checks**, free: total height, fits-the-sheet, head:body ratio, and silhouette drift against the locked 2D anchor. The 2D anchor stays the truth; the proxy is a stand-in.
- **Out of scope, disabled with reasons**: skeleton rigging (3D-only, after Phase 2), texturing/UVs (would imply it ships), 3D animation timeline (2D animation stays frame-by-frame).
- The proxy **does not stale** when the 2D anchor changes — proportions survive re-anchoring.

## Screen K — History & lineage

One timeline for every write in the package, filterable by kind (generated / hand edits / tuning / schema / imports).

- **Hand edits are marked** `--special` — they are what a cascade would destroy, and the plan card lists them separately for that reason.
- **Band widens get their own row** (`registry.set`, `--warn`), never folded into the tune that prompted them, because they are pack-wide.
- **A paused cascade** sits pinned at the top with spend-to-date against the rollup and `Resume · $0.15–$0.60`.
- The inspector shows before/after with a pixel-diff count, the **provenance chain** read downward (import → anchor lock → generate → hand edit), and **downstream impact** (which levels use it, which skins inherit it).
- `Restore` writes a new version rather than rewriting history. Footer states the rule: `nothing in cradle is deleted · every write is a version`.

## Screen L — Command palette

- Results **grouped by what they are**, not by source; group order follows context (sessions first while one runs, art first inside the character editor).
- **Estimates in the row** for paid entries, `free` where the distinction matters. Running a paid entry still opens its normal confirm — the palette is a faster route, never a quieter one.
- **Unavailable entries stay listed**, greyed, with the reason *on the row* (a palette row has nowhere to hover).
- One query returns four kinds of thing: tuning keys, animation states, actions, and past writes.
- The board lists every new Phase 2 entry in full.

## Screen A — Character mode

The spine of Phase 2: play, feel something wrong, tune it against the real level in a live session.

### Layout

Right-hand tuning panel at **372px** — the level editor's existing selection-inspector width — inside the DetailPane, canvas to its left. With the agent panel expanded at 412 and the shell at 1440, the canvas is ~450px: enough for the problem spot at 20px tile pitch. Below 900px of remaining main width the tuning panel becomes an overlay drawer on the canvas's right edge (see Coexistence).

### Knob row anatomy

Every row is generated from the pack field spec (`canon db types`), same machinery as `RowEditor`. Four densities:

| Density | When | Contains |
|---|---|---|
| Compact | Default | name · track · value |
| Expanded | Override present, or focused | name · badge · numeric input · unit · track with pack tick · band ends · Clear override · ⤢ band |
| Advisory | Code-owned key | struck name · hatched track · last known value · reason block · "Open in agent →" |
| Stepper | Integer, small range | name · − value + |

### Knob state table

| State | Visual | Copy | Interaction |
|---|---|---|---|
| Pack value, unedited | Compact row, muted value | — | Drag or type to stage |
| Staged (dirty) | Value input gets accent border; footer count increments | `2 unapplied` | `⌘⏎` applies, `Esc` reverts the focused row |
| Level override | 2px `--warn` left bar, tinted row, `LEVEL OVERRIDE` badge, pack tick on track | `pack 2.80` + `Clear override`; the badge's tooltip reads `The pack value 2.80 is shadowed by this level's override.` | Clear override reverts to pack value and removes the badge |
| Scope = whole game | Group segmented control on "Whole game"; rows show no override badges | `editing the pack value — every level follows` (tooltip on the segment) | Switching scope with staged edits asks which scope they belong to |
| At band end | Handle stops; band end value turns `--warn` | `at the top of the band (4.5)` | `⤢ band` opens the widen sheet |
| Band widened | Track ends show new values in `--special`; History row written | `band widened 4.5 → 6.0 · registry edit` | Journaled schema edit, restorable |
| Code-owned (advisory) | Advisory density, 50% opacity, hatched track | `The engine copy stopped reading this key — game_coder rewrote air control in player.py on 12 Aug. The slider stays for reference; changing it changes nothing in game.` | Slider inert; "Open in agent →" routes to `game_coder` with the key in the prompt |
| Validator down | Chips replaced by one neutral chip | `validator unavailable — Apply still writes` | Apply is never blocked by a missing validator |

**Widen-band sheet copy.** Title: `Widen the band for gravity`. Body: `Bands are the pack's registry, not a preference. Widening this changes the allowed range for every level and every future edit, and is recorded in History.` Fields: min, max. Buttons: `Cancel` · `Widen band`. No estimate — free.

### Derived readouts

Read-only block under the movement group, recomputed live from staged values:

- `jump velocity` = √(2·g·(jump_height + 0.4))
- `time to apex` = v / g
- `max distance at run speed` = run_speed × 2 × (v / g)
- `margin over widest gap` — the level's widest gap minus max distance, in `--warn` when negative

The canvas draws the corresponding arc from the spawn point and labels it `arc · apex 0.34 s · 4.6 cells`. The arc is the tuning panel's readout, drawn where the problem is.

### Live session strip

Left to right: engine chips (primary full-strength, twin muted) · session state dot + word · state note · swap latency · `▶ Launch` `⟳` `⏹`. One row, never wraps; the note ellipsises first.

| Session state | Dot | Note | Controls |
|---|---|---|---|
| `live` | `--ok` | `edits swap in place` | ⟳ ⏹ enabled, Launch disabled ("already running") |
| `stale` | `--warn` | `2 keys not in session — restart` | ⟳ emphasised |
| `relaunching` | `--info`, pulsing | `rebuilding · 1.4 s of 3 s` | ⏹ only |
| `crashed` | `--err` | `exited 1 · see log` | Launch, and the chip opens the log tail |
| `not running` | `--fg-dim` | `launch to tune against the level` | Launch only |

**Latency contract, three separate promises, each surfaced where it is felt:**

1. **Generation legs are API-bound.** Elapsed time and item counts only (`3 of 11 · 22 s`). Never an ETA, never a progress bar that lies. Cancel keeps what landed.
2. **The local loop is ours.** Key swap ≤ 250 ms (shown on the strip as `swap 180 ms`), relaunch ≤ 3 s (elapsed in the chip), local rebuild ≤ 1 s.
3. **On-disk to on-screen ≤ 100 ms.** Generated bytes are viewable the moment they exist; the footer states it as a standing promise.

### Spawn picker

`S` arms the spawn tool; a callout explains it. Clicking canvas or minimap moves this session's spawn and, if live, teleports the player there. Spawn is **session state, not pack data** — it is not journaled and does not dirty the level. Footer shows `spawn 12,18`.

### Save boundary

Dragging is local UI state. **Apply** is the write: `canon tune set`, journaled, restorable, then hot-swap into every live session running the affected level, then re-run the free validator. Footer copy: `Apply journals canon tune set, hot-swaps the live session, and re-runs the free validator. Restorable from History.` Buttons: `Revert` · `Apply 2 changes ⌘⏎`. Zero staged edits: Apply is disabled with `Nothing staged — drag a slider or type a value first.`

Any applied change clears the level's validation chips before re-running them, so a stale `valid ✓` never describes an edited level.

### Traversal-modes verdict — the question to settle

Board 02 groups knobs by locomotion context (Ground / Air / Water / Climb / Glide), follows the player's current context automatically, and shows Water's volume trio (`speed_factor`, `gravity`, `impulse`). Board 01 is the flat list.

**Recommendation: ship the flat list; add traversal as a filter, not a hierarchy.** Grouping only earns its keep where one key genuinely has more than one value — `gravity` in water versus on ground. That is three keys today. Making context the panel's spine puts eleven movement keys behind tabs and invents a taxonomy the pack schema does not have. Keep from board 02: the **context chip** on keys that vary by context, and **"following the player"** auto-scroll to the relevant group.

**Settled:** traversal contexts are a **presentation filter** over a flat key set (board 01 is the shipping shape). Keep the context chip on keys that vary and the "following the player" auto-scroll from board 02; do not add a traversal taxonomy to the manifest.

---

## Screen B — Zone painting

Zones are typed rectangles on the level grid. Music regions are the degenerate full-height case and migrate into this system.

- **Creation.** Zone tool on the existing ToolRail (`Z`), drag a rect, snapped to the tile grid. Type is chosen **after** creation in the tray: `Drag a rectangle. Type is chosen after, in the tray — a zone with no payload is still a valid zone.`
- **Payload editor** in the Dock's 372px tray pane: type select, name, z, then spec-driven payload fields with bands shown as text (`0.20–1.00`).
- **Zone list** in the Dock as a fourth palette tab (`Tiles · Enemies · Items · Zones`), ordered by z descending, each row: visibility toggle · type swatch · name · type · origin+size · z.
- **Types v1:** `physics` (gravity/speed multipliers, water trio), `music` (track per zone), `event` (trigger payload), `camera` (framing override — **disabled with a reason**: `Camera zones need the 3D camera rig — not in this engine copy yet.`).

**The kill plane is one stepped system, not a zone type.** Every level has exactly one kill plane. It starts flat at the bottom row — where it is today — and it is **stepped**: drag a handle to raise a run of columns, and the plane becomes a staircase. Three steps make a west ledge survivable, a middle drop shorter, and an east pit lethal, so traversal reads as elevation instead of one flat death line. There is no second concept and nothing to link: the Bounds tool and the old kill-floor idea collapse into this. Steps snap by row, the canvas always draws every segment with its row number, and the validator re-runs on change because reachability depends on it.

| Zone state | Visual | Copy |
|---|---|---|
| Selected | 1.5px type-coloured border + resize handles, tray open | — |
| Overlapping same type | `--warn` border + outline on both, list row explains | `updraft and cistern_pool share 6 cells. Highest z wins per key, so gravity there comes from cistern_pool. Allowed — it is how a waterfall works.` |
| Kill-plane step above placements | `--warn` on the kill-plane row | `This step is above 3 placements. They are unreachable while it stands.` |
| Hidden | Row toggle off, canvas overlay hidden, geometry unaffected | — |
| Migrated music region | Full-height, `--special`, marked in the list | `The old music region is a full-height zone now. Same data, same crossfade fields — the M toggle in the audio lane still shows and selects it.` |
| Empty (no zones) | Canvas clean, list shows one line | `No zones in this level. The zone tool (Z) draws one; music regions from before appear here automatically.` |

Overlap is a **warning, never a block**. Conflicts resolve per key by highest z, and the rule is stated in the warning rather than in docs.

---

## Screen C — The 2D pixel editor

Mounts as a **DetailPane tab** (`PixEd`) beside Overview / Animation / History on player, enemies, items and tilesets.

### Tools (v1, locked)

`B` brush · `E` eraser · `G` fill · `I` colour picker · `M` rect select · `L` freeform select · `T` transform · `R` recolour region · `'` grid · `O` onion skin · `⌘Z/⌘⇧Z` undo/redo · `⌘S` save · `[`/`]` brush size · `,`/`.` previous/next frame · `⇧,`/`⇧.` previous/next state.

Not v1: filters, effects, blend modes beyond normal, vector layers, brush engine.

Reference for tool semantics and keyboard defaults: Aseprite/LibreSprite behaviour, Piskel's frame-first model, Pixelorama's timeline layout. Behaviour only — no code, no assets.

### Palette constraint

The pack's style palette (`style/<stage>/style.json`) is the swatch set, shown as **roles with names** (`coat`, `metal`, `shadow`, `highlight`, `accent`) plus hex in mono. Painting off-palette is allowed and flagged:

> `off-palette · 38 px` — `Allowed, and QA meters it. Nearest role is accent.` · button `Snap to accent`

Alpha is binary at sprite resolution; the alpha slider exists but the panel states `Binary alpha only — the alpha gate rejects partial transparency at sprite resolution.`

### Frame-aware editing

The editor opens on a **frame within a state** and navigates with the Animation tab's own state selector and filmstrip — same components, same muscle memory. Onion skin shows prev/next frames from the real frame map at adjustable opacity (`onion ±1 · 35%`). Edited-unsaved frames carry a `--warn` dot in the filmstrip.

Layers are simple: `sprite` plus optional `notes`. Copy states the boundary: `No part layers — 2D animation is frame-by-frame here. Rigging arrives with 3D.`

### Tileset mode

Segmented `Sprite | Tileset` in the tab bar. The sheet is a strip of named slots; editing is per-slot with **bounds frozen** (`slot bounds locked` on the canvas, `Slot geometry is frozen. PixEd repaint; regions never move.` in the rail). Autotile slots show a **variant grid** with `This variant | Shared base` — `Editing the shared base repaints all 16; editing a variant touches one.`

Joins are a four-step panel: see the repetition (free diagnostic overlay) → choose join kinds (edges / corners / cracks, estimate moves with the checkboxes) → generate (`Generate 4 · $0.06–$0.22`) → hand-edit with seam guides → `Approve selected`, which updates the autotile rotation and re-runs the repetition pass. Full flow on board P4.

### Region recolour / reskin

**A tool inside the pixel editor only** (`R`). Selection by palette role, freeform or rect; remap per source colour with ramps preserved; preview across every frame and state; save as **skin** (same character, colour map beside the base, shares lineage) or **new character** (fresh id, `parents` → base). Pure code, free, no confirm. Full flow on board P3.

### Save

Save writes **one provenance version** per edited frame (journaled, restorable from History) and re-runs the free QA checks; chips (`alpha pass`, `palette 91% · was 98%`) warn and never block. Navigating away with unsaved frames: `2 frames aren't saved. Save them, or discard?` · `Cancel` · `Discard` · `Save`.

### Generate-then-tune handoff

Entering from a generation result shows an `--info` banner: `Opened on jump · frame 3 — the candidate you picked in Animate, with the two flagged frames queued.` with `Next flagged →` and `Dismiss`. Board 04 shows it; P2 boards the whole flow.

---

## Screen D — Dialogue live scene

Extends `design_handoff_dialogue/`. Test mode gains a live half: the same tester state drives a running session so the branch plays in the world.

- **`Play in game`** on the tester toolbar launches or attaches a session, injects the simulated state, and boots to the NPC's room with the player nearby. Engine-agnostic: the injector speaks the session channel, not the engine.
- **The tester stays the authority.** The live viewport is a window, not an editor. Sync is stated on the viewport (`in sync` / `session behind`) and edits to state mark it stale until `Re-inject`. The session never writes back into the tester.
- **Speaker portraits with moods are v1.** Moods are a closed enum. The line editor shows a mood chip per line; moods without a portrait are greyed with the reason, never hidden. The scene renders the speaking character's portrait in the engine's own dialogue box.
- Missing portrait falls back to `neutral` and says so **in the tester**, not in the game.
- Dungeon crawler first; nothing platformer-specific is designed.

| Live state | Viewport chip | Copy |
|---|---|---|
| In sync | `--ok` `in sync` | — |
| Tester edited | `--warn` `session behind` | `State changed here. Re-inject to play it.` |
| Attaching | `--info` `attaching…` | `Booting to Whisper-Tam's room · 1.2 s` |
| No session | Neutral | `No session running. Play in game launches one and drops the player at the door.` |
| Engine lacks dialogue hook | Disabled button | `This pack's engine copy has no dialogue channel. Sync the engine to enable live scenes.` |

---

## Screen E — Play-session controls

Sessions become first-class: tracked, killable, live-linked.

- **TopBar chip** — engine · level · state · elapsed. Click opens a popover with the session registry.
- **Popover rows** — engine (with `PRIMARY` tag), elapsed, level and spawn, state note, then `⟳ Restart` `⏹ Stop` `Make live`. Disabled controls carry the reason (`Already live — the edit channel is connected.`).
- **Multiple sessions** — one per engine is typical, more allowed. Only one session per engine holds the live channel and the registry says which. Applying an edit swaps into every live session running the affected level.
- **Primary engine** — a project names one; the twin demotes visually everywhere engines are picked, and is never hidden.
- **Crash** — chip turns `--err` and stays until dismissed; popover shows the last 20 log lines with copy and `Relaunch`. Nothing auto-restarts.
- This replaces the level editor's floating `playing… (Esc quits)` note: same trigger, same Esc, now named and persistent across navigation.

---

## Screen F — The asset library

Designed now, built after Phase 2. Backend exists and is untouched.

- **The unit is a bundle.** Character = anchor (base / turnaround / optional 3D proxy ref) + states + expressions + skins. Tileset = sheet + slots + autotile + joins. Audio = track + row metadata. Cards preview the *parts*, not one thumbnail.
- **Import adapts.** The palette-adaptation preview is the flow's centre: source palette beside this pack's, every frame previewed adapted, `5 of 5 roles matched` (by role name, then luminance), unresolved frames named before confirm. `Import adapted` is free — pure recolour.
- **Provenance is stamped.** Import mints a fresh id and records `library_ref heron-salvager@v3` plus the origin project; History shows the import as the first row of lineage. A later bundle version offers `Compare` / `Update` and never changes anything silently.
- **Publish** picks what the bundle carries, with name and tags.
- Empty library: `Nothing published yet. Publish a character or tileset from any project and it appears here.`
- Out of scope: engine copies and templates as library items; any sharing beyond this machine.

---

## Cross-cutting rules

### Keyboard map

| Scope | Key | Action |
|---|---|---|
| Global | `⌘K` | Command palette |
| Global | `⌘⇧P` | Session registry popover |
| Global | `⌘R` | Launch / relaunch the primary-engine session |
| Global | `Esc` | Quit the focused session |
| Character mode | `⌘⏎` | Apply staged changes |
| Character mode | `Esc` | Revert the focused row |
| Character mode | `S` | Arm the spawn picker |
| Character mode | `⇧←/→` | Nudge the focused knob by one step (`⌥` for fine) |
| Level editor | `V B G E` | Select · paint · fill · erase |
| Level editor | `Z` | Zone tool |
| PixEd | `B E G I M L T R` | Brush · eraser · fill · picker · rect · lasso · transform · recolour |
| PixEd | `O` `'` | Onion skin · grid |
| PixEd | `,` `.` / `⇧,` `⇧.` | Frame / state navigation |
| PixEd | `⌘S` | Save edited frames |
| Dialogue test | `R` | Restart from entry |
| Dialogue test | `⌃↓` | Collapse the dock |

Every interactive element is tab-reachable with a visible focus ring (`--accent`, 2px). Sliders respond to arrows and Home/End. Canvas tools are all reachable from the ToolRail by tab, not only by shortcut.

### Coexistence with the agent panel

Boards are drawn at 1440 with the panel at its 412 default. Rules:

- The **canvas absorbs width loss** — panels and rails keep their widths; tile pitch and zoom are the canvas's business.
- Below **900px of remaining main width**, floating panels reflow inward: the 372px tuning panel and the Dock tray become right-edge overlay drawers with a scrim-free toggle, and the minimap collapses to a corner button.
- The panel collapses to a **40px rail** (boards 02, 04, 06) and every screen must be complete in that state.

### Disabled-with-a-reason

Nothing that could exist is hidden. Greyed controls carry the reason on the tooltip and, where there is room, inline. Examples in this package: `+ Camera zone` (no 3D rig), `Climb`/`Glide` traversal tabs (not in this pack), `Make live` (already live), `Approve selected` (nothing selected), `Apply` (nothing staged), advisory knobs (code-owned).

### Paid actions

Every paid action carries its estimate **on the button** (`Generate 4 · $0.06–$0.22`), as a range, before any confirm. Free actions never confirm. Batches show one price with a per-item breakdown on hover, and cancelling keeps what landed and re-prices the rest. Where a free path exists beside a paid one, the copy leads with the free path (`Fix by hand · free` beside `Re-roll · $0.04`).

### Validation and QA

Free checks run on Apply and on Save: validator verdict for level and tuning writes; palette conformance, alpha gate and silhouette drift for art. Chips use the level editor's language and **warn, never block**. Any edit clears the chips of the thing edited before re-running them.

### First-run and empty states

| Surface | First run |
|---|---|
| Character mode | No session: panel fully usable, strip says `launch to tune against the level`, Apply writes without a session |
| Zones | `No zones in this level. The zone tool (Z) draws one; music regions from before appear here automatically.` |
| PixEd | No hand edits yet: filmstrip shows generated frames, footer `Nothing edited. Paint to start; Save writes a version you can restore.` |
| Dialogue live | `No session running. Play in game launches one and drops the player at the door.` |
| Sessions | Chip present, `not running` — it is the launch point, not an absence |
| Library | `Nothing published yet. Publish a character or tileset from any project and it appears here.` |

### Failure states

| Failure | Behaviour and copy |
|---|---|
| Validator down | Neutral chip `validator unavailable — Apply still writes`. Writes are never gated on it |
| Generation leg down mid-batch | Keep what landed, stop, re-price the remainder: `6 of 11 sheets generated. The image service stopped responding. Retry the remaining 5 · $0.20–$0.75.` |
| Session crash | `--err` chip until dismissed, log tail in the popover, manual relaunch only |
| Band widened past validator comfort | Validator warns (`gravity 58 makes 3 gaps uncrossable`); the write still happens and the warning names the levels |
| Code-owned key edited | Impossible by construction — the slider is inert; the reason and the `game_coder` deep link are always shown |
| Palette adaptation cannot resolve | `4 roles have no match here. Import maps them to the nearest luminance and flags 12 frames off-palette.` Importing anyway is allowed |
| Regenerating over a hand edit | Separate confirm, frame named, thumbnail shown: `This replaces your edit to jump · frame 3. The edit stays in History.` |

### Voice

Plain, specific, no apologies. State what happened and what it costs. Name the file, the key, the frame, the level. No exclamation marks, no "oops", no personality in error text.

---

## Open questions for the PRD

### Settled

1. **Traversal contexts** — a filter, not a manifest system. Board 01 is the shipping shape.
2. **Expression sheets** — **generated on demand**, when a character has dialogue or when asked. P1's combined batch is not the default; P6 is correct.
3. **Repetition detection** — the agent **may** raise a paid suggestion card for it, like any other plan card: estimate on the card, confirm per step.
4. **Dialogue-line SFX** — **both surfaces, one asset.** The SFX editor (board Q) is for listening, designing, generating and assigning; the dialogue line editor can also generate and assign a sound in place. Same asset, same in-place popover, two entry points.
5. **References** — a shared **moodboard** system, scoped per domain (board R).

6. **Kept candidates** — a kept candidate **replaces** the state; every prior version (and every rejected candidate) stays in History and is restorable. Restoring makes that version **current** without rewriting order: generation lineage keeps its own sequence, so a later generation is still *newer*, while `current` is a separate pointer at whatever you chose. History therefore shows two facts per row — where it sits in the sequence, and whether it is current.
7. **Anchor tier** — **selectable per generation, not a fixed default.** A single base image is right for a portrait or a first pass; a turnaround is right when animation or multiple views are coming; and one-shotting straight to a turnaround is allowed. The form remembers what you picked last for that kind of asset.

### Still open

Nothing blocking. Two implementation questions for the build session: the **price table** below needs real provider numbers, and the **undo rule** below needs confirming against what the store can actually revert.

## Price table

One place owns the numbers; boards quote from here rather than inventing ranges. All are estimate *ranges* shown on the button before any confirm, and every batch shows one price with a per-item breakdown on hover.

| Action | Estimate | Notes |
|---|---|---|
| Anchor · base image | $0.04–$0.12 | 1 frame |
| Anchor · turnaround sheet | $0.16–$0.48 | 4 views |
| Anchor · 3D proxy from turnaround | $0.20–$0.60 | mesh, reference only |
| Animation state | $0.08–$0.30 | per state, per candidate set |
| Splice · multi-source img2img | $0.08–$0.30 | 2–4 sources with weights; price is per candidate set, not per source |
| Animate · 3 candidates, 8 frames | $0.16–$0.60 | scales with candidates × frames |
| Single frame re-roll | $0.04–$0.15 | |
| Expression sheet · 6 moods | $0.18–$0.70 | on demand, not batched |
| Tileset joins · 4 variants | $0.06–$0.22 | per batch of 4 |
| Music track | $0.20–$0.70 | 2 candidates |
| Music variant | $0.10–$0.35 | derived, stays in key |
| SFX set · 4 variants | $0.04–$0.16 | |
| SFX in place · 3 candidates | $0.04–$0.12 | frame, event or emitter |
| SFX single variant | $0.03–$0.10 | |
| Re-anchor cascade · typical character | $0.46–$1.75 | rollup of 4 steps |
| Everything free | $0 | validation, QA, recolour/skins, palette adaptation, references and moodboards, repetition passes, renders from the 3D proxy, record and import |

## Undo rule

Three mechanisms, one sentence each. No screen invents a fourth.

| Mechanism | Scope | Where |
|---|---|---|
| **⌘Z / ⌘⇧Z** | pre-save edits inside one surface — brush strokes, frame edits, event drags, blockout moves | PixEd, 3D, audio timelines |
| **Revert** | discards *all* staged, unsaved changes in the panel and restores the last written values | tuning, zones, timing, placements, trim |
| **Restore** | brings back a written version; writes a new version and moves `current` to it | History |

Rules that hold everywhere: ⌘Z never crosses a save boundary; Revert is always available while a dirty chip is showing and never enabled otherwise; Restore never deletes anything; and no destructive action is reachable without one of these three being able to get back.
