import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { DialogueCard, type EditableProps } from "./DialogueCard";
import { EditableNode, type EditGraphProps } from "./EditableNode";
import type { Beat, BeatEdge } from "./types";

/** Edit-mode wiring. Present only in Edit mode; View mode passes nothing and
 *  the graph renders exactly as it did before row P0-9 (board 00 is a
 *  reference, not a build target).
 *
 *  The bridge from a beat back to an author node is `Beat.label`, which
 *  `ingestTree` sets to the node id — the one piece of `(tree, node_id)` the
 *  flattening keeps. Edit mode renders ONE tree through the `tree` lane, so it
 *  is unambiguous there; the whole-character View render is never editable. */
export type GraphEdit = EditGraphProps;

type CardData = { beat: Beat; edit?: GraphEdit };

type CardNode = Node<CardData, "card">;

const NODE_W = 280;
const NODE_H = 120;

function CardFlowNode({ data }: NodeProps<CardNode>) {
  const { beat, edit } = data;
  const nodeId = beat.label;
  const editable: EditableProps | undefined = edit
    ? {
        nodeId,
        selected: edit.selected === nodeId,
        onSelect: edit.onSelect,
        onPromptCommit: edit.onPromptCommit,
        onGesture: edit.onGesture,
        dirty: edit.dirtyNodes?.has(nodeId),
      }
    : undefined;
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {edit?.structural ? (
        <EditableNode beat={beat} edit={edit} />
      ) : (
        <DialogueCard beat={beat} mode="compact" editable={editable} />
      )}
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

/** The graph's STRUCTURE — ids and wiring, nothing else.
 *
 *  The layout memo keys on this rather than on the beats, because in Edit mode
 *  a prompt edit changes `beats` on every keystroke and re-running dagre would
 *  jump the canvas out from under the caret. Structure changes → relayout;
 *  prose changes → the same positions, re-rendered. */
function structuralHash(beats: Beat[], edges: BeatEdge[]): string {
  return `${beats.map((b) => b.id).join("|")}##${edges.map((e) => `${e.from}>${e.to}`).join("|")}`;
}

/** `⇧1` — fit to view, on demand. A child of `<ReactFlow>` so it can reach the
 *  instance; bumping `tick` is the whole API, which keeps the caller from
 *  holding a ref it would have to null-check. */
function FitOnTick({ tick }: { tick: number }) {
  const flow = useReactFlow();
  useEffect(() => {
    if (tick > 0) flow.fitView({ duration: 200 });
  }, [flow, tick]);
  return null;
}

export function DialogueGraphMode({
  beats,
  beatEdges,
  edit,
  fitTick = 0,
  dim,
  minimap = false,
}: {
  beats: Beat[];
  beatEdges: BeatEdge[];
  edit?: GraphEdit;
  /** Bump to re-fit the graph (`⇧1`, and automatically on open). */
  fitTick?: number;
  /** Beat ids the `/` search did NOT match — dimmed, never hidden. */
  dim?: Set<string>;
  /** Show the graph minimap. React Flow's own, NOT `level/Minimap` — that one
   *  draws a `LevelBundle` through `drawLevel` and has no meaning for a node
   *  graph; reusing it would mean a second renderer that could disagree with
   *  the canvas. */
  minimap?: boolean;
}) {
  const shape = structuralHash(beats, beatEdges);

  const edges = useMemo(
    () =>
      beatEdges.map((e, i) => {
        const style = EDGE_STYLE[e.kind ?? "tree"] ?? EDGE_STYLE.tree;
        return {
          id: `${e.from}->${e.to}#${i}`,
          source: e.from,
          target: e.to,
          label: e.label,
          style: {
            stroke: style.stroke,
            strokeWidth:
              e.kind === "gate" || e.kind === "success" || e.kind === "failure" ? 2 : 1.5,
            strokeDasharray: style.dashed ? "4 4" : undefined,
          },
          labelStyle: { fill: style.labelFill, fontSize: 10 },
        } satisfies Edge;
      }),
    [beatEdges],
  );

  // Positions are recomputed ONLY when the structure changes. Not a `useMemo`
  // on `beats`: in Edit mode a prompt edit changes `beats` on every keystroke,
  // and re-running dagre would jump the canvas out from under the caret. The
  // cache is keyed on the structural hash and holds the last layout.
  const layoutCache = useRef<{ shape: string; nodes: CardNode[] } | null>(null);
  if (!layoutCache.current || layoutCache.current.shape !== shape) {
    layoutCache.current = {
      shape,
      nodes: layout(
        beats.map((beat) => ({
          id: beat.id,
          type: "card" as const,
          position: { x: 0, y: 0 },
          data: { beat },
          draggable: true,
          selectable: true,
        })),
        edges,
      ),
    };
  }
  const positioned = layoutCache.current.nodes;

  // The rendered nodes carry the CURRENT beat and edit wiring at the positions
  // the structural layout fixed.
  const nodes = useMemo(() => {
    const byId = new Map(beats.map((b) => [b.id, b]));
    return positioned.map((n) => {
      const beat = byId.get(n.id) ?? n.data.beat;
      const classes = [
        edit?.unreachable?.has(beat.label) ? "dlg-unreachable" : "",
        dim?.has(n.id) ? "dlg-dimmed" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return { ...n, data: { beat, edit }, className: classes || undefined };
    });
  }, [beats, dim, edit, positioned]);

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
        {minimap ? <MiniMap pannable zoomable className="dlg-minimap" /> : null}
        <FitOnTick tick={fitTick} />
      </ReactFlow>
    </div>
  );
}
