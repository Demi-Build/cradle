# HANDOFF — Phase 2 addendum: the three-tier 3D system

For the code team. Read with `README.md` (interaction spec, exact copy, gate
thresholds) and `PLAN.md` (component map, store slices, build order) in this
folder. The parent package `design_handoff_sandbox/` is still authoritative for
shell, tokens, agent panel, History and NR machinery — nothing here replaces it.

## Scope

Eleven boards, both themes:

- **Screens** — J′ (3D tab, Mesh mode), S1 rig intent, S2 deformation review,
  S3 mesh ops + Blender round-trip, S4 PixEd on texture, S5 faces, S6 state clips
- **Flows** — P9′ promotion (flagship), P10 texture round-trip, P12 mesh-edit
  consequences, P13 manual round-trip

Supersedes the v1 addendum draft. Its six in-app DCC surfaces (weight painting,
sculpting, UV seam editing, an in-app rig editor, and two others) are **not**
carried over and have no build row. Each appears in the UI only as a disabled
control with its reason.

## Decisions confirmed for this handoff

| Question | Answer |
|---|---|
| Package location | Stays separate as `design_handoff_3d/`. Do not merge into the sandbox package. |
| Gate pass/warn/fail thresholds | **Design sets them.** README §2 is the source of truth — implement those numbers as configured constants, not magic literals. |
| Roster name `mesh_smith` | **Code's call.** The name appears in copy on J′, S1, S2, S3 and P9′/P10; if you rename it, it is a one-token find-and-replace across those boards and README. The behaviour, not the name, is the spec. |
| First build slice | **All twelve PLAN rows.** No milestone cut — build order still matters for sequencing (1–3 are infrastructure every screen needs), but nothing is deferred out of scope. |

## The one architectural commitment

Cradle does not hand-build mesh surgery. Three tiers:

1. **Cradle establishes and judges** — in-app review, the anchor ladder, posing,
   state clips, PixEd on texture, and every judgment surface.
2. **`mesh_smith` executes** — headless Blender, one agent-written bpy script per
   task, results returning as before/after cards behind the gate ladder.
3. **Manual Blender** — the user, for artistry, via the journaled round-trip.

If a change request pushes an in-app paint, sculpt or seam tool back into tier 1,
that is a reversal of this decision and not an implementation detail. The line in
copy — `the agent does operations, not art` — is load-bearing and should survive
copy edits.

## Non-negotiables in the build

- **Free never confirms.** Every tier-2 op and the whole round-trip are free
  (conversation tokens only). Only mesh generation, provider auto-rig, and
  generate-from-pose are paid, and each shows its range on its own button.
- **Nothing overwrites.** Agent ops and re-imports are versions; Restore, not
  undo. `⌘Z` is for pre-save edits in pose, rig-intent and timeline surfaces.
- **Every op is journaled** with its generating script and before/after hashes,
  including rejected runs — a rejection is data about that mesh.
- **Disabled with a reason, always.** The tooltips in README §4–§10 are exact
  copy, not placeholders.
- **A failed gate never blocks Accept.** It colours the row and states the
  number. Same for a failing re-import diff: import is still allowed.
- **The neutral-gray render stage never themes.** Renders are conditioning
  images; theming them would poison generation.
- **The 2D anchor never stales from mesh work, and the mesh never stales from 2D
  re-anchoring.** P12 is the full matrix; these two independences are the part
  users feel.

## External dependency

Blender, detected exactly like Godot: `$BLENDER_BIN` → PATH → /Applications.
Pinned to **4.x LTS**, version-gated — a 5.0 install is reported, not silently
used. Not installed → every tier 2/3 affordance disables with the reason and an
install pointer, and the character stays at its current ladder tier (a shippable
state, not an error).

Licensing: cradle invokes Blender as an external process on glTF interchange
files. The GPL covers Blender's code, not the files it edits. If a "send back to
cradle" addon is ever wanted, it ships as its own separate GPL script.

## Reuse, not reinvention

- S3's right half **is** the asset Replace flow with mesh-specific numbers. Build
  it on that code path.
- Agent op cards wrap the existing Phase 1 run cards. No new progress or approval
  vocabulary.
- `poseforge` supplies the pose stack (world-space canonical rotations, sketch
  solve, Stances/Actions/Clips). S6 consumes its Clips and owns trimming and
  state binding only — do not re-derive pose math.
- PixEd's tool, palette and QA machinery is reused wholesale on the texture atlas;
  the only new parts are the island overlay, the seam-bleed check and the
  click-mesh-to-focus mapping.

## Open, carried forward

The **D4 spike** — raw pixel art vs restyle-before-Meshy — is still the one open
empirical. A disabled "Restyle for meshing" slot on J′ holds the place. Nothing
in the twelve rows depends on its outcome.
