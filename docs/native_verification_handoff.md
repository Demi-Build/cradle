# Hand-off: verify the native cradle editor end-to-end (Task #7)

**Audience:** Wolfgang at the keyboard, optionally with a fresh Claude Code session
driving. Self-contained — no prior conversation context needed.

## Why this exists

Cradle (Tauri desktop app, this repo) has been evolved into a level **editor** for
canon's platformer packs: it renders levels in three modes (Blocks / Art / Overlay),
lets you select + drag placements (enemies/items/checkpoints/spawn/exit), and saves
edits by shelling out to `canon level apply-edit`, which rewrites layer files,
rehashes, stamps `user_edited`, and journals provenance to `.canon/journal.jsonl`
plus a content-addressed object store (`.canon/objects/`).

**Everything is proven in halves, never assembled:**
- The UI loop (render/select/drag/save-chip) ran in a **browser mock** — saves were
  faked in memory (`src/lib/devMock.ts`).
- The disk writes (`canon level apply-edit / baseline / versions / restore`) were
  tested **via CLI** on throwaway packs.

The prior session was headless (no display), so the native window was never run.
This hand-off assembles and verifies the real path: **drag in the native app →
canon writes the pack on disk → journal + object store record it.**

## Prereqs (all already on this machine)

- canon-ai repo: `/Users/wolfgangblack/Documents/projects/canon-ai` (uncommitted
  changes include the `canon level` verbs — do not stash them)
- `canon` CLI installed in its venv: `/Users/wolfgangblack/Documents/projects/canon-ai/.venv/bin/canon`
- cradle repo: `/Users/wolfgangblack/Documents/projects/cradle` (uncommitted editor changes)
- A generated pack: `~/Documents/projects/plat_lantern_paid` ("The Wandering Wick")

## Step 0 — work on a COPY of the paid pack

Edits write into the pack. Keep the paid original pristine:

```bash
cp -R ~/Documents/projects/plat_lantern_paid ~/Documents/projects/plat_lantern_edit
```

Open the **copy** in cradle below. (The journal/object store would preserve history
anyway, but a scratch copy makes cleanup trivial.)

## Step 1 — launch the native app

```bash
cd ~/Documents/projects/cradle
CANON_BIN=/Users/wolfgangblack/Documents/projects/canon-ai/.venv/bin/canon npm run tauri dev
```

- **Do NOT set `VITE_CRADLE_MOCK`.** That env var turns on the browser mock, which
  intercepts Tauri calls and fakes saves. Plain `npm run tauri dev` is correct;
  the mock also self-disables when the real Tauri backend is present.
- `CANON_BIN` must be in the environment of this command — the Rust side reads it
  (`std::env::var`) to find the canon binary for `export_level` / `save_level_edit`
  / `baseline_level`. If it's missing, saves fail with "failed to run 'canon'".
- First run compiles Rust (~1–2 min).

## Step 2 — open the pack

In the app: **Open world from disk** → select `~/Documents/projects/plat_lantern_edit`.

Expect:
- Left nav shows **LEVELS (9)** and **ENEMIES (7)** (platformer packs skip the
  MazeWorld Bible view; the first level opens automatically).
- The level detail shows chips (display name, dims, enemies, items), a brief, and
  the **Blocks · Art · Overlay** toggle (defaults to Art).

## Step 3 — verification checklist

### A. Rendering (exercises convertFileSrc + Tauri asset protocol)
1. **Art mode**: real tilesheet terrain, parallax forest backdrop, enemy/item
   sprites, checkpoint props, translucent water. ⚠️ This is the riskiest untested
   piece — sprites load from absolute paths via `convertFileSrc`. If images are
   missing (level renders as flat colors even in Art), open devtools (right-click →
   Inspect) and look for asset-protocol denials; the relevant config is
   `assetProtocol.scope` in `src-tauri/tauri.conf.json` (currently `**`).
2. **Blocks / Overlay** round-trip; grid + labels checkboxes work.
3. Click through several levels incl. a vertical one (l4 "2-1") and the secret
   rooms (`l1r1`, `l3r1`, `l6r1`, `l9r1`) — rooms render like any level with a
   "secret room of lN" chip; vaults have 0 enemies by design. (An earlier room
   export crash is fixed; if a room errors, the canon-side fix isn't loaded.)

### B. The edit loop (the core of this task)
4. Click an enemy → inspector panel appears (sprite thumbnail, enemy id, variant,
   archetype, size, cell; "open enemy →" link works).
5. **Drag it to a new cell → drop.** Expect the chip **"saved · user_edited ✓"**.
6. **Verify on disk** (fill in the stage dir for the level you edited):

```bash
P=~/Documents/projects/plat_lantern_edit
# moved coords present:
cat $P/level/*/l1/entities.json
# status flipped + hash consistent:
python3 - <<'EOF'
import json, glob, hashlib
d = glob.glob(str(__import__('pathlib').Path.home()/ 'Documents/projects/plat_lantern_edit/level/*/l1'))[0]
lvl = json.load(open(d + '/level.json'))
raw = open(d + '/entities.json','rb').read()
print('status:', lvl['status'])
print('hash ok:', lvl['entities_hash'] == 'sha256:' + hashlib.sha256(raw).hexdigest())
EOF
# provenance journal: baseline generate events (from opening) + your edit event:
cat $P/.canon/journal.jsonl
ls $P/.canon/objects | wc -l
```

Expect: `status: user_edited`, `hash ok: True`, journal has `generate` events for
each opened level's steps plus an `edit` event with `before_hash`/`after_hash` and
a `detail` like `{"kind":"enemy_move","moves":[{"id":...,"from":[..],"to":[..]}]}`,
actor `cradle:user`.

### C. Version history + restore (CLI, against the same pack)

Copy-paste as one block — it defines its own variables and extracts the original
hash automatically (no placeholders to fill in):

No comments inside the block — default zsh passes `# …` through as arguments:

```bash
P=~/Documents/projects/plat_lantern_edit
C=/Users/wolfgangblack/Documents/projects/canon-ai/.venv/bin/canon
$C level versions "$P" --level l1 --step entities
ORIG=$($C level versions "$P" --level l1 --step entities \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['versions'][0]['hash'])")
echo "restoring entities to original: $ORIG"
$C level restore "$P" --level l1 --step entities --to "$ORIG"
```

**STATUS: verified 2026-07-21** — restore ran on the edit copy; entities.json byte-
matched the generated original afterward, journal tail = `op:"restore"`.
7. Back in cradle, click away to another level and back to l1 — the enemy should be
   at its **original** generated position again (bundle re-exports from disk).
8. `canon level versions` again — the chain now ends with an `op:"restore"` event;
   nothing was lost from `.canon/objects/`.

### D. Persistence sanity
9. Quit the app entirely, relaunch, reopen the pack — edited/restored state is
   what's on disk (no cache surprises).

## Known limitations (don't chase these — they're tracked tasks)
- Only **move** editing exists. No add/delete/swap of placements yet (tasks #1, #2),
  no terrain paint (#3), no DB editing (#4).
- Nav only shows Levels + Enemies — no items/tilesets/backdrops/audio yet, enemy DB
  views have no sprite images, level cards show "NO IMAGE" (task #8: full catalog).
- Maps bigger than the window can't be panned/scrolled in the canvas (task #9).
- Save has no undo in-app yet — undo = `canon level restore` (CLI) for now; the
  in-app restore UI is task #6.

## Cleanup after verification (part of this task)
- The browser-mock scaffolding lives at: `src/lib/devMock.ts`, the
  `VITE_CRADLE_MOCK` block in `src/main.tsx`, `public/__mockdata__/`, and the
  `public/__mockassets__` symlink (points at the paid pack). Either delete them or
  make sure they're gitignored/gated before any real build — `public/` contents get
  **bundled into production builds**, and the symlink would drag the whole pack in.
- Delete the scratch pack copy when done, or keep it as an editing sandbox.

## Outcome to record
Report pass/fail per checklist letter (A rendering / B edit loop / C restore /
D persistence), any console errors, and whether cleanup was done — then mark
task #7 accordingly (it's in the session task list; the memory file
`project_cradle_platformer_editor.md` should get a one-line result too).
