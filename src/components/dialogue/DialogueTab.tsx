// The NPC's Dialogue tab — now the MODE HOST (PLAN "What exists today":
// `DialogueTab` is *Extended — becomes the mode host*).
//
// What it kept: the quest fetch, which `buildDialogue` needs to draw the gate
// and the outcome one-liners. What moved: the Card/Graph segmented control and
// the beat/edge counter now live in `ModeBar`, inside View mode, because Card
// and Graph are two readers of ONE mode rather than two modes.
//
// The empty check moved too. `buildDialogue` returning nothing used to mean
// "No dialogue content."; the surface now decides, because an NPC with no tree
// is a legal, authorable state (screen 06) and not an absence.

import { useEffect, useState } from "react";
import { DialogueSurface } from "./DialogueSurface";
import type { QuestLike } from "./types";
import type { NpcRow } from "./model";
import { api } from "../../lib/invoke";
import { useStore } from "../../store";

export function DialogueTab({
  npc,
  npcId,
  onOpenScene,
  onOpenQuest,
}: {
  npc: NpcRow;
  npcId?: string;
  /** Cross-surface entry — the rail deep-links to the scene and quest scopes. */
  onOpenScene?: (sceneId: string) => void;
  onOpenQuest?: (questId: string) => void;
}) {
  const worldPath = useStore((s) => s.worldPath);
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

  return (
    <DialogueSurface
      npc={npc}
      npcId={String(npcId ?? npc.id ?? "")}
      quest={quest}
      onOpenScene={onOpenScene}
      onOpenQuest={onOpenQuest}
    />
  );
}
