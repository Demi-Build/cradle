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
import { correctMatch, formatCheck, type PuzzleChoice, type PuzzleEvent } from "./types";

type PromptData = { text: string };
type ChoiceData = { choice: PuzzleChoice; index: number; isCorrect: boolean };
type OutcomeData = { kind: "success" | "failure"; text: string };

type AnyNode =
  | Node<PromptData, "prompt">
  | Node<ChoiceData, "choice">
  | Node<OutcomeData, "outcome">;

function PromptNode({ data }: NodeProps<Node<PromptData, "prompt">>) {
  return (
    <>
      <div className="pz-node pz-prompt">
        <div className="pz-label">prompt</div>
        <div className="pz-body">{data.text}</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

function ChoiceNode({ data }: NodeProps<Node<ChoiceData, "choice">>) {
  const check = formatCheck(data.choice);
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className={`pz-node pz-choice ${data.isCorrect ? "correct" : ""}`}>
        <div className="pz-choice-header">
          <span>#{data.index + 1}</span>
          <span className="pz-check">{check}</span>
          {data.isCorrect && <span className="cc-badge cc-badge-correct">correct</span>}
        </div>
        <div className="pz-body">{data.choice.text}</div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

function OutcomeNode({ data }: NodeProps<Node<OutcomeData, "outcome">>) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className={`pz-node pz-outcome ${data.kind}`}>
        <div className="pz-label">{data.kind}</div>
        <div className="pz-body">{data.text}</div>
      </div>
    </>
  );
}

const nodeTypes = { prompt: PromptNode, choice: ChoiceNode, outcome: OutcomeNode };

const W = 260;
const H_PROMPT = 140;
const H_CHOICE = 120;
const H_OUTCOME = 100;

function heightFor(n: AnyNode): number {
  if (n.type === "prompt") return H_PROMPT;
  if (n.type === "outcome") return H_OUTCOME;
  return H_CHOICE;
}

function layout(nodes: AnyNode[], edges: Edge[]): AnyNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: W, height: heightFor(n) });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const gn = g.node(n.id);
    return { ...n, position: { x: gn.x - W / 2, y: gn.y - heightFor(n) / 2 } } as AnyNode;
  });
}

export function PuzzleGraphMode({ event }: { event: PuzzleEvent }) {
  const { nodes, edges } = useMemo(() => {
    const ns: AnyNode[] = [];
    const es: Edge[] = [];
    ns.push({
      id: "prompt",
      type: "prompt",
      position: { x: 0, y: 0 },
      data: { text: event.description ?? "" },
    });
    const choices = event.choices ?? [];
    const failRange = event.failure_damage_range;
    const failType = event.failure_damage_type;
    choices.forEach((c, i) => {
      const cid = `c${i}`;
      const isCorrect = correctMatch(c, event) !== null;
      ns.push({
        id: cid,
        type: "choice",
        position: { x: 0, y: 0 },
        data: { choice: c, index: i, isCorrect },
      });
      es.push({
        id: `prompt->${cid}`,
        source: "prompt",
        target: cid,
        style: { stroke: "#555", strokeWidth: 1.5 },
      });
      const sid = `${cid}-s`;
      ns.push({
        id: sid,
        type: "outcome",
        position: { x: 0, y: 0 },
        data: { kind: "success", text: c.success_text ?? "(no text)" },
      });
      es.push({
        id: `${cid}->${sid}`,
        source: cid,
        target: sid,
        label: c.auto_success ? "auto" : "success",
        style: { stroke: "var(--ok)", strokeWidth: 1.5 },
        labelStyle: { fill: "var(--ok)", fontSize: 10 },
      });
      if (!c.auto_success && failRange) {
        const fid = `${cid}-f`;
        ns.push({
          id: fid,
          type: "outcome",
          position: { x: 0, y: 0 },
          data: {
            kind: "failure",
            text: `${failType ?? "damage"} ${failRange[0]}–${failRange[1]}`,
          },
        });
        es.push({
          id: `${cid}->${fid}`,
          source: cid,
          target: fid,
          label: "failure",
          style: { stroke: "var(--err)", strokeWidth: 1.5 },
          labelStyle: { fill: "var(--err)", fontSize: 10 },
        });
      }
    });
    return { nodes: layout(ns, es), edges: es };
  }, [event]);

  return (
    <div className="puzzle-graph-mode">
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
