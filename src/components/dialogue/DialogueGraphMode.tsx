import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { DialogueCard } from "./DialogueCard";
import {
  entryNodeId,
  isTerminal,
  type DialogueNode,
  type DialogueTree,
} from "./types";

type CardData = {
  nodeId: string;
  node: DialogueNode;
  isEntry: boolean;
  isTerminal: boolean;
  expanded: boolean;
  onToggle: () => void;
};

type CardNode = Node<CardData, "card">;

const NODE_W = 260;
const NODE_COMPACT_H = 120;
const NODE_FULL_H = 260;

function CardFlowNode({ data }: NodeProps<CardNode>) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <DialogueCard
        nodeId={data.nodeId}
        node={data.node}
        mode={data.expanded ? "full" : "compact"}
        isEntry={data.isEntry}
        isTerminal={data.isTerminal}
        onCardClick={data.onToggle}
      />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

const nodeTypes = { card: CardFlowNode };

function layout(nodes: CardNode[], edges: Edge[]): CardNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const h = n.data.expanded ? NODE_FULL_H : NODE_COMPACT_H;
    g.setNode(n.id, { width: NODE_W, height: h });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const gn = g.node(n.id);
    const h = n.data.expanded ? NODE_FULL_H : NODE_COMPACT_H;
    return { ...n, position: { x: gn.x - NODE_W / 2, y: gn.y - h / 2 } };
  });
}

export function DialogueGraphMode({ tree }: { tree: DialogueTree }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const entry = entryNodeId(tree);

  const { nodes, edges } = useMemo(() => {
    const ids = Object.keys(tree.nodes ?? {});
    const rawEdges: Edge[] = [];
    for (const id of ids) {
      const n = tree.nodes[id];
      (n.choices ?? []).forEach((c, i) => {
        if (!tree.nodes[c.next_node_id]) return;
        rawEdges.push({
          id: `${id}->${c.next_node_id}#${i}`,
          source: id,
          target: c.next_node_id,
          animated: false,
          style: { stroke: "#555", strokeWidth: 1.5 },
        });
      });
    }
    const rawNodes: CardNode[] = ids.map((id) => ({
      id,
      type: "card" as const,
      position: { x: 0, y: 0 },
      data: {
        nodeId: id,
        node: tree.nodes[id],
        isEntry: id === entry,
        isTerminal: isTerminal(tree.nodes[id]),
        expanded: !!expanded[id],
        onToggle: () => setExpanded((s) => ({ ...s, [id]: !s[id] })),
      },
      draggable: true,
      selectable: true,
    }));
    const laid = layout(rawNodes, rawEdges);
    return { nodes: laid, edges: rawEdges };
  }, [tree, expanded, entry]);

  return (
    <div className="dialogue-graph-mode">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="#2a2a2a" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
