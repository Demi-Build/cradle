import type { DialogueTree, NpcLike } from "./types";
import type { BeatEdit } from "./DialogueCard";

type TreeKey =
  | "dialogue_tree"
  | "dialogue_tree_complete"
  | "dialogue_tree_failed"
  | "dialogue_tree_incomplete";

const LANE_TO_TREE: Record<string, TreeKey> = {
  tree: "dialogue_tree",
  complete: "dialogue_tree_complete",
  failed: "dialogue_tree_failed",
  incomplete: "dialogue_tree_incomplete",
};

// Beat IDs are either "<lane>:<nodeId>" for tree beats or a single token for
// special beats (greeting, exhausted, quest-gate, success, failure).
export function parseBeatId(
  beatId: string,
):
  | { kind: "scalar"; field: keyof NpcLike }
  | { kind: "tree"; tree: TreeKey; nodeId: string }
  | null {
  if (beatId === "greeting") return { kind: "scalar", field: "opening_greeting" };
  if (beatId === "exhausted") return { kind: "scalar", field: "exhausted_dialogue" };
  const sep = beatId.indexOf(":");
  if (sep <= 0) return null;
  const lane = beatId.slice(0, sep);
  const nodeId = beatId.slice(sep + 1);
  const tree = LANE_TO_TREE[lane];
  return tree ? { kind: "tree", tree, nodeId } : null;
}

// Dispatch hub for dialogue editing — every prompt and choice text update
// flows through here. Returns the same npc reference on no-op so the store's
// reference-equality dirty check correctly stays clean.
export function applyEdit(npc: NpcLike, beatId: string, change: BeatEdit): NpcLike {
  const target = parseBeatId(beatId);
  if (!target) return npc;
  if (target.kind === "scalar") {
    if (change.kind !== "prompt") return npc;
    return { ...npc, [target.field]: change.value } as NpcLike;
  }
  const tree = npc[target.tree] as DialogueTree | undefined;
  const node = tree?.nodes?.[target.nodeId];
  if (!tree || !node) return npc;
  if (change.kind === "prompt") {
    return {
      ...npc,
      [target.tree]: {
        ...tree,
        nodes: { ...tree.nodes, [target.nodeId]: { ...node, prompt: change.value } },
      },
    } as NpcLike;
  }
  const choices = node.choices ?? [];
  if (change.choiceIdx < 0 || change.choiceIdx >= choices.length) return npc;
  const nextChoices = choices.map((c, i) =>
    i === change.choiceIdx ? { ...c, text: change.value } : c,
  );
  return {
    ...npc,
    [target.tree]: {
      ...tree,
      nodes: { ...tree.nodes, [target.nodeId]: { ...node, choices: nextChoices } },
    },
  } as NpcLike;
}
