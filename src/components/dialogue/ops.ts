// The `EditOp` union and its pure `apply` — the WHOLE write surface of the
// dialogue editor (PLAN "Edit buffer and ops").
//
// EXTENDS: nothing in cradle had a dialogue write path; this is the client half
// of a shape canon already implements. `canon.dialogue.ops` carries the same
// union under the same key names, and the op list is literally the JSON that
// goes to `canon dialogue update --ops`. Two implementations of one union is
// deliberate and NOT a parallel system: canon is the only writer (doctrine 1,
// cradle never writes pack files), and this copy exists so the canvas can show
// the result of an edit before it is saved. It must therefore agree with canon
// op for op — where the two could drift, the comment names canon's rule.
//
// One op per gesture. `⌘S` ships the list; canon journals each op separately
// with its own per-field diff, inside one CAS snapshot and one file write.
//
// Two behaviours that are easy to get wrong, both pinned by tests:
//   • `node.remove` RETARGETS every inbound choice to `null` — "becomes end of
//     conversation", which is exactly what the consequence preview draws.
//   • `tree.rank` is a SEMANTIC edit, never a view preference: `order`
//     re-ranks 0..n-1 and reorders the list, and a tree absent from `order`
//     keeps its relative position after the named ones.
//
// Step 12 added the SCENE half of the union in this same file, against the same
// rule: `canon.dialogue.ops.SCENE_OPS` carries the identical twelve kinds, and
// `applyOps` dispatches on the document rather than growing a second buffer.
//
// Deliberately absent, by row ownership: `node.rename` (forbidden in v1 — a
// rename is a rewire of every inbound choice).

import type { AuthorChoice, AuthorDoc, AuthorNode, AuthorTree, Selector } from "./model";
import { isSceneDoc, type SceneActor, type SceneDoc, type SceneLine } from "./scene";
import type { AxisId } from "./axes";
import type { Token } from "./grammar";
import type { ImproveRow } from "../../lib/invoke";

/** The tree half of the union — `canon.dialogue.ops.TREE_OPS`, verbatim. */
export const TREE_OPS = [
  "node.add",
  "node.remove",
  "node.prompt",
  "node.speaker",
  "node.tags",
  "choice.add",
  "choice.remove",
  "choice.text",
  "choice.target",
  "choice.conditions",
  "choice.effects",
  "tree.entry",
  "tree.add",
  "tree.remove",
  "tree.duplicate",
  "tree.selector",
  "tree.rank",
] as const;

/** The scene half — `canon.dialogue.ops.SCENE_OPS`, verbatim. */
export const SCENE_OPS = [
  "scene.line.add",
  "scene.line.remove",
  "scene.line.text",
  "scene.line.speaker",
  "scene.line.conditions",
  "scene.actor.add",
  "scene.actor.remove",
  "scene.actor.required",
  "scene.settings",
  "scene.trigger",
  "scene.once",
  "scene.on_finish",
] as const;

export type OpKind = (typeof TREE_OPS)[number] | (typeof SCENE_OPS)[number];

/** The two documents one buffer can hold. Keyed `npc:<id>` / `scene:<id>`;
 *  `applyOps` dispatches on which it was handed. */
export type EditDoc = AuthorDoc | SceneDoc;

/** The scene half of the wire format. Every payload key is `value`, which is
 *  the key `canon.dialogue.ops._apply_scene_op` READS — the tree half's
 *  `tokens` key is a tree-op spelling and canon refuses it here fail-closed.
 *  `n` on `scene.line.add` is an INSERT POSITION, clamped to 1..len+1, not a
 *  unique line number: canon renumbers 1..N after every structural line op. */
export type SceneOp =
  | { k: "scene.line.add"; scene: string; n: number; value?: Partial<SceneLine> }
  | { k: "scene.line.remove"; scene: string; n: number }
  | { k: "scene.line.text"; scene: string; n: number; value: string }
  | { k: "scene.line.speaker"; scene: string; n: number; value: string | null }
  | { k: "scene.line.conditions"; scene: string; n: number; value: Token[] }
  | { k: "scene.actor.add"; scene: string; character_id: string; required?: boolean }
  | { k: "scene.actor.remove"; scene: string; character_id: string }
  | { k: "scene.actor.required"; scene: string; character_id: string; required: boolean }
  | { k: "scene.settings" | "scene.on_finish"; scene: string; value: Token[] }
  | { k: "scene.trigger"; scene: string; value: string }
  | { k: "scene.once"; scene: string; value: boolean };

export type EditOp =
  | { k: "node.add" | "node.remove"; tree: string; node_id: string; node?: Partial<AuthorNode> }
  | { k: "node.prompt" | "node.speaker"; tree: string; node_id: string; value: string | null }
  | { k: "node.tags"; tree: string; node_id: string; tags: string[] }
  | {
      k: "choice.add" | "choice.remove";
      tree: string;
      node_id: string;
      index: number;
      choice?: Partial<AuthorChoice>;
    }
  | {
      k: "choice.text" | "choice.target";
      tree: string;
      node_id: string;
      index: number;
      value: string | null;
    }
  | {
      k: "choice.conditions" | "choice.effects";
      tree: string;
      node_id: string;
      index: number;
      tokens: Token[];
    }
  | { k: "tree.entry"; tree: string; node_id: string }
  | {
      k: "tree.add";
      tree: string;
      label?: string;
      axis?: AxisId | null;
      selector?: Selector | null;
      rank?: number;
      entry_node_id?: string;
      nodes?: Record<string, Partial<AuthorNode>>;
    }
  | { k: "tree.remove"; tree: string }
  | { k: "tree.duplicate"; tree: string; from: string; label?: string; axis?: AxisId | null }
  | { k: "tree.selector"; tree: string; selector: Selector | null; axis?: AxisId | null }
  | { k: "tree.rank"; order: string[] }
  | SceneOp;

/** The tree half, narrowed — everything `applyOne` handles on an `AuthorDoc`. */
export type TreeOp = Exclude<EditOp, SceneOp>;

export function isSceneOp(op: EditOp): op is SceneOp {
  return (SCENE_OPS as readonly string[]).includes(op.k);
}

/** A refused op, naming its index and kind. Fail-closed: nothing in the batch
 *  lands if any op is illegal — the same rule canon applies before it writes. */
export class OpError extends Error {
  readonly opIndex: number;
  readonly op: string;
  constructor(index: number, kind: string, message: string) {
    super(`op[${index}] ${kind}: ${message}`);
    this.name = "OpError";
    this.opIndex = index;
    this.op = kind;
  }
}

/** The `(kind, id)` a buffer is keyed by — `npc:1023`, `scene:evt_3120`. */
export type BufferKey = string;

export function npcKey(npcId: string | number): BufferKey {
  return `npc:${npcId}`;
}
export function sceneKey(sceneId: string | number): BufferKey {
  return `scene:${sceneId}`;
}

// ---------------------------------------------------------------------------
// Normalisers — one place each shape gets its defaults (canon's `stored_*`)
// ---------------------------------------------------------------------------

function normChoice(raw: Partial<AuthorChoice> | undefined): AuthorChoice {
  return {
    text: raw?.text ?? "",
    next_node_id: raw?.next_node_id ?? null,
    conditions: [...(raw?.conditions ?? [])],
    effects: [...(raw?.effects ?? [])],
  };
}

function normNode(nodeId: string, raw: Partial<AuthorNode> | undefined): AuthorNode {
  return {
    node_id: raw?.node_id || nodeId,
    speaker: raw?.speaker ?? null,
    prompt: raw?.prompt ?? "",
    choices: (raw?.choices ?? []).map((c) => normChoice(c)),
    tags: [...(raw?.tags ?? [])],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// The human label an op carries in the unsaved list (README §7's per-edit row)
// ---------------------------------------------------------------------------

/** What the op touched, as a stable string the dirty list groups by:
 *  `tree:<id>`, `tree:<id>/node:<id>`, `tree:<id>/node:<id>/choice:<n>`, or
 *  `selector`. Mirrors canon's `detail.target` so the unsaved row and the
 *  journal entry read the same. */
export function opTarget(op: EditOp): string {
  if (isSceneOp(op)) {
    if ("n" in op) return `scene:${op.scene}/line:${op.n}`;
    if ("character_id" in op) return `scene:${op.scene}/actor:${op.character_id}`;
    return `scene:${op.scene}`;
  }
  if (op.k === "tree.rank") return "selector";
  if (op.k === "tree.add" || op.k === "tree.remove" || op.k === "tree.duplicate") {
    return `tree:${op.tree}`;
  }
  if (op.k === "tree.selector" || op.k === "tree.entry") return `tree:${op.tree}`;
  if (op.k.startsWith("choice.")) {
    const o = op as Extract<EditOp, { index: number }>;
    return `tree:${o.tree}/node:${o.node_id}/choice:${o.index}`;
  }
  const o = op as Extract<EditOp, { node_id: string }>;
  return `tree:${o.tree}/node:${o.node_id}`;
}

/** One line of English for the unsaved list. Copy only — the op is the truth. */
export function opLabel(op: EditOp): string {
  switch (op.k) {
    case "node.add":
      return `add node ${op.node_id}`;
    case "node.remove":
      return `delete node ${op.node_id}`;
    case "node.prompt":
      return `edit prompt of ${op.node_id}`;
    case "node.speaker":
      return `set speaker of ${op.node_id} to ${op.value ?? "the tree's character"}`;
    case "node.tags":
      return `retag ${op.node_id}`;
    case "choice.add":
      return `add choice ${op.index} on ${op.node_id}`;
    case "choice.remove":
      return `delete choice ${op.index} on ${op.node_id}`;
    case "choice.text":
      return `edit choice ${op.index} text on ${op.node_id}`;
    case "choice.target":
      return `re-point choice ${op.index} on ${op.node_id} → ${op.value ?? "end of conversation"}`;
    case "choice.conditions":
      return `set ${op.tokens.length} condition(s) on ${op.node_id}[${op.index}]`;
    case "choice.effects":
      return `set ${op.tokens.length} effect(s) on ${op.node_id}[${op.index}]`;
    case "tree.entry":
      return `make ${op.node_id} the entry node`;
    case "tree.add":
      return `new tree ${op.tree}`;
    case "tree.remove":
      return `delete tree ${op.tree}`;
    case "tree.duplicate":
      return `duplicate ${op.from} → ${op.tree}`;
    case "tree.selector":
      return op.selector === null
        ? `make ${op.tree} the fallback`
        : `set ${op.selector.rows.length} selector row(s) on ${op.tree}`;
    case "tree.rank":
      return `reorder selector rows (${op.order.join(" → ")})`;
    case "scene.line.add":
      return `add line ${op.n}`;
    case "scene.line.remove":
      return `delete line ${op.n}`;
    case "scene.line.text":
      return `edit line ${op.n}`;
    case "scene.line.speaker":
      return `set line ${op.n}'s speaker to ${op.value ?? "— narration —"}`;
    case "scene.line.conditions":
      return `set ${op.value.length} condition(s) on line ${op.n}`;
    case "scene.actor.add":
      return `add actor ${op.character_id}${op.required === false ? " (optional)" : ""}`;
    case "scene.actor.remove":
      return `remove actor ${op.character_id}`;
    case "scene.actor.required":
      return `make ${op.character_id} ${op.required ? "required" : "optional"}`;
    case "scene.settings":
      return `set ${op.value.length} scene setting(s)`;
    case "scene.on_finish":
      return `set ${op.value.length} on-finish effect(s)`;
    case "scene.trigger":
      return `trigger this scene on ${op.value}`;
    case "scene.once":
      return op.value ? "play this scene once" : "let this scene replay";
  }
}

export type OpBucket = "nodes" | "choices" | "trees" | "selectors" | "lines" | "actors" | "scene";

/** Which unsaved-chip bucket an op counts in (`4 unsaved · 2 nodes 2 choices`). */
export function opBucket(op: EditOp): OpBucket {
  if (op.k.startsWith("scene.line.")) return "lines";
  if (op.k.startsWith("scene.actor.")) return "actors";
  if (op.k.startsWith("scene.")) return "scene";
  if (op.k === "tree.rank" || op.k === "tree.selector") return "selectors";
  if (op.k.startsWith("tree.")) return "trees";
  if (op.k.startsWith("choice.")) return "choices";
  return "nodes";
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function findTree(doc: AuthorDoc, index: number, kind: string, treeId: string): AuthorTree {
  const tree = doc.trees.find((t) => t.tree_id === treeId);
  if (!tree) {
    const known = doc.trees.map((t) => t.tree_id);
    throw new OpError(
      index,
      kind,
      `no tree '${treeId}' on this character (have ${known.join(", ")})`,
    );
  }
  return tree;
}

function findNode(tree: AuthorTree, index: number, kind: string, nodeId: string): AuthorNode {
  const node = tree.nodes[nodeId];
  if (!node) {
    throw new OpError(
      index,
      kind,
      `tree '${tree.tree_id}' has no node '${nodeId}' (have ${Object.keys(tree.nodes).join(", ")})`,
    );
  }
  return node;
}

function findChoice(node: AuthorNode, index: number, kind: string, at: number): AuthorChoice {
  if (!Number.isInteger(at) || at < 0 || at >= node.choices.length) {
    throw new OpError(
      index,
      kind,
      `node '${node.node_id}' has ${node.choices.length} choice(s); index ${at} is out of range`,
    );
  }
  return node.choices[at];
}

function nextRank(doc: AuthorDoc): number {
  return doc.trees.reduce((max, t) => Math.max(max, t.rank), -1) + 1;
}

/** The rank a NEW tree has to take to be reachable at all.
 *
 *  `nextRank` — canon's own default for `tree.add` / `tree.duplicate` — is only
 *  correct for a doc with no fallback. Selection is first-match-by-rank and the
 *  fallback (`selector === null`) matches every state, so a tree ranked after it
 *  can never be selected: canon's `validate_trees` says exactly that ("tree X is
 *  ranked after the fallback … it can never be selected"). A legacy-imported
 *  NPC's fallback sits at rank 999, so the default would land every tree
 *  authored in cradle at 1000 — dead on arrival.
 *
 *  This lands it one past the last GATED tree, and never at or after the
 *  fallback. */
export function rankBeforeFallback(doc: AuthorDoc): number {
  const gatedMax = doc.trees.reduce(
    (max, t) => (t.selector === null ? max : Math.max(max, t.rank)),
    -1,
  );
  const fallbackMin = doc.trees.reduce(
    (min, t) => (t.selector === null ? Math.min(min, t.rank) : min),
    Number.POSITIVE_INFINITY,
  );
  const wanted = gatedMax + 1;
  return Number.isFinite(fallbackMin) ? Math.min(wanted, fallbackMin - 1) : wanted;
}

/** The follow-up `tree.rank` that keeps a newly-GATED tree selectable, or `[]`
 *  when it already is.
 *
 *  Giving a tree a selector does not move it: `tree.selector` leaves `rank`
 *  alone, in cradle and in canon alike. A tree that arrived after the fallback
 *  — every `tree.duplicate` copy does, because canon appends it at `nextRank`
 *  and ignores a requested rank — therefore stays dead the moment it is gated.
 *  This lifts it ahead of every fallback, keeping the fallbacks last, which is
 *  the precedence rule the reorder sheet edits. */
export function liftAboveFallbackOps(doc: AuthorDoc, treeId: string): EditOp[] {
  const fallbacks = doc.trees.filter((t) => t.selector === null);
  if (fallbacks.length === 0) return [];
  const target = doc.trees.find((t) => t.tree_id === treeId);
  if (!target) return [];
  if (target.rank < Math.min(...fallbacks.map((t) => t.rank))) return [];
  const gated = doc.trees
    .filter((t) => t.selector !== null && t.tree_id !== treeId)
    .map((t) => t.tree_id);
  return [{ k: "tree.rank", order: [...gated, treeId, ...fallbacks.map((t) => t.tree_id)] }];
}

/** Apply ONE op to a doc IN PLACE. Internal — callers use `applyOps`, which
 *  clones first so the base document is never mutated. */
function applyOne(doc: AuthorDoc, op: TreeOp, index: number): void {
  const kind = op.k;
  if (!(TREE_OPS as readonly string[]).includes(kind)) {
    throw new OpError(
      index,
      kind,
      `unknown op — the dialogue op kinds are ${TREE_OPS.join(", ")}` +
        ((SCENE_OPS as readonly string[]).includes(kind)
          ? `; '${kind}' is a scene op — it belongs to a scene buffer`
          : ""),
    );
  }

  if (op.k === "tree.add") {
    if (!op.tree) throw new OpError(index, kind, "needs a 'tree' id");
    if (doc.trees.some((t) => t.tree_id === op.tree)) {
      throw new OpError(index, kind, `tree '${op.tree}' already exists`);
    }
    const nodes: Record<string, AuthorNode> = {};
    for (const [nodeId, node] of Object.entries(op.nodes ?? {}))
      nodes[nodeId] = normNode(nodeId, node);
    doc.trees.push({
      tree_id: op.tree,
      character_id: doc.character_id,
      label: op.label || op.tree,
      axis: op.axis ?? null,
      selector: op.selector ?? null,
      rank: op.rank ?? nextRank(doc),
      entry_node_id: op.entry_node_id || "start",
      nodes,
    });
    return;
  }

  if (op.k === "tree.duplicate") {
    const source = findTree(doc, index, kind, op.from);
    if (!op.tree) throw new OpError(index, kind, "needs a 'tree' id for the copy");
    if (doc.trees.some((t) => t.tree_id === op.tree)) {
      throw new OpError(index, kind, `tree '${op.tree}' already exists`);
    }
    doc.trees.push({
      ...clone(source),
      tree_id: op.tree,
      label: op.label || `${source.label || source.tree_id} copy`,
      axis: op.axis === undefined ? source.axis : op.axis,
      // canon: a copy is UNGATED until the author gives it a selector — two
      // trees with the same selector would make the copy unreachable, which is
      // an uncoverable-row warning against an edit the user never made.
      selector: null,
      rank: nextRank(doc),
    });
    return;
  }

  if (op.k === "tree.rank") {
    if (!Array.isArray(op.order) || op.order.length === 0) {
      throw new OpError(index, kind, "needs 'order': the tree ids in their new precedence order");
    }
    const known = new Map(doc.trees.map((t) => [t.tree_id, t]));
    const unknown = op.order.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new OpError(index, kind, `order names unknown tree(s) ${unknown.join(", ")}`);
    }
    const named = new Set(op.order);
    const ranked = [
      ...op.order.map((id) => known.get(id)!),
      ...doc.trees.filter((t) => !named.has(t.tree_id)),
    ];
    ranked.forEach((tree, position) => {
      tree.rank = position;
    });
    doc.trees = ranked;
    return;
  }

  const tree = findTree(doc, index, kind, op.tree);

  if (op.k === "tree.remove") {
    doc.trees = doc.trees.filter((t) => t.tree_id !== op.tree);
    return;
  }
  if (op.k === "tree.selector") {
    if (op.selector !== null && !Array.isArray(op.selector?.rows)) {
      throw new OpError(index, kind, 'selector must be null (fallback) or {"rows": [tokens]}');
    }
    tree.selector = op.selector === null ? null : { rows: op.selector.rows.map(String) };
    if (op.axis !== undefined) tree.axis = op.axis;
    return;
  }
  if (op.k === "tree.entry") {
    if (!(op.node_id in tree.nodes)) {
      throw new OpError(
        index,
        kind,
        `tree '${op.tree}' has no node '${op.node_id}' to make the entry`,
      );
    }
    tree.entry_node_id = op.node_id;
    return;
  }

  if (op.k === "node.add") {
    if (op.node_id in tree.nodes) {
      throw new OpError(index, kind, `node '${op.node_id}' already exists in '${op.tree}'`);
    }
    tree.nodes[op.node_id] = normNode(op.node_id, op.node);
    return;
  }
  if (op.k === "node.remove") {
    if (!(op.node_id in tree.nodes)) {
      throw new OpError(index, kind, `tree '${op.tree}' has no node '${op.node_id}'`);
    }
    delete tree.nodes[op.node_id];
    // canon's rule: every inbound choice becomes "end of conversation".
    for (const other of Object.values(tree.nodes)) {
      for (const choice of other.choices) {
        if (choice.next_node_id === op.node_id) choice.next_node_id = null;
      }
    }
    return;
  }

  const node = findNode(tree, index, kind, op.node_id);

  if (op.k === "node.prompt") {
    if (op.value === null) {
      throw new OpError(index, kind, "a node prompt cannot be null (use an empty string)");
    }
    node.prompt = String(op.value);
    return;
  }
  if (op.k === "node.speaker") {
    node.speaker = op.value === null ? null : String(op.value);
    return;
  }
  if (op.k === "node.tags") {
    if (!Array.isArray(op.tags)) throw new OpError(index, kind, "needs 'tags': a list of strings");
    node.tags = op.tags.map(String);
    return;
  }
  if (op.k === "choice.add") {
    const at = op.index ?? node.choices.length;
    if (!Number.isInteger(at) || at < 0 || at > node.choices.length) {
      throw new OpError(index, kind, `index ${at} is outside 0..${node.choices.length}`);
    }
    node.choices.splice(at, 0, normChoice(op.choice));
    return;
  }
  if (op.k === "choice.remove") {
    findChoice(node, index, kind, op.index);
    node.choices.splice(op.index, 1);
    return;
  }

  // Positive narrowing rather than "everything else": the four token/value
  // choice ops are the only kinds that reach here, and saying so keeps the
  // union exhaustive if the design ever adds a fifth.
  if (
    op.k !== "choice.text" &&
    op.k !== "choice.target" &&
    op.k !== "choice.conditions" &&
    op.k !== "choice.effects"
  ) {
    throw new OpError(index, kind, "unhandled op kind — the union grew without this apply");
  }
  const choice = findChoice(node, index, kind, op.index);
  switch (op.k) {
    case "choice.text":
      choice.text = op.value === null ? "" : String(op.value);
      return;
    case "choice.target":
      choice.next_node_id = op.value === null ? null : String(op.value);
      return;
    default: {
      if (!Array.isArray(op.tokens)) {
        throw new OpError(index, kind, `needs 'tokens': a list of ${op.k.split(".")[1]} tokens`);
      }
      if (op.k === "choice.conditions") choice.conditions = op.tokens.map(String);
      else choice.effects = op.tokens.map(String);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// The scene half — canon's `_apply_scene_op`, mirrored
// ---------------------------------------------------------------------------

function findLine(doc: SceneDoc, index: number, kind: string, n: number): number {
  const at = doc.lines.findIndex((line) => line.n === n);
  if (at < 0) {
    throw new OpError(
      index,
      kind,
      `scene '${doc.id}' has no line ${n} (have ${doc.lines.map((l) => l.n).join(", ") || "none"})`,
    );
  }
  return at;
}

/** canon's `_renumber`: lines get contiguous numbers 1..N in list order and
 *  every choice option's `to` follows them. Branch targets ARE line numbers, so
 *  a bare insert or splice would silently re-point half the script — and the
 *  unsaved preview would show a different script than the one canon writes. */
function renumber(doc: SceneDoc): void {
  const remap = new Map<number, number>();
  doc.lines.forEach((line, position) => {
    remap.set(line.n, position + 1);
    line.n = position + 1;
  });
  for (const line of doc.lines) {
    if (line.k !== "choice") continue;
    for (const option of line.options) {
      const target = option.to;
      if (target === null || target === undefined) continue;
      const moved = remap.get(target);
      option.to = moved ?? (target >= 1 && target <= doc.lines.length ? target : null);
    }
  }
}

function findActor(doc: SceneDoc, index: number, kind: string, characterId: string): SceneActor {
  const actor = doc.actors.find((a) => a.character_id === characterId);
  if (!actor) {
    throw new OpError(
      index,
      kind,
      `'${characterId}' is not an actor in scene '${doc.id}' ` +
        `(have ${doc.actors.map((a) => a.character_id).join(", ") || "none"})`,
    );
  }
  return actor;
}

function applySceneOne(doc: SceneDoc, op: SceneOp, index: number): void {
  const kind = op.k;
  switch (op.k) {
    case "scene.line.add": {
      const seed = op.value ?? {};
      // canon: `n` is an insert POSITION, clamped — never a unique key. A
      // duplicate number is not an error there and must not be one here.
      const at = Math.max(1, Math.min(Number(op.n ?? doc.lines.length + 1), doc.lines.length + 1));
      const line: SceneLine =
        seed.k === "choice"
          ? { k: "choice", n: at, options: [...(seed.options ?? [])] }
          : {
              k: "line",
              n: at,
              speaker:
                (seed as { speaker?: string | null }).speaker === undefined
                  ? null
                  : ((seed as { speaker?: string | null }).speaker ?? null),
              text: (seed as { text?: string }).text ?? "",
              conditions: [...((seed as { conditions?: Token[] }).conditions ?? [])],
            };
      doc.lines.splice(at - 1, 0, line);
      renumber(doc);
      return;
    }
    case "scene.line.remove": {
      const at = findLine(doc, index, kind, op.n);
      doc.lines.splice(at, 1);
      renumber(doc);
      return;
    }
    case "scene.line.text": {
      const line = doc.lines[findLine(doc, index, kind, op.n)];
      if (line.k !== "line") throw new OpError(index, kind, `line ${op.n} is a choice point`);
      line.text = String(op.value);
      return;
    }
    case "scene.line.speaker": {
      const line = doc.lines[findLine(doc, index, kind, op.n)];
      if (line.k !== "line") throw new OpError(index, kind, `line ${op.n} is a choice point`);
      line.speaker = op.value === null ? null : String(op.value);
      return;
    }
    case "scene.line.conditions": {
      const line = doc.lines[findLine(doc, index, kind, op.n)];
      if (line.k !== "line") throw new OpError(index, kind, `line ${op.n} is a choice point`);
      if (!Array.isArray(op.value)) {
        throw new OpError(index, kind, "needs 'value': a list of condition tokens");
      }
      line.conditions = op.value.map(String);
      return;
    }
    case "scene.actor.add": {
      if (!op.character_id) throw new OpError(index, kind, "needs a 'character_id'");
      if (doc.actors.some((a) => a.character_id === op.character_id)) {
        throw new OpError(index, kind, `'${op.character_id}' is already an actor`);
      }
      doc.actors.push({
        character_id: String(op.character_id),
        required: op.required === undefined ? true : !!op.required,
      });
      return;
    }
    case "scene.actor.remove": {
      findActor(doc, index, kind, op.character_id);
      doc.actors = doc.actors.filter((a) => a.character_id !== op.character_id);
      // Their lines STAY, and the validator warns that nobody speaks them —
      // deleting an actor must never silently delete authored prose.
      return;
    }
    case "scene.actor.required": {
      findActor(doc, index, kind, op.character_id).required = !!op.required;
      return;
    }
    case "scene.settings":
    case "scene.on_finish": {
      if (!Array.isArray(op.value)) {
        throw new OpError(index, kind, `${kind.split(".")[1]} must be a list of tokens`);
      }
      if (op.k === "scene.settings") doc.settings = op.value.map(String);
      else doc.on_finish = op.value.map(String);
      return;
    }
    case "scene.trigger":
      doc.trigger = String(op.value);
      return;
    case "scene.once":
      doc.once = !!op.value;
      return;
  }
}

/** Apply an op list to a doc, purely. The input is deep-cloned; the first
 *  illegal op throws `OpError` so a batch is all-or-nothing before any byte is
 *  written — the same fail-closed contract canon enforces.
 *
 *  ONE function for both documents: a scene op against a character buffer (or
 *  the reverse) is refused BY NAME rather than mis-applied, which is what keeps
 *  the two scopes on one buffer implementation instead of two. */
export function applyOps<T extends EditDoc>(doc: T, ops: EditOp[]): T {
  const out = clone(doc);
  const scene = isSceneDoc(out);
  ops.forEach((op, index) => {
    if (isSceneOp(op)) {
      if (!scene) {
        throw new OpError(index, op.k, "is a scene op, but this buffer holds a character's trees");
      }
      applySceneOne(out as SceneDoc, op, index);
      return;
    }
    if (scene) {
      throw new OpError(index, op.k, "is a tree op, but this buffer holds a scene");
    }
    applyOne(out as AuthorDoc, op, index);
  });
  return out;
}

/** The wire payload for `canon dialogue update --ops`. Ops go over verbatim —
 *  this exists so the one place that serialises them is named. */
export function toWire(ops: EditOp[]): EditOp[] {
  return ops;
}

// ---------------------------------------------------------------------------
// Improve → ops (build-order step 13)
// ---------------------------------------------------------------------------

/** An accepted `canon dialogue improve` row as the EditOp that lands it in the
 *  UNSAVED BUFFER — `prompt` → `node.prompt`, `text` → `choice.text`.
 *
 *  This is the whole of "an LLM re-author is never a write": the proposal never
 *  reaches a verb, it reaches this function, and what comes out is an ordinary
 *  edit `⌘Z` undoes and `⌘S` writes. A row naming any other field is DROPPED
 *  rather than guessed at — improve is structure-preserving, and a field this
 *  build cannot land is a diagnostic, not a write.
 *
 *  It lives here, in the op module, because that is the rule: nothing outside
 *  `ops.ts` may invent a write. */
export function improveRowToOps(rows: ImproveRow[]): EditOp[] {
  const ops: EditOp[] = [];
  for (const row of rows) {
    if (row.field === "prompt" && row.choice === null) {
      ops.push({ k: "node.prompt", tree: row.tree, node_id: row.node_id, value: row.after });
    } else if (row.field === "text" && row.choice !== null) {
      ops.push({
        k: "choice.text",
        tree: row.tree,
        node_id: row.node_id,
        index: row.choice,
        value: row.after,
      });
    }
  }
  return ops;
}
