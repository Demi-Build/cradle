import { useState } from "react";
import { PuzzleCardMode } from "./PuzzleCardMode";
import { PuzzleGraphMode } from "./PuzzleGraphMode";
import type { PuzzleEvent } from "./types";

export function PuzzleTab({ event }: { event: PuzzleEvent }) {
  const [mode, setMode] = useState<"card" | "graph">("card");
  const choices = event.choices ?? [];

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
        <span className="dialogue-meta">{choices.length} choices</span>
      </div>
      <div className="dialogue-body">
        {mode === "card" ? <PuzzleCardMode event={event} /> : <PuzzleGraphMode event={event} />}
      </div>
    </div>
  );
}
