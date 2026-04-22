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

// Some fields store an integer that needs to be prefixed with the entity type's
// naming convention (e.g. destination_room = 1 → room id "room_1").
const NORMALIZE_ID: Record<string, (s: string) => string> = {
  rooms: (s) => (/^\d+$/.test(s) ? `room_${s}` : s),
};

function normalize(typeId: string, raw: string | number): string {
  const s = String(raw);
  const fn = NORMALIZE_ID[typeId];
  return fn ? fn(s) : s;
}

export type RefValue =
  | { kind: "one"; typeId: string; id: string }
  | { kind: "many"; typeId: string; ids: string[] };

export function refFromField(key: string, value: unknown): RefValue | null {
  const typeId = REF_FIELDS[key];
  if (!typeId) return null;
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const ids = value
      .map((v) => (typeof v === "number" || typeof v === "string" ? normalize(typeId, v) : null))
      .filter((v): v is string => v !== null);
    if (!ids.length) return null;
    return { kind: "many", typeId, ids };
  }
  if (typeof value === "number" || typeof value === "string") {
    return { kind: "one", typeId, id: normalize(typeId, value) };
  }
  return null;
}
