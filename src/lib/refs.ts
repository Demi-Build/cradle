export const REF_FIELDS: Record<string, string> = {
  giver_npc_id: "npcs",
  escort_npc_id: "npcs",
  quest_id: "quests",
  prerequisite_quest_id: "quests",
  quest_ids: "quests",
  room_id: "rooms",
  destination_room: "rooms",
  item_id: "items",
  monster_ids: "monsters",
  gate_encounter_id: "events",
};

export type RefValue =
  | { kind: "one"; typeId: string; id: string }
  | { kind: "many"; typeId: string; ids: string[] };

export function refFromField(key: string, value: unknown): RefValue | null {
  const typeId = REF_FIELDS[key];
  if (!typeId) return null;
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const ids = value
      .map((v) => (typeof v === "number" || typeof v === "string" ? String(v) : null))
      .filter((v): v is string => v !== null);
    if (!ids.length) return null;
    return { kind: "many", typeId, ids };
  }
  if (typeof value === "number" || typeof value === "string") {
    return { kind: "one", typeId, id: String(value) };
  }
  return null;
}
