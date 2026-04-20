export type DialogueChoice = {
  text: string;
  next_node_id: string;
};

export type DialogueNode = {
  prompt?: string;
  choices?: DialogueChoice[];
};

export type DialogueTree = {
  nodes: Record<string, DialogueNode>;
};

export function bfsOrder(tree: DialogueTree, entry = "start"): string[] {
  const nodes = tree.nodes ?? {};
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = nodes[entry] ? [entry] : Object.keys(nodes).slice(0, 1);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const node = nodes[id];
    if (!node) continue;
    for (const c of node.choices ?? []) {
      if (!seen.has(c.next_node_id) && nodes[c.next_node_id]) {
        queue.push(c.next_node_id);
      }
    }
  }
  // append any orphan nodes
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

export function entryNodeId(tree: DialogueTree): string {
  if (tree.nodes?.start) return "start";
  return Object.keys(tree.nodes ?? {})[0] ?? "";
}

export function isTerminal(node: DialogueNode): boolean {
  return !node.choices || node.choices.length === 0;
}
