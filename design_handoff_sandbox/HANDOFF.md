# HANDOFF — Cradle Phase 2 "Sandbox Stages"

Design package is complete and approved for build. This page is the entry point; everything else is in this folder.

| File | What it is |
|---|---|
| `Index.dc.html` | The map. Open this first — every board, grouped into editors / sandbox / process flows |
| `README.md` | Interaction spec: state tables, exact copy, keyboard map, empty and failure states, **price table**, **undo rule** |
| `PLAN.md` | Implementation map: component tree, store slices, canon verb surface, numbered build order (rows 1–26) |
| 20 `.dc.html` screen boards | Design references, both themes, drawn at 1440 with the agent panel where it really sits |
| 9 `P*.dc.html` flow boards | Processes end to end in three lanes: user / cradle / spend & QA |

The `.dc.html` files are **design references written in HTML** — intended look, layout, copy and behaviour. Recreate them in cradle's React + TypeScript with its own components and CSS classes (`src/App.css`, `src/styles/tokens.css`). Where a prototype disagrees with `App.css`, `App.css` wins. No new design tokens are introduced anywhere in the package.

---

## Start here, not at the top

**First slice: PLAN rows 1–5** — session slice + chip, tuning read path, tuning write path, spawn picker + arc overlay, band widening. That is Screen A end to end, and it proves the two hardest contracts before anything depends on them:

- the **staged / applied split** that *is* the save boundary (dragging a slider must never reach disk without Apply), and
- the **latency contract** — measured ms returned by `sessionSwap` / `sessionLaunch` and rendered as a number, not a spinner.

**Pull row 22 (references / moodboards) forward** to sit alongside it. It is free, self-contained, and the cheapest lever on output quality — every generation downstream is better with boards in place, and every composer needs the one-line `board: X · N on` binding anyway.

After that, PLAN's order holds: zones (6), PixEd (7–11), cascade plan cards (12), expressions and dialogue live (13–14), then audio (24–26), with the library last and gated (see below).

---

## Contracts that must survive the port

These are the package's spine. If a shortcut breaks one of them, it is the wrong shortcut.

1. **Every write goes through a canon verb.** No component touches pack files; the store dispatches and canon journals.
2. **Spec-driven fields everywhere.** Tuning knobs, zone payloads, mood enums, event lists all come from the pack registry through the path `RowEditor` already uses. No hardcoded key lists in components — there is a snapshot test for this in PLAN.
3. **Disabled-with-a-reason.** Nothing that could exist is hidden; greyed controls carry the reason, and in the command palette the reason sits *on the row* (nowhere to hover).
4. **Paid actions read as paid before any confirm.** The estimate is on the button, as a range, from the price table — never invented per component.
5. **Free actions never confirm**, and where a free path exists beside a paid one the copy leads with the free path.
6. **Honest progress.** Generation shows elapsed time and counts. Never an ETA, never a bar that lies. Cancel keeps what landed and re-prices the rest.
7. **Needs review, never stale-and-broken.** An artifact affected by an upstream edit is flagged `NR` and keeps working. A session running older code is **behind**, which restart fixes for free. Two words, two consequences.
8. **`current` is a pointer, not a position.** Restoring an older version makes it current without reordering the sequence; later generations remain *newer*.
9. **Three commit verbs only** — Save (writes an edit), Apply (writes *and* hot-swaps a live session), Keep/Approve (choosing between candidates). Lock is a gate, not a write.
10. **Three influence verbs only** — curated (visible, changes nothing), steering (in the prompt at a weight), source (img2img input).

---

## Questions for the build session

Neither is a design question; both change cost or architecture.

1. **Multi-source img2img.** Does the provider support several source images with weights, or must a splice be composed locally and sent as one image? The design reads the same either way; cost and quality do not. Affects `spliceEntity` and board P8.
2. **Real price numbers.** The README table's ranges are design placeholders. Wire the real figures into **one constants module** and have every button read from it, so no component hardcodes a range. This is also how the price table stops drifting from the boards.

Also worth confirming early: the **undo rule** in the README (⌘Z for pre-save edits, Revert for staged changes, Restore for written versions) against what the store can actually revert per surface.

---

## Explicitly not in scope

- **The asset library (board F, flow P7) is parked.** Designed, not decided — the "how reuse should feel" conversation has not happened. Do not build it.
- 3D beyond the blockout: no skeleton rigging, no texturing or UVs, no 3D animation timeline. The proxy serves the sprite and never ships.
- Part layers for 2D animation — frames are the whole model.
- Camera zones' runtime (the type exists, disabled with its reason).
- Sharing anything beyond the local machine.
- Auto-restart after a crash, and agent-initiated *unconfirmed* spending. The agent may raise a paid suggestion card; accepting it is always the user's act.

## Known inconsistency, accepted

Four segmented mode patterns do similar work: `View · Edit · Test` (dialogue), `Sprite · Tileset` (PixEd), `Blockout · Pose · Render` (3D), `Music · SFX · Ambience` (audio dock). Build as boarded — unifying them touches four screens' chrome and was judged not worth blocking on. Flag it if it starts to itch in use.

## Decisions already settled (do not relitigate in code)

- Traversal contexts are a **filter** over a flat key list, not a manifest system.
- Expression sheets generate **on demand**, not batched with animation states.
- Anchor tier is **selectable per generation** (single image / turnaround / one-shot turnaround), remembered per asset kind.
- Kill plane is **one stepped system** per level, starting flat at the bottom row — not a zone type.
- Region recolour lives **in PixEd only**.
- Dialogue-line SFX: **both surfaces, one asset** — the SFX editor and the dialogue line editor.
- Generation has **many doors, four destinations**: composer (inline), Animate, Audio, Layout. The agent drives the same destination a user would.
