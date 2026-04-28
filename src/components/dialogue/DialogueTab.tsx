import { useEffect, useMemo, useState } from "react";
import { DialogueCardMode } from "./DialogueCardMode";
import { DialogueGraphMode } from "./DialogueGraphMode";
import { buildDialogue, type NpcLike, type QuestLike } from "./types";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";

export function DialogueTab({ npc }: { npc: NpcLike }) {
  const worldPath = useStore((s) => s.worldPath);
  const [mode, setMode] = useState<"card" | "graph">("card");
  const [quest, setQuest] = useState<QuestLike | null>(null);

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

  if (beats.length === 0) {
    return <div className="dialogue-empty">No dialogue content.</div>;
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
        <span className="dialogue-meta">
          {beats.length} beats · {edges.length} edges
        </span>
      </div>
      <div className="dialogue-body">
        {mode === "card" ? (
          <DialogueCardMode beats={beats} edges={edges} />
        ) : (
          <DialogueGraphMode beats={beats} beatEdges={edges} />
        )}
      </div>
    </div>
  );
}
