// The repo's REAL dungeon fixture rows, read straight off disk.
//
// `bibles/mazeworld_scifi/` is the pack cradle ships as its demo world, and
// NPC 1023 (Whisper-Tam) is the character the dialogue design package quotes
// verbatim. Loading the actual file rather than a hand-written stub is the
// point: step 1's byte-identity proof is only worth anything against the data
// the app really renders — 79 NPCs, 33 of them four-variant quest NPCs.
//
// Loaded with Vite's `?raw` (declared by `vite/client`, already referenced in
// `src/vite-env.d.ts`) and parsed here, rather than a JSON import: a literal
// import would type the whole 79-row document and drag it through tsc on every
// build for a test-only fixture.

import npcsRaw from "../../../bibles/mazeworld_scifi/npcs/npcs.json?raw";
import questsRaw from "../../../bibles/mazeworld_scifi/quests/quests.json?raw";
import type { NpcRow } from "../../components/dialogue/model";
import type { QuestLike } from "../../components/dialogue/types";

/** All 79 NPC rows of the shipped mazeworld_scifi bible. */
export const MAZEWORLD_NPCS: NpcRow[] = JSON.parse(npcsRaw) as NpcRow[];

/** The quest rows, keyed by id — `buildDialogue` needs the NPC's quest to draw
 *  the gate and the outcome one-liners. */
export const MAZEWORLD_QUESTS: Record<string, QuestLike> = Object.fromEntries(
  (JSON.parse(questsRaw) as QuestLike[]).map((q) => [String(q.id), q]),
);

export function npcById(id: string | number): NpcRow {
  const row = MAZEWORLD_NPCS.find((n) => String(n.id) === String(id));
  if (!row) throw new Error(`no NPC ${id} in the mazeworld_scifi fixture`);
  return row;
}

export function questFor(npc: NpcRow): QuestLike | null {
  return npc.quest_id === null || npc.quest_id === undefined
    ? null
    : (MAZEWORLD_QUESTS[String(npc.quest_id)] ?? null);
}

/** NPC 1023 — the design package's own worked example: no quest, one tree. */
export const WHISPER_TAM = npcById(1023);

/** NPC 1001 — a four-variant quest NPC (quest 4000): default + incomplete +
 *  complete + failed, which is the shape the selector model replaces. */
export const FOUR_VARIANT_NPC = npcById(1001);
