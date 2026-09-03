// The authoring model and its two adapters (PLAN "The load-bearing refactor").
//
// EXTENDS `types.ts` — it does not replace it. `buildDialogue()` stays exactly
// as it is and keeps rendering View mode; what it produces (`Beat[]`) is a
// LOSSY flattening built to draw, and the editor needs the thing it flattened.
// So this module adds a PARALLEL AUTHORING MODEL and two adapters between them:
//
//   toAuthorDoc(npc)              legacy four fields / `dialogue_trees` → AuthorDoc
//   toBeats(doc, treeId, quest)   AuthorDoc → the same DialogueBuild View draws
//
// Every editing surface reads `AuthorDoc`. Nothing writes `Beat`.
//
// What the flattening lost, and this keeps:
//   • per-choice `conditions` / `effects` (absent from `DialogueChoice`);
//   • choices whose `next_node_id` is missing from `nodes` — the ORPHAN case
//     the editor must show, silently filtered out of the render;
//   • the way back from a beat to `(tree, node_id)`, destroyed by the lane
//     prefixes and the merge into one `Beat[]`;
//   • the distinction between a real node and a synthetic beat (`greeting`,
//     `quest-gate`, `exhausted`), which are type-indistinguishable in `Beat`;
//   • the selector model — the four `dialogue_tree*` fields hard-code quest
//     state as the only selection axis.
//
// The shape mirrors canon's `dialogue_trees` projection byte for byte
// (`canon.dialogue.models.stored_tree`), because canon is the only writer:
// `{tree_id, character_id, label, axis, selector, rank, entry_node_id, nodes}`.
// The legacy import mirrors `canon.dialogue.storage.import_legacy` and the
// lane projection mirrors `legacy_projection`, so what the rail previews is
// what canon will write back.
//
// ONE deliberate divergence from canon's `engine_tree`, documented because it
// looks like a bug: canon ALIASES a non-`start` entry node to `"start"` when
// it writes the engine copy (MazeWorld hardcodes `start`). `viewTree` here does
// not, because that alias would add a duplicate node — and therefore an extra
// beat — to the View render. Writing the engine copy is canon's job; cradle
// never writes pack files (doctrine 1), so the view projection has no business
// carrying the runtime's convention.
//
// Deliberately absent, by row ownership: scenes (`SceneEvent`, step 12) and the
// quest-scope lane grid (step 11).

import {
  buildDialogue,
  type DialogueBuild,
  type DialogueTree as ViewTree,
  type NpcLike,
  type QuestLike,
} from "./types";
import {
  DEFAULT_VOCAB,
  engineVerdict,
  formatToken,
  legacySlotForState,
  legacySuffix,
  namespaceOf,
  stateForSlot,
} from "./grammar";
import type { DialogueVocab, Token } from "./grammar";
import type { PackInfo } from "../../lib/invoke";
import type { AxisId } from "./axes";

/** A tree's selection predicate. ALL rows must match for the tree to be
 *  selected, and the first tree by `rank` whose selector matches wins. A tree
 *  with `selector: null` is the fallback — the `otherwise → default` row. */
export type Selector = { rows: Token[] };

export type AuthorChoice = {
  text: string;
  /** `null` ends the conversation — NOT the same as a terminal node. */
  next_node_id: string | null;
  conditions: Token[];
  effects: Token[];
};

export type AuthorNode = {
  node_id: string;
  /** `null` = "use the tree's `character_id`" — the single-NPC common case. */
  speaker: string | null;
  prompt: string;
  choices: AuthorChoice[];
  tags: string[];
};

export type AuthorTree = {
  tree_id: string;
  character_id: string;
  /** "night vigil" — author-named, shown in the rail. */
  label: string;
  /** Which registered axis it groups under; `null` for the fallback. */
  axis: AxisId | null;
  /** `null` = the fallback tree. */
  selector: Selector | null;
  /** Selector precedence, first match wins. */
  rank: number;
  entry_node_id: string;
  nodes: Record<string, AuthorNode>;
};

/** One character's whole dialogue.
 *
 *  `chrome` carries the NON-TREE dialogue the four legacy fields sit beside —
 *  the opening greeting, the exhausted line, the exchange cap and the quest the
 *  NPC's gate reads. `AuthorDoc` would be lossy without it and `toBeats` could
 *  not reproduce today's View render, which is the whole point of step 1. */
export type AuthorDoc = {
  character_id: string;
  trees: AuthorTree[];
  chrome: {
    opening_greeting?: string;
    exhausted_dialogue?: string;
    max_exchanges?: number;
    quest_id?: number | string | null;
  };
};

/** The row shape `toAuthorDoc` reads: today's four fields, plus the new
 *  `dialogue_trees` list once a pack has been saved through
 *  `canon dialogue update`. Both are read; only canon writes either. */
export type NpcRow = NpcLike & {
  id?: number | string;
  dialogue_trees?: unknown;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Normalising: whatever the row carries → the author shape
// ---------------------------------------------------------------------------

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function tokens(value: unknown): Token[] {
  return Array.isArray(value) ? value.map((t) => String(t)) : [];
}

function authorChoice(raw: unknown): AuthorChoice {
  const c = (raw ?? {}) as Record<string, unknown>;
  const next = c.next_node_id;
  return {
    text: str(c.text),
    next_node_id: typeof next === "string" && next.length > 0 ? next : null,
    conditions: tokens(c.conditions),
    effects: tokens(c.effects),
  };
}

/** One node, keyed by the map key when the payload's own `node_id` is missing
 *  — canon's `_keyed_node` rule, so a hand-written buffer never comes back
 *  with empty ids. */
function authorNode(nodeId: string, raw: unknown): AuthorNode {
  const n = (raw ?? {}) as Record<string, unknown>;
  const speaker = n.speaker;
  return {
    node_id: str(n.node_id) || nodeId,
    speaker: typeof speaker === "string" && speaker.length > 0 ? speaker : null,
    prompt: str(n.prompt),
    choices: Array.isArray(n.choices) ? n.choices.map(authorChoice) : [],
    tags: Array.isArray(n.tags) ? n.tags.map((t) => String(t)) : [],
  };
}

function authorNodes(raw: unknown): Record<string, AuthorNode> {
  const out: Record<string, AuthorNode> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [nodeId, node] of Object.entries(raw as Record<string, unknown>)) {
    out[nodeId] = authorNode(nodeId, node);
  }
  return out;
}

/** `"start"` when present, else the first key — canon's `_entry_of`, and the
 *  same rule `ingestTree` already applies. */
function entryOf(nodes: Record<string, unknown>): string {
  return "start" in nodes ? "start" : (Object.keys(nodes)[0] ?? "start");
}

/** One stored `dialogue_trees` entry as an `AuthorTree`. */
export function authorTree(raw: unknown, characterId: string): AuthorTree {
  const t = (raw ?? {}) as Record<string, unknown>;
  const nodes = authorNodes(t.nodes);
  const selector = t.selector;
  const axis = t.axis;
  return {
    tree_id: str(t.tree_id),
    character_id: str(t.character_id) || characterId,
    label: str(t.label),
    axis: typeof axis === "string" && axis.length > 0 ? axis : null,
    selector:
      selector && typeof selector === "object"
        ? { rows: tokens((selector as Record<string, unknown>).rows) }
        : null,
    rank: typeof t.rank === "number" ? t.rank : Number(t.rank ?? 0) || 0,
    entry_node_id: str(t.entry_node_id) || entryOf(nodes),
    nodes,
  };
}

// ---------------------------------------------------------------------------
// toAuthorDoc — the read adapter (both storage shapes)
// ---------------------------------------------------------------------------

/** Read one NPC row into the authoring model.
 *
 *  The new `dialogue_trees` list wins when the row carries one; otherwise the
 *  four legacy fields are imported as `quest:` selectors — canon's read-both
 *  shim, mirrored, so cradle renders a never-edited pack and an edited one
 *  through exactly one code path. Dangling `next_node_id`s are PRESERVED.
 *
 *  `vocab` supplies the legacy field names and the quest-state vocabulary; it
 *  is pack-registry data (`pack info`'s `dialogue` block), never a hardcoded
 *  list. `npcId` names the character — the id_field value, stringified. */
export function toAuthorDoc(
  npc: NpcRow,
  opts: { npcId?: string | number; vocab?: DialogueVocab } = {},
): AuthorDoc {
  const vocab = opts.vocab ?? DEFAULT_VOCAB;
  const characterId = String(opts.npcId ?? npc.id ?? "");
  const chrome: AuthorDoc["chrome"] = {};
  if (typeof npc.opening_greeting === "string") chrome.opening_greeting = npc.opening_greeting;
  if (typeof npc.exhausted_dialogue === "string")
    chrome.exhausted_dialogue = npc.exhausted_dialogue;
  if (typeof npc.max_exchanges === "number") chrome.max_exchanges = npc.max_exchanges;
  if (npc.quest_id !== undefined) chrome.quest_id = npc.quest_id;

  const field = vocab.storage.field ?? "dialogue_trees";
  const stored = (npc as Record<string, unknown>)[field];
  if (Array.isArray(stored) && stored.length > 0) {
    return {
      character_id: characterId,
      trees: stored.map((t) => authorTree(t, characterId)),
      chrome,
    };
  }
  return { character_id: characterId, trees: importLegacy(npc, characterId, vocab), chrome };
}

/** The four legacy keys as `AuthorTree`s — canon's `import_legacy`, mirrored.
 *  Order and rank follow the mapping table: the three variant slots take ranks
 *  0..2 with `quest:<id>:<state>` selectors, and the base field is the
 *  fallback at rank 999. An NPC with no `quest_id` gets its variant trees with
 *  `selector: null` — honest: without a quest there is nothing to gate on. */
export function importLegacy(
  npc: NpcRow,
  characterId: string,
  vocab: DialogueVocab = DEFAULT_VOCAB,
): AuthorTree[] {
  const legacy = vocab.storage.legacy_fields ?? [];
  if (legacy.length === 0) return [];
  const [base, ...variants] = legacy;
  const questId = npc.quest_id;
  const trees: AuthorTree[] = [];
  variants.forEach((name, rank) => {
    const payload = (npc as Record<string, unknown>)[name] as ViewTree | undefined;
    if (!payload || typeof payload !== "object" || !payload.nodes) return;
    if (Object.keys(payload.nodes).length === 0) return;
    const state = stateForSlot(name, vocab);
    const suffix = legacySuffix(name, vocab);
    trees.push({
      tree_id: `${characterId}:${suffix}`,
      character_id: characterId,
      label: suffix,
      axis: "quest",
      selector:
        questId !== null && questId !== undefined && state
          ? { rows: [formatToken("quest", questId, state)] }
          : null,
      rank,
      entry_node_id: entryOf(payload.nodes),
      nodes: authorNodes(payload.nodes),
    });
  });
  const payload = (npc as Record<string, unknown>)[base] as ViewTree | undefined;
  if (
    payload &&
    typeof payload === "object" &&
    payload.nodes &&
    Object.keys(payload.nodes).length
  ) {
    trees.push({
      tree_id: `${characterId}:default`,
      character_id: characterId,
      label: "default",
      axis: null,
      selector: null,
      rank: 999,
      entry_node_id: entryOf(payload.nodes),
      nodes: authorNodes(payload.nodes),
    });
  }
  return trees;
}

// ---------------------------------------------------------------------------
// toBeats — the render adapter
// ---------------------------------------------------------------------------

/** One tree in the shape `buildDialogue` reads. Prompt + choices only, because
 *  that is all the View render uses; conditions, effects, speaker and tags stay
 *  in the `AuthorDoc` (doctrine 10 — the authoring store is the superset).
 *  See the module header for why the `"start"` alias is NOT applied here. */
export function viewTree(tree: AuthorTree): ViewTree {
  const nodes: ViewTree["nodes"] = {};
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    nodes[nodeId] = {
      prompt: node.prompt,
      choices: node.choices.map((c) => ({ text: c.text, next_node_id: c.next_node_id })),
    };
  }
  return { nodes };
}

/** `(slot → view tree, tree_id → slot, warnings)`.
 *
 *  Trees are walked in RANK order and each takes the FIRST unclaimed legacy
 *  slot its selector maps to; a slot already claimed, or a selector the legacy
 *  four cannot express (`time:`, `flag:`, …), is a WARNING and never a refusal
 *  — the engine simply never plays that tree. Mirrors canon's
 *  `legacy_projection`, whose warnings are the selector-level engine-lag case. */
export function laneProjection(
  trees: AuthorTree[],
  vocab: DialogueVocab = DEFAULT_VOCAB,
): { slots: Record<string, ViewTree>; claims: Record<string, string>; warnings: string[] } {
  const legacy = vocab.storage.legacy_fields ?? [];
  const ordered = [...trees].sort((a, b) => a.rank - b.rank || a.tree_id.localeCompare(b.tree_id));
  const slots: Record<string, ViewTree> = {};
  const claims: Record<string, string> = {};
  const warnings: string[] = [];
  const base = legacy[0];
  for (const tree of ordered) {
    const { slot, reason } = claimedSlot(tree, legacy);
    if (reason) {
      warnings.push(reason);
      continue;
    }
    if (!slot) continue;
    if (slot in slots) {
      const taken = Object.entries(claims).find(([, s]) => s === slot)?.[0] ?? "";
      warnings.push(
        `tree '${tree.tree_id}' maps onto '${slot}', already taken by '${taken}' ` +
          "(first match wins) — the engine will not play it",
      );
      continue;
    }
    slots[slot] = viewTree(tree);
    claims[tree.tree_id] = slot;
  }
  if (base && !(base in slots)) {
    // The generation pipeline's own rule: the shown tree is the incomplete
    // variant when there is no separate fallback.
    const residual = legacy[1];
    const source = (residual ? slots[residual] : undefined) ?? (ordered[0] && viewTree(ordered[0]));
    if (source) slots[base] = source;
  }
  return { slots, claims, warnings };
}

function claimedSlot(
  tree: AuthorTree,
  legacy: string[],
): { slot: string | null; reason: string | null } {
  const rows = tree.selector?.rows ?? [];
  if (rows.length === 0) return { slot: legacy[0] ?? null, reason: null };
  for (const row of rows) {
    const parts = row.split(":");
    if (parts[0] === "quest" && parts.length >= 3) {
      return { slot: legacySlotForState(parts[2], legacy), reason: null };
    }
  }
  const axes = [...new Set(rows.map((r) => r.split(":")[0]))].sort().join(", ");
  return {
    slot: null,
    reason:
      `tree '${tree.tree_id}' is selected by ${axes} — the four legacy dialogue_tree* keys ` +
      "only carry quest state, so the engine never plays this tree (engine lag: the data is " +
      "kept, the engine copy is not written)",
  };
}

/** Render an `AuthorDoc` the way View mode renders it today.
 *
 *  `treeId === null` is the WHOLE-CHARACTER view: the trees are projected back
 *  onto their legacy lanes and handed to the untouched `buildDialogue`, so the
 *  greeting, the quest gate, the outcome one-liners and the exhausted line all
 *  come out exactly as they do now. That equality — `toBeats(toAuthorDoc(npc))`
 *  deep-equals `buildDialogue(npc)` — is step 1's whole proof.
 *
 *  A `treeId` renders that ONE tree on its own, which is what the navigator
 *  rail's previews and Edit mode's single-tree canvas need (README Q9, "tree
 *  focus — one tree on the canvas at a time"). */
export function toBeats(
  doc: AuthorDoc,
  treeId: string | null = null,
  quest?: QuestLike | null,
): DialogueBuild {
  if (treeId !== null) {
    const tree = doc.trees.find((t) => t.tree_id === treeId);
    if (!tree) return { beats: [], edges: [] };
    return buildDialogue({ dialogue_tree: viewTree(tree) }, null);
  }
  return buildDialogue(toNpcLike(doc), quest);
}

/** The `NpcLike` an `AuthorDoc` projects back to — the four lanes plus the
 *  chrome. Never written to disk (canon owns that); this is the render input. */
export function toNpcLike(doc: AuthorDoc, vocab: DialogueVocab = DEFAULT_VOCAB): NpcLike {
  const { slots } = laneProjection(doc.trees, vocab);
  const legacy = vocab.storage.legacy_fields ?? [];
  const out: Record<string, unknown> = { ...doc.chrome };
  for (const name of legacy) {
    if (name in slots) out[name] = slots[name];
  }
  return out as NpcLike;
}

/** Every tree in precedence order — rank first, then id, exactly the order
 *  canon walks them in. The rail, the selector node and the save all read it. */
export function orderedTrees(doc: AuthorDoc): AuthorTree[] {
  return [...doc.trees].sort((a, b) => a.rank - b.rank || a.tree_id.localeCompare(b.tree_id));
}

/** The tree a surface should open first: the fallback if there is one (that is
 *  what a player with no state sees), else the highest-ranked. */
export function defaultTreeId(doc: AuthorDoc): string | null {
  const ordered = orderedTrees(doc);
  return ordered.find((t) => t.selector === null)?.tree_id ?? ordered[0]?.tree_id ?? null;
}

/** A node's outbound choices that point at a node this tree does not have —
 *  the orphan case `buildDialogue` silently drops and the editor must show. */
export function danglingChoices(
  tree: AuthorTree,
): { node_id: string; index: number; target: string }[] {
  const out: { node_id: string; index: number; target: string }[] = [];
  for (const node of Object.values(tree.nodes)) {
    node.choices.forEach((choice, index) => {
      if (choice.next_node_id !== null && !(choice.next_node_id in tree.nodes)) {
        out.push({ node_id: node.node_id, index, target: choice.next_node_id });
      }
    });
  }
  return out;
}

/** Nodes no path from the entry reaches. A warning in the editor and in
 *  `canon dialogue validate`, never an error — unreachable subtrees stay in
 *  the tree and keep their gates (README §8). */
export function unreachableNodes(tree: AuthorTree): string[] {
  const nodes = tree.nodes;
  if (!(tree.entry_node_id in nodes)) return Object.keys(nodes);
  const seen = new Set<string>([tree.entry_node_id]);
  const stack = [tree.entry_node_id];
  while (stack.length) {
    const id = stack.pop()!;
    for (const choice of nodes[id]?.choices ?? []) {
      const next = choice.next_node_id;
      if (next !== null && next in nodes && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return Object.keys(nodes).filter((id) => !seen.has(id));
}

// ---------------------------------------------------------------------------
// The local pre-flight (the save sheet's checklist)
// ---------------------------------------------------------------------------

export type LocalReport = { errors: string[]; warnings: string[]; passed: string[] };

/** What the UNSAVED buffer would validate as.
 *
 *  `canon dialogue validate` is the authority and it reads what is on disk, so
 *  it cannot answer "would this save?" for work that has not been written. This
 *  is the client-side pre-flight for exactly that question — the save sheet's
 *  ⚠/✓ checklist — and it deliberately checks only what needs no pack lookup:
 *  the entry node, orphaned targets, unreachable subtrees and selector rows
 *  pointing at trees that are gone.
 *
 *  It is NOT the gate. `canon dialogue update` re-validates fail-closed with
 *  the pack's own operand tables, and a save it refuses is refused however
 *  green this looks. Doctrine 10 holds throughout: everything except a missing
 *  entry and a dead selector reference is a WARNING and never blocks. */
export function localReport(doc: AuthorDoc): LocalReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const passed: string[] = [];
  const treeIds = new Set(doc.trees.map((t) => t.tree_id));
  let orphanCount = 0;
  let unreachableCount = 0;
  let conditionCount = 0;

  for (const tree of doc.trees) {
    if (Object.keys(tree.nodes).length === 0) {
      warnings.push(
        `Tree '${tree.label || tree.tree_id}' is empty — opening it offers to author it.`,
      );
      continue;
    }
    if (!(tree.entry_node_id in tree.nodes)) {
      errors.push(
        `Tree '${tree.label || tree.tree_id}' has no entry node '${tree.entry_node_id}'.`,
      );
    }
    for (const dangling of danglingChoices(tree)) {
      orphanCount += 1;
      warnings.push(
        `${dangling.node_id}[${dangling.index}] points at '${dangling.target}', which '${tree.tree_id}' does not have.`,
      );
    }
    for (const orphan of unreachableNodes(tree)) {
      unreachableCount += 1;
      warnings.push(
        `Node '${orphan}' is unreachable. Work-in-progress trees are legal — this never blocks a save.`,
      );
    }
    for (const node of Object.values(tree.nodes)) {
      for (const choice of node.choices) conditionCount += choice.conditions.length;
    }
    for (const row of tree.selector?.rows ?? []) {
      const parts = row.split(":");
      if (parts[0] === "tree" && parts[1] && !treeIds.has(parts[1])) {
        errors.push(`Selector row '${row}' names a tree that no longer exists.`);
      }
    }
  }
  if (errors.length === 0) passed.push("Entry node exists");
  if (orphanCount === 0) passed.push("no orphaned targets");
  if (unreachableCount === 0) passed.push("every node is reachable");
  passed.push(`${conditionCount} condition${conditionCount === 1 ? "" : "s"} carried`);
  return { errors, warnings, passed };
}

// ---------------------------------------------------------------------------
// The engine-lag computation (build-order step 10)
// ---------------------------------------------------------------------------
// Doctrine 10's data, beside the other per-tree reports because it answers the
// same shape of question: `unreachableNodes` says what the DATA cannot reach,
// this says what the ENGINE cannot evaluate. The three warning treatments in
// `EngineLag.tsx` all render this one answer, so a banner and a ribbon dot can
// never disagree. It reports; it never blocks.

/** One lagging gate, located. */
export type LagGate = {
  node_id: string;
  choice: number;
  token: Token;
  namespace: string;
  reason: string;
};

export type TreeLag = {
  gates: LagGate[];
  /** Selector rows the engine cannot evaluate — the selector-level case. */
  selectorRows: { token: Token; namespace: string; reason: string }[];
  /** Distinct namespaces, in first-seen order — what the banner names. */
  namespaces: string[];
  /** Distinct `node_id[choice]` pairs — the banner's "the N choices". */
  choices: string[];
};

/** Every engine-lagging gate in one tree, with its reason. Pure, so the banner,
 *  the statusbar count and the tests all read one computation. */
export function treeLag(
  tree: AuthorTree | null,
  packInfo: PackInfo | null,
  scope = "tree",
): TreeLag {
  const gates: LagGate[] = [];
  const selectorRows: TreeLag["selectorRows"] = [];
  if (!tree) return { gates, selectorRows, namespaces: [], choices: [] };
  // TOKEN-level, not namespace-level: an engine block may declare a namespace
  // and still narrow it per operand (the dungeon pack really does — it honours
  // `quest:` at selector scope only for `completed` / `failed`). The ribbon dots
  // ask `engineVerdict`, so the banner must ask the same question or the two
  // disagree on exactly the rows that matter.
  for (const node of Object.values(tree.nodes)) {
    node.choices.forEach((choice, index) => {
      for (const token of choice.conditions) {
        const verdict = engineVerdict(token, "condition", packInfo, scope);
        if (verdict.ok) continue;
        gates.push({
          node_id: node.node_id,
          choice: index,
          token,
          namespace: namespaceOf(token),
          reason: verdict.reason ?? "",
        });
      }
    });
  }
  for (const token of tree.selector?.rows ?? []) {
    const verdict = engineVerdict(token, "condition", packInfo, "selector");
    if (verdict.ok) continue;
    selectorRows.push({
      token,
      namespace: namespaceOf(token),
      reason: verdict.reason ?? "",
    });
  }
  const namespaces = [...new Set([...gates, ...selectorRows].map((g) => g.namespace))];
  const choices = [...new Set(gates.map((g) => `${g.node_id}[${g.choice}]`))];
  return { gates, selectorRows, namespaces, choices };
}

/** The save sheet's engine-lag lines, in board 03's own shape:
 *  `time:22-04 on voices[3] — engine ignores it (tester enforces)`. */
export function lagWarnings(lag: TreeLag): string[] {
  return [
    ...lag.gates.map(
      (g) => `${g.token} on ${g.node_id}[${g.choice}] — engine ignores it (tester enforces)`,
    ),
    ...lag.selectorRows.map(
      (r) => `selector row ${r.token} — the engine skips it and may play a different tree`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Selector precedence (build-order step 9)
// ---------------------------------------------------------------------------
// Reordering the selector is a SEMANTIC edit, not a view preference, so the
// sheet that confirms it has to name which states change tree. Pure and here,
// beside `orderedTrees`, so the sheet and its test read one computation.

/** What changing the order does, computed BEFORE it commits. */
export type RankConsequence = {
  order: string[];
  moved: string;
  /** One line per tree whose would-play verdict changes. */
  changes: string[];
};

/** Which trees swap places when `order` replaces the current ranking, in the
 *  language the confirm sheet uses ("`night vigil` now wins over `default`").
 *  Pure, so the sheet and the test read the same computation. */
export function rankConsequences(doc: AuthorDoc, order: string[], moved: string): RankConsequence {
  const before = orderedTrees(doc).map((t) => t.tree_id);
  const label = (id: string) => doc.trees.find((t) => t.tree_id === id)?.label || id;
  const changes: string[] = [];
  order.forEach((id, position) => {
    const was = before.indexOf(id);
    if (was === position || was < 0) return;
    const overtaken = order
      .slice(0, position)
      .filter((other) => before.indexOf(other) > was)
      .map(label);
    if (was > position && overtaken.length === 0) {
      changes.push(`'${label(id)}' is now tried before ${label(order[position + 1] ?? "")}.`);
    } else if (overtaken.length) {
      changes.push(`${overtaken.join(", ")} now win over '${label(id)}' when both match.`);
    }
  });
  if (changes.length === 0) {
    changes.push("No tree changes which states it wins — the order moved but nothing overtakes.");
  }
  return { order, moved, changes };
}
