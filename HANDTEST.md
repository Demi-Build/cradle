# Hand-test checklist

Everything this cycle touched, in the order it makes sense to click through.
Roughly 20 minutes. Tick as you go; anything that surprises you is worth a note.

## Before you start

```bash
cd cradle
export CANON_BIN=/path/to/canon-ai/.venv/bin/canon
npm run tauri dev
```

> **Restart, don't reload.** Several of these are new Rust commands. `tauri dev`
> hot-reloads the frontend only — if a button does nothing, you're on the old
> binary. Quit and re-run before assuming it's broken.

Open a real pack (`plat_lantern_paid` is the one I measured against).

---

## 1. Engine runtime — do this first, it changes the rest

- [ ] A ⚠ **Engine outdated** chip is in the title bar.
- [ ] Click it. The dialog lists `godot/main.gd` as **unstamped** and the other
      two as **current**, and explains that runtime code is copied in at
      generation time.
- [ ] **Update runtime.** It should report "updated 1 file", flip everything to
      CURRENT, and the chip should disappear.

**Why it matters:** your packs never received the phase-1 Godot render fix, so
until you do this they are mis-drawing animation frames _in real gameplay_ —
frames whose content doesn't touch the top of their square draw too high.

- [ ] **▶ Play game** and look at an actor's feet. They should sit on the
      ground rather than floating. (This is the fix landing for the first time.)

---

## 2. Animation tab — the new inspector

Open **ACTORS → PLAYER**, then the **Animation** tab.

- [ ] An amber banner says _5 states reach the cell edge_ and explains what that
      means.
- [ ] The **stage** on the left is playing the animation.
- [ ] The **filmstrip** on the right highlights the frame currently on stage.
- [ ] Transport: `‹` / `❚❚` / `›` work; stepping pauses; the readout shows
      `frame N/M · 120ms`.
- [ ] The **overlays** chip turns on the pixel grid and the green content box.
- [ ] Click through the state chips. **`fall`** is the interesting one: frame 1
      is a small crouched pose, frames 2–3 are full-height. That size jump is
      the "half the frame vanishes in the jump" bug, made visible.
- [ ] **Position in frame** → press ↓ a few times. The art moves down, the chip
      gains a `nudged` marker, and it saves.
- [ ] **Reset to generated** puts it back and greys itself out.
- [ ] Change **Loop** or **Every frame** and confirm the stage's playback changes.

Then confirm the edit reaches the games:

- [ ] Nudge `fall` down ~6px, then **▶ Preview (pygame)** and **▶ Preview
      (godot)** from the Overview tab. Both should show `fall` moved by the
      same amount. (I measured this: 10 world px moved it 25px in pygame at
      2.5× and 50px in Godot at 5×.)
- [ ] Reset it afterwards.

**Known limit, working as intended:** offsets re-seat a pose, they cannot
un-bake its proportions. Genuinely fixing your player needs re-animating on the
fixed pipeline (~$0.04/state, ≈$1.40 for the roster) — **your call, your spend.**

---

## 3. World map

Open **🗺 WORLD MAP**.

- [ ] The sidebar is now **area-centric**: areas with colour swatches, their
      levels with dimensions, secret rooms as `↳ l1r1`.
- [ ] The **tool rail** floats top-right with six tools. Hover each — every one
      has a tooltip with a shortcut and a description.
- [ ] **Area** and **Player start** are greyed. Hover them: they explain _why_
      (areas are stages; player start isn't editable yet). That's deliberate.
- [ ] `V` / `L` / `P` / `S` switch tools from the keyboard.
- [ ] Top-left float reads `Layout agent`, with Re-run and a lock.
- [ ] Bottom-left legend, bottom-right `stops` / `world art` chips and the
      `− 61% + fit 1:1` pill.
- [ ] **Camera:** scroll to zoom (it should zoom toward the cursor, not the
      centre), drag empty space to pan, hold **Space** and drag from anywhere.
- [ ] Click a level → the inspector shows a thumbnail with `size · N entities`,
      an **Inherited from area** block, and a Connections list.
- [ ] **Drag a node.** It should say "placed", the header should flip to
      `1 human edit`, and Re-run should become available.
- [ ] Switch to **Overworld** — same graph, painted areas, tile nodes.

---

## 4. Panels and chrome

- [ ] `⌘B` collapses the sidebar, `⌘I` the inspector (or the dock tray in the
      level editor). Both persist across a restart.
- [ ] `⌘K` opens the palette; the new View commands are in it.
- [ ] In the level editor, `V` `B` `G` `E` switch tools (these were advertised
      in the tooltips but never actually bound until now).
- [ ] Drag the **minimap** by its dotted grip; double-click the grip to reset.
- [ ] **Toggle the theme.** This is the one I most want your eye on: the canvas
      used to stay dark in light mode. The world map, level canvas and rulers
      should now all follow the theme. Game _content_ colours (tiles, spawn/exit
      markers) stay as they are on purpose.

---

## 5. Start page

Close the project (`cradle` breadcrumb).

- [ ] Hero shows **World at a glance** with a schematic preview of the last
      project, and Map / Asset sets / Levels tabs.
- [ ] Hover a recents card → `⋯` appears. Open it.
- [ ] **Remove from recents.** The card should hide, the header should say
      `1 hidden from view · show`, and the status bar should confirm
      _"still on disk"_. Click **show** — it returns as a ghost card.
- [ ] **Delete project…** opens a confirm that spells out it is _not_ the same
      as removing from recents. **Move to trash is deliberately disabled** —
      no backend command touches your filesystem outside a pack yet.
- [ ] Tray (panel icon, top right): **What's new / Updates / Links**. The
      changelog now describes v0.2. Links have no destinations configured yet.
- [ ] **＋ New platformer project** → step 1 is now a template choice
      (Platformer / Dungeon crawler `beta`), step 2 the generation form with a
      live cost box reading `$0`.

---

## Expected to be missing

Not bugs — either deferred by you or genuinely unbuilt:

- Sequence mode (`jump → fall → land` as one motion) and the sandbox — chunk C.
- "🎬 Animate…" is not yet renamed to "Generate animation" — chunk D.
- Reveal on disk / Duplicate / Move to trash — need plugins and verbs.
- Player token and Play route on the world map — you deferred these.
- Freehand area drawing — you ruled it out (areas are stages).
