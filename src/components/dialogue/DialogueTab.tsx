import { useState } from "react";
import { DialogueCardMode } from "./DialogueCardMode";
import { DialogueGraphMode } from "./DialogueGraphMode";
import type { DialogueTree } from "./types";

export function DialogueTab({ tree }: { tree: DialogueTree }) {
  const [mode, setMode] = useState<"card" | "graph">("card");
  const nodeCount = Object.keys(tree.nodes ?? {}).length;

  if (nodeCount === 0) {
    return <div className="dialogue-empty">No dialogue tree.</div>;
  }

  return (
    <div className="dialogue-tab">
      <div className="dialogue-toolbar">
        <div className="segmented">
          <button
            className={`seg-btn ${mode === "card" ? "active" : ""}`}
            onClick={() => setMode("card")}
          >
            Card
          </button>
          <button
            className={`seg-btn ${mode === "graph" ? "active" : ""}`}
            onClick={() => setMode("graph")}
          >
            Graph
          </button>
        </div>
        <span className="dialogue-meta">{nodeCount} nodes</span>
      </div>
      <div className="dialogue-body">
        {mode === "card" ? <DialogueCardMode tree={tree} /> : <DialogueGraphMode tree={tree} />}
      </div>
    </div>
  );
}
