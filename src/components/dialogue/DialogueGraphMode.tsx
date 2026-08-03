import { useMemo } from "react";
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
import type { Beat, BeatEdge } from "./types";

type CardData = { beat: Beat };

type CardNode = Node<CardData, "card">;

const NODE_W = 280;
const NODE_H = 120;

function CardFlowNode({ data }: NodeProps<CardNode>) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <DialogueCard beat={data.beat} mode="compact" />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

const nodeTypes = { card: CardFlowNode };

const EDGE_STYLE: Record<string, { stroke: string; labelFill: string; dashed?: boolean }> = {
  tree: { stroke: "#555", labelFill: "#999" },
  gate: { stroke: "var(--warn)", labelFill: "var(--warn)" },
  success: { stroke: "var(--ok)", labelFill: "var(--ok)" },
  failure: { stroke: "var(--err)", labelFill: "var(--err)" },
  exhausted: { stroke: "var(--warn)", labelFill: "var(--warn)", dashed: true },
};

function layout(nodes: CardNode[], edges: Edge[]): CardNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const gn = g.node(n.id);
    return { ...n, position: { x: gn.x - NODE_W / 2, y: gn.y - NODE_H / 2 } };
  });
}

export function DialogueGraphMode({ beats, beatEdges }: { beats: Beat[]; beatEdges: BeatEdge[] }) {
  const { nodes, edges } = useMemo(() => {
    const rawEdges: Edge[] = beatEdges.map((e, i) => {
      const style = EDGE_STYLE[e.kind ?? "tree"] ?? EDGE_STYLE.tree;
      return {
        id: `${e.from}->${e.to}#${i}`,
        source: e.from,
        target: e.to,
        label: e.label,
        style: {
          stroke: style.stroke,
          strokeWidth: e.kind === "gate" || e.kind === "success" || e.kind === "failure" ? 2 : 1.5,
          strokeDasharray: style.dashed ? "4 4" : undefined,
        },
        labelStyle: { fill: style.labelFill, fontSize: 10 },
      };
    });
    const rawNodes: CardNode[] = beats.map((beat) => ({
      id: beat.id,
      type: "card" as const,
      position: { x: 0, y: 0 },
      data: { beat },
      draggable: true,
      selectable: true,
    }));
    return { nodes: layout(rawNodes, rawEdges), edges: rawEdges };
  }, [beats, beatEdges]);

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
        <Background color="var(--border-hi)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
