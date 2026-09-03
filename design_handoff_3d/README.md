# Phase 2 addendum — the three-tier 3D system

Interaction spec for the 3D surfaces. Addendum to `design_handoff_sandbox/`;
same tokens, same shell, same doctrine. Supersedes the v1 addendum draft (which
designed six in-app DCC surfaces — deleted, not amended).

Boards in this package:

| File | Screen |
|---|---|
| `J1 3D tab - mesh mode.dc.html` | J′ · the 3D tab, Mesh mode |
| `S1 Rig intent.dc.html` | S1 · rig intent (replaces the rig editor) |
| `S2 Deformation review.dc.html` | S2 · deformation review + fix loop (replaces weight painting) |
| `S3 Mesh ops and Blender round-trip.dc.html` | S3 · agent ops + the manual round-trip (replaces sculpt + UV) |
| `S4 PixEd on texture.dc.html` | PixEd-on-texture |
| `S5 Faces.dc.html` | S5 · faces (preview + assignment) |
| `S6 3D animation timeline.dc.html` | S6 · state clips |
| `P9-flow-mesh-smith-promotes-the-eel.dc.html` | P9′ · the flagship promotion flow |
| `P10-flow-texture-round-trip.dc.html` | P10 · texture round-trip |
| `P12-flow-mesh-edit-consequences.dc.html` | P12 · what stales, what never does |
| `P13-flow-manual-round-trip.dc.html` | P13 · export → Blender → re-import |

Every board carries a `theme` toggle in its header; both themes are the spec.

---

## 1. The three tiers, and where each one lives

| Tier | Who | Surfaces |
|---|---|---|
| 1 — cradle establishes and judges | in-app | J′, S1, S2 (the judging half), S4, S5, S6 |
| 2 — `mesh_smith` executes | headless Blender, agent-written bpy per task | op cards on J′, S1, S2, S3, S5 |
| 3 — manual Blender | the user | `Open in Blender` on J′, S2, S3, S5 |

**The honesty line, verbatim, wherever tier 2 is offered:**
`the agent does operations, not art`

It appears as a muted subtitle beside the op list (J′ footer strip, S1 handoff
card, S2 footer). Never as a tooltip only.

Deterministic mesh math is tier 2. Aesthetic geometry is tier 3 or generation.
When a user describes something that is not an operation ("make the face
kinder", "better hands"), the agent says so and points at tier 3 — it does not
attempt art. That refusal is copy, not an error state.

## 2. Gate thresholds

Design sets these. Every number is a **judgment aid, not a lock** — a failed gate
never blocks Accept, it colours the row red and says why. Rows marked
*informational* never colour.

### Rig and weights (S1 → S2)

| Metric | pass | warn | fail |
|---|---|---|---|
| weight coverage | 100% | 99.0–99.9% | < 99.0% |
| unweighted vertices | 0 | 1–10 | > 10 |
| bones with no vertices above 0.1 weight | 0 | — | ≥ 1 (named) |
| joints inside mesh | all | — | any outside (highlighted) |
| chain continuity | unbroken | — | any break (named) |
| unnamed joints | 0 | ≥ 1 | — |
| pose-library mapping | informational — always shown as `n / total` |

### Deformation (S2 test-pose strip)

Silhouette render-diff is normalised 0–1 against the pre-op render of the same
pose at sprite resolution.

| Metric | pass | warn | fail |
|---|---|---|---|
| target pose diff after a fix | ≤ 0.08 | 0.08–0.20 | > 0.20 |
| regression on any other test pose | ≤ 0.05 | 0.05–0.15 | > 0.15 |
| per-tile state chip | `clean` ≤ 0.08 | `watch` 0.08–0.20 | `problem` > 0.20 |

### Mesh ops (S3)

| Op | pass | warn | fail |
|---|---|---|---|
| any op · non-manifold edges introduced | 0 | 1–5 | > 5 |
| any op · weights kept | 100% | 99.0–99.9% | < 99.0% |
| proportional adjust · vertex delta | 0 | — | ≠ 0 |
| decimate · tris vs target | within ±5% | ±5–15% | > ±15% |
| decimate · silhouette diff | ≤ 0.06 | 0.06–0.15 | > 0.15 |
| mirror · symmetry delta | ≤ 0.01 | 0.01–0.05 | > 0.05 |
| unwrap · island overlap | 0 | — | ≥ 1 |
| unwrap · margin at 256² | ≥ 2 px | — | < 2 px |
| unwrap · island count | ≤ 24 | 25–40 | > 40 |
| shape-key scaffold · keys created | = requested moods | — | fewer (named) |

### Proportion checks (J′, always on)

| Metric | pass | warn | fail |
|---|---|---|---|
| fits the sheet | ≥ 1 px margin | 0 px | overflows |
| total height, head:body | informational |
| silhouette drift vs the locked 2D anchor | ≤ 0.25 | > 0.25 | never fails — the anchor is the truth, the mesh is a stand-in |

### Re-import (S3 right, P13)

| Metric | pass | warn | fail |
|---|---|---|---|
| bone-name compatibility | all match | any renamed (named, with affected pose/clip count) | — |
| unweighted vertices | 0 | 1–10 | > 10 |
| vertex-count delta | informational |
| UV island count | unchanged | changed (atlas reported) | — |
| texture-map changes | informational |
| file parses as glTF | yes | — | no (parser error, nothing written) |

Import is allowed at every level, including fail. The card's job is to make the
call an informed one.

### Texture QA (S4)

| Chip | pass | warn | fail |
|---|---|---|---|
| palette on-pack | all pixels | — | any off-palette (count + first coordinate) |
| islands covered | all | 1–2 uncovered | > 2 |
| seam bleed | 0 | — | ≥ 1 (coordinates listed) |
| outline weight consistency | even | uneven on ≤ 3 islands | > 3 |

## 3. The anchor ladder (unchanged)

| Tier | Character has | Posing |
|---|---|---|
| 1 | 2D anchor only | chained img2img "apply pose (2D)" |
| 2 | mesh, unrigged | turntable renders only |
| 3 | mesh + rig | full pose editor |

The ladder chip is always visible in the 3D tab, top-left of the viewport, and
always names **what would promote it**. At tier 3 it says there is nothing left
to promote rather than disappearing.

Promotion is `mesh_smith`'s job. "Promote this eel" is a product flow (P9′).

## 4. Screen J′ — the 3D tab

Modes: **Mesh · Pose · Render** (segmented, top-right of the tab bar). Pose and
Render carry over from the parent Screen J intent unchanged: direct-manipulation
posing, named per-state poses, free flat renders at sprite resolution on the
neutral-gray stage. **The stage never themes.**

Mesh mode hosts review and agent-op entry points. It has no paint tools, ever.

Always visible:

- ladder-tier chip + what would promote it
- dimensions in **sprite pixels**, not world units
- proportion checks: total height, fits-the-sheet (with margin), head:body,
  silhouette drift vs the locked 2D anchor, weight coverage
- test-pose deformation strip (4 tiles) with a link into S2

Left rail is **mesh versions**, newest first, each labelled with its origin
(`meshy`, `decimated`, `blender import`, `rigged`). Every agent op and every
re-import is a version. Restore, never overwrite.

Start-anywhere backfill list (right rail): done steps show `done`, skipped ones
gray as `skipped` / `optional` with their price if paid. Generate mesh, rigging
(auto) and generate-from-pose are the only paid actions in this package.

Disabled-with-a-reason, exact tooltips:

| Control | Tooltip |
|---|---|
| Weight painting | Weight painting is Blender's job, and mesh_smith drives it headlessly. Describe the problem on S2 instead — the fix comes back as a before/after strip. |
| Sculpt / vertex edit | Sculpting is artistry, not an operation. Open in Blender (tier 3) and re-import as a version. |
| Manual UV seams | Seam editing by hand has no ceiling worth building. Smart UV unwrap is a tier-2 op; the resulting PNG opens in PixEd. |
| Restyle for meshing | Restyle-before-meshing is the open D4 spike. Disabled until the experiment says whether it helps. |

Footer, right-aligned: `tier 2 costs conversation tokens, nothing else`.

## 5. Screen S1 — rig intent

The user marks **intent, not armature mechanics**.

- presets: `chain` · `biped` · `quadruped` — they seed the joint list, never
  constrain it. Copy: "An eel is a chain, not a biped."
- click-place a joint (`J`), name it, set parent, set role
  (spine / limb / head / tail / prop), position shown in sprite pixels
- drag to reorder / reparent in the joint list
- mirror across the spine (`M`) copies placement and appends `.L` / `.R`;
  disabled on a chain with the reason "No lateral joints on this skeleton."
- Mixamo-style names offered via a checkbox, never forced. Retarget maps only
  what exists on both skeletons.

Live validation (free, continuous, right of the viewport):

| Check | Failure copy |
|---|---|
| joints inside mesh | `4 / 6` — the two outside are highlighted |
| chain continuity | `broken after spine.02` |
| unnamed joints | `1` (warns, never blocks Send) |
| pose library maps | `12 / 15` — the 3 that don't are listed with the missing bone |

**The handoff is the hero.** The bottom card names the ops before running:
`1 · build armature from 6-joint chain spec` → `2 · automatic weights` →
`3 · weight smoothing`. Free, so no confirm — one Accept when results return.
`Preview the script` is available beside it. `Auto-rig` sits disabled with
"Auto-rig via the mesh provider failed on this shape: no biped match. That
failure is why rig intent exists."

Commit verb: **Save intent**. The intent spec is a saved artifact, separate from
the rig it produces.

## 6. Screen S2 — deformation review + fix loop

**Nobody paints weights.** The screen is the judge.

Hero: the **test-pose strip** — bend / crouch / stretch / one pose from the
library, live-deforming side by side, each with a state chip
(`clean` / `watch` / `problem`) and its silhouette diff. `+ add from pose
library` extends it.

Describing a problem, two equivalent routes:

1. free text — placeholder `the elbow collapses when the arm straightens`
2. common-failure chips — elbow collapses · shoulder tears · knee inverts ·
   hips pinch · coat clips the leg · wrist twists · head detaches · stray verts
   follow

Either becomes a `mesh_smith` fix card. The agent chooses the operation and
**names it on the card** (`bpy: weight smoothing on arm.L chain, falloff 0.35,
2 iterations`).

Result card contents, in order:

- before/after strips **playing the same test pose** (`play both`, `wipe`,
  `show the script`)
- mesh gate ladder: weight coverage %, unweighted vertices, bones-in-limbs,
  silhouette render-diff, vertex count, other test poses
- `Accept · new mesh version` / `Tell it more` / `Reject`

A warning rides the card rather than being hidden ("apex moved slightly — not a
regression by the gate's threshold, but it is named").

Rejected runs stay in the journal with their script: "a rejection is data about
what does not work on this mesh."

Escape hatch on the surface: `Open in Blender · tier 3`, with the reason stated
— some geometry will not bend well however it is weighted.

Not on this screen: weight brush, per-vertex weight table, bone envelope tuning
— each disabled with its reason.

## 7. Screen S3 — mesh ops + the Blender round-trip

Two halves, one screen, split 50/50 by a hairline.

### Left · agent ops (tier 2, free)

Card anatomy: op + params → before/after (viewport + numbers) → gate results →
Accept / Tell it more / Reject. Ops:

| Op | Params | Gate numbers |
|---|---|---|
| Decimate / cleanup | target tris, weld doubles, fix normals | vertex delta, manifold, weights kept |
| Smart UV unwrap | margin | island count, packing, overlap |
| Mirror across the spine | axis | symmetry delta, groups mirrored |
| Proportional adjust | described in words | vertex delta 0, silhouette diff, fits sheet |
| Shape-key scaffold | mood list | keys created, offsets (0 — scaffold only) |

Plus a free-text field: `or describe the operation — "thin the legs 15%"`.

**Failure state (specified, shown on the board):** headless run crashed → the
script name, exit code, and stderr tail are shown; the mesh is untouched and
nothing was written. `Retry` beside it.

### Right · the manual round-trip (tier 3)

1. `Open in Blender` → export the GLB to a stable per-project exchange path
   (never a temp dir)
2. **watching state**: path, `Blender 4.2.5 LTS`, elapsed, `Cancel watch`.
   Not a modal — cradle stays usable. An abandoned watch collapses to "export
   still on disk", re-armable in one click.
3. on save → **re-import diff card**: vertex-count delta, bone-name
   compatibility, weight sanity, UV island count, texture-map changes,
   silhouette render-diff, and a "what this import will stale" block
4. `Import as new version` (journaled import op, NR flows downstream) /
   `Discard` (writes nothing, leaves the file on disk)

Blender presence, exactly like Godot: `$BLENDER_BIN` → PATH → /Applications.
Not-installed state disables every tier 2/3 affordance with the reason and an
install pointer. Recipes are pinned to Blender 4.x LTS and version-gated — a 5.0
install is reported, not silently used.

Licensing note for the build: cradle invokes Blender as an external process on
glTF interchange files. The GPL covers Blender's code, not files it edits.

## 8. PixEd-on-texture

Painting a texture is a PNG job. PixEd does not own unwrapping — unwrap is a
tier-2 op, and PixEd receives a PNG with islands already laid out.

- left rail: PixEd's own tools, **palette roles** (base / shade / light /
  accent / outline / glass, keys `1`–`6`), and the **UV island list** named from
  the rig's vertex groups
- canvas: the atlas with island outlines as a non-painting overlay, checker
  behind transparency, 1× / 4× / 8×
- right rail: **live on-mesh preview**, updating on every stroke — no bake, no
  apply
- **click-mesh-to-focus-texture-region**: clicking a surface in the preview
  pans, zooms and selects that island. Alt-click on the canvas points the other
  way — the mesh spins to show that patch.
- QA chips, same family as sprite work: palette on-pack, islands covered, seam
  bleed (with coordinates), outline weight consistency. Chips report; they never
  block a save.

Maps panel states plainly that there is one map (base colour), a flat roughness,
and no normal map — rather than offering empty PBR slots.

Not here: UV unwrap / seam editing, paint directly on the mesh (both disabled
with reasons).

## 9. Screen S5 — faces

The in-app half is **preview and assignment**. Authoring is tier 2 (shape-key
scaffold + proportional offsets) or tier 3 (sculpted, returning through the
round-trip).

- grid of moods: 8 canon defaults + project additions, each card showing its
  **route badge** — `3D` (shape key), `2D` (expression sheet row), or
  `fallback`
- fallback-to-neutral shows the reason: "A shape key named `mood.weary` exists
  but has no offsets — it was scaffolded, never shaped."
- mix preview sliders, with the caveat stated: "Mixes are previews only. What
  ships is the enum value — the runtime picks one mood, never a blend."
- coverage summary: 3D shapes, 2D sheet rows, falling back, used in dialogue

Two routes fill one enum. A character can be half 2D moods and half 3D shapes;
the character editor's Moods strip shows which route filled each.

Commit verb: **Apply** (assignment, not new pixels).

## 10. Screen S6 — state clips

- left rail: the **closed state vocabulary**, each row showing `clip` /
  `gap` and `sheet` / `—`. A state with a sheet but no clip is a **gap**, not an
  error.
- viewport: playback with client-side slerp scrub — labelled free, because it is
  our renderer
- timeline: pose keyframes as diamonds, the source clip as a bar with **trim
  handles**; trim is non-destructive and says so
- CMU clips insert as **keyframe batches** you can then delete or retime.
  Unmapped bones are named, never silently dropped.
- interpolation per key: slerp / ease / step. Rotations are canonical and
  world-space, so a key drops into any compatible skeleton without re-deriving
  parents.
- export: **GLB animation track per state**, track names = state ids;
  `Export all tracks · free`
- disabled: generate video from this clip — "Video generation is not part of
  cradle. Clips render as flat frames at sprite resolution; that is what the
  generator consumes."

Cross-link to the 2D Animation tab, never a merged screen: "same states, two
halves."

## 11. Cost doctrine in this package

| Action | Cost |
|---|---|
| every tier-2 agent op | free · conversation tokens only |
| posing, rendering, scrub, validation, QA, gates | free |
| the whole Blender round-trip | free |
| mesh generation | paid · $0.20–$0.90 |
| rigging (auto, provider) | paid |
| generate sprites from pose | paid · $0.16–$0.60 |

Paid-on-the-button with the range on it. Free never confirms. "Meshy paid tier
for commercial use" rides the key-gated actions only.

## 12. Commit verbs, undo, journaling

- three verbs hold: **Save** (mesh/clip/texture edits), **Apply** (assignments),
  **Keep** (unchanged from the parent package)
- `⌘Z` undoes pre-save edits in the pose, rig-intent and timeline surfaces
- agent ops and re-imports are **versions** — undone by Restore, not undo
- every op is journaled with the generating script and before/after hashes; the
  History tab shows import ops like any other write

## 13. Needs-review propagation

Full matrix on P12. Summary:

- weight fixes stale clips only
- geometry changes stale renders, then sprites through them, then clips
- decimation **invalidates** the texture atlas — stated on the button before it
  runs, old PNG kept as a version
- re-import stales renders, sprites, clips and possibly the atlas
- **the 2D anchor never stales from mesh work; the mesh never stales from 2D
  re-anchoring**

Clearing is free everywhere except sprite regeneration. `Dismiss` exists ("I
have looked, it is fine") and is journaled as a judgement.

## 14. Keyboard map

| Key | Where | Action |
|---|---|---|
| `J` | S1 | place a joint |
| `M` | S1, S3 | mirror across the spine |
| `⌫` | S1, S6 | delete selected joint / key |
| `K` | S6 | key at playhead |
| `←` `→` | S6 | step frame |
| `F` | J′ | frame selection |
| `1`–`6` | S4 | palette roles |
| space+drag | S4 | pan |
| `⌘Z` | pose, rig-intent, timeline, PixEd | undo pre-save |
| middle drag / shift+drag | 3D viewports | orbit / pan |

## 15. Empty states

| Surface | Empty copy |
|---|---|
| J′ · no mesh | Tier 1: 2D anchor only. Generate a mesh, upload a GLB, or upload a rigged GLB — or stay here; chained img2img posing works on the anchor alone. |
| S1 · no joints | Pick a preset or click the mesh to place your first joint. |
| S2 · no rig | Deformation review needs a rig. Mark intent on S1 first. |
| S3 · no ops run | Nothing has been run on this mesh yet. Ops are free. |
| S4 · no unwrap | No UV atlas yet. Smart UV unwrap is a tier-2 op — run it and the PNG opens here. |
| S5 · no shapes | No shape keys. Scaffold them (tier 2) or draw expression sheets instead. |
| S6 · no clips | No clips yet. Every state can have one; states with sheets and no clips show as gaps. |

## 16. Failure states

Blender missing · gate failed · watch abandoned · headless run crashed (script +
stderr tail) · unreadable/corrupt save (parser error, mesh untouched) · bones
renamed on re-import (named per bone, with the count of poses and clips that
would stop mapping — import still allowed).

## 17. Open

The **D4 spike** — raw pixel art vs restyle-before-Meshy — remains the one open
empirical. A disabled-with-reason "Restyle for meshing" slot on J′ is enough
until the experiment reports.
