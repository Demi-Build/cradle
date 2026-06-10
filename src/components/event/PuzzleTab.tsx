import { useState } from "react";
import { PuzzleCardMode } from "./PuzzleCardMode";
import { PuzzleGraphMode } from "./PuzzleGraphMode";
import type { PuzzleEvent } from "./types";
import type { ChoiceEdit } from "./ChoiceCard";
import { useStore } from "../../store";

export function PuzzleTab({
  event,
  editMode = false,
  typeId,
  entityId,
}: {
  event: PuzzleEvent;
  editMode?: boolean;
  typeId?: string;
  entityId?: string;
}) {
  const setEntityDraft = useStore((s) => s.setEntityDraft);
  const [mode, setMode] = useState<"card" | "graph">("card");
  const choices = event.choices ?? [];

  // Force card mode while editing — graph mode is read-only.
  const effectiveMode = editMode ? "card" : mode;

  const onChoiceEdit =
    editMode && typeId && entityId
      ? (index: number, change: ChoiceEdit) => {
          const next = (event.choices ?? []).map((c, i) =>
            i === index ? { ...c, [change.kind]: change.value } : c,
          );
          setEntityDraft(typeId, entityId, { ...event, choices: next });
        }
      : undefined;

  return (
    <div className="dialogue-tab">
      <div className="dialogue-toolbar">
        <div className="segmented">
          <button
            className={`seg-btn ${effectiveMode === "card" ? "active" : ""}`}
            onClick={() => setMode("card")}
          >
            Card
          </button>
          <button
            className={`seg-btn ${effectiveMode === "graph" ? "active" : ""}`}
            onClick={() => setMode("graph")}
            disabled={editMode}
            title={editMode ? "Graph view is read-only — exit edit mode to use it." : undefined}
          >
            Graph
          </button>
        </div>
        <span className="dialogue-meta">{choices.length} choices</span>
      </div>
      <div className="dialogue-body">
        {effectiveMode === "card" ? (
          <PuzzleCardMode event={event} editMode={editMode} onChoiceEdit={onChoiceEdit} />
        ) : (
          <PuzzleGraphMode event={event} />
        )}
      </div>
    </div>
  );
}
