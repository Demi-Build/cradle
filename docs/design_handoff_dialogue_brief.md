# Design brief — Cradle's dialogue editor & tester

September Phase 0, build-order item #2. The design produced from this brief
returns to `canon-ai/docs/September_Phase_0_prd.md` (gates build item #9).

---

## THE PROMPT (paste this + the rest of this document into the design session)

> You are designing two coupled surfaces for **cradle**, a desktop game-dev
> editor (Tauri/React, dark-first, token-driven design system): a **dialogue
> graph EDITOR** (full structural editing of NPC conversation trees — nodes,
> choices, rewiring, variants, and gate conditions) and a **dialogue
> TESTER** (play a conversation against a simulated game state — inventory,
> quest states, clock, player fields — with per-choice gate results shown
> live). Cradle has read-only dialogue views today (a card walker and a
> React Flow graph); you are designing the editing and testing layer on top
> of them. This is not a reskin — it is a coherent interaction model for the
> densest new surface in the app. The brief below carries the data model,
> verbs, validation rules, a real dialogue tree from a shipped world, the
> target condition grammar, ten design questions to answer, and the design
> system constraints. Deliverables: a README.md interaction spec, static
> HTML mock screens (self-contained, using the token palette, real content
> from the brief — no lorem), and a PLAN.md implementation map, in the style
> of a design handoff a developer builds from directly. Answer all ten
> design questions explicitly; propose one recommended model rather than
> option menus.

---

## 1. Context

Cradle is "the agentic atelier for game development" — a desktop editor over
**canon**, a Python engine that generates coherent game worlds (this brief
concerns its dungeon-crawler/MazeWorld worlds: rooms, NPCs, quests, items).
Every NPC can carry a **dialogue tree**; quests gate on conversations;
dialogue is how worlds breathe. Cradle never writes files itself — every
edit shells to a `canon` CLI verb that validates fail-closed, journals the
change with a per-field diff, and stamps provenance.

Today's dialogue surfaces are **read-only**: a Card mode (walk the
conversation with driver buttons) and a Graph mode (React Flow + dagre
auto-layout, colored edges per beat kind). An NPC can have up to four tree
**variants** woven into one state machine — `default · complete ·
incomplete · failed` — joined by a **quest-gate node** that branches on
quest state. Users will also create custom variants.

## 2. What is being designed

**A. The graph editor (v1, non-negotiable full editing):**
- add / remove / re-text nodes; edit speaker; multi-speaker scenes exist
- add / remove / rewire choices (edges); set a choice's target or make it
  end the conversation
- change the entry node; create / delete / duplicate variants
- author **conditions** and **effects** on any choice (see §4)
- delete safely: removing a node orphans inbound choices — the design must
  make consequences visible before commit

**B. The tester:**
- drive any tree in a card-like walker **against a simulated game state**:
  inventory (items by id), quest states (offered/active/complete/failed),
  game clock/time, player fields (hp, class, level…), world flags
- every choice shows its gate result live (pass / fail / engine-can't-
  evaluate-yet) with the failing condition named
- effects fire into the simulated state as you choose (picking "take the
  key" adds the key), so a full playthrough is testable
- surface unreachable branches for the current state, and statically
  unreachable nodes regardless of state
- powered by a `canon dialogue test` verb — the same evaluator the engine
  path uses, so the UI never reimplements gating

**C. The condition/effect authoring affordance** — used inside A, verified
inside B. See §4 for the grammar. Vocabulary (which item ids, quest ids,
player fields, namespaces exist) comes from the pack's registry — authoring
should feel like picking from the world, not typing tokens from memory.

## 3. Data model and write rules (fixed; design within these)

```python
DialogueTree:   tree_id, character_id, entry_node_id="start",
                nodes: dict[str, DialogueNode], variant: str|None
DialogueNode:   node_id, speaker: str|None, prompt: str,
                choices: list[DialogueChoice], tags: list[str]
DialogueChoice: text, next_node_id: str|None,   # None = conversation ends
                conditions: list[str], effects: list[str]
```

- Terminal node = empty `choices`. Entry = `entry_node_id`. Variants are
  separate trees sharing `character_id`.
- Writes go through `canon dialogue update` (edit ops journaled
  per-change). Validation on write: entry exists; no orphaned
  `next_node_id`; referenced item/quest ids exist in the pack; conditions
  parse against the grammar; **unreachable nodes are a WARNING, not an
  error** — work-in-progress trees are legal. Warnings must be visible but
  never blocking (house doctrine: loud fallback, disabled-with-a-reason
  beats hidden).
- `canon dialogue improve` exists: current tree + a user instruction → LLM
  re-author (structure kept by default). It is a **paid** action when a
  real LLM backend is selected — paid must read as paid *before* any
  confirm, and the exact prompt is user-editable (an "Edit prompt
  (advanced)" affordance exists on every other generation gate in cradle).

## 4. Condition & effect grammar (the target)

Namespaced tokens, validated on write, evaluated by the tester:

```
conditions:  has_item:<item_id>
             quest:<quest_id>:<offered|active|complete|failed>
             time:<from>-<to>
             player:<field>:<op>:<value>     e.g. player:hp:lt:10
             flag:<key>
effects:     gives_item:<id>  takes_item:<id>  gives_quest:<id>
             set_flag:<key>   advance_quest:<id>
```

Critical doctrine — **data may outrun the engine**: the pack declares which
namespaces its game engine can evaluate at runtime. Authoring any
registered namespace is always allowed; where the engine hasn't caught up,
the editor shows a loud, specific, non-blocking warning ("the engine
doesn't evaluate time: gates yet — the tester does"). Design what that
warning looks like at the choice, the tree, and the save moment.

## 5. Real content for mocks (from a shipped 79-NPC world)

Whisper-Tam, a heretic signal-mystic — current shape (no gates yet):

```json
{"name": "Whisper-Tam",
 "opening_greeting": "The voices from above sing in frequencies beyond flesh... but their song speaks of unity, not this... this brutality.",
 "dialogue_tree": {"nodes": {
  "start":  {"prompt": "The voices from above sing in frequencies beyond flesh... but their song speaks of unity, not this... this brutality.",
             "choices": [{"text": "What do the voices tell you?", "next_node_id": "voices"},
                          {"text": "The Chain says you speak heresy.", "next_node_id": "heresy"}]},
  "voices": {"prompt": "Signal-pattern-seven-seven... harmony not hierarchy... The metal whispers truth - they seek convergence, not conquest. But the Prophet twists the frequency...",
             "choices": [{"text": "What is the true message?", "next_node_id": "end"},
                          {"text": "How do you know this?", "next_node_id": "end"}]},
  "heresy": {"prompt": "Heresy? The resonance speaks clearly through copper-song and steel-dreams. The Chain hears static where divine frequency flows...",
             "choices": [{"text": "Tell me more about the signal.", "next_node_id": "end"}]},
  "end":    {"prompt": "When the great transmission comes, you will understand... the metal fragments sing the same tune as distant stars...",
             "choices": []}}},
 "exhausted_dialogue": "The signal grows discordant... perhaps the Prophet's message has been... misinterpreted..."}
```

Target-state example for mocks — the same NPC after a user adds gating
(show this being authored and tested):

```json
{"text": "I recovered your resonance shard.",
 "next_node_id": "reward",
 "conditions": ["has_item:item_resonance_shard", "quest:q_whisper_signal:active"],
 "effects": ["takes_item:item_resonance_shard", "advance_quest:q_whisper_signal", "set_flag:heard_true_signal"]}
```

Mocks should also show a quest-gate junction between variants
(default/complete/incomplete/failed) and at least one `time:` gate carrying
the engine-can't-evaluate-yet warning.

## 6. The ten design questions — answer all explicitly

1. **Editing locus:** inline on the graph canvas, inspector-driven (select →
   edit in a tray), or hybrid? Cradle precedent: the level editor pairs a
   canvas with an inspector tray; DetailPane hosts tabs.
2. **Mode model:** view / edit / test — how does the user always know which
   mode they're in? (House lesson from the level editor: three implicit
   states — armed brush, view mode, selection — is the known failure
   pattern. Make mode explicit.)
3. **Condition builder:** structured chip/row builder, free text with live
   validation, or both with progressive disclosure? Vocabulary is
   pick-from-world (items, quests, fields by name). How do 3+ conditions on
   one choice read at a glance on the graph?
4. **Variant navigation:** up to 4+ trees per NPC plus custom variants —
   tabs, a lane switcher, side-by-side? How does the quest-gate junction
   render so the relationship between variants is legible?
5. **Tester state panel:** where does simulated state live on screen, how is
   it edited mid-conversation, and how do effect firings display as you
   walk? Support "reset to state X" checkpoints?
6. **Gate feedback:** how does a choice show pass/fail/unevaluable in the
   tester (and, softly, in the editor)? Failing condition must be named,
   not just colored.
7. **Save model:** batch with ⌘S + dirty chips (level-editor precedent) or
   per-op immediate journaling? What does undo mean in each? Recommend one.
8. **Destructive-edit safety:** deleting nodes/variants, re-pointing entry —
   how are consequences (orphans, unreachable subtrees) previewed?
9. **Scale:** trees up to ~30 nodes, worlds with 79+ NPCs — graph
   navigation, minimap or fit-to-view, and how the editor opens fast from
   an NPC's detail page.
10. **The improve loop:** where does "✨ Improve" (LLM re-author with an
    instruction) live, how does paid read as paid, where is the prompt
    editable, and how is the result diffed/accepted rather than silently
    applied?

## 7. Design-system constraints

- Desktop app, **dark-first** with a light theme; every color from the
  existing custom-property tokens (`--surface-*`, `--text-*`, `--border`,
  accent amber). No new palettes.
- Type: Inter (UI) + JetBrains Mono (ids, tokens, data). Condition tokens
  are natural mono territory.
- Pixel-art portraits appear beside dialogue (never smooth-scale sprites).
- Keyboard: `Esc` cancels the current gesture; `⌘S` saves where batch-save
  is chosen; `⌘K` command palette exists and should list dialogue actions
  (greyed with a reason when unavailable).
- Existing components to harmonize with (not replace): React Flow graph
  with dagre layout, Card mode walker, DetailPane tab host, the level
  editor's dock/tray/inspector patterns, Lightbox for portraits.
- Doctrines: loud fallback; disabled-with-a-reason beats hidden; paid reads
  as paid before confirm; every hint renders the key the user actually
  presses (⌘ vs Ctrl).

## 8. Deliverables

Match the shape of the prior handoff (`design_handoff_editor_worldmap_start/`):

1. **README.md** — the interaction spec: every state, mode, empty state,
   warning, and keyboard path; explicit answers to the ten questions.
2. **HTML mock screens** — static, self-contained, token-palette, real
   Whisper-Tam content: at minimum (a) editor with a node selected and the
   condition builder open, (b) the variant/quest-gate view, (c) tester
   mid-conversation with a failed gate and an effect having fired, (d) the
   engine-lag warning treatment.
3. **PLAN.md** — implementation notes mapping the design onto the existing
   components (what extends DialogueGraphMode/DialogueCardMode vs what's
   new), with a build order.

Return the package to `cradle/design_handoff_dialogue/`; approval of it
flips build-order row #2 in `canon-ai/docs/September_Phase_0_prd.md` and
gates row #9 (the build).
