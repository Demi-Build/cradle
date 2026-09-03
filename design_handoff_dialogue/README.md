# Handoff: Cradle — Dialogue editor & tester

September Phase 0, build-order item #2. Approval of this bundle gates build-order row #9.

> **Revision 2.** The first pass designed a single-NPC dialogue editor with variants gated in the graph. Review raised three things it got wrong: the canvas was mostly empty, the tester shouldn't take the whole surface, and "up to four variants" is not the real shape of the problem. This revision replaces the variant model with a **selector** model, adds a **navigator rail** and a **docked tester**, and adds two surfaces that were missing: **quest-scoped dialogue** and **group scenes**. Screens 03–06 are unchanged from revision 1 and still describe their states correctly.

## Overview

Dialogue in cradle is authored at three scopes, all built from the same parts:

| Scope | Surface | Primary question it answers |
|---|---|---|
| **NPC** | Screens 01, 02 — the NPC's Dialogue tab | What does this character say, in every state they can be in? |
| **Quest** | Screen 07 — the quest's Dialogue tab | How does this quest's conversation move across NPCs? |
| **Scene** | Screen 08 — an event of type `scene` | Who is in this room, and who says what? |

The quest scope is the **primary authoring surface for quest conversations**; the NPC scope is the per-character slice of the same data. A scene is its own entity that both other scopes embed and scroll to. Duplication between the surfaces is deliberate — the same beat is legitimately reachable from the character who says it, the quest that needs it, and the scene it happens in.

Underneath all three: the React Flow + dagre graph, the card walker, the DetailPane tab host, and the level editor's dock/tray/inspector patterns. The graph gets richer; it is never replaced.

## About the design files

The nine `.dc.html` files are **design references written in HTML** — prototypes showing intended look, layout and behaviour. They are not production code. Recreate them in cradle's React + TypeScript environment with its own components and CSS classes (`src/App.css`, `src/styles/tokens.css`).

Prototype-only conventions to drop when porting:

1. The prototypes **inline all styles** so each screen opens standalone. The real implementation uses the existing class names — `.dialogue-card`, `.dc-choice`, `.chip`, `.btn`, `.tool`, `.kbd`, `.seg-btn`, `.tool-rail`, `.validation`. Every value is taken from those classes; where a prototype disagrees with `App.css`, `App.css` wins.
2. The **dashed pill at the bottom-left** and the **titlebar state switchers** (screens 01, 04, 05) are review affordances, not app chrome.
3. Each screen sets a **1180px minimum width** on its content grid so the three-column layout survives a small preview window by scrolling. In the app the columns are fixed (218 rail / flexible canvas / 300 tray) and the canvas absorbs the remainder — no min-width needed.

Screens are lightly interactive: 00 toggles Card/Graph, 01 toggles the theme and the ⌘P switcher, 04 and 05 toggle between two states each.

## Fidelity

**High on layout, tokens, type and copy. Medium on graph geometry** — the prototype graphs are hand-positioned to imitate dagre's `rankdir: TB, nodesep: 32, ranksep: 60`; real layout stays computed. Node width stays 280px.

Every string is intended as the shipped string. Whisper-Tam's content is verbatim from `bibles/mazeworld_scifi/npcs/npcs.json` (NPC `1023`). The gated choice, the `reward` node, `q_whisper_signal`, the `night vigil` and `after the transmission` trees, Rust-Kell, and the Bonefield Confession scene are the target-state additions.

## Design tokens

No new tokens. Everything from `src/styles/tokens.css`:

| Role | Token | Use here |
|---|---|---|
| Accent (amber) | `--accent` / `--accent-ink` | Edit mode, selection, entry node, selector node, primary buttons, active tree |
| OK | `--ok` | Gate passes, engine-evaluable namespace, accepted diff, `advance_quest`, actor present |
| Warn | `--warn` | Engine lag, unsaved chip, unreachable node, orphaned choice, optional-actor lines |
| Error | `--err` | Gate fails, delete target, `takes_item`, destructive buttons |
| Info | `--info` | **Test mode and every cross-surface link.** Dock top border, unevaluable gates, scenes, deep-links |
| Special | `--special` | New/added nodes, `set_flag`, flags, the `segment` axis |

Two colour rules carry meaning and must survive the port:

- **Mode colour**: amber = edit, blue = test, none = view. The canvas's 2px top border, the mode pill, the segmented underline and the statusbar `MODE` word all use it, so mode is never inferred from a single indicator.
- **`--info` means "this belongs to another surface too."** Scenes, quest deep-links, the docked tester, and the ⌘P switcher's cross-NPC results are all blue. A blue thing is shared; an amber thing is yours.

Type follows the house split: **Inter for prose, JetBrains Mono for every id, token, count, key hint, axis name and namespace.** A condition row reads `has_item` in mono beside *resonance shard* in Inter — that pairing is the core reading pattern of the builder.

Pixel-art portraits use `image-rendering: pixelated`: 15–20px in rails and transcripts, 26–32px in inspectors and scene lines, 52px for the current speaker (opens the existing Lightbox).

---

## The ten design questions

### 1. Editing locus — **hybrid, weighted to the tray**

Prompt text and speaker edit **in place on the node**; everything structural edits in a **300px inspector tray**.

Split by cost of being wrong. Re-typing a line is cheap and constant and wants to happen where you can see the surrounding conversation, so the selected node's prompt becomes an editable field on the canvas (accent border, caret, character count, `⏎` commits, `Esc` cancels). Adding a condition is precise and vocabulary-driven, so it lives in the tray where the level editor already trained users to look.

In Edit mode every node renders its **choice rows** instead of a `3 choices` footer. That is the biggest change to the graph: edges become rows whose target you can read (`→ reward`), and rewiring is direct — drag from a row's right edge to another node, or to empty canvas to end the conversation.

### 2. Mode model — **three explicit positions, four simultaneous indicators**

`View · Edit · Test` in the surface toolbar. The level editor's failure was three *implicit* states, so mode is stated four times: the segmented control's underline, a 2px top border on the canvas, a mode pill floating on the canvas, and the statusbar's coloured `MODE` word.

- **View** — today's behaviour. Read-only graph or cards, no tray, gates as summary ribbons.
- **Edit** — choice rows, tool rail, tray on selection, `⌘S` live.
- **Test** — the tester **dock** opens along the bottom (see Q5). The graph stays live above it and lights the walked path.

`Esc` is the universal step-out: cancels an in-progress gesture if one is running, otherwise drops to View. Entering Test with unsaved edits tests the **unsaved buffer**, and the statusbar says so — testing what you just wrote is the point.

### 3. Condition builder — **structured rows, with a token escape hatch**

One row per condition: a namespace select (mono, accent) then one to three value controls whose shape follows the namespace.

| Namespace | Row shape |
|---|---|
| `has_item` | item picker (pack names) |
| `quest` | quest picker + state select |
| `time` | from + to fields |
| `player` | field + operator + value |
| `flag` | flag key combo-box (existing suggested, new allowed) |
| `segment` | segment/act picker |
| `room` | room picker |
| `actor` | actor picker + `present`/`absent` (scenes only) |
| `scene` | event picker + `seen`/`unseen` |
| `event` | event picker + `solved`/`unsolved` |

Vocabulary is **pick-from-world**, and the raw token renders under each row in 9px mono (`has_item:item_resonance_shard`). You author by recognising *resonance shard*; you verify by reading the token. Nobody has to trust that the dropdown produced the right id.

The escape hatch is a **paste tokens** link on the conditions header: the row stack swaps for a mono textarea, one token per line, with per-line parse validation. Both directions are lossless.

### 3a. The entity picker — one popover, every "pick from the world" moment

Every place the design says *pick from the world* uses the same 326px popover, so adding an NPC to a scene and choosing an item for a condition are the same gesture learned once.

**Shape.** Header naming what is being picked and where it will land (`voices[3] · condition`, `scene setting`). A search field. A type tab row (`items · events · quests · rooms · flags`) when more than one type is legal in the slot, omitted when only one is. Then grouped results — **proximity first**: for NPCs, the current room, then the current quest, then the rest of the world; for items and events, exact matches then the rest. Each row is a 26px thumb (pixel portrait, or a mono type tag), the human name in Inter, the id and one line of context in mono, and a right-side meta or state select.

**Three details that carry the doctrine:**

- **Already-added rows stay visible and disabled with the reason** (`already an actor`), rather than being filtered out — otherwise searching for someone you already added looks like they don't exist.
- **The token is previewed in the footer before you commit** (`has_item : item_resonance_shard` with its engine-evaluability dot). The picker is the friendly face of the grammar, never a replacement for seeing what it produced.
- **Consequences are named on the row.** Picking an NPC who lives outside the quest's rooms shows `room_2 — adds a room: gate to reach this scene`, and picking one with no beats yet shows `new lane`. You learn what the pick will do before you make it.

Placements in the prototypes: screen 01's `Pick item / event` state (a condition row in the NPC editor), screen 07's `＋ Beat` state (add an NPC to a quest, with quest-state and kind pills above the list), screen 08's `＋ Actor` state (add an actor, with the required/optional select in the footer) and its `Pick item / event` state (a scene setting).

Events appear in the picker as first-class rows with a state select on the right (`seen ▾`, `solved ▾`), because an event is a state you can gate on, not only a thing you can open.

**On the graph, 3+ conditions read as a gate ribbon**, not text: a leading `⊳3` badge plus one dot per condition, coloured by *engine evaluability* (green = the engine evaluates it, amber = tester-only). Two questions answered at a glance — how gated is this, and will the game honour it. Full text lives in the tray and the hover tooltip. Ungated choices show no badge, so ungated trees look exactly as they do today.

### 4. Variant navigation — **replaced by selectors, a navigator rail, and a router node**

This is the biggest change from revision 1. "Up to four variants plus custom" was too small a frame: a tree can be selected by quest state, game segment, time of day, world flag, room, scene attendance, player class or level, or an axis the author names. Four tabs cannot carry that, and neither can four coloured outlets on one gate node.

**The model.** A character's dialogue is a list of trees. Each tree carries a **selector** — an ordered predicate over any registered axis — or no selector, which makes it the fallback. At runtime the first matching selector wins, top to bottom. Today's four variants are just four trees whose selectors happen to be `quest:<id>:<state>`; `default` is the tree with no selector. Nothing about the existing data is invalidated, and the migration is mechanical.

**Three affordances, because there are three different questions.**

1. **Navigator rail** (218px, left edge of the canvas) — *what trees exist?* Trees grouped by selector axis with counts, an empty-state row for `failed 0`, the selector token in mono under any non-obvious row, scenes listed with an event glyph and an actor count, and the quests this NPC participates in as deep-links. A filter field at the top. `＋ New tree` asks for the axis first.
2. **⌘P quick-switcher** — *take me to a tree I can name.* Fuzzy over this NPC's trees and scenes, then over other NPCs' trees and quest dialogues. `⌘P` is trees and scenes; `⌘K` stays commands. For a 79-NPC world this, not the rail, is how you actually move.
3. **Selector (router) node** on the canvas — *what plays next, and why?* Where the current tree's terminals converge, a dashed-accent node lists the ordered selector rows: rank number, the token, the tree it selects. Drag to reorder — that reorder **is** the precedence rule, so the thing that decides is the thing you edit. Rows open their tree. The last row is always `otherwise → default`.

The old quest-gate junction is this node with only `quest:` rows, so quest-state NPCs get exactly the picture they had, in a frame that also handles the other seven axes.

### 5. Tester dock — **bottom dock, expandable to full height**

Test is a **dock along the bottom of the canvas** (186px), not a canvas replacement. Reasons: the graph should light up as you walk (that is what "expand the graph, don't replace it" meant), the space was empty anyway, and switching between fixing a gate and re-walking it should not be a mode change.

Collapsed dock (screen 01): a header carrying the mode pill, the exchange counter, and the simulated state as compact chips (`inv 3`, `quest offered`, `23:10`, `hp 14`) — editable in place — then two columns, transcript on the left and the current node's choices with gate results on the right.

Expanded dock (screen 02, `⌃↑`): full height. Transcript at reading size with portraits, choices at full detail with named failing conditions, and the state panel promoted to the **right column** — the same 300px slot the inspector uses in Edit mode, so the eye doesn't move between modes. `⌃↓` collapses. `G` shows the graph.

The state panel sections are the selector axes plus inventory: **Checkpoint · Inventory · Quests · Segment · Clock & place · Player · Flags · Scenes seen**. Every change re-evaluates every gate live, and re-runs the selector — so the rail's "would play now / blocked by state" grouping updates as you edit. That grouping is the tester's answer to "which of my nine trees does this state actually reach?", which no amount of graph reading gives you.

Effect firings display in **two places at once**: in the transcript, a bordered green ledger under the choice you took (`+ gives_item:item_resonance_shard — resonance shard added`), and in the state panel, the affected row tagged `new` / `set` with a single flash. The transcript answers "what did that choice do"; the panel answers "what is true now".

**Checkpoints, yes.** Named session-local states (`fresh save`, `mid-quest`, `act 2 night`) plus **Snapshot** and **Reset to it**. Never written to the pack, and the panel says so in place.

### 6. Gate feedback — **glyph, colour, and the failing condition named**

- **Pass** — `✓` in `--ok`. Sub-line names what passed when there was something: `flag:signal_gap_named ✓ true`.
- **Fail** — `✗` in `--err`, err-washed, not clickable. One mono line per condition so passing conditions still read as passing and only the blocker is red: `quest:q_whisper_signal:active ✗ quest is offered, not active`. Then the count (`Blocked by 1 of 2 conditions`) and two repairs: **Set the quest active** and **jump to this node**.
- **Unevaluable** — `?` in `--info`, dashed, **still clickable**. Names the namespace and the split verdict: the tester evaluates it and it passes at 23:10; in game the choice shows unconditionally.

Statusbar aggregates: `gates 2 pass · 1 fail · 1 unevaluable`.

In the editor, softly: the gate ribbon's dots. The editor never claims pass/fail, because pass/fail is meaningless without a state.

### 7. Save model — **batch with ⌘S and dirty chips. Recommended.**

Per-op journaling was rejected because authoring a gated choice is not one op — a target, two conditions and three effects is six writes for one thought, and a journal full of half-built choices is useless for finding the change that broke a conversation. Batch also matches the level editor users arrive from.

Edits land in an in-memory buffer; the toolbar shows `4 unsaved · 2 nodes 2 choices`; clicking it opens a per-edit list with `revert` per row. `⌘S` sends the buffer as **one `canon dialogue update`** carrying the edit-op list, and canon journals each op separately with its own per-field diff and provenance.

In **quest scope** one save can touch several NPCs. The chip says so (`2 unsaved across 2 NPCs`) and the save is one batch of one `canon dialogue update` per NPC — atomic from the user's point of view, per-character in the journal, since that is how the pack stores it.

**Undo means two things and the UI says which.** Before save, `⌘Z` walks the local edit stack. After save, `⌘Z` no longer reaches those edits — reverting is explicit, in the **History** panel, driven by canon's journal. The unsaved popover states this before the boundary is hit.

### 8. Destructive-edit safety — **preview on the canvas, behind the sheet**

Deleting a node opens a confirm sheet and **redraws the graph behind it** as the consequence preview (screen 04a): the target dashed-red with its prompt struck through, each inbound choice dashed-amber retargeted to `→ ⌀` with an edge label reading *becomes end of conversation*, and each newly-unreachable node dashed-amber and badged. The sheet names each consequence and offers a repair where one exists (an inbound choice gets `end the conversation · re-point to heresy · re-point to reward · delete the choice too`), states what is unaffected, and names the gates deleted along with the node.

Same machinery for the new cases:

- **Re-pointing entry** — the old entry's orphaned subtree paints dashed-amber the moment the select changes.
- **Deleting a tree** — the selector node loses a row; the sheet names which state now falls through to the next matching row, and to what.
- **Reordering selector rows** — the sheet shows which states change tree, since reordering is a semantic edit, not a cosmetic one.
- **Removing a required actor from a scene** — the scene can no longer play; the sheet says which quest beats lose it.

Deletion is a buffer edit: `⌘Z` undoes it, `⌘S` writes it. Unreachable subtrees stay in the tree and keep their gates — a warning, never an error.

### 9. Scale — **~30-node trees, 9+ trees per NPC, 79+ NPCs, 72 events**

The navigator rail and `⌘P` (Q4) are the answer at the tree level. Beyond them:

- **Fit to view** on `⇧1`, automatic on open.
- **Node search** on `/` — dims non-matches, matches ids, prose and condition tokens, so `resonance_shard` finds every gate referencing the item.
- **Tree focus** — one tree on the canvas at a time; the selector node is the only place they're seen together.
- **Cross-surface entry** — a beat is reachable from its NPC, its quest, and its scene, and every one of those rails deep-links to the others. That is why duplication is a feature: for a 79-NPC world, "find the line" has three plausible starting points and all three work.
- **Opening fast** — still the same DetailPane tab, not a route. The NPC payload carries every tree, so Edit is a state flip with no fetch. `E` opens Edit with the entry node selected, `T` opens Test.

### 10. The improve loop — **a proposal, never an application**

`✨ Improve…` sits beside Save in every scope, and in `⌘K`. With no backend selected it is **disabled with the reason showing**.

The modal (screen 04b) is two columns. Left, the request: instruction textarea, scope pills (`this node · this variant · all 4 variants`, and in the new model `this tree · every tree for this NPC · this scene`), a **Keep structure** toggle on by default, a backend select, and a cost box. **Paid reads as paid three times before any confirm**: a `paid · anthropic` chip in the header, `paid run` in the cost-box label, and the estimate itself at 17px mono — plus where the key comes from (`CANON_ENV_FILE`) and that a missing one is refused up front with the variable named. **Edit prompt (advanced)** is a disclosure holding the editable system prompt, matching `PromptOverride`.

Right, the result as a **row-by-row diff**: one card per changed field headed with node id and field, removed text on an err wash, added text on an ok wash with the changed span highlighted, `Skip` / `Accept` per card, and a footer on structure-adjacent cards confirming what did not move. The footer counts accepted rows; applying lands them in the **unsaved buffer**, so `⌘S` remains the only write and `⌘Z` still undoes it. An LLM re-author is never a write.

---

## Quest-scoped dialogue (screen 07)

The primary surface for authoring a quest's conversation. Same shell, same three columns, same dock.

**Rail — quest beats**, grouped by quest state (`offered · active · turn-in · complete · failed`), each row showing the speaking NPC's portrait and its gate count. An empty state group renders its emptiness as a line of prose, not a blank: *no beats — falls back to the quest's failure line*.

**Canvas — cross-NPC lanes.** One horizontal lane per participating NPC, one column per quest state. Beats sit in cells; edges cross lanes where one NPC's effect moves the quest for another (`gives_quest`, `advance_quest`), labelled with the effect or condition that carries the handoff. Empty cells are `＋ beat for <NPC>` drop targets, which makes coverage gaps visible as holes in a grid rather than as an absence you have to notice. A **group scene** spanning several NPCs renders as a translucent blue block spanning its lanes inside the column where it plays.

**Tray — the selected beat**, identical to the NPC-scope inspector with three differences: it is headed by the speaking NPC's portrait, it opens with a blue **deep-link** stating that you are editing that NPC's tree from the quest (same data, same buffer) with an `Open her tree →` link, and the quest id is **implied** — condition and effect pickers default to `this quest`, which is what makes quest-scope authoring faster than NPC-scope for quest work. Below the beat, a **quest coverage** list: one row per quest state with its beat count, amber where there are none.

**Dock — test the whole quest.** The walk crosses lanes as the state advances, so a full playthrough of a three-NPC quest is one continuous transcript with the NPC named on each entry.

## Group scenes (screen 08)

A scene is **its own entity** — an event of type `scene` — that the NPC and quest surfaces embed and scroll to. It is not a tree with multiple speakers, and it is not a lane: a scene has actors, its own trigger conditions, and a life independent of any one participant's dialogue.

**Rail — appears in.** Which NPC tree lists carry it, which quests embed it, and the scene outline (numbered lines with gate counts). The footer states the contract: *one scene, many surfaces. Editing here edits it everywhere.*

**Canvas — the script.** A vertical sequence of lines rather than a graph, because a scene is mostly linear and a graph would be a worse reader for it. Each line is a numbered row: actor portrait, speaker select, the line, and any per-line conditions with their gate ribbon. Conditional lines are dashed-amber and carry `skipped if absent`. A choice point renders as an accent-bordered block listing its options with their gates. Branch targets are line numbers (`→ 07`).

**Tray — Actors and Settings**, the two lists the review asked for:

- **Actors** — one row per actor: portrait, name, line count, and a `required` / `optional` select. Stated in place: an absent *optional* actor's lines are skipped, not blocked; removing a *required* actor cancels the scene, previewed before commit.
- **Scene settings** — the scene's own gates, in the same condition-row vocabulary as everything else (`quest`, `room`, `time`, `segment`, `player`, `has_item`, `flag`, `actor`), each with its engine-evaluability dot. Then **Plays once**, **triggered by** (`entering the room · talking to any actor · quest advance`), and **on finish** effects.
- **Selected line** — speaker, its conditions, and `＋ condition on this line`.

**Dock — test with presence toggles.** Actor chips switch each participant present/absent, and the transcript re-resolves: skipped lines are named (`line 05 will be skipped — Rust-Kell is absent`) rather than silently vanishing. This is the one test control scenes need that trees don't.

---

## States and empty states

| State | Treatment |
|---|---|
| NPC with no tree | Screen 06. Greeting-only fallback stated as legal. Three routes in; Test disabled with a reason. |
| Empty tree in the rail | Italic dim row with a dashed dot and count `0`; opening it offers `＋ author this tree`. |
| Quest state with no beats | Rail group renders a prose line naming the fallback; tray's coverage list shows the row amber. |
| Terminal node | `terminal` badge, no choice rows. Adding a choice clears it. |
| Unreachable node | Amber dashed in the editor; in the validator panel with `reveal`; in the tester's footer split into *unreachable in this state* and *unreachable in every state*. Never blocking. |
| Tree unreachable in every state | Rail row dimmed with the blocking axis named. A selector row that can never match is a warning at save. |
| Multi-speaker | Trees: a second speaker is a second node. Scenes: a speaker select per line. |
| Absent optional actor | Line dashed-amber, `skipped if absent`, and the tester names the skip. |
| Engine lag | Screen 03 — tree banner, dashed choice row + amber ribbon dot, tray warning naming the namespace and what the engine does instead, save-sheet warning block. Also on scene settings and selector rows. Mutable per tree, never blocking. |
| No backend for Improve | Button and command disabled, reason visible. |
| Unsaved on leave | Prompt naming the counts, per NPC in quest scope. |
| Validation error | Save sheet's primary disables with the error named — the only blocking case. Errors: entry missing, unparseable condition, unresolved item/quest/room/actor id, selector referencing a deleted tree. |

## Keyboard

Every hint renders the key the reader actually presses (`⌘` vs `Ctrl`) via the existing `kbd()` helper.

| Key | Action |
|---|---|
| `Esc` | Cancel the current gesture; else drop Edit/Test to View |
| `E` / `T` | Enter Edit / Test |
| `⌘S` | Save the unsaved buffer |
| `⌘Z` / `⇧⌘Z` | Undo / redo within the buffer |
| `⌘P` | Tree & scene switcher |
| `⌘K` | Command palette — dialogue actions under **Dialogue** |
| `⌃↑` / `⌃↓` | Expand / collapse the tester dock |
| `V` `N` `C` `⌫` | Select · Add node · Connect · Delete |
| `⇧1` | Fit graph to view |
| `/` | Node search |
| `⌘I` | Hide/show the tray or state panel |
| `1`–`9` | Pick that choice (Test) |
| `⌫` | Step back one exchange (Test) |
| `R` / `G` | Restart the walk / toggle graph (Test) |
| `Tab` / `⇧Tab` | Cycle DetailPane tabs (existing) |

## Doctrine checks

- **Loud fallback** — every fallback named where it happens: empty tree → next matching selector row; no matching row → `default`; quest state with no beats → the quest's one-liner; engine-lag gate → choice shows unconditionally; absent optional actor → line skipped, and the tester says so.
- **Disabled-with-a-reason beats hidden** — Test on a treeless NPC, Improve with no backend, `Duplicate the failed variant` on an empty tree, `＋ beat` cells sitting empty rather than collapsed away.
- **Paid reads as paid before confirm** — three simultaneous signals, and the estimate is the largest number on screen.
- **cradle never writes files itself** — every write is one `canon dialogue update` per NPC; the tester's state is simulated and says so; Improve produces a proposal.
