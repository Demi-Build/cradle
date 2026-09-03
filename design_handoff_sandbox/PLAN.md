# PLAN: Cradle Phase 2 — Sandbox Stages

Implementation map for the boards in this folder. Companion to `README.md` (interaction spec). Paths are relative to `cradle/src`.

## Principles

1. **Extend, never replace.** `LevelDetail`, `Dock`, `ToolRail`, `AnimationTab`, `AnimateModal`, `LineagePanel`, `CommandPalette`, `DialogueTab` all stay. Phase 2 adds tabs, tool entries, dock panes and one global chip.
2. **Every write goes through a canon verb.** No component writes pack files directly; the store dispatches verbs via `lib/invoke.ts` and journals.
3. **Spec-driven fields everywhere.** Tuning knobs, zone payloads and mood enums all come from the pack registry through the same path `RowEditor` already uses. No hardcoded key lists in components.
4. **Session is one concept.** One store slice owns sessions; the character panel, dialogue tester, level editor and TopBar chip are all views of it.

---

## New components

```
components/
  character/
    CharacterEditor.tsx       tab host: hero, composer, anchor, states, moods, skins
    GenerateComposer.tsx      on-page generation: brief, gap tickboxes, one estimate
    GapDetector.tsx           derives "what is missing" from zones, dialogue, mood enum
    JobPanel.tsx              elapsed/count, per-item results as they land, stop
    AnchorStrip.tsx           turnaround views + 3D proxy card + lock explanation
    StateCard.tsx             filmstrip + QA chip + Play / PixEd / Animate
    MoodStrip.tsx             expression sheet, dashed for unfilled
    SkinStrip.tsx             colour-map variants
  anim/
    AnimationTab.tsx          EXTEND: add in-level playback + physics link
    InLevelPreview.tsx        + loop against the level fragment and tuned arc
    PhysicsLink.tsx           + duration vs airtime, mismatch, link to sandbox
    AnimateModal.tsx          EXTEND: guidance stack, candidates, compare, keep-none
    CandidateCompare.tsx      N filmstrips at real fps + measured facts, no ranking
  threed/
    ThreeDTab.tsx             Blockout | Pose | Render modes
    BlockoutViewport.tsx      orbit, gizmos, sprite overlay, pixel grid
    PartInspector.tsx         size in sprite pixels, proportion checks
    PoseLibrary.tsx           named per-part poses
    ReferenceRender.tsx       flat-shaded views at sprite res (free, local)
  history/
    HistoryTab.tsx            EXTEND: filters, paused-plan banner
    HistoryRow.tsx            per-verb row with thumbnails and restore
    ProvenanceChain.tsx       import → anchor → generate → hand edit
    DownstreamPanel.tsx       levels using it, skins inheriting it
  palette/
    CommandPalette.tsx        EXTEND: new entries, estimates in rows, disabled+reason
  audio/
    AudioDock.tsx             dock host; Music | SFX | Ambience panes
    MusicLane.tsx             spatial timeline: x = cells, regions = music zones
    SfxLane.tsx               frame-pinned events; drag between frames
    SfxBindingSwitch.tsx      Frame | Event | Place — same pane, different axis
    EventBindingTable.tsx     an entity's events → sound or none
    EmitterPlacement.tsx      point/radius emitters on the level canvas
    InPlaceSoundPopover.tsx   brief + pick/generate on a frame, event or emitter
    MusicEditor.tsx           track as an asset: sections, variants, generation
    SectionTimeline.tsx       intro/loop/tension + enter-conditions
    SfxEditor.tsx             sample trim, envelope, variant set, bindings list
  references/
    MoodboardView.tsx         board host: grid | wall | list
    ReferenceCard.tsx         upload / kept-generation / pack asset / note
    SteeringSwitch.tsx        per-kind on/off + weight (art, levels, music, sfx, story)
    SourceTray.tsx            img2img source picks with weights + Send to…
    BoardBinding.tsx          the one-line "board: X · N on" every composer shows
  tune/
    CharacterPanel.tsx        372px panel host; group list, footer, dirty/apply
    KnobRow.tsx               compact | expanded | advisory | stepper densities
    KnobTrack.tsx             band track, pack tick, handle, keyboard stepping
    BandWidenSheet.tsx        journaled registry edit
    DerivedReadouts.tsx       jump velocity, apex, distance, gap margin
    ScopeToggle.tsx           this level | whole game (per group)
    ArcOverlay.tsx            canvas arc + apex label from staged values
  session/
    SessionChip.tsx           TopBar chip; five states
    SessionPopover.tsx        registry list, restart/stop/make live
    SessionStrip.tsx          in-surface strip (character mode, dialogue test)
    EngineBadge.tsx           extends EngineChip's vocabulary; primary/twin
    CrashLogTail.tsx          last 20 lines + copy + relaunch
  zone/
    ZoneLayer.tsx             canvas overlays, typed, z-ordered, hit-testing
    ZoneTool.tsx              ToolRail entry + drag-to-create
    ZoneList.tsx              Dock tab; visibility, z order, overlap notes
    ZoneInspector.tsx         tray pane; type/name/z + spec-driven payload
  pixels/
    PixEdTab.tsx             DetailPane tab host; sprite | tileset mode
    PixelCanvas.tsx           checkerboard, grid, onion skin, cursor readout
    PixelToolRail.tsx         brush…transform + recolour
    PaletteRail.tsx           roles by name; off-palette meter (name clashes
                              with level/PaletteRail — import as StylePaletteRail)
    LayerList.tsx             sprite + notes only
    RecolourPanel.tsx         region select → colour map → preview → save
    TilesetStrip.tsx          slots, variant grid, shared-base toggle
    JoinsPanel.tsx            4-step join workflow
    FrameStrip.tsx            wraps AnimationTab's filmstrip; edited-dot state
    UnsavedGuard.tsx          navigation guard
  dialogue/
    LiveSceneDock.tsx         viewport + sync state + re-inject
    MoodPicker.tsx            closed enum; greyed with reason when no portrait
    PortraitSlot.tsx          speaker portrait, pixelated, mood-aware
  library/
    LibraryBrowser.tsx        bundle grid, search, tag filters
    BundleCard.tsx            parts preview, not one thumbnail
    ImportPanel.tsx           palette adaptation preview + provenance
    PublishDialog.tsx         bundle contents, name, tags
  cascade/
    PlanCard.tsx              extends the agent panel's plan card
    BlastRadiusHeader.tsx     artifact count, steps, rollup range
    StaleBadge.tsx            shared stale marker for entities and artifacts
```

Reused as-is: `Tooltip`, `Tabs`, `DetailPane`, `Lightbox`, `Portrait`, `ValidationBar`, `JobTray`, `CostDashboard`, `LineagePanel`, `Minimap`, `AudioLane`, `CommandPalette`, `RowEditor` field renderers, `EngineChip`'s sync dialog.

---

## Store slices (`store.ts`)

```ts
sessions: {
  byId: Record<SessionId, {
    engine: "pygame" | "godot";
    level: string;
    state: "live" | "stale" | "relaunching" | "crashed" | "stopped";
    spawn?: [number, number];      // session-only, never journaled
    startedAt: number;
    lastSwapMs?: number;
    logTail?: string[];
  }>;
  primaryEngine: "pygame" | "godot";
  liveByEngine: Partial<Record<Engine, SessionId>>;
}

tune: {
  scope: Record<GroupId, "level" | "pack">;
  staged: Record<KeyPath, number>;          // pre-save UI state
  applied: Record<KeyPath, number>;         // last known written value
  overrides: Record<KeyPath, number>;       // level overrides shadowing pack
  bands: Record<KeyPath, [number, number]>; // from registry
  codeOwned: Record<KeyPath, { reason: string; file: string; when: string }>;
}

zones: {
  byLevel: Record<LevelId, Zone[]>;         // includes migrated music regions
  selectedId?: ZoneId;
  hidden: Set<ZoneId>;
  conflicts: { ids: ZoneId[]; cells: number; keys: string[] }[];
}

pixels: {
  target: { entityId: string; mode: "sprite" | "tileset" };
  state?: string; frame?: number; slot?: string; variant?: string;
  variantScope: "variant" | "sharedBase";
  dirtyFrames: Set<string>;                 // drives the unsaved guard
  tool: PixelTool; colourRole: string; onion: { on: boolean; span: number; opacity: number };
  offPaletteCount: number;
}

library: {
  bundles: BundleSummary[];
  selectedId?: string;
  adaptation?: { matched: number; total: number; unresolvedFrames: string[] };
}

audio: {
  dock: { pane: "music" | "sfx" | "ambience"; binding: "frame" | "event" | "place" };
  musicRegions: Record<LevelId, MusicRegion[]>;   // same objects as zones.byLevel music zones
  sfxEvents: Record<StateId, { frame: number; sfxId: string; gain: number; pitchVar: number }[]>;
  eventBindings: Record<EntityId, Record<EventName, string | null>>;
  emitters: Record<LevelId, { at: [number, number]; radius: number; sfxId: string }[]>;
  tracks: Record<TrackId, { sections: Section[]; variants: Variant[]; usedIn: string[] }>;
}

references: {
  boards: Record<BoardId, { name: string; refIds: string[] }>;
  refs: Record<RefId, {
    kind: "image" | "audio" | "note";
    origin: "upload" | "generation" | "pack";
    steering: Partial<Record<"art" | "levels" | "music" | "sfx" | "story", number>>; // weight
    usedBy: string[];              // generation ids, for traceability
  }>;
  boardBySurface: Record<SurfaceId, BoardId>;     // per-screen curation, no global state
  sourceTray: { refId: string; weight: number }[]; // img2img inputs, cleared on use
}

cascade: {
  plans: Record<PlanId, { steps: Step[]; cursor: number; rollup: [number, number]; spentSoFar: number }>;
  stale: Record<ArtifactId, { reason: string; since: number }>;
}
```

`tune.staged` is deliberately separate from `applied` — that split *is* the save boundary. `Apply` diffs them, sends only changed keys, clears `staged` on success.

## Backend surface (`lib/invoke.ts`)

New calls, all wrapping canon verbs:

| Call | Verb | Notes |
|---|---|---|
| `tuneSet(level \| null, keys)` | `canon tune set` | `null` level = pack-wide; journals, returns new values |
| `tuneClearOverride(level, key)` | `canon tune clear` | |
| `bandWiden(key, min, max)` | `canon registry set` | Schema edit; journaled separately |
| `sessionLaunch(engine, level, spawn?)` | runtime spawn | Returns SessionId |
| `sessionControl(id, "restart" \| "stop" \| "attach")` | | `attach` = make live |
| `sessionSwap(id, keys)` | edit channel | Must report elapsed ms for the 250 ms contract |
| `zoneWrite(level, zones)` | `canon zone set` | Whole-level array; canon diffs |
| `pixelSave(entity, frames)` | `canon art save` | One version per frame |
| `recolour(entity, region, map, as)` | `canon art skin` | `as: "skin" \| "entity"` |
| `joinsGenerate(tileset, slot, kinds)` | `canon art joins` | Estimate returned before run |
| `expressionSheet(entity, moods)` | `canon art moods` | Batch, cancellable |
| `libraryPublish(entity, parts)` | `canon library publish` | |
| `libraryImport(bundle, adapt)` | `canon library import` | Returns new id + `library_ref` |
| `staleGraph(artifact)` | provenance walk | Free, metadata only |
| `musicGenerate(trackId, brief, refs)` | `canon audio track` | Candidates; audition is local |
| `sfxGenerate(binding, brief, refs)` | `canon audio sfx` | Binding = frame \| event \| place |
| `audioBind(target, sfxId, opts)` | `canon audio bind` | One verb for all three bindings |
| `spliceEntity(sources, weights, brief)` | `canon art splice` | Multi-source img2img; stamps `parents`; $0.08–$0.30 per candidate set |
| `refWrite(boardId, refs)` | `canon refs set` | Free; boards, weights, steering flags |

Latency instrumentation is part of the contract, not an afterthought: `sessionSwap` and `sessionLaunch` return measured ms, and the UI shows the measurement rather than a spinner.

---

## Build order

Numbered so a slice can ship on its own; each row leaves the app usable.

1. **Session slice + chip.** `sessions` store, `SessionChip`, `SessionPopover`, `EngineBadge`, primary-engine concept. Replaces the level editor's `playing…` note. No new canon verbs beyond launch/control. *Unblocks everything else that says "live".*
2. **Tuning read path.** Registry → bands → `CharacterPanel` with compact rows, scope toggle, derived readouts, advisory demotion. Read-only: no Apply yet. Proves the spec-driven generation against a real pack.
3. **Tuning write path.** `staged`/`applied` split, Apply → `canon tune set`, override badges and clear, validation chip clearing, hot-swap through `sessionSwap`. Ship the 250 ms measurement with it.
4. **Spawn picker + arc overlay.** Session spawn, canvas/minimap click, `ArcOverlay`. Small, high-value, needs 1–3.
5. **Band widening.** `BandWidenSheet` + `canon registry set` + History row.
6. **Zones.** `ZoneLayer` + `ZoneTool` + `ZoneList` + `ZoneInspector`; migrate music regions into the model behind the existing `M` toggle. Camera type present and disabled with its reason.
7. **PixEd — sprite mode.** `PixEdTab`, canvas, tools, `StylePaletteRail`, layers, frame navigation reusing `AnimationTab`'s selector and filmstrip, save → `canon art save`, QA chips, unsaved guard.
8. **PixEd — generate-then-tune handoff.** `AnimateModal` result → PixEd with the flagged-frame queue and the `--info` banner.
9. **Recolour / reskin.** `RecolourPanel` (P3) — pure code, no generation, so it ships independently of any art service work.
10. **PixEd — tileset mode.** `TilesetStrip`, frozen bounds, variant grid, shared-base editing.
11. **Joins.** `JoinsPanel` + repetition pass + `canon art joins` + approval into the autotile table + canvas re-render (P4).
12. **Cascade plan cards.** `stale` graph, `StaleBadge`, `PlanCard`, `BlastRadiusHeader`, per-step confirm, pause/resume from History (P5). Everything before this can stale artifacts; this is where staleness becomes actionable.
13. **Expression sheets.** Mood enum from registry, `expressionSheet` batch, `MoodPicker`, `PortraitSlot` in the line editor and tester (P6).
14. **Dialogue live scene.** `LiveSceneDock`, `Play in game`, state injection, sync state, re-inject (D). Needs 1 and 13.
15. **Library.** `LibraryBrowser`, `BundleCard`, `ImportPanel` with palette adaptation (reusing 9's machinery), `PublishDialog`, provenance in `LineagePanel` (F, P7). Designed now, built last.

Rows 1–5 are Screen A end to end. Rows 7–11 are Screen C. Rows 12–15 depend on the pieces above and are safe to reorder among themselves.

16. **Character editor + composer.** `CharacterEditor`, `GenerateComposer`, `GapDetector`, `JobPanel`, `AnchorStrip`, `StateCard`. This is the authoring home and, in hindsight, belongs earlier than its number — build it alongside rows 7–8 if art generation is being touched at all.
17. **Animation tab extensions.** `InLevelPreview` and `PhysicsLink`. Needs rows 2–4 (tuning read path and the arc) to have anything to draw.
18. **AnimateModal extensions.** Guidance stack, candidate compare, `Keep none`, run-in-background handoff to JobTray.
19. **3D tab.** `BlockoutViewport`, `PartInspector`, `PoseLibrary`, `ReferenceRender`, then generate-from-pose. Independent of everything else; the renderer is local and free.
20. **History extensions.** Filters, hand-edit marking, paused-plan banner, provenance chain, downstream panel. Depends on row 12's stale graph for the banner.
21. **Command palette entries.** Mechanical once the verbs exist; do it last so the entry list is complete.

22. **References and moodboards.** `MoodboardView`, `ReferenceCard`, `SteeringSwitch`, `BoardBinding`. Free and self-contained; every composer gains the one-line board binding. Do this **before** row 19 if art generation quality matters early — it is the cheapest lever on output.
23. **Source tray and splicing.** `SourceTray` + `spliceEntity`. Depends on 22 and on the provider question above.
24. **Audio dock — music.** `AudioDock`, `MusicLane`; music regions read the existing zone slice, so this is a second view, not a new model.
25. **Audio dock — SFX.** `SfxLane`, `SfxBindingSwitch`, `EventBindingTable`, `EmitterPlacement`, `InPlaceSoundPopover`. The popover is the highest-value piece; build it with the lane.
26. **Music and SFX editors.** `MusicEditor`, `SectionTimeline`, `SfxEditor`. Assets, versions, publish — same shape as a character.

**Price table and undo rule** (README) are implementation contracts, not screens: the price table needs real provider numbers wired to one constants module so no component hardcodes a range, and the three undo mechanisms need confirming against what the store can actually revert. Both are good first tasks for the build session.

## Testing notes

- **Latency assertions**, not vibes: unit-test that `sessionSwap` reports ms and the strip renders the measurement; integration-test the 3 s relaunch budget in CI with a stub runtime.
- **Spec-driven rendering**: snapshot `CharacterPanel` against two packs with different registries to prove no key list is hardcoded.
- **Save boundary**: property test that no `staged` value ever reaches disk without an Apply, and that Apply sends only changed keys.
- **Frozen bounds**: a join result that alters geometry outside the slot must be rejected before it reaches the strip.
- **Stale correctness**: re-anchor stales exactly the artifacts conditioned on the old anchor, and never the skins.

## Deliberately out of scope for Phase 2

3D editing (proxy refs are reference only), part layers and rigging, filters and blend modes, engine copies as library items, sharing beyond the local machine, camera-zone runtime, auto-restart on crash, agent-initiated paid suggestions.
