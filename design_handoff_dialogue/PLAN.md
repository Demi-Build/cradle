# PLAN.md — implementing the dialogue editor & tester

Maps the design onto what exists in `src/components/dialogue/` and the surrounding shell. Read `README.md` first; this is the build order and the file-by-file delta.

> **Revision 2.** The selector model, the quest scope and scenes-as-events change the data layer more than the first pass assumed. The refactor in step 1 is bigger and now blocks more; the payoff is that all three scopes read the same model.

## What exists today

| File | What it does | Fate |
|---|---|---|
| `dialogue/DialogueTab.tsx` | Card/Graph segmented control, beat/edge count, fetches the NPC's quest | **Extended** — becomes the mode host |
| `dialogue/DialogueGraphMode.tsx` | React Flow + dagre, `CardFlowNode`, per-kind edge styles | **Extended** — editable nodes, selection, tool rail, selector node |
| `dialogue/DialogueCardMode.tsx` | Kind-grouped card list, BFS ordering, scroll-to on choice click | **Untouched** — the View-mode card reader |
| `dialogue/DialogueCard.tsx` | `compact` / `full` beat card | **Extended** — an `editable` mode |
| `dialogue/types.ts` | `buildDialogue()` — flattens 4 trees + quest into `Beat[]` / `BeatEdge[]` | **The main problem.** See below |
| `event/PuzzleTab.tsx`, `event/types.ts`, `event/ChoiceCard.tsx` | The events surface (puzzle / choice types) | **Extended** — a third event type, `scene` |
| `quest/QuestDetail.tsx` | Quest overview | **Extended** — gains a Dialogue tab |
| `DetailPane.tsx` | Tab host | Small changes: mount Dialogue for treeless NPCs; add the quest Dialogue tab |
| `CommandPalette.tsx` + `store.registerCommands` | Palette registry | Register a `Dialogue` group; add a second `⌘P` palette instance |
| `ValidationBar.tsx` | Statusbar with three checker slots | Gains a dialogue validator slot, a `MODE` slot and a `SCOPE` slot |
| `level/ToolRail.tsx`, `level/Minimap.tsx`, `lib/useDraggablePanel.ts` | Floating rail, minimap, drag | **Reused as-is** |
| `level/Dock.tsx`, `level/AudioLane.tsx` | The level editor's bottom dock, and a lane that expands/collapses | **The precedent for the tester dock** — copy its geometry and its open/closed transition |
| `PromptOverride.tsx` | "Edit prompt (advanced)" | **Reused as-is** |
| `db/LineagePanel.tsx` | Journal/history browser | The post-save undo path |
| `Lightbox.tsx`, `Portrait.tsx` | Portrait viewing | Reused in transcripts and scene lines |

## The load-bearing refactor: `types.ts`

`buildDialogue()` is a **lossy flattening** built to render, and it discards everything an editor needs:

- `DialogueChoice` has no `conditions` or `effects` fields at all.
- Choices whose `next_node_id` is missing from `nodes` are silently filtered out — exactly the orphan case the editor must show.
- Node ids are prefixed per lane (`tree:`, `complete:`…) and merged into one `Beat[]`, so there is no way back from a beat to `(tree, node_id)`.
- Synthetic beats (`greeting`, `quest-gate`, `exhausted`) are type-indistinguishable from real nodes, and only real nodes are editable.
- The four `dialogue_tree*` fields hard-code quest state as the only selection axis.

**Do not extend `Beat`.** Add a parallel authoring model; keep `buildDialogue` for View mode.

```ts
// dialogue/model.ts  (new)
export type Token = string;              // validated, never parsed for display

export type Selector = {
  rows: Token[];                         // ALL rows must match for this tree to be selected
};                                       // a tree with no selector is the fallback

export type AuthorChoice = {
  text: string;
  next_node_id: string | null;           // null = conversation ends
  conditions: Token[];
  effects: Token[];
};
export type AuthorNode = {
  node_id: string;
  speaker: string | null;
  prompt: string;
  choices: AuthorChoice[];
  tags: string[];
};
export type AuthorTree = {
  tree_id: string;
  character_id: string;
  label: string;                         // "night vigil" — author-named, shown in the rail
  axis: AxisId | null;                   // which group it sorts under in the rail
  selector: Selector | null;             // null = fallback ("default")
  rank: number;                          // selector precedence, first match wins
  entry_node_id: string;
  nodes: Record<string, AuthorNode>;
};
export type AuthorDoc = { character_id: string; trees: AuthorTree[] };
```

Two adapters:

- `toAuthorDoc(npc): AuthorDoc` — reads the four `dialogue_tree*` fields into four `AuthorTree`s with synthesised `quest:` selectors (`default` → `selector: null`, `rank: 999`), plus any trees the new storage carries. **Preserves dangling `next_node_id`s.**
- `toBeats(doc, treeId, quest): DialogueBuild` — re-uses the existing per-lane logic so View mode and the rail previews render exactly as today.

Every editing surface reads `AuthorDoc`. Nothing writes `Beat`.

### Selector axes

```ts
// dialogue/axes.ts (new)
type AxisId = "quest" | "segment" | "time" | "flag" | "room" | "scene" | "player" | "custom";
```

One registry drives four things: the rail's grouping, the `＋ New tree` axis picker, the condition-row shapes, and `engineSupports`. Add an axis in one place and it appears in all four. `custom` takes an author-supplied label and an arbitrary token, validated by the grammar but not by an axis-specific shape.

**Storage.** Four fixed fields cannot hold nine trees, so this needs a canon-side change: a `dialogue_trees: AuthorTree[]` list on the NPC, with the four legacy fields written back for engine compatibility while the engine still reads them. Land the read path first (`toAuthorDoc` handles both shapes); the write path is a canon decision, not a cradle one.

## Scenes

A scene is an **event of type `scene`**, along`puzzle` and `choice` in `event/types.ts`:

```ts
export type SceneEvent = {
  id: string; type: "scene"; title: string;
  actors: { character_id: string; required: boolean }[];
  settings: Token[];                     // the scene's own gates
  trigger: "enter_room" | "talk_any_actor" | "quest_advance";
  once: boolean;
  on_finish: Token[];                    // effects
  lines: SceneLine[];
};
export type SceneLine =
  | { k: "line"; n: number; speaker: string | null; text: string; conditions: Token[] }
  | { k: "choice"; n: number; options: { text: string; to: number; conditions: Token[] }[] };
```

Scenes are referenced, never embedded: an NPC's rail lists scenes where `actors` includes them; a quest's rail lists scenes whose `settings` reference the quest. One store of truth, three readers.

`actor:<id>:present|absent` is a new condition namespace, legal only inside a scene — the grammar must reject it in a tree, with that reason named.

## Edit buffer and ops

`ops.ts` is the whole write surface. One op per gesture; the op list is what `⌘S` ships.

```ts
type EditOp =
  | { k: "node.add" | "node.remove"; tree: string; node_id: string; node?: AuthorNode }
  | { k: "node.prompt" | "node.speaker"; tree: string; node_id: string; value: string | null }
  | { k: "node.tags"; tree: string; node_id: string; tags: string[] }
  | { k: "choice.add" | "choice.remove"; tree: string; node_id: string; index: number; choice?: AuthorChoice }
  | { k: "choice.text" | "choice.target"; tree: string; node_id: string; index: number; value: string | null }
  | { k: "choice.conditions" | "choice.effects"; tree: string; node_id: string; index: number; tokens: Token[] }
  | { k: "tree.entry"; tree: string; node_id: string }
  | { k: "tree.add" | "tree.remove" | "tree.duplicate"; tree: string; from?: string; axis?: AxisId }
  | { k: "tree.selector"; tree: string; selector: Selector | null }
  | { k: "tree.rank"; order: string[] }                      // the selector-node reorder
  | { k: "scene.line.add" | "scene.line.remove" | "scene.line.text" | "scene.line.speaker"
       | "scene.line.conditions"; scene: string; n: number; value?: unknown }
  | { k: "scene.actor.add" | "scene.actor.remove" | "scene.actor.required"; scene: string; character_id: string; required?: boolean }
  | { k: "scene.settings" | "scene.trigger" | "scene.once" | "scene.on_finish"; scene: string; value: unknown };
```

`useDialogueEditor` holds `{ base, ops, cursor }`; the rendered doc is `ops.slice(0, cursor).reduce(apply, base)`. Undo/redo is cursor movement — no inverse ops — and the dirty list is `ops.slice(0, cursor)` grouped by target. `⌘S` posts the list and, on success, replaces `base` and empties `ops`.

**Quest scope shares the buffer.** The buffer is keyed by `(kind, id)` — `npc:1023`, `scene:evt_3120` — and a quest-scope session opens buffers for every participating NPC. `⌘S` from quest scope flushes all dirty buffers as one batch of per-NPC `canon dialogue update` calls. The unsaved chip groups by NPC. This is the only reason the buffer is a keyed map rather than a single object; do not simplify it away.

`ops.ts` must be pure and unit-tested in the style of `level/gridOps.test.ts`.

## Grammar

`grammar.ts` owns the vocabulary; no component builds a token by concatenation.

```ts
parseToken(t: Token): Parsed | ParseError
formatToken(p: Parsed): Token
namespaceShape(ns: Namespace): FieldSpec[]         // drives ConditionRow's controls
engineSupports(ns: Namespace, pack: PackMeta): boolean
legalIn(ns: Namespace, scope: "tree" | "scene" | "selector"): boolean | string   // string = the reason
```

Vocabulary comes from the pack registry via the store's already-cached `entities.items` / `.quests` / `.rooms` / `.npcs`, so pickers are free. `engineSupports` reads the pack's declared namespaces; when the manifest doesn't carry them yet, treat everything as supported and skip the engine-lag layer rather than warning falsely.

## New files

```
dialogue/
  model.ts                  AuthorDoc, AuthorTree, Selector + adapters
  axes.ts                   the selector-axis registry
  ops.ts                    EditOp union + pure apply()
  grammar.ts                token parse/format/shape/engine-support/scope rules
  useDialogueEditor.ts       keyed edit buffers, undo/redo, dirty grouping, validate
  useDialogueTest.ts         drives `canon dialogue test`, sim state, transcript, selector resolution
  DialogueSurface.tsx        mode host: View | Edit | Test, three-column + dock layout
  ModeBar.tsx                mode segmented + tree chip + dirty chip + Save/Improve
  TreeRail.tsx               the 218px navigator (trees grouped by axis, scenes, quests)
  TreeSwitcher.tsx           ⌘P fuzzy switcher across trees, scenes, NPCs, quest dialogues
  EditableNode.tsx           React Flow node type for Edit mode
  GateRibbon.tsx             ⊳N badge + evaluability dots
  SelectorNode.tsx           the router node — ordered rows, drag to reorder
  Inspector.tsx              node/choice tray
  EntityPicker.tsx           the shared "pick from the world" popover (see below)
  ConditionRow.tsx           one namespace-driven condition row
  EffectRow.tsx              one effect row
  TokenPaste.tsx             mono textarea escape hatch + per-line validation
  DeletePreview.tsx          consequence computation + confirm sheet (nodes, trees, actors, entry)
  ImproveDialogue.tsx        request form + per-row diff proposal
  TesterDock.tsx             the dock: collapsed 186px / expanded full-height
  StatePanel.tsx             simulated state + checkpoints (expanded dock only)
  StateChips.tsx             the compact editable state strip (collapsed dock)
quest/
  QuestDialogueTab.tsx       quest scope host
  QuestLanes.tsx             cross-NPC lane grid + handoff edges + scene blocks
  QuestCoverage.tsx          per-quest-state beat counts
event/
  SceneTab.tsx               scene scope host
  SceneScript.tsx            the numbered line list + choice blocks
  SceneActors.tsx            the Actors list
  SceneSettings.tsx          the scene's own gates + trigger + once + on_finish
```

## The entity picker

`EntityPicker.tsx` is one component with one prop shape, used by every "pick from the world" moment. Build it early (it blocks the condition builder, the actor list and the quest lane grid) and build it once.

```ts
type PickerSlot = {
  types: EntityType[];                    // ["items","events"] — one type hides the tab row
  scope?: { room?: string; quest?: string; npc?: string };   // drives result grouping
  exclude?: string[];                     // ids already used — rendered DISABLED, not filtered
  excludeReason?: (id: string) => string; // "already an actor"
  consequence?: (id: string) => string | null;  // "adds a room: gate", "new lane"
  onPick: (id: string, state?: string) => void; // state = the row's select (seen/solved/present)
};
```

Results come from the store's already-cached `entities.*` — no fetch, so the popover opens instantly. Grouping is by **proximity to the current scope**, not alphabetical: current room, then current quest, then everything else. The footer renders `formatToken()` of the pick-in-progress plus its `engineSupports` dot, so the picker never hides what it produced.

Two rules the prototypes encode and the implementation must keep:

1. **`exclude` disables, never filters.** Filtering out an already-added NPC makes a search for them look like they don't exist in the world.
2. **`consequence` is computed before the pick.** Picking an NPC outside the quest's rooms appends a `room:` condition; the row says so first. Compute it in the picker, apply it as part of the same op so `⌘Z` undoes both together.



| Verb | Used by | Status |
|---|---|---|
| `canon dialogue update <npc> --ops <json>` | `⌘S` | **New.** Op list in, fail-closed validation, journal per op |
| `canon dialogue validate <npc>` | validator panel, save sheet | **New.** `{errors[], warnings[]}`; unreachable nodes and uncoverable selector rows are warnings |
| `canon dialogue test --tree <json> --state <json>` | tester | **New.** Takes a tree payload (the unsaved buffer), returns per-choice `{pass, failing_condition, unevaluable[]}` + post-effect state |
| `canon dialogue select --npc <id> --state <json>` | tester rail, selector node | **New.** Which tree the state selects, and why each other tree didn't — this is what drives "would play now / blocked by state" |
| `canon scene update / validate / test` | scene surface | **New.** Same shape, plus actor-presence in the test state |
| `canon dialogue improve …` | Improve modal | Exists; must return a **proposal** (per-field before/after), not write |
| pack engine capabilities | engine-lag layer | **New manifest field:** which condition namespaces the target engine evaluates |
| `dialogue_trees` on the NPC | selector model | **New storage.** Legacy four fields written back while the engine reads them |

The UI must not reimplement gating or selection. `useDialogueTest` calls `canon dialogue test` on every state change and choice, and `canon dialogue select` whenever a selector-relevant axis changes. If the round-trip is too slow to feel live, cache per `(state hash, node)` — do not port the evaluator into TypeScript.

## Build order

1. **`model.ts` + `axes.ts` + adapters, no UI.** Prove `toAuthorDoc → toBeats` renders today's View mode byte-identically for Whisper-Tam and for a four-variant quest NPC. This is the whole risk of the project; do it first and alone.
2. **`ops.ts` + `useDialogueEditor` + tests.** Keyed buffers, undo/redo, dirty grouping, serialisation. Still no UI.
3. **Mode shell.** `DialogueSurface`, `ModeBar`, the four mode indicators, `Esc`, statusbar `MODE`. Ship with Edit read-only — the mode model is worth landing before the editing.
4. **`canon dialogue update` + `validate` wired to `⌘S`.** Dirty chip, unsaved list with revert, validator panel, save sheet. Prose editing only. First genuinely useful release.
5. **Navigator rail + `⌘P`.** `TreeRail`, `TreeSwitcher`. Needs only step 1's model, and it is what makes a nine-tree NPC usable — do not defer it behind structural editing.
6. **Structural editing.** `EditableNode` choice rows, tool rail, add/remove/rewire, entry change, `DeletePreview`, minimap, `⇧1`.
7. **Grammar + entity picker + condition builder.** `grammar.ts`, `EntityPicker`, `ConditionRow`, `EffectRow`, `TokenPaste`, `GateRibbon`. The picker lands here because steps 11 and 12 both depend on it.
8. **Tester dock.** `TesterDock` collapsed, `StateChips`, `useDialogueTest`, `canon dialogue test`. Then expanded + `StatePanel` + checkpoints + unreachable reporting.
9. **Selectors.** `SelectorNode`, `tree.selector` / `tree.rank` ops, `canon dialogue select`, the rail's would-play/blocked grouping, `dialogue_trees` storage. Steps 5 and 8 make this legible; before them it is abstract.
10. **Engine-lag layer.** Pack capability field, `engineSupports`, the three warning treatments. Cheap once 7–9 exist, dead weight before.
11. **Quest scope.** `QuestDialogueTab`, `QuestLanes`, `QuestCoverage`, multi-NPC batch save. Reuses everything above; only the canvas and the rail are new.
12. **Scenes.** `SceneTab`, `SceneScript`, `SceneActors`, `SceneSettings`, the `actor:` namespace, `canon scene *`, presence toggles in the dock.
13. **Improve + polish.** Proposal-shaped improve, the modal, per-row diff, `PromptOverride`, paid signals. Then `⌘K` registration with disabled reasons, `/` search, `⌘I`, light theme pass, keyboard-hint audit against `kbd()`.

Increments: 1–4 is a prose editor with a real save path. 5–8 is the working editor and tester. 9–10 is the selector model. 11–12 are the other two scopes. 13 closes out.

## Watch-outs

- **`scrollIntoView` is banned in the app shell** but `DialogueCardMode` already calls it and `CommandPalette` calls it optionally. Add no new calls — the transcript and the scene script manage their own scroll containers.
- **`DialogueGraphMode` re-lays out on every `beats` change** (`useMemo` on `[beats, beatEdges]`). In Edit mode that would re-run dagre on every keystroke of an in-place prompt edit and jump the canvas. Key the layout memo on a **structural hash**, not on the doc.
- **`DetailPane` only mounts the Dialogue tab when `hasAny`.** Screen 06 needs it for NPCs with no tree at all; widen to "typeId is `npcs`".
- **Node ids are user-visible and referenced by `next_node_id`.** Renaming is a rewire of every inbound choice — forbid renames in v1 (the design assumes forbidden) or implement as a compound op.
- **Terminal detection is `choices.length === 0`** throughout `types.ts`. A choice with `next_node_id: null` is a node that is not terminal but ends the conversation. Handle it in `toBeats` and the card reader or the graph grows a dangling edge.
- **The tester tests the unsaved buffer**, so `canon dialogue test` must accept a tree payload, not just an NPC id.
- **Selector precedence is data, not layout.** The selector node's row order is `rank`. Dragging a row is a `tree.rank` op that changes behaviour — never treat it as a view preference, and show it in the dirty list.
- **A tree can be selected by an axis the engine can't evaluate.** Then the engine falls through to the next matching row while the tester picks the right tree. That divergence is the selector-level case of engine lag and needs the same loud, non-blocking treatment as a gated choice.
- **Scene edits fan out.** Editing a scene changes what three NPC surfaces and a quest surface show. Invalidate by scene id across every mounted surface, or a quest tab left open will render a stale line.
