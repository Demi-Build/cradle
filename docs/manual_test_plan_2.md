# Manual test plan #2 — catalog · construction kit · replace/switch · generation

**Scope:** everything shipped since your last native run (which verified render /
move / restore / persistence). New surface: catalog nav + DB tables (#8/#11),
camera (#9), the construction kit (#2/#3: paint/place/erase/resize/create/
publish), asset Replace/Switch (#1), and generation (#5: anchored rows,
LLM-complete, sprite generate, animate). Report pass/fail per LETTER; skip
anything marked optional.

**zsh notes:** none of the code blocks contain inline `#` comments (paste-safe);
quote `"$P"` everywhere.

---

## 0 — Setup

```bash
cp -R ~/Documents/projects/plat_lantern_paid ~/Documents/projects/plat_lantern_t2
cd ~/Documents/projects/cradle
CANON_ENV_FILE=~/Documents/projects/canon-ai/.env \
CANON_BIN=~/Documents/projects/canon-ai/.venv/bin/canon \
npm run tauri dev
```

- `CANON_ENV_FILE` is NEW and required for the paid generation buttons (canon
  never auto-reads `.env`; cradle forwards this path to the verbs).
- Rust changed since your last run — first launch recompiles (~1–2 min).
- Open the **t2 copy**.

Shorthand for terminal checks below:

```bash
P=~/Documents/projects/plat_lantern_t2
C=~/Documents/projects/canon-ai/.venv/bin/canon
```

---

## A — Catalog + DB tables (#8, #11)

1. Nav shows **Levels (13) · Enemies (7) · Items (5) · Tilesets (3) ·
   Backdrops (3) · Audio (3)**; secret rooms sit directly under their parents
   with `↳`.
2. Enemies → card grid shows real sprites. Toggle **List**: spreadsheet with
   sprite | name | archetype | size | rarity | hp | damage | speed | habitats |
   patrol/aggro | review status. Click the **hp header** — numeric sort (16 top
   or bottom, not lexicographic).
3. Levels → List: map thumbnails, dims (l4 = 20×76), enemy/item counts,
   l5 `layout fallback = true`.
4. Items List (kind/rarity/params columns), Tilesets (tilesheet thumb),
   Backdrops (band art), Audio → open a stage → music + per-event SFX players
   (play one; the pack has sfx — music may be absent, that's the pack).

## B — Camera (#9)

1. Open 2-1 (20×76). Opens at 100% showing the top.
2. Trackpad scroll pans; **⌘+scroll (or pinch)** zooms at the cursor;
   drag empty space pans (grab cursor).
3. Buttons − / + / **fit** (whole tall level visible ~25%) / **1:1**.
4. While zoomed OUT ~50%: click an enemy — selection/inspector still lands on
   the right one (hit-testing goes through the camera).

## C — Construction kit (#2, #3)

1. Open 1-1. **Palette rail**: Tiles listed as type ids with block-color
   swatches (floor 1 … water 20; no box tile — boxes come from item source).
2. **Paint:** arm `spike`, drag a strip on the ground row. Art mode shows flat
   red "pending" cells; chip reads `unsaved: grids`. **⌘S** → `saved ✓` and the
   painted cells re-render with REAL spike art (autotile-derived canon-side).
3. **Place:** arm an enemy + a variant chip, click to drop; arm an item with
   source `box`, drop it; arm `checkpoint`, drop one. Save.
4. **Erase / delete:** eraser removes a placement (or clears a tile);
   select + `Delete` key removes; inspector has delete too. Save.
5. **Resize:** W 53 → 75 → Resize → paint floor into the new space → Save →
   flip Blocks/Art — both consistent; disk check:

```bash
python3 -c "import json;print(json.load(open('$HOME/Documents/projects/plat_lantern_t2/level/ember_grove/l1/level.json'))['grid_width'])"
```

6. **Create:** ＋ next to LEVELS → stage + size → create draft → opens with
   `draft — not in world` chip, flat floor scaffold. Build a little; Save.
7. **Publish at position:** pos `2` → **Publish to world** → nav renumbers
   (your map is 1-2, old 1-2 becomes 1-3). Optional Godot check: the new level
   is in the run at slot 2. Then optional unpublish:

```bash
$C level publish "$P" --level l10 --remove
```

   (use your actual new level id; nav reverts to draft after reopening).

## D — Replace / Switch (#1)

1. Select a placed enemy → inspector → **replace sprite…** → pick any PNG →
   canvas + inspector update immediately (same path, new pixels — cache-bust).
2. Palette 🖌 on tile `floor` → pick a PNG → the whole ground re-skins in Art
   mode; **physics untouched** (Blocks mode unchanged).
3. Inspector **switch to** dropdown: turn a Tallow Bloom into an Ember Hopper
   in place → dirty → Save.
4. Original recoverable:

```bash
$C level history "$P" | tail -20
```

   expect `import` events for the replaces with `before_hash`/`after_hash`.

## E — Generation, $0 sanity (optional, CLI, fake backends)

```bash
$C db new "$P" --type enemy --fields '{"archetype":"hopper","name":"Test Hopper"}' --complete --llm-backend fake
$C asset animate "$P" --target enemy:test_hopper --image-backend fake --vlm-backend fake
```

Expect: row created with hopper anchor held (`behavior.hop_height` present),
then `animated: true` with idle/walk/hurt/death **+ jump** (hoppers). This
proves plumbing without spend. (Fake image sprite GENERATION correctly
produces nothing but a loud warning — pipeline parity; animate works because
the sprite came from the fake pipeline's placeholder path? No — if animate
errors with "no base sprite", first run:
`$C asset replace "$P" --target enemy:test_hopper --from <any>.png`.)

## F — Generation, PAID, from the UI (#5) — est. total ~$0.30–0.70

1. **Anchored create + LLM:** Enemies table → **＋ new row** → set
   `archetype: flyer`, name empty, size 1.5 → **Create + LLM complete** →
   confirm. Expect: a NEW named/flavored flyer appears; in Raw JSON `speed: 2`
   and hp in the 7–12 band (both derived FROM your anchors). (~<1¢, Haiku.)
2. **Generate sprite:** on its overview → 🎨 Generate sprite → confirm
   (~$0.04, fal/nano). Sprite appears on the card/overview; check the pack:
   `sprite/enemy/<id>/base.png` exists.
3. **Animate:** 🎬 Animate → confirm (~$0.04 × 4 states + Sonnet VLM tokens).
   Expect `<id>/idle.png walk.png hurt.png death.png frames.json atlas.png
   atlas.json` and `stats.animation` in Raw JSON with a per-state motion spec.
4. **Re-complete:** ✍️ LLM re-complete (locks archetype/size/rarity) — name/
   flavor re-authored, mechanics untouched.
5. **Place it:** open a level — your new enemy is in the palette with its real
   sprite; drop it; Save; (optional) run the level in Godot.
6. **Journal audit:**

```bash
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path.home()/"Documents/projects/plat_lantern_t2/.canon/journal.jsonl"
for line in p.read_text().splitlines()[-8:]:
    e = json.loads(line)
    print(e["op"], e["artifact_id"], (e.get("detail") or {}).get("kind"), e.get("gen"))
EOF
```

   expect the trail: `generate db_new` (llm_model = a real Haiku id) →
   `regenerate asset_generate` (image_model fal…) → `regenerate asset_animate`
   (image + vlm models) — locked fields recorded in the db_new detail.

## G — Versions / provenance round-trip

```bash
$C level versions "$P" --level l1 --step entities
```

chain includes your session's edits; restore still round-trips (same block as
last time, auto-extracting ORIG). New-row artifacts show `create`/`generate`
ops in `$C level history "$P"`.

## H — Regression spot-checks

1. MazeWorld demo (or any mazeworld world) still loads with its original nav —
   catalog changes are platformer-gated.
2. Prior editor flows: move an enemy in 1-1, Save, quit, relaunch — persisted.
3. Suites if you like: `npm test` (cradle) ·
   `.venv/bin/python -m pytest tests/test_platformer_ops.py tests/test_platformer_import_grids.py -q` (canon).

---

## Known gaps (don't chase — acknowledge or file)

**Untested (headless couldn't):**
- The entire **paid path** (F) — fakes only so far; F is its first real run.
- **`CANON_ENV_FILE` loader** — written, not exercised by tests; F1 is its
  first live use (a key error will say which var is missing).
- **Native file picker** for Replace (D1/D2) — plugin-dialog flow untested.
- **Player targets** (`asset generate/animate --target player`) and
  **backdrop/audio generate** — verbs exist, zero coverage even with fakes.
- **Item** LLM-complete + item sprite generation (only enemy exercised).
- `db complete --reroll` path.

**Known limitations (by design or deferred):**
- Generation UI hardcodes fal + anthropic; no backend picker; confirm-dialog
  costs are static text, not computed from cost_model.
- Backdrop/audio generation is CLI-only (no UI buttons yet).
- Palette/enemy-DB thumbnails can be stale after replace/generate until the
  level or table is reopened (canvas + inspector do refresh).
- Switching levels with unsaved edits silently discards (only window-close
  warns). No in-app undo — undo = `canon level restore` (CLI).
- New doors (`room_entrance`) aren't placeable; no marquee/multi-select.
- Editing an EXISTING row's fields in a form is #4 (tables are read-only cells;
  the RowEditor only creates).
- `review_status` stays `draft` on hand-made/edited content until a VLM QA run.
- Publish re-lays world-map node positions deterministically — canon's original
  jitter isn't reproduced (cosmetic; map render only).
- `complete --reroll` derives its rng stream from the row's alphabetical index,
  which can shift as rows are added — rerolled mechanics may differ from the
  row's original stream (determinism nuance, not a bug).
- No file locking: don't run canon CLI against the pack while the app is
  mid-save.
- The new Rust platformer branches have no dedicated unit tests (covered by
  usage + the 23 existing fixture tests still passing).
- MazeWorld generation/editing is design-tracked (registry) but NOT wired —
  platformer only for now.
