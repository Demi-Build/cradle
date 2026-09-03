# PLAN — Phase 2 addendum: the three-tier 3D system

Component map and build order. Reads against `README.md` in this folder and the
parent package's PLAN (shell, tokens, agent panel, NR machinery all reused).

## Component map

### New components

| Component | Used by | Notes |
|---|---|---|
| `LadderChip` | J′, S1, P9′ | tier + what would promote it; three states |
| `ProportionChecks` | J′, S1 | free, continuous; sprite-pixel units |
| `TestPoseStrip` | J′ (compact), S2 (hero) | n tiles, per-tile state chip + diff; plays a shared clock |
| `BeforeAfterStrip` | S2, S3, P9′ | two viewports, one pose, `play both` / `wipe` |
| `MeshGateLadder` | S2, S3 | keyed metric list; pass/warn/fail per row |
| `AgentOpCard` | J′, S1, S2, S3, S5 | wraps the existing agent run-card; adds gate + Accept/Tell it more/Reject |
| `OpPicker` | J′ (chips), S3 (grid + free text) | one source of truth for the op list |
| `JointList` | S1 | tree, drag-reparent, inline rename, unnamed warning |
| `JointPlacementViewport` | S1 | click-place, mirror, selection |
| `RigValidationPanel` | S1 | 4 checks incl. pose-library mapping |
| `FailureChips` | S2 | common-failure vocabulary, shared with the agent prompt |
| `BlenderWatchCard` | S3, S2 (via Open in Blender) | export → watching → save-detected states |
| `ReImportDiffCard` | S3, P13 | mesh-flavoured Replace diff + stale list |
| `UVIslandList` | S4 | names from vertex groups |
| `TextureCanvas` | S4 | PixEd canvas + island-outline overlay + seam guard |
| `OnMeshPreview` | S4, S5 | live material update; click-to-focus both ways |
| `MoodCard` | S5 | route badge (3D / 2D / fallback) + reason |
| `ShapeMixPanel` | S5 | preview-only sliders |
| `StateClipList` | S6 | clip/gap × sheet/— per state |
| `ClipTimeline` | S6 | keys, trim handles, playhead, non-destructive |
| `ScriptDisclosure` | all op cards | `show the script` + stderr tail on failure |

### Reused unchanged

Shell + tabs, agent panel and run cards, History/journal, NR badge and
propagation, disabled-with-a-reason tooltip, cost chip and paid-button
estimates, PixEd tool/palette/QA machinery, asset Replace flow (S3 right half is
a specialisation of it), Godot-style external-binary detection.

## Store slices

| Slice | Holds |
|---|---|
| `mesh.versions` | ordered versions, origin tag, hashes, generating script |
| `mesh.gates` | last gate result per version |
| `rig.intent` | joints (name, parent, role, position), preset, mirror pairs |
| `rig.compat` | pose-library mapping result |
| `ops.runs` | queued / running / returned / accepted / rejected + stderr |
| `blender.env` | binary path, version, LTS gate, detection source |
| `blender.watch` | exchange path, armed, elapsed, last mtime |
| `texture.atlas` | PNG asset ref, island names, QA results |
| `moods.assignment` | enum → 3D key / 2D row / fallback + reason |
| `clips.byState` | keys, trims, source refs, GLB track names |

`poseforge` supplies the pose stack (world-space canonical rotations, sketch
solve, Stances/Actions/Clips). `clips.byState` consumes its Clips; S6 owns
trimming and state binding, not pose math.

## Build order

Rows 1–5 first, as in the parent PLAN. Nothing in this addendum blocks the 2D
path.

| # | Row | Work |
|---|---|---|
| 1 | env | Blender detection (`$BLENDER_BIN` → PATH → /Applications), version gate, not-installed disabling across every tier 2/3 affordance |
| 2 | agent | `mesh_smith` roster entry, bpy script harness, `blender --background --python` runner, journaling with script + hashes, stderr capture |
| 3 | gates | `MeshGateLadder` metrics: coverage, unweighted verts, bones-in-limbs, manifold, vertex delta, silhouette render-diff |
| 4 | J′ | Mesh mode: version rail, ladder chip, proportion checks, op entry points, compact test-pose strip |
| 5 | S1 | rig intent + validation + `Send to mesh_smith` (the promotion path — highest product value) |
| 6 | S2 | test-pose strip hero, failure chips, fix loop, accept-as-version |
| 7 | S3 left | op cards for decimate, mirror, proportional adjust, unwrap, shape-key scaffold |
| 8 | S3 right | export → watch → re-import diff → version (reuse Replace) |
| 9 | S4 | PixEd on the atlas: island list, outline overlay, QA chips, on-mesh preview, click-to-focus |
| 10 | S6 | state clips: timeline, trim, CMU batches, GLB track export |
| 11 | S5 | mood assignment, fallback reasons, mix preview |
| 12 | NR | full P12 matrix wired: op/import → stale sets, dismiss-as-judgement |

Ship order rationale: 1–3 are infrastructure every screen needs; 5 is the flow
that changes what users can do (creatures reach tier 3); 8 is the safety net
that makes tier 3 usable at all; 11 is last because fallback-to-neutral is
already a working state.

## Test hooks

- headless runner: exit-code and stderr surfacing, no partial writes on crash
- gate metrics: golden meshes with known coverage / non-manifold cases
- watch: mtime debounce, abandoned-watch expiry, corrupt-glTF parse error
- re-import: bone-rename detection, vertex-delta accounting, atlas island count
- NR: each row of the P12 matrix as a case

## Not in this package

Weight painting, sculpting, manual UV seams, projection painting, PBR authoring,
video generation, in-app armature mechanics. Each has a disabled control with
its reason in the UI; none has a build row.
