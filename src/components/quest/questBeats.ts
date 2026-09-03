// The quest-lane PROJECTION (README screen 07, "Canvas"; PLAN step 11).
//
// A "beat" is a NODE in some NPC's tree, located by `(npc, tree, node_id)`.
// Nothing here owns data — the grid is a projection, and the same beat is
// legitimately reachable from the character who says it, the quest that needs
// it, and the scene it happens in. That duplication is a feature.
//
// Which column a beat sits in comes from ITS OWN GATES: a node whose selector
// or choices carry `quest:<id>:<state>` belongs to that state; a node with no
// quest gate belongs to the fallback column. There is no quest-lane coordinate
// in the pack, and inventing one would be a second source of truth.

import { formatToken, namespaceOf } from "../dialogue/grammar";
import type { AuthorDoc, AuthorNode, AuthorTree } from "../dialogue/model";

export type QuestBeat = {
  npcId: string;
  npcName: string;
  treeId: string;
  nodeId: string;
  prompt: string;
  /** The quest state this beat belongs to, or `null` for the fallback column. */
  state: string | null;
  gates: number;
  /** Effects that HAND OFF the quest — `gives_quest`, `advance_quest`. */
  handoffs: string[];
};

export type QuestSceneBlock = {
  id: string;
  title: string;
  actors: string[];
  state: string | null;
};

/** Which quest state a node belongs to, read from its own condition tokens.
 *  `null` when nothing gates it on this quest — the beat plays in whatever
 *  state the tree's selector allows, which is the fallback column. */
export function beatState(node: AuthorNode, tree: AuthorTree, questId: string): string | null {
  const rows = [
    ...(tree.selector?.rows ?? []),
    ...node.choices.flatMap((choice) => choice.conditions),
  ];
  for (const token of rows) {
    if (namespaceOf(token) !== "quest") continue;
    const parts = token.split(":");
    if (parts[1] === questId && parts[2]) return parts[2];
  }
  return null;
}

/** Every beat one character contributes to one quest. */
export function beatsFor(
  doc: AuthorDoc,
  npcId: string,
  npcName: string,
  questId: string,
): QuestBeat[] {
  const out: QuestBeat[] = [];
  for (const tree of doc.trees) {
    for (const node of Object.values(tree.nodes)) {
      const gates = node.choices.reduce((n, c) => n + c.conditions.length, 0);
      const handoffs = node.choices
        .flatMap((c) => c.effects)
        .filter((token) => token.startsWith("gives_quest:") || token.startsWith("advance_quest:"));
      out.push({
        npcId,
        npcName,
        treeId: tree.tree_id,
        nodeId: node.node_id,
        prompt: node.prompt,
        state: beatState(node, tree, questId),
        gates,
        handoffs,
      });
    }
  }
  return out;
}

/** The `quest:<id>:<state>` token a new quest-scope beat is gated with. In
 *  quest scope the quest id is IMPLIED — that is what makes quest-scope
 *  authoring faster than NPC-scope for quest work (README screen 07). */
export function impliedQuestToken(questId: string, state: string): string {
  return formatToken("quest", questId, state);
}
