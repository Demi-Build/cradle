// A dungeon room bundle in the P.6.3a shape (`canon grid export`) and the
// `canon pack info` document a dungeon pack answers with — the fixtures the
// read-only room view tests (row P0-5) render from. Kept small on purpose:
// a 6×5 maze with one NPC, one event and one item, spawn and door.

import type { LevelBundle } from "../../components/level/drawLevel";
import type { PackInfo, WorldSummary } from "../../lib/invoke";

const GRID = [
  [1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 1],
  [1, 0, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1],
];

const SLOTS = [
  {
    index: 0,
    tile_type: 0,
    name: "empty",
    px_region: [0, 0, 20, 20],
    collision: "empty",
    params: {},
  },
  {
    index: 1,
    tile_type: 1,
    name: "wall",
    px_region: [0, 0, 20, 20],
    collision: "solid",
    params: {},
  },
] as LevelBundle["tileset"]["slots"];

export function roomBundle(overrides: Partial<LevelBundle> = {}): LevelBundle {
  return {
    level_id: "room_0",
    stage_id: "",
    display_name: "The Whispering Wood",
    revision: "sha256:abc",
    revision_short: "abc",
    last_change: null,
    grid_width: 6,
    grid_height: 5,
    spawn: [1, 1],
    exit: [4, 3],
    layout_fallback: false,
    parent_level: null,
    brief: null,
    variants: [],
    tile_px: 20,
    actor_scale: 1,
    water_alpha: 1,
    grids: {
      collision: GRID.map((r) => [...r]),
      terrain: GRID.map((r) => [...r]),
      background: GRID.map((r) => r.map(() => 0)),
    },
    tileset: {
      slots: SLOTS,
      palette: { background: "--bg-sunken", wall: "#225022" },
      render_filter: "nearest",
      tilesheet_path_abs: null,
    },
    tiles_by_type: Object.fromEntries(SLOTS.map((s) => [String(s.tile_type), s])),
    entities: [
      {
        enemy_id: "1000",
        x: 1,
        y: 3,
        variant: null,
        name: "Mira",
        archetype: "RandomNPC",
        size: 1,
        placeholder_color: "#3c823c",
        sprite_path_abs: null,
      },
    ],
    items: [
      {
        item_id: "2000",
        x: 3,
        y: 2,
        source: null,
        name: "ration cube",
        kind: "food",
        placeholder_color: "#ffd700",
        sprite_path_abs: null,
      },
    ],
    triggers: [
      {
        x: 2,
        y: 1,
        type: "combat",
        params: { event_id: 3000, is_gate: true, is_climax_boss: false, monster_ids: [5000] },
      },
    ],
    hazards: [],
    foreground: [],
    props: {},
    backdrop: null,
    music_path: "",
    music_sections: [],
    warnings: [],
    room: {
      environment: "forest",
      environment_name: "The Whispering Wood",
      door_revealed: false,
      gate_encounter_id: 3000,
      quest_ids: [4000],
      monsters: [{ entity_type: "monster", entity_id: "5000", name: "Wolf" }],
    },
    ...overrides,
  };
}

/** `canon pack info` for a dungeon pack — the placements block in registry
 *  order (P0 paper P.3.2: npc, event, item) with the entity labels. */
export const DUNGEON_PACK_INFO: PackInfo = {
  pack_type: "dungeon",
  label: "Dungeon crawler",
  capabilities: ["grid", "dialogue", "per_step_roll"],
  entities: {
    npc: { label: "NPCs", id_field: "id", placeable: true },
    monster: { label: "Monsters", id_field: "id", placeable: false },
    item: { label: "Items", id_field: "id", placeable: true },
    quest: { label: "Quests", id_field: "id", placeable: false },
    event: { label: "Events", id_field: "id", placeable: true },
    room: { label: "Rooms", id_field: "id", placeable: false },
  },
  grids: {
    room: {
      placements: {
        npc_positions: { kind: "npc", wire: "entities" },
        event_positions: { kind: "event", wire: "triggers" },
        item_placements: { kind: "item", wire: "items" },
      },
      points: ["player_start", "door_position"],
      dims: { width_field: "width", height_field: "height", default: [40, 30] },
    },
  },
};

export function dungeonWorld(): WorldSummary {
  return {
    path: "/w",
    name: "mazeworld",
    world_kind: "dungeon",
    entity_counts: [
      { type_id: "npcs", count: 1 },
      { type_id: "rooms", count: 1 },
    ],
    pack_info: DUNGEON_PACK_INFO,
  };
}
