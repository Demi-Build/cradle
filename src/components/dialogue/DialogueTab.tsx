import { useEffect, useMemo, useState } from "react";
import { DialogueCardMode } from "./DialogueCardMode";
import { DialogueGraphMode } from "./DialogueGraphMode";
import { buildDialogue, type DialogueTree, type NpcLike, type QuestLike } from "./types";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";
import type { BeatEdit } from "./DialogueCard";

type TreeKey =
  | "dialogue_tree"
  | "dialogue_tree_complete"
  | "dialogue_tree_failed"
  | "dialogue_tree_incomplete";

const LANE_TO_TREE: Record<string, TreeKey> = {
  tree: "dialogue_tree",
  complete: "dialogue_tree_complete",
  failed: "dialogue_tree_failed",
  incomplete: "dialogue_tree_incomplete",
};

// Beat IDs are either "<lane>:<nodeId>" for tree beats or a single token for
// special beats (greeting, exhausted, quest-gate, success, failure).
function parseBeatId(beatId: string): { kind: "scalar"; field: keyof NpcLike } | { kind: "tree"; tree: TreeKey; nodeId: string } | null {
  if (beatId === "greeting") return { kind: "scalar", field: "opening_greeting" };
  if (beatId === "exhausted") return { kind: "scalar", field: "exhausted_dialogue" };
  const sep = beatId.indexOf(":");
  if (sep <= 0) return null;
  const lane = beatId.slice(0, sep);
  const nodeId = beatId.slice(sep + 1);
  const tree = LANE_TO_TREE[lane];
  return tree ? { kind: "tree", tree, nodeId } : null;
}

function applyEdit(npc: NpcLike, beatId: string, change: BeatEdit): NpcLike {
  const target = parseBeatId(beatId);
  if (!target) return npc;
  if (target.kind === "scalar") {
    if (change.kind !== "prompt") return npc;
    return { ...npc, [target.field]: change.value } as NpcLike;
  }
  const tree = npc[target.tree] as DialogueTree | undefined;
  const node = tree?.nodes?.[target.nodeId];
  if (!tree || !node) return npc;
  if (change.kind === "prompt") {
    return {
      ...npc,
      [target.tree]: {
        ...tree,
        nodes: { ...tree.nodes, [target.nodeId]: { ...node, prompt: change.value } },
      },
    } as NpcLike;
  }
  const choices = node.choices ?? [];
  if (change.choiceIdx < 0 || change.choiceIdx >= choices.length) return npc;
  const nextChoices = choices.map((c, i) =>
    i === change.choiceIdx ? { ...c, text: change.value } : c,
  );
  return {
    ...npc,
    [target.tree]: {
      ...tree,
      nodes: { ...tree.nodes, [target.nodeId]: { ...node, choices: nextChoices } },
    },
  } as NpcLike;
}

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

  const onEdit = editMode && typeId && entityId
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
