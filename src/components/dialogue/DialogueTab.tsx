import { useEffect, useMemo, useState } from "react";
import { DialogueCardMode } from "./DialogueCardMode";
import { DialogueGraphMode } from "./DialogueGraphMode";
import { buildDialogue, type NpcLike, type QuestLike } from "./types";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";
import type { BeatEdit } from "./DialogueCard";
import { applyEdit } from "./applyEdit";

export function DialogueTab({
  npc,
  editMode = false,
  typeId,
  entityId,
}: {
  npc: NpcLike;
  editMode?: boolean;
  typeId?: string;
  entityId?: string;
}) {
  const worldPath = useStore((s) => s.worldPath);
  const setEntityDraft = useStore((s) => s.setEntityDraft);
  const [mode, setMode] = useState<"card" | "graph">("card");
  const [quest, setQuest] = useState<QuestLike | null>(null);

  // Force card mode while editing — graph mode is read-only.
  const effectiveMode = editMode ? "card" : mode;

  useEffect(() => {
    setQuest(null);
    if (!npc.quest_id || !worldPath) return;
    let cancelled = false;
    api
      .getEntity(worldPath, "quests", String(npc.quest_id))
      .then((q) => {
        if (!cancelled) setQuest(q as QuestLike);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [npc.quest_id, worldPath]);

  const { beats, edges } = useMemo(() => buildDialogue(npc, quest), [npc, quest]);

  const onEdit =
    editMode && typeId && entityId
      ? (beatId: string, change: BeatEdit) => {
          setEntityDraft(typeId, entityId, applyEdit(npc, beatId, change));
        }
      : undefined;

  if (beats.length === 0) {
    return <div className="dialogue-empty">No dialogue content.</div>;
  }

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
        <span className="dialogue-meta">
          {beats.length} beats · {edges.length} edges
        </span>
      </div>
      <div className="dialogue-body">
        {effectiveMode === "card" ? (
          <DialogueCardMode beats={beats} edges={edges} editMode={editMode} onEdit={onEdit} />
        ) : (
          <DialogueGraphMode beats={beats} beatEdges={edges} />
        )}
      </div>
    </div>
  );
}
