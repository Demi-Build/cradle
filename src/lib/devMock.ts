// Dev-only Tauri shim. When VITE_CRADLE_MOCK is set, stands in for the Rust
// backend so the real cradle UI can run in a plain browser against real data
// (built by scratchpad/build_mockdata.py from an actual platformer pack). NOT
// bundled in production — main.tsx only imports this behind the env flag.

import { USER_ACTOR, agentActor, isAgentActor, parseActor } from "./actor";
import { DB_NESTING } from "./dbNesting";
import { handleJobEvent, handleJobProgress } from "./jobs";
import type { JournalEvent, WorldMap } from "./invoke";
import { summarizeJournal } from "./cost";
import { setAgentTransport } from "./agent";
import { cancelledJobs, installAgentMock, onMockServiceState, scriptedAgent } from "./agentMock";
import { useStore } from "../store";
import {
  dialogueImprove as mockDialogueImprove,
  dialogueSelect as mockDialogueSelect,
  dialogueShow as mockDialogueShow,
  dialogueTest as mockDialogueTest,
  dialogueUpdate as mockDialogueUpdate,
  dialogueValidate as mockDialogueValidate,
  mockNpcRefs,
  mockNpcRow,
  mockSceneRefs,
  mockSceneRow,
  resetDialogueMock,
  sceneTest as mockSceneTest,
  sceneUpdate as mockSceneUpdate,
  sceneValidate as mockSceneValidate,
} from "./dialogueMock";

type Ref = { type_id: string; id: string; name: string };
type JsonMap = Record<string, unknown>;

type MockData = {
  name: string;
  entity_counts: { type_id: string; count: number }[];
  levels: Ref[];
  enemies: Ref[];
  items?: Ref[];
  tilesets?: Ref[];
  backdrops?: Ref[];
  audio?: Ref[];
  levelJson: JsonMap;
  enemyJson: JsonMap;
  itemJson?: JsonMap;
  tilesetJson?: JsonMap;
  backdropJson?: JsonMap;
  audioJson?: JsonMap;
  bundles: Record<string, unknown>;
  dbTypes?: Record<string, unknown>;
  dbSchemas?: Record<string, unknown>;
};

// Fallback roll-table schemas so the schema editor demos without a rebuilt
// mockdata.json (native serves the real files via `canon db schema`).
const FALLBACK_SCHEMAS: Record<string, unknown> = {
  enemy: {
    schema_version: "8",
    entity_type: "enemy",
    fields: {
      archetype: {
        choices: [
          ["patroller", 5],
          ["sentry", 1],
          ["swimmer", 3],
          ["flyer", 2],
          ["hopper", 4],
        ],
      },
      rarity: {
        choices: [
          ["common", 3],
          ["uncommon", 2],
          ["rare", 1],
        ],
      },
      size: {
        choices: [
          [1.0, 4],
          [1.5, 2],
          [2.0, 1],
        ],
      },
      hp: {
        lookup: [
          [1.0, [4, 6]],
          [1.5, [7, 12]],
          [2.0, [13, 18]],
        ],
        depends_on: "size",
        lookup_ranges: true,
      },
      speed: {
        lookup: [
          ["patroller", 2],
          ["sentry", 0],
          ["swimmer", 2],
          ["flyer", 2],
          ["hopper", 4],
        ],
        depends_on: "archetype",
      },
      patrol_range: { range: [3, 8] },
    },
  },
  item: {
    schema_version: "3",
    entity_type: "item",
    fields: {
      kind: {
        choices: [
          ["coin", 6],
          ["heal", 3],
          ["shield", 1],
          ["double_jump", 1],
          ["run_boost", 1],
        ],
      },
      rarity: {
        choices: [
          ["common", 3],
          ["uncommon", 2],
          ["rare", 1],
        ],
      },
      coin_value: {
        lookup: [
          ["coin", 1],
          ["heal", 0],
          ["shield", 0],
          ["double_jump", 0],
          ["run_boost", 0],
        ],
        depends_on: "kind",
      },
    },
  },
};

// typeId → [refs field, entity-json field]
const TYPE_KEYS: Record<string, [keyof MockData, keyof MockData]> = {
  levels: ["levels", "levelJson"],
  enemies: ["enemies", "enemyJson"],
  items: ["items", "itemJson"],
  tilesets: ["tilesets", "tilesetJson"],
  backdrops: ["backdrops", "backdropJson"],
  audio: ["audio", "audioJson"],
};

let dataReady: Promise<MockData> | null = null;
function ensureData(): Promise<MockData> {
  if (!dataReady) dataReady = fetch("/__mockdata__/mockdata.json").then((r) => r.json());
  return dataReady;
}

function refsFor(d: MockData, typeId: string): Ref[] {
  const keys = TYPE_KEYS[typeId];
  return keys ? ((d[keys[0]] as Ref[] | undefined) ?? []) : [];
}

function jsonFor(d: MockData, typeId: string): JsonMap {
  const keys = TYPE_KEYS[typeId];
  return keys ? ((d[keys[1]] as JsonMap | undefined) ?? {}) : {};
}

// `canon pack templates` (P0 paper P.4.4, row P0-10) — the two installed
// templates' wizard metadata, copied from canon's seeds so the create wizard
// renders in the browser exactly what it renders natively (I7). The phase
// label maps are the §3.0-E ones; the mock's pipelines emit these ids.
const MOCK_TEMPLATES = [
  {
    id: "platformer",
    label: "Platformer",
    description: "Side-scrolling stages of levels, wired into a world map.",
    vocab: ["stages", "levels", "paths"],
    defaults: { stages: 1, levels: 2, enemies: 4, items: 4 },
    ranges: { stages: [1, 8], levels: [1, 12], enemies: [0, 24], items: [0, 24] },
    advanced: [] as string[],
    engine: ["godot"],
    dimension: "2D",
    distribution: ["computer", "mobile", "web"],
    beta: false,
    phase_labels: {
      "plat:world": "World premise",
      "plat:stage": "Stages",
      "plat:style": "Art direction",
      "plat:enemies": "Enemy roster",
      "plat:items": "Item pool",
      "plat:tileset": "Tile slots",
      "plat:layout": "Level layouts",
      "plat:terrain": "Terrain",
      "plat:background": "Backgrounds",
      "plat:placement": "Placing enemies",
      "plat:item_placement": "Placing items",
      "plat:decorator": "Decoration",
      "plat:tileset_art": "Tileset art",
      "plat:sprite_art": "Sprite art",
      "plat:sprite_animation": "Animation",
      "plat:backdrop_art": "Backdrops",
      "plat:world_art": "Title art",
      "plat:audio": "Music & SFX",
      "plat:render": "Review renders",
      "plat:vlm_qa": "Quality pass",
      "plat:manifest": "Manifest",
      "plat:level_steps": "Level steps",
      // The orchestrator's per-artifact families: the reader tries the whole
      // id, then `<family>:<leaf>`, then `<family>` (see `phaseLabel`).
      level: "Level",
      "level:collision": "Collision",
      "level:terrain": "Terrain",
      "level:background": "Background",
      "level:foreground": "Foreground",
      "level:hazards": "Hazards",
      "level:triggers": "Triggers",
      "level:entities": "Placing enemies",
      "level:items": "Placing items",
      "level:level": "Level assembly",
      review: "Review",
      "review:legend": "Legend review",
    },
    generators: ["llm", "image", "music", "sfx", "vlm"],
    count_scope: { enemies: "total", items: "total" },
  },
  {
    id: "dungeon",
    label: "Dungeon crawler",
    description: "Rooms of encounters, NPCs and loot tables.",
    vocab: ["rooms", "encounters", "loot"],
    defaults: { rooms: 3, npc: 2, item: 3, monster: 2, event: 4, quest: 2, class: 4 },
    ranges: {
      rooms: [1, 24],
      npc: [0, 8],
      monster: [0, 8],
      item: [0, 8],
      event: [0, 8],
      quest: [0, 8],
      class: [1, 4],
    },
    advanced: ["event", "quest", "class"],
    engine: ["pygame"],
    dimension: "2D",
    distribution: [] as string[],
    beta: false,
    phase_labels: {
      story: "Story & world",
      classes: "Player classes",
      maze_layout: "Room layouts",
      "db:item": "Items",
      "db:monster": "Monsters",
      "db:npc": "NPCs",
      "db:event": "Encounters",
      "db:quest": "Quests",
      mazeworld_dialogue: "Dialogue",
      spell_pool: "Spells & abilities",
      assets: "Portraits & audio",
      narrative: "Narrative",
      mazeworld_placement: "Placing entities",
      validation: "Validation",
      manifest: "Manifest",
    },
    // No `vlm` lane: canon's dungeon runner takes no `--vlm-backend`, so the
    // wizard disables Animation for it with the reason (doctrine 4).
    generators: ["llm", "image", "music", "sfx"],
    count_scope: {
      npc: "per_room",
      monster: "per_room",
      item: "per_room",
      quest: "per_room",
      event: "per_room",
      class: "total",
    },
  },
];

// `canon pack info` for the mock's platformer pack (P0 paper P.4.6) — the
// registry grids block is what the level editor reads for its Dock tabs.
const MOCK_PACK_INFO = {
  pack_type: "platformer",
  label: "Platformer",
  // Row P0-9: the mock declares `dialogue` so the vocabulary the pickers and
  // the grammar read comes from `pack info` in the browser exactly as it does
  // natively (I7). The block is canon's `DEFAULT_DIALOGUE_DATA`, verbatim.
  capabilities: ["grid", "dialogue"],
  vocab: ["stages", "levels", "paths"],
  dialogue: {
    storage: {
      on: "npc",
      field: "dialogue_trees",
      legacy_fields: [
        "dialogue_tree",
        "dialogue_tree_incomplete",
        "dialogue_tree_complete",
        "dialogue_tree_failed",
      ],
    },
    condition_namespaces: [
      "has_item",
      "quest",
      "time",
      "player",
      "flag",
      "segment",
      "room",
      "scene",
      "event",
    ],
    scene_only_namespaces: ["actor"],
    effects: ["gives_item", "takes_item", "gives_quest", "advance_quest", "set_flag"],
    scopes: ["tree", "selector", "scene", "effects", "music"],
    operands: {
      has_item: { entity: "item", field: "id" },
      quest: {
        entity: "quest",
        field: "id",
        states: ["not_started", "active", "completed", "failed"],
      },
      time: { windows: ["dawn", "day", "dusk", "night"] },
      player: {
        fields: ["level", "health", "max_health", "stamina", "money", "archetype"],
        ops: ["<", "<=", "==", ">=", ">"],
      },
      flag: { keys: "from set_flag effects", values: ["true", "false"] },
      segment: { values: [] },
      room: { entity: "room", field: "id" },
      scene: {
        entity: "event",
        field: "id",
        filter: { type: "scene" },
        states: ["seen", "unseen"],
      },
      event: { entity: "event", field: "id", states: ["solved", "unsolved"] },
      actor: {
        entity: "npc",
        field: "id",
        restrict_to: "scene.actors",
        states: ["present", "absent"],
      },
    },
    selector_axes: ["quest", "segment", "time", "flag", "room", "scene", "player", "custom"],
    scene: {
      event_type: "scene",
      triggers: ["enter_room", "talk_any_actor", "quest_advance"],
      once: true,
      on_finish: "effects",
    },
  },
  engine_evaluable_namespaces: {
    // What the mock's "engine" claims it evaluates. `time` is deliberately
    // absent so the engine-lag layer has something real to warn about.
    tree: { has_item: true, quest: { states: ["completed", "failed", "not_started"] }, flag: true },
    selector: { quest: { states: ["completed", "failed", "not_started"] } },
    effects: { gives_item: true, takes_item: true, gives_quest: true, advance_quest: true },
  },
  entities: {
    enemy: { label: "Enemies", id_field: "enemy_id", placeable: true },
    item: { label: "Items", id_field: "item_id", placeable: true },
  },
  grids: {
    level: {
      placements: {
        entities: { kind: "enemy", wire: "entities" },
        items: { kind: "item", wire: "items" },
      },
      points: ["spawn", "exit"],
      dims: { width_field: "grid_width", height_field: "grid_height", default: [48, 16] },
    },
  },
  engines: [{ id: "godot", primary: true }],
  template: { id: "platformer", version: null },
  source: "manifest",
};

/** The room bundles the mock has HANDED OUT, so an edit round-trips exactly
 *  the way the native path does (canon writes, cradle re-exports). Row P0-8:
 *  without this a paint or a drag vanished on the next export. */
const mockRooms: Record<string, Record<string, unknown>> = {};

/** A synthetic dungeon ROOM bundle in the P.6.3a shape (`canon grid export`
 *  on a room): a 12×8 maze with walls, one NPC / event / item, spawn and
 *  door — enough for the room view to be exercised headless. */
export function mockRoomBundle(roomId: string): Record<string, unknown> {
  const W = 12;
  const H = 8;
  // 1 = wall, 0 = path; the sidecars below agree with the grid (no warnings).
  const rows = [
    "111111111111",
    "100000100001",
    "101110101101",
    "101000100101",
    "101011111101",
    "100000000001",
    "111111011101",
    "111111111111",
  ];
  const collision = rows.map((r) => r.split("").map((c) => (c === "1" ? 1 : 0)));
  const slots = [
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
  ];
  const bundle = {
    level_id: roomId,
    stage_id: "",
    display_name: "The Whispering Wood",
    revision: "sha256:mock-room",
    revision_short: "mock-room",
    last_change: null,
    grid_width: W,
    grid_height: H,
    spawn: [1, 1],
    exit: [6, 6],
    layout_fallback: false,
    parent_level: null,
    brief: null,
    tile_px: 20,
    actor_scale: 1,
    water_alpha: 1,
    variants: [],
    grids: {
      collision,
      terrain: collision.map((r) => [...r]),
      background: collision.map((r) => r.map(() => 0)),
    },
    tileset: {
      slots,
      palette: { background: "--bg-sunken", wall: "#225022" },
      render_filter: "nearest",
      tilesheet_path_abs: null,
    },
    tiles_by_type: Object.fromEntries(slots.map((s) => [String(s.tile_type), s])),
    entities: [
      {
        enemy_id: "1000",
        x: 9,
        y: 1,
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
        y: 3,
        source: null,
        name: "ration cube",
        kind: "food",
        placeholder_color: "#ffd700",
        sprite_path_abs: null,
      },
    ],
    triggers: [
      {
        x: 5,
        y: 5,
        type: "combat",
        params: { event_id: 3000, is_gate: true, is_climax_boss: false, monster_ids: [5000] },
      },
    ],
    hazards: [],
    foreground: [],
    props: {},
    backdrop: null,
    music_path: "",
    music_path_abs: null,
    music_sections: [],
    stage_music: "",
    stage_music_abs: null,
    warnings: [],
    room: {
      environment: "forest",
      environment_name: "The Whispering Wood",
      door_revealed: false,
      gate_encounter_id: 3000,
      quest_ids: [4000],
      monsters: [
        {
          entity_type: "monster",
          entity_id: "5000",
          name: "Wolf",
          room_id: roomId,
          lore: "",
          tags: [],
        },
      ],
    },
  };
  return bundle;
}

/** The live copy of a mock room — created on first ask, mutated by the write
 *  handlers below (`save_level_edit` / `save_level_grids` / `roll_grid_step`
 *  / `restore_grid_step`), so devMock parity (I7) covers the room path. */
function mockRoom(roomId: string): Record<string, unknown> {
  if (!mockRooms[roomId]) mockRooms[roomId] = mockRoomBundle(roomId);
  return mockRooms[roomId];
}

/** A room write's own `last_change` chip (the room bundle carries the field
 *  itself, where a platformer bundle stamps `_last_change` for the export). */
function stampRoom(room: Record<string, unknown>, label: string, op = "edit"): void {
  room.last_change = {
    op,
    source: "user",
    kind: "",
    actor: USER_ACTOR,
    ts: new Date().toISOString(),
    hash: "",
    label,
  };
}

/** `canon grid apply-edit` on a room (row P0-8): the sparse wire keys land on
 *  the bundle's own lists, and `encounters` does the cross-file thing —
 *  building or joining the combat event on that cell (P.9 G4). */
function mockRoomEdit(roomId: string, edit: Record<string, unknown>): unknown {
  const room = mockRoom(roomId);
  const updated: string[] = [];
  const grid = (room.grids as { collision: number[][] }).collision;
  if (Array.isArray(edit.entities)) {
    const prev = room.entities as Record<string, unknown>[];
    room.entities = (edit.entities as Record<string, unknown>[]).map((e) => ({
      ...(prev.find((p) => p.enemy_id === e.enemy_id) ?? {
        name: e.enemy_id,
        archetype: null,
        size: 1,
        placeholder_color: "#7a8b99",
        sprite_path_abs: null,
        variant: null,
      }),
      ...e,
    }));
    updated.push("entities");
  }
  if (Array.isArray(edit.items)) {
    const prev = room.items as Record<string, unknown>[];
    for (const it of prev) grid[it.y as number][it.x as number] = 0;
    room.items = (edit.items as Record<string, unknown>[]).map((it) => ({
      ...(prev.find((p) => p.item_id === it.item_id) ?? {
        name: it.item_id,
        kind: null,
        placeholder_color: "#ffd700",
        sprite_path_abs: null,
        source: null,
      }),
      ...it,
    }));
    updated.push("items");
  }
  if (Array.isArray(edit.triggers)) {
    const prev = room.triggers as Record<string, unknown>[];
    room.triggers = (edit.triggers as Record<string, unknown>[]).map((t) => {
      const old = prev.find(
        (p) =>
          String((p.params as Record<string, unknown>)?.event_id) ===
          String((t.params as Record<string, unknown>)?.event_id),
      );
      return { ...t, params: { ...(old?.params ?? {}), ...(t.params ?? {}) } };
    });
    updated.push("triggers");
  }
  if (Array.isArray(edit.encounters)) {
    const triggers = room.triggers as Record<string, unknown>[];
    for (const raw of edit.encounters as Record<string, unknown>[]) {
      const at = triggers.find(
        (t) => String((t.params as Record<string, unknown>).event_id) === String(raw.event_id),
      );
      if (at) {
        (at.params as Record<string, unknown>).monster_ids = raw.monster_ids;
        at.x = raw.x;
        at.y = raw.y;
      } else {
        // A new combat event: the id comes from the kind's allocator (base
        // 3000) — the mock takes the next free one the same way.
        const next =
          Math.max(
            2999,
            ...triggers.map((t) => Number((t.params as Record<string, unknown>).event_id) || 0),
          ) + 1;
        triggers.push({
          x: raw.x,
          y: raw.y,
          type: "combat",
          params: {
            event_id: next,
            is_gate: false,
            is_climax_boss: false,
            monster_ids: raw.monster_ids ?? [],
          },
        });
      }
    }
    updated.push("encounters");
  }
  if (edit.spawn) room.spawn = edit.spawn;
  if (edit.exit) room.exit = edit.exit;
  if (edit.spawn || edit.exit) updated.push("markers");
  stampRoom(room, "Saved room edit");
  return { level_id: roomId, room_id: roomId, stage_id: "", updated, warnings: [], events: 1 };
}

// The PLAYER has no row file in any pack — Rust synthesizes one from
// sprite/player/. Mirror that here so nav/buttons are exercisable headless.
// (public/__mockassets__ points at a real pack, so the portrait resolves.)
const MOCK_PLAYER_ROW: JsonMap = {
  player: {
    player_id: "player",
    artifact_id: "player",
    name: "Player",
    kind: "player",
    sprite_path: "sprite/player/base.png",
    animation_states: ["idle", "walk", "jump", "fall", "land", "skid"],
  },
};
const MOCK_PLAYER_REF: Ref[] = [{ type_id: "player", id: "player", name: "Player" }];

/** The mock's scenes are EVENT rows, so the events count has to include them
 *  or the left nav hides the type and the Scene tab is unreachable in the
 *  browser — the one place a contributor without a dungeon pack can exercise
 *  it (I7). Adds an `events` row when the pack has none. */
function withMockCounts(counts: { type_id: string; count: number }[]) {
  const scenes = mockSceneRefs().length;
  if (scenes === 0) return counts;
  const at = counts.findIndex((c) => c.type_id === "events");
  if (at < 0) return [...counts, { type_id: "events", count: scenes }];
  return counts.map((c, i) => (i === at ? { ...c, count: c.count + scenes } : c));
}

/** Row P0-12's provider rows (I7 parity). A COPY of what `canon providers
 *  list` answers — the browser mock stands in for canon, so it carries the
 *  same DATA the native path renders. Adding a provider is still a row in
 *  `canon/providers.py`; this list follows it, exactly as MOCK_TEMPLATES
 *  follows the template seeds. */
const MOCK_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic",
    env_var: "ANTHROPIC_API_KEY",
    aliases: [] as string[],
    unlocks: "LLM generation, VLM animation review, and the agent's Claude models.",
    backends: { llm: ["anthropic"], vlm: ["anthropic"], chat: ["anthropic"] } as Record<
      string,
      string[]
    >,
    docs: "https://console.anthropic.com/settings/keys",
    note: "",
    test: {
      url: "https://api.anthropic.com/v1/models?limit=1",
      header: "x-api-key",
      prefix: "",
      note: "a free, read-only list call: no tokens, no generation",
    },
  },
  {
    id: "fal",
    label: "fal.ai",
    env_var: "FAL_KEY",
    aliases: [] as string[],
    unlocks: "Image generation and animation frames on the nano-banana line.",
    backends: { image: ["fal"] } as Record<string, string[]>,
    docs: "https://fal.ai/dashboard/keys",
    note: "",
    test: null,
  },
  {
    id: "lyria",
    label: "Google (Lyria music)",
    env_var: "GOOGLE_API_KEY",
    aliases: [] as string[],
    unlocks: "Music generation through Lyria on the Gemini API.",
    backends: { music: ["lyria"] } as Record<string, string[]>,
    docs: "https://aistudio.google.com/apikey",
    note: "Lyria is paid-tier only — a free-tier Gemini key authenticates but cannot generate music.",
    test: {
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      header: "x-goog-api-key",
      prefix: "",
      note: "a free, read-only list call: no tokens, no generation",
    },
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    env_var: "ELEVENLABS_API_KEY",
    aliases: [] as string[],
    unlocks: "Sound-effect generation.",
    backends: { sfx: ["elevenlabs"] } as Record<string, string[]>,
    docs: "https://elevenlabs.io/app/settings/api-keys",
    note: "The free tier does not carry a commercial licence; SFX credits are shared with the rest of the account.",
    test: {
      url: "https://api.elevenlabs.io/v1/user",
      header: "xi-api-key",
      prefix: "",
      note: "reads your own account row: free",
    },
  },
  {
    id: "pixellab",
    label: "PixelLab",
    env_var: "PIXELLAB_SECRET",
    aliases: ["PIXELLAB_API_KEY"],
    unlocks: "Pixel-art sprites and animation through PixelLab.",
    backends: { image: ["pixellab"] } as Record<string, string[]>,
    docs: "https://www.pixellab.ai/",
    note: "PIXELLAB_API_KEY is the dashboard's name for the same token; canon accepts either, PIXELLAB_SECRET first.",
    test: null,
  },
  {
    id: "retro",
    label: "Retro Diffusion",
    env_var: "RD_API_KEY",
    aliases: [] as string[],
    unlocks: "Retro Diffusion pixel-art images and animation clips.",
    backends: { image: ["retro", "retro-diffusion"] } as Record<string, string[]>,
    docs: "https://www.retrodiffusion.ai/",
    note: "",
    test: null,
  },
  {
    id: "meshy",
    label: "Meshy (3D)",
    env_var: "MESHY_API_KEY",
    aliases: [] as string[],
    unlocks: "Image-to-3D meshes, texturing, auto-rigging (the 3D lane arrives with W2.2).",
    backends: { mesh: ["meshy"] } as Record<string, string[]>,
    docs: "https://www.meshy.ai/api",
    note: "Free-tier outputs are CC BY 4.0 — commercial use IS allowed with attribution. A paid tier is required for full ownership / commercial use without attribution.",
    test: null,
  },
  {
    id: "openai",
    label: "OpenAI",
    env_var: "OPENAI_API_KEY",
    aliases: [] as string[],
    unlocks: "The agent's GPT models.",
    backends: { chat: ["openai"] } as Record<string, string[]>,
    docs: "https://platform.openai.com/api-keys",
    note: "",
    test: {
      url: "https://api.openai.com/v1/models",
      header: "Authorization",
      prefix: "Bearer ",
      note: "a free, read-only list call: no tokens, no generation",
    },
  },
  {
    id: "kimi",
    label: "Moonshot (Kimi)",
    env_var: "MOONSHOT_API_KEY",
    aliases: [] as string[],
    unlocks: "The agent's Kimi models.",
    backends: { chat: ["kimi"] } as Record<string, string[]>,
    docs: "https://platform.moonshot.ai/console/api-keys",
    note: "",
    test: {
      url: "https://api.moonshot.ai/v1/models",
      header: "Authorization",
      prefix: "Bearer ",
      note: "a free, read-only list call: no tokens, no generation",
    },
  },
];

/** `{kind: {backend id: env var}}`, derived from the rows exactly as canon
 *  derives it — never a second literal. */
function mockBackendKeyVars(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const row of MOCK_PROVIDERS) {
    for (const [kind, ids] of Object.entries(row.backends)) {
      for (const id of ids) (out[kind] ??= {})[id] = row.env_var;
    }
  }
  return out;
}

/** Which vars the mock reports as SET. Names only — the mock holds no key
 *  value at all, realistic-looking or otherwise. */
const MOCK_PRESENT_KEYS = new Set<string>(["ANTHROPIC_API_KEY", "FAL_KEY", "GOOGLE_API_KEY"]);

/** The relocated project store, when the Environment pane moved it. */
let MOCK_PROJECT_STORE: string | null = null;

function dispatch(cmd: string, args: Record<string, unknown>, d: MockData): unknown {
  switch (cmd) {
    // The dialog plugin rides the same invoke bridge, so the mock has to
    // answer it or every flow behind a file/folder picker (open a world, new
    // project) dead-ends in the browser. Answers with a plausible path rather
    // than a cancel, so the flow CONTINUES and stays testable.
    case "plugin:dialog|open": {
      const opts = (args.options ?? {}) as { directory?: boolean; multiple?: boolean };
      const path = opts.directory ? "/mock/projects" : "mock://plat_pack";
      return opts.multiple ? [path] : path;
    }
    case "load_world":
      return {
        path: String(args.path ?? "mock://pack"),
        name: d.name,
        // The mock's data is a platformer pack; native answers this from
        // `canon pack info` (the pack's registry id, verbatim).
        world_kind: "platformer",
        // …and carries that document whole (row P0-5): the platformer's
        // registry grids, as `canon pack info` reports them.
        pack_info: MOCK_PACK_INFO,
        // Splice the synthesized player in after levels, matching the Rust
        // registry order so the ACTORS group renders contiguously. Row P0-9
        // splices `npcs` in the same way: the mock's data is a platformer pack
        // with no NPC rows, and without a count the dialogue surface is
        // unreachable in the browser — the one place a contributor without a
        // dungeon pack can exercise it (I7).
        entity_counts: withMockCounts(
          d.entity_counts.some((c) => c.type_id === "player")
            ? d.entity_counts
            : [
                ...d.entity_counts.slice(0, 1),
                { type_id: "player", count: 1 },
                { type_id: "npcs", count: mockNpcRefs().length },
                ...d.entity_counts.slice(1),
              ],
        ),
      };
    case "list_entities":
      if (String(args.typeId) === "npcs") return mockNpcRefs();
      // Scenes are EVENTS (P0-9 step 12), so they ride the events list rather
      // than a fourth entity type — one store of truth, three readers.
      if (String(args.typeId) === "events") {
        return [...refsFor(d, "events"), ...mockSceneRefs()];
      }
      return String(args.typeId) === "player" ? MOCK_PLAYER_REF : refsFor(d, String(args.typeId));
    case "list_entity_rows":
      return (
        String(args.typeId) === "player" ? MOCK_PLAYER_REF : refsFor(d, String(args.typeId))
      ).map((r) => ({
        id: r.id,
        data:
          String(args.typeId) === "player"
            ? MOCK_PLAYER_ROW[r.id]
            : (jsonFor(d, String(args.typeId))[r.id] ?? {}),
      }));
    case "get_entity":
      if (String(args.typeId) === "npcs") return mockNpcRow(String(args.id)) ?? {};
      if (String(args.typeId) === "events") {
        const scene = mockSceneRow(String(args.id));
        if (scene) return scene;
      }
      return String(args.typeId) === "player"
        ? (MOCK_PLAYER_ROW[String(args.id)] ?? {})
        : (jsonFor(d, String(args.typeId))[String(args.id)] ?? {});
    case "export_level": {
      // A room id answers with a synthetic room bundle in the P.6.3a shape —
      // the one export serves both grids natively (`canon grid export`), and
      // the mock mirrors that without a second mock world (I7).
      if (String(args.levelId).startsWith("room_")) return mockRoom(String(args.levelId));
      const b = d.bundles[String(args.levelId)] as Record<string, unknown> | undefined;
      if (!b) return null;
      // Revision is derived from the mutable content (so it changes exactly when
      // content changes); last_change is stamped by the mutation handlers.
      return { ...b, ...mockRevision(b), last_change: b._last_change ?? null };
    }
    case "save_level_edit": {
      // Apply the sparse edit into the stored bundle so the post-save
      // re-export reflects it (native persists via canon apply-edit).
      const edit = (args.edit as Record<string, unknown>) ?? {};
      if (String(args.levelId).startsWith("room_")) {
        return mockRoomEdit(String(args.levelId), edit);
      }
      const b = d.bundles[String(args.levelId)] as Record<string, unknown> | undefined;
      if (b) {
        if (edit.entities) {
          const prev = b.entities as Record<string, unknown>[];
          b.entities = (edit.entities as Record<string, unknown>[]).map((e) => ({
            ...(prev.find((p) => p.enemy_id === e.enemy_id && p.x === e.x && p.y === e.y) ?? {
              name: e.enemy_id,
              archetype: null,
              size: 1,
              placeholder_color: "#ff00ff",
              sprite_path_abs: null,
            }),
            ...e,
          }));
        }
        if (edit.items) {
          const prev = b.items as Record<string, unknown>[];
          b.items = (edit.items as Record<string, unknown>[]).map((it) => ({
            ...(prev.find((p) => p.item_id === it.item_id && p.x === it.x && p.y === it.y) ?? {
              name: it.item_id,
              kind: null,
              placeholder_color: "#ffd700",
              sprite_path_abs: null,
            }),
            ...it,
          }));
        }
        if (edit.triggers) b.triggers = edit.triggers;
        if (edit.spawn) b.spawn = edit.spawn;
        if (edit.exit) b.exit = edit.exit;
        if (edit.music_path !== undefined) {
          b.music_path = edit.music_path;
          b.music_hash = edit.music_hash ?? "";
        }
        if (edit.music_sections) b.music_sections = edit.music_sections;
        stampChange(b, "Saved edit", "edit", "user");
      }
      return {
        level_id: String(args.levelId),
        updated: Object.keys(edit),
        status: "user_edited",
      };
    }
    case "baseline_level":
      // Provenance journalling is a native/canon concern; ack in the mock.
      return { level_id: String(args.levelId), baselined: [] };
    case "save_level_grids": {
      if (String(args.levelId).startsWith("room_")) {
        const room = mockRoom(String(args.levelId));
        const grids = room.grids as { collision: number[][]; terrain: number[][] };
        const painted = (args.collision as number[][]).map((r) => [...r]);
        // canon re-stamps every placement after the paint (P.6.3); the mock
        // does the same so what renders is what "canon wrote".
        for (const it of room.items as { x: number; y: number }[]) painted[it.y][it.x] = 0;
        grids.collision = painted;
        grids.terrain = painted.map((r) => [...r]);
        stampChange(room, "Painted the maze", "edit", "user");
        return { level_id: args.levelId, room_id: args.levelId, updated: ["grid"] };
      }
      // Update the stored bundle so re-export reflects the paint; terrain gets
      // a naive re-derivation (base slot per type — no autotile in the mock).
      const b = d.bundles[String(args.levelId)] as {
        grid_width: number;
        grid_height: number;
        grids: { collision: number[][]; terrain: number[][]; background: number[][] };
        tiles_by_type: Record<string, { index: number }>;
      } | null;
      const collision = args.collision as number[][];
      if (b && collision) {
        b.grids.collision = collision;
        b.grid_height = collision.length;
        b.grid_width = collision[0]?.length ?? 0;
        b.grids.terrain = collision.map((row) =>
          row.map((t) => d && (b.tiles_by_type[String(t)]?.index ?? 0)),
        );
        b.grids.background = collision.map((row, y) =>
          row.map(() => Math.floor((y * 3) / Math.max(1, collision.length))),
        );
        stampChange(
          b as unknown as Record<string, unknown>,
          "Hand-painted terrain",
          "edit",
          "user",
        );
      }
      return { level_id: String(args.levelId), updated: ["collision"], status: "user_edited" };
    }
    case "roll_grid_step": {
      // `canon grid roll` — code only and $0, so the mock never asks to spend.
      // It jitters the room enough to make the reload visible.
      const roomId = String(args.levelId);
      const step = String(args.step);
      const room = mockRoom(roomId);
      const grid = (room.grids as { collision: number[][]; terrain: number[][] }).collision;
      if (step === "layout" || step === "whole") {
        for (let y = 1; y < grid.length - 1; y++) {
          for (let x = 1; x < grid[y].length - 1; x++)
            grid[y][x] = (x * y + step.length) % 4 === 0 ? 1 : 0;
        }
        (room.grids as { terrain: number[][] }).terrain = grid.map((r) => [...r]);
      }
      if (step === "npcs" || step === "whole") {
        (room.entities as { x: number; y: number }[]).forEach((e, i) => {
          e.x = 1 + ((i * 3 + 2) % 9);
          e.y = 1 + ((i * 5 + 1) % 5);
        });
      }
      if (step === "items" || step === "whole") {
        (room.items as { x: number; y: number }[]).forEach((it, i) => {
          it.x = 1 + ((i * 4 + 5) % 9);
          it.y = 1 + ((i * 2 + 3) % 5);
        });
      }
      if (step === "events" || step === "whole") {
        (room.triggers as { x: number; y: number }[]).forEach((t, i) => {
          t.x = 1 + ((i * 7 + 1) % 9);
          t.y = 1 + ((i * 3 + 2) % 5);
        });
      }
      if (step === "monsters") {
        const target = (room.triggers as Record<string, unknown>[]).find(
          (t) => String((t.params as Record<string, unknown>).event_id) === String(args.encounter),
        );
        if (!target)
          throw new Error("select an encounter first — a monsters roll re-rolls ONE encounter");
        (target.params as Record<string, unknown>).monster_ids = ["5000"];
      }
      stampRoom(room, `${step} rolled`);
      return {
        room_id: roomId,
        level_id: roomId,
        step,
        seed: String(args.seed ?? "mock-seed"),
        changed: true,
        changed_artifacts: [
          `room:${roomId}/${step === "layout" || step === "whole" ? "grid" : "placements"}`,
        ],
        no_change: false,
        cost_usd: 0,
        warnings: [],
        updated: [step],
      };
    }
    case "restore_grid_step": {
      // Restore writes a NEW version through the same writer (doctrine 6);
      // the mock only has to answer in the shape the panel reads.
      const roomId = String(args.levelId);
      stampRoom(mockRoom(roomId), `restored ${String(args.step)}`, "restore");
      return {
        level_id: roomId,
        room_id: roomId,
        restored_step: String(args.step),
        restored_to: String(args.to),
      };
    }
    case "create_level": {
      // Synthesize a draft bundle from an existing bundle's stage assets.
      const stageId = String(args.stageId);
      const w = Number(args.width ?? 60);
      const h = Number(args.height ?? 16);
      const template = Object.values(d.bundles).find(
        (x) => (x as { stage_id: string }).stage_id === stageId,
      ) as Record<string, unknown> | undefined;
      if (!template) throw new Error(`no template bundle for stage ${stageId}`);
      const nums = d.levels
        .map((r) => /^l(\d+)$/.exec(r.id))
        .filter(Boolean)
        .map((m) => parseInt(m![1], 10));
      const lid = `l${Math.max(0, ...nums) + 1}`;
      const tilesByType = template.tiles_by_type as Record<string, { index: number }>;
      const collision = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, () => (y === h - 2 ? 1 : y === h - 1 ? 3 : 0)),
      );
      d.bundles[lid] = {
        ...template,
        level_id: lid,
        stage_id: stageId,
        display_name: null,
        parent_level: null,
        brief: "Hand-built in cradle.",
        layout_fallback: false,
        grid_width: w,
        grid_height: h,
        spawn: [2, h - 3],
        exit: [w - 1, h - 3],
        grids: {
          collision,
          terrain: collision.map((row) => row.map((t) => tilesByType[String(t)]?.index ?? 0)),
          background: collision.map((_, y) => Array(w).fill(Math.floor((y * 3) / h))),
        },
        hazards: [],
        triggers: [],
        foreground: [],
        entities: [],
        items: [],
      };
      d.levels.push({ type_id: "levels", id: lid, name: `✎ ${lid}` });
      d.levelJson[lid] = { level_id: lid, stage_id: stageId, grid_width: w, grid_height: h };
      const count = d.entity_counts.find((c) => c.type_id === "levels");
      if (count) count.count += 1;
      // A fresh draft is a PLANNED node on the world map until it's built and
      // published — mirroring canon's read verb, which surfaces drafts that
      // aren't in any stage's level list yet.
      MOCK_WORLD_MAP.nodes.push({
        level_id: lid,
        display_name: null as unknown as string,
        stage_id: stageId,
        pos: [0.5, 0.5],
        status: "planned",
      } as (typeof MOCK_WORLD_MAP.nodes)[number]);
      return { level_id: lid, stage_id: stageId, dims: [w, h], draft: true };
    }
    case "new_project": {
      // Mock: the browser can't scaffold a real pack — hand back a path so the
      // open-flow works for UI testing. Real scaffold is native. The step-log
      // relay is mocked too (see simulateWorldRun), so the create tracker is
      // exercisable headless at a watchable speed for BOTH templates (row
      // P0-10, I7 devMock parity).
      const id = String(args.jobId ?? "");
      const template = String(args.template ?? "platformer");
      const counts = (args.counts ?? {}) as Record<string, number>;
      // Mirrors the native slug + project-store + uniquify rules well enough
      // for the UI: a null parentDir means the store.
      const slug =
        String(args.name ?? "project")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || "project";
      const parent = args.parentDir ? String(args.parentDir) : "mock://CradleProjects";
      const taken = `${parent}/${slug}`;
      const packDir = MOCK_CREATED.has(taken) ? `${taken}_${MOCK_CREATED.size + 1}` : taken;
      MOCK_CREATED.add(taken);
      simulateWorldRun(id, template, counts, {
        pack_dir: packDir,
        template,
        world: String(args.name ?? "New project"),
        seed: String(args.seed ?? "mock"),
        engines: [template === "dungeon" ? "pygame" : "godot"],
        changed: true,
      });
      return { job_id: id, status: "queued", pack_dir: packDir };
    }
    case "project_store":
      return {
        root: MOCK_PROJECT_STORE ?? "mock://CradleProjects",
        exists: true,
        source: MOCK_PROJECT_STORE ? "settings" : "default",
        locked_by_env: false,
      };
    case "pack_templates":
      return { result: "templates", templates: MOCK_TEMPLATES };
    case "generate_level": {
      // Mock: synthesize a draft like create_level, plus a few placements
      // copied from the stage template so the Art view shows enemies/items.
      // Real generation is native only.
      const stageId = String(args.stageId);
      const w = Number(args.width ?? 56);
      const h = Number(args.height ?? 16);
      const template = Object.values(d.bundles).find(
        (x) => (x as { stage_id: string }).stage_id === stageId,
      ) as Record<string, unknown> | undefined;
      if (!template) throw new Error(`no template bundle for stage ${stageId}`);
      const nums = d.levels
        .map((r) => /^l(\d+)$/.exec(r.id))
        .filter(Boolean)
        .map((m) => parseInt(m![1], 10));
      const lid = `l${Math.max(0, ...nums) + 1}`;
      const tilesByType = template.tiles_by_type as Record<string, { index: number }>;
      const collision = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, () => (y === h - 2 ? 1 : y === h - 1 ? 3 : 0)),
      );
      const tEnts = ((template.entities as unknown[]) ?? []).slice(0, Number(args.enemies ?? 3));
      const tItems = ((template.items as unknown[]) ?? []).slice(0, Number(args.items ?? 5));
      d.bundles[lid] = {
        ...template,
        level_id: lid,
        stage_id: stageId,
        display_name: null,
        parent_level: null,
        brief: String(args.brief ?? "Generated in cradle."),
        layout_fallback: false,
        grid_width: w,
        grid_height: h,
        spawn: [2, h - 3],
        exit: [w - 1, h - 3],
        grids: {
          collision,
          terrain: collision.map((row) => row.map((t) => tilesByType[String(t)]?.index ?? 0)),
          background: collision.map((_, y) => Array(w).fill(Math.floor((y * 3) / h))),
        },
        hazards: [],
        triggers: [],
        foreground: [],
        entities: tEnts.map((e, i) => ({ ...(e as object), x: 6 + i * 5, y: h - 3 })),
        items: tItems.map((it, i) => ({ ...(it as object), x: 8 + i * 4, y: h - 4 })),
      };
      d.levels.push({ type_id: "levels", id: lid, name: `✎ ${lid}` });
      d.levelJson[lid] = { level_id: lid, stage_id: stageId, grid_width: w, grid_height: h };
      const count = d.entity_counts.find((c) => c.type_id === "levels");
      if (count) count.count += 1;
      stampChange(d.bundles[lid] as Record<string, unknown>, "Generated", "generate", "llm");
      return simulateJob(args.jobId as string, {
        level_id: lid,
        stage_id: stageId,
        ok: true,
        repair_count: 0,
        layout_fallback: false,
        seed: "mock-seed",
        warnings: [],
        changed: true,
        changed_artifacts: [`level:${stageId}/${lid}/collision`],
      });
    }
    case "place_enemies":
    case "place_items": {
      const lid = String(args.levelId);
      const b = d.bundles[lid] as Record<string, unknown> | undefined;
      if (!b) throw new Error(`no level ${lid}`);
      const template = Object.values(d.bundles).find(
        (x) => (x as { stage_id: string }).stage_id === b.stage_id,
      ) as Record<string, unknown> | undefined;
      const h = Number(b.grid_height ?? 16);
      const step = cmd === "place_enemies" ? "entities" : "items";
      if (cmd === "place_enemies") {
        const tEnts = ((template?.entities as unknown[]) ?? []).slice(0, Number(args.enemies ?? 3));
        b.entities = tEnts.map((e, i) => ({ ...(e as object), x: 6 + i * 5, y: h - 3 }));
      } else {
        const tItems = ((template?.items as unknown[]) ?? []).slice(0, Number(args.items ?? 5));
        b.items = tItems.map((it, i) => ({ ...(it as object), x: 8 + i * 4, y: h - 4 }));
      }
      stampChange(
        b,
        cmd === "place_enemies" ? "Placed enemies" : "Placed items",
        "generate",
        "llm",
      );
      return simulateJob(args.jobId as string, {
        level_id: lid,
        stage_id: b.stage_id,
        ok: true,
        repair_count: 0,
        layout_fallback: false,
        seed: "mock-seed",
        warnings: [],
        changed: true,
        changed_artifacts: [`level:${b.stage_id}/${lid}/${step}`],
      });
    }
    case "regenerate_layout": {
      // Mock: rebuild the level's grid into something visibly structured (not
      // flat) + clear placements, so the regen shows a change. Native runs the
      // real generator.
      const lid = String(args.levelId);
      const b = d.bundles[lid] as Record<string, unknown> | undefined;
      if (!b) throw new Error(`no level ${lid}`);
      const w = Number(b.grid_width ?? 60);
      const h = Number(b.grid_height ?? 16);
      const template = Object.values(d.bundles).find(
        (x) => (x as { stage_id: string }).stage_id === b.stage_id,
      ) as Record<string, unknown> | undefined;
      const tilesByType = (template?.tiles_by_type as Record<string, { index: number }>) ?? {};
      const collision = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => {
          if (y === h - 1) return 1; // floor
          if (y === h - 2 && x % 7 !== 0) return 1; // floor with gaps
          if (y === h - 6 && x % 5 === 0) return 2; // scattered platforms
          return 0;
        }),
      );
      b.grids = {
        collision,
        terrain: collision.map((row) => row.map((t) => tilesByType[String(t)]?.index ?? 0)),
        background: collision.map((_, y) => Array(w).fill(Math.floor((y * 3) / h))),
      };
      b.entities = []; // old placements belonged to the old terrain
      b.items = [];
      b.brief = String(args.brief ?? b.brief ?? "");
      b.layout_fallback = false;
      stampChange(b, "Regenerated layout", "regenerate", "llm");
      return simulateJob(args.jobId as string, {
        level_id: lid,
        stage_id: b.stage_id,
        ok: true,
        repair_count: 0,
        layout_fallback: false,
        seed: "mock-seed",
        warnings: [],
        changed: true,
        changed_artifacts: [`level:${b.stage_id}/${lid}/collision`],
      });
    }
    case "improve_layout": {
      // Mock: context-aware improve — RE-AUTHOR the grid (keeping dims) so the
      // change is visible, VARYING on the instruction so the mock proves it's
      // guided ("harder" → pits, "easier" → a flat runway). Placements are KEPT
      // by default (the user's enemies/items survive) or cleared on re-roll, to
      // mirror the real op. Native runs the real LLM improve.
      const lid = String(args.levelId);
      const b = d.bundles[lid] as Record<string, unknown> | undefined;
      if (!b) throw new Error(`no level ${lid}`);
      const w = Number(b.grid_width ?? 60);
      const h = Number(b.grid_height ?? 16);
      const instr = String(args.instruction ?? "").toLowerCase();
      const harder = instr.includes("harder");
      const easier = instr.includes("easier");
      const template = Object.values(d.bundles).find(
        (x) => (x as { stage_id: string }).stage_id === b.stage_id,
      ) as Record<string, unknown> | undefined;
      const tilesByType = (template?.tiles_by_type as Record<string, { index: number }>) ?? {};
      const collision = Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => {
          if (y === h - 1) return easier ? 1 : x % 11 !== 0 ? 1 : 0; // floor (pits unless easier)
          if (y === h - 2) return easier ? 1 : x % 7 !== 0 ? 1 : 0;
          if (harder && y === h - 5 && x % 9 === 3) return 4; // scattered hazards
          if (y === h - 6 && x % 5 === 0) return 2; // platforms
          return 0;
        }),
      );
      // Faithful change signal: re-authoring to the SAME grid (e.g. the same
      // instruction twice) is a no-op, exactly like canon's idempotent baseline.
      const prevGrids = b.grids as { collision?: unknown } | undefined;
      const gridChanged = JSON.stringify(prevGrids?.collision) !== JSON.stringify(collision);
      const clearedPlacements =
        !!args.rerollPlacements &&
        (((b.entities as unknown[]) ?? []).length > 0 || ((b.items as unknown[]) ?? []).length > 0);
      const changed = gridChanged || clearedPlacements;
      b.grids = {
        collision,
        terrain: collision.map((row) => row.map((t) => tilesByType[String(t)]?.index ?? 0)),
        background: collision.map((_, y) => Array(w).fill(Math.floor((y * 3) / h))),
      };
      if (args.rerollPlacements) {
        b.entities = [];
        b.items = [];
      }
      b.layout_fallback = false;
      if (changed) stampChange(b, "Improved", "regenerate", "llm");
      return simulateJob(args.jobId as string, {
        level_id: lid,
        stage_id: b.stage_id,
        ok: true,
        repair_count: 0,
        layout_fallback: false,
        seed: "mock-seed",
        improved: true,
        warnings: [],
        cost: { usd: 0, input_tokens: 0, output_tokens: 0, calls: 1, backend: "fake" },
        changed,
        changed_artifacts: changed ? [`level:${b.stage_id}/${lid}/collision`] : [],
      });
    }
    case "db_types": {
      // Row P0-6 widened `canon db types` with the P.1 lists (user_fields /
      // hidden / decorative / protected / routed) and RowEditor reads them
      // instead of its old HIDDEN literal (row P0-8). Mock data captured
      // before that carries only the original four keys, so fill the rest in
      // with the core protected set — parity (I7) without a refreshed fixture.
      const types = Object.fromEntries(
        Object.entries((d.dbTypes ?? {}) as Record<string, Record<string, unknown>>).map(
          ([kind, block]) => [
            kind,
            {
              user_fields: [],
              hidden: [],
              decorative: [],
              protected: [
                "artifact_id",
                `${kind}_id`,
                "provenance_hash",
                "parents",
                "status",
                "review_status",
                "sprite_path",
                "sprite_hash",
                "animation",
                "canon_version",
              ],
              routed: {},
              label: `${kind[0].toUpperCase()}${kind.slice(1)}s`,
              id_field: `${kind}_id`,
              ...block,
            },
          ],
        ),
      );
      return { types };
    }
    case "db_new": {
      // Mock: synthesize a row locally so the table flow is visible; native
      // runs the real anchored generation via canon.
      const t = String(args.entityType);
      const f = (args.fields as Record<string, unknown>) ?? {};
      const name = String(f.name ?? `Mock ${t}`);
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const row = {
        [`${t}_id`]: id,
        name,
        archetype: f.archetype ?? "patroller",
        kind: f.kind ?? "coin",
        size: f.size ?? 1,
        rarity: f.rarity ?? "common",
        stats: {
          hp: 6,
          damage: 1,
          speed: 2,
          flavor: "(mock roll — native runs canon)",
          placeholder_color: "#7c5cff",
        },
        behavior: { patrol_range: 5, aggro_range: 0, leash_range: 0 },
        ...f,
      };
      const typeKey = t === "enemy" ? "enemies" : "items";
      const refs = (d[typeKey as "enemies"] as Ref[]) ?? [];
      refs.push({ type_id: typeKey, id, name });
      const jmapKey = t === "enemy" ? "enemyJson" : "itemJson";
      ((d[jmapKey as "enemyJson"] as JsonMap) ?? {})[id] = row;
      const count = d.entity_counts.find((c) => c.type_id === typeKey);
      if (count) count.count += 1;
      return { id, row, completed: Boolean(args.complete), warnings: [] };
    }
    case "db_complete":
      return { id: String(args.id), row: {}, warnings: ["mock: native runs canon"] };
    case "db_update": {
      // Mock: apply the flat-routed edit in memory so the UI round-trips;
      // native runs `canon db update` (rehash + user_edited + journal).
      const t = String(args.entityType);
      const id = String(args.id);
      const set = (args.set as Record<string, unknown>) ?? {};
      if (t === "tile") {
        const [stageId, tileName] = id.split("/");
        const tilesets = (d.tilesetJson ?? {}) as Record<
          string,
          { stage_id?: string; slots?: Record<string, unknown>[] }
        >;
        const manifest = Object.values(tilesets).find((m) => m?.stage_id === stageId);
        const slots = (manifest?.slots ?? []).filter((s) => s.name === tileName);
        for (const slot of slots) {
          if (typeof set.collision === "string") slot.collision = set.collision;
          if (set.params && typeof set.params === "object") {
            slot.params = {
              ...(slot.params as Record<string, unknown>),
              ...(set.params as Record<string, unknown>),
            };
          }
        }
        return { stage: stageId, tile: tileName, slots: slots.length, changed: set };
      }
      const jmapKey = t === "enemy" ? "enemyJson" : "itemJson";
      const jmap = (d[jmapKey as "enemyJson"] as JsonMap) ?? {};
      const row = jmap[id] as Record<string, unknown> | undefined;
      if (!row) throw new Error(`devMock: ${t} ${id} not found`);
      const nesting = DB_NESTING[t] ?? {};
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(set)) {
        const [container, key] = k.includes(".")
          ? [k.split(".")[0], k.split(".").slice(1).join(".")]
          : [nesting[k], k];
        if (container) {
          const bucket = ((row[container] as Record<string, unknown>) ??= {});
          changed[k] = { from: bucket[key], to: v };
          if (v === null) delete bucket[key];
          else bucket[key] = v;
        } else {
          changed[k] = { from: row[key], to: v };
          row[key] = v;
        }
      }
      row.status = "user_edited";
      const ref = refsFor(d, t === "enemy" ? "enemies" : "items").find((r) => r.id === id);
      if (ref && typeof set.name === "string") ref.name = set.name;
      return { type: t, id, row, changed, warnings: [] };
    }
    case "library_list":
      return {
        root: "~/.canon/library (mock)",
        count: 2,
        entries: [
          {
            library_id: "lib-mock-wisp",
            ts: "2026-07-22T18:00:00",
            kind: "enemy_def",
            name: "Ember Wisp",
            tags: ["fire", "flyer"],
            source: {
              pack: "/mock/plat_other",
              world: "Cinder Vale",
              artifact_id: "enemy:ember_wisp",
              target: "enemy:ember_wisp",
            },
            objects: { row: "sha256:mockrow-wisp", sprite: "sha256:mocksprite-wisp" },
            meta: {},
            preview: "sha256:mocksprite-wisp",
            actor: USER_ACTOR,
          },
          {
            library_id: "lib-mock-band",
            ts: "2026-07-21T10:00:00",
            kind: "backdrop",
            name: "dusk pines band",
            tags: [],
            source: {
              pack: String(args.project ?? "/mock/this"),
              world: d.name,
              artifact_id: "backdrop:s1",
              target: "backdrop:s1/1",
            },
            objects: { art: "sha256:mocksprite-band" },
            meta: { depth: 0.5 },
            preview: "sha256:mocksprite-band",
            actor: USER_ACTOR,
          },
        ]
          .filter((e) => !args.kind || e.kind === args.kind)
          .filter(
            (e) =>
              !args.query ||
              (e.name + " " + e.tags.join(" "))
                .toLowerCase()
                .includes(String(args.query).toLowerCase()),
          )
          .filter(
            (e) =>
              !args.project ||
              e.source.pack.toLowerCase().includes(String(args.project).toLowerCase()) ||
              e.source.world.toLowerCase().includes(String(args.project).toLowerCase()),
          ),
      };
    case "library_publish":
      return {
        library_id: "lib-mock-new",
        kind: "enemy_def",
        name: String(args.target),
        tags: [],
        source: {
          pack: "/mock/this",
          world: d.name,
          artifact_id: String(args.target),
          target: String(args.target),
        },
        objects: {},
        meta: {},
        preview: "",
        actor: USER_ACTOR,
      };
    case "library_import": {
      // Mock: land a visible row so the select-after-import flow demos.
      const id = "ember_wisp";
      const row = {
        enemy_id: id,
        name: "Ember Wisp",
        archetype: "flyer",
        size: 1,
        rarity: "uncommon",
        status: "user_edited",
        stats: {
          hp: 5,
          damage: 1,
          speed: 2,
          flavor: "(imported from the library — mock)",
          placeholder_color: "#ff7043",
          library_ref: {
            library_id: String(args.id),
            source_pack: "/mock/plat_other",
            source_artifact: "enemy:ember_wisp",
          },
        },
        behavior: { patrol_range: 5, aggro_range: 0, leash_range: 0 },
      };
      ((d.enemyJson as JsonMap) ?? {})[id] = row;
      const refs = (d.enemies as Ref[]) ?? [];
      if (!refs.some((r) => r.id === id)) refs.push({ type_id: "enemies", id, name: "Ember Wisp" });
      return { kind: "enemy_def", id, library_id: String(args.id) };
    }
    case "library_cat":
      return {
        hash: String(args.hash),
        size: 68,
        bytes_b64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      };
    case "asset_assign":
      return { from: String(args.source), to: String(args.to), sprite_hash: "sha256:mock" };
    case "asset_lineage": {
      // Mock: a canned three-node family (generate → edit, plus a sprite
      // import) so the History tab demos; native derives from the journal.
      const target = String(args.target);
      const rowA = "sha256:mockrow-aaaa";
      const rowB = "sha256:mockrow-bbbb";
      const spr = "sha256:mocksprite-cccc";
      return {
        artifact_id: target,
        root_id: rowA,
        requested_node_id: rowB,
        nodes: [
          {
            id: rowA,
            facet: "row",
            op: "generate",
            source: "llm",
            actor: "canon",
            ts: "2026-07-20T10:00:00",
            gen: {
              llm_model: "claude-haiku",
              prompt:
                "Design a small patrolling creature themed to candle-lit woods. Return JSON with name and flavor.",
            },
            artifacts: [target],
            current_of: [],
            usage: { [target]: ["l1", "l3"] },
            detail: {},
            depth: 0,
          },
          {
            id: rowB,
            facet: "row",
            op: "edit",
            source: "user",
            actor: USER_ACTOR,
            ts: "2026-07-22T09:00:00",
            gen: null,
            artifacts: [target],
            current_of: [`${target}#row`],
            usage: { [target]: ["l1", "l3"] },
            detail: {},
            depth: 1,
          },
          {
            id: spr,
            facet: "sprite",
            op: "import",
            source: "import",
            actor: USER_ACTOR,
            ts: "2026-07-21T12:00:00",
            gen: null,
            artifacts: [target],
            current_of: [`${target}#sprite`],
            usage: {},
            detail: {},
            depth: 0,
          },
        ],
        edges: [{ from: rowA, to: rowB, op: "edit", kind: "db_update", actor: USER_ACTOR, ts: "" }],
        metadata: { total_nodes: 3, max_depth: 1, pruned: false },
      };
    }
    case "asset_restore":
      return { artifact_id: String(args.target), kind: "row_restore", pinned: false };
    case "object_cat": {
      const h = String(args.hash);
      if (h.includes("sprite")) {
        // 1×1 png — enough for the thumbnail pipeline to exercise.
        return {
          hash: h,
          size: 68,
          bytes_b64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        };
      }
      const row = h.includes("aaaa")
        ? { name: "Original Beast", stats: { hp: 6, speed: 2 } }
        : { name: "Edited Beast", stats: { hp: 9, speed: 2 } };
      const b64 = btoa(JSON.stringify(row));
      return { hash: h, size: b64.length, bytes_b64: b64 };
    }
    case "validate_level":
      // Mock: canned pass — native runs canon's full reachability simulation.
      return {
        level_id: String(args.levelId),
        stage_id: "mock",
        display_name: "",
        ok: true,
        checks: [
          {
            name: "terrain",
            problems: [],
            notes: ["mock: native runs canon's jump-arc simulation"],
          },
          { name: "enemies", problems: [], repairs: [], count: 0 },
          { name: "items", problems: [], repairs: [], count: 0 },
        ],
        movement: {},
        rooms: [],
      };
    case "preview_prompt": {
      // Mock: canned prompts standing in for `canon prompt show`. Same SHAPE as
      // the real verb — LLM kinds split system/user, image+audio carry one.
      const kind = String(args.kind);
      const LABELS: Record<string, string> = {
        layout: "plat:layout",
        improve: "plat:layout",
        enemy: "plat:enemies",
        item: "plat:items",
        sprite: "plat:sprite_art",
        animate: "plat:sprite_animation",
        music: "plat:audio",
      };
      const label = LABELS[kind] ?? "plat:layout";
      if (kind === "sprite" || kind === "music" || kind === "animate") {
        const MODES: Record<string, string> = {
          sprite: "image",
          music: "audio",
          animate: "vlm",
        };
        const PROMPTS: Record<string, string> = {
          sprite: `Single game sprite: ${args.target ?? "the actor"}, full body, side view facing right, centered, isolated on a plain solid white background. No shadow, no text. (mock)`,
          music:
            "Looping instrumental theme for a retro platformer level. Melodic, atmospheric, seamless loop, no vocals. (mock)",
          // The VLM's motion-spec AUTHORING prompt — one call per run, NOT the
          // per-state img2img sheet prompt.
          animate: `### TASK: plat_animate\n### ACTOR: ${args.target ?? "the actor"}\n\nYou are a 2D sprite animator. The attached image is the ACTUAL generated sprite for this character — describe how THIS character moves in each state.\n\nStates to author (use these exact keys):\n  - "idle": at rest / holding position\n  - "walk": actively moving along its path\n  - "hurt": recoiling from a hit\n  - "death": defeated\n  - "jump": the RISING launch\n\nReturn ONE JSON object. (mock)`,
        };
        return { kind, label, mode: MODES[kind], prompt: PROMPTS[kind] };
      }
      return {
        kind,
        label,
        mode: "llm",
        system:
          "You are a level and content designer for a 2D side-scrolling platformer. " +
          "You respond ONLY in the exact format the task requests — a JSON object or DSL " +
          "lines — with no prose, no markdown fences, and no commentary. (mock default)",
        user_message:
          `### TASK: ${kind}\n### LEVEL: ${args.levelId ?? "l1"}\n` +
          `Brief: ${args.brief ?? ""}\n` +
          (args.instruction ? `APPLY THIS CHANGE: ${args.instruction}\n` : "") +
          "(mock: the real task message is rebuilt from live pack data each call)",
      };
    }
    case "play_level":
      return {
        launched: false,
        mode: args.animTarget ? "anim" : args.sandbox ? "sandbox" : "play",
        note: args.animTarget
          ? `mock: the ${String(args.animMode ?? "grid")} animation viewer for ${args.animTarget} opens in the native app`
          : args.sandbox
            ? "mock: the movement sandbox opens in the native app"
            : "mock: playtesting launches from the native app",
      };
    case "get_world_bible":
      // MazeWorld-shaped: the hero renders story.synopsis under the title.
      return {
        story: {
          title: "The Wandering Wick",
          synopsis:
            "A lantern-lit autumn forest where the light you carry is the " +
            "only thing keeping the hollows at bay. Three areas, nine levels, " +
            "and something older than the grove waiting at the end.",
        },
      };
    // -- Row P1-A5: the agent sidecar's lifecycle + ⏹ on a queued job (I7
    //    parity for the new commands). The scripted agent (`agentMock.ts`)
    //    stands in for the whole service, so `agent_start` answers at once. --
    case "agent_start": {
      // The sidecar's `--backend` / `--model` are the ONLY seam that carries
      // a model to the service, so the scripted agent adopts them the same
      // way (I7). A restart re-installs the transport, which `agent_stop`
      // cleared.
      const backend = args.backend ? String(args.backend) : null;
      const model = args.model ? String(args.model) : null;
      scriptedAgent.startedOn(backend, model);
      setAgentTransport(scriptedAgent);
      return {
        port: 0,
        pid: 0,
        mock: true,
        command:
          "scripted agent (devMock — no sidecar)" +
          `${backend ? ` --backend ${backend}` : ""}${model ? ` --model ${model}` : ""}`,
      };
    }
    case "agent_stop":
      return { stopped: true };
    case "agent_status":
      return {
        running: true,
        port: 0,
        pid: 0,
        pack: String(args.pack ?? ""),
        exit_code: null,
        stderr: [],
      };
    case "cancel_job": {
      // Row A4.5's contract: a queued job is dropped outright; a running one
      // stops at its next item boundary and keeps what landed. The scripted
      // agent's paid loop checks `cancelledJobs` at each item.
      const id = String(args.jobId ?? "");
      cancelledJobs.add(id);
      const job = useStore.getState().jobs.find((j) => j.id === id);
      if (job?.status === "queued") {
        void handleJobEvent({ id, status: "cancelled", result: { kept: [], not_started: [] } });
        return { job_id: id, status: "cancelled" };
      }
      if (job?.status === "running" && !id.startsWith("agentjob-")) {
        // An editor-launched mock job has no item loop to stop at: it ends now.
        setTimeout(
          () =>
            void handleJobEvent({ id, status: "cancelled", result: { kept: [], not_started: [] } }),
          80,
        );
      }
      return { job_id: id, status: "cancelling" };
    }
    case "sandbox_level":
      // Mock the canon verb: a reserved-id draft room, idempotent.
      return { level_id: "sandbox", stage_id: "mock_stage", created: false };
    case "runtime_status":
      // I7 parity for row P0-11's startup probe. The browser mock has no
      // canon at all, so it reports the leg a dev machine actually uses —
      // `ok: true` keeps the guided failure screen out of the mock, which is
      // not what it is there to test.
      return {
        ok: true,
        origin: "path",
        command: "canon",
        triple: "mock",
        resource_dir: null,
        legs: [
          { leg: "env", tried: null, found: false, note: "CANON_BIN is not set (mock)." },
          { leg: "bundled", tried: null, found: false, note: "no bundle in the browser mock." },
          { leg: "path", tried: "canon", found: true, note: "`canon` on PATH (mock)." },
        ],
        version: { canon_version: "0.1", package_version: "0.1.0" },
        error: null,
      };
    case "provider_keys": {
      // I7 parity for row P0-12's extended status read. Pretend the usual keys
      // are PRESENT so paid gates are reachable headless — but only as names
      // and sources. There is deliberately NO key value anywhere in this mock:
      // a realistic-looking key in the repo is a secret-shaped liability even
      // when it is fake, and the real command cannot return one either.
      const present = new Set(MOCK_PRESENT_KEYS);
      const asked = Array.isArray(args.vars) ? (args.vars as string[]) : [];
      const names = [...new Set([...asked, ...MOCK_PRESENT_KEYS])].sort();
      return {
        env_file: "mock://.env",
        keys: names.filter((n) => present.has(n)),
        vars: names.map((name) => ({
          name,
          set: present.has(name),
          source: present.has(name) ? "keychain" : null,
          also_in: [],
        })),
        backend: "keychain",
        warning: null,
        config_dir: "mock://config/cradle",
      };
    }
    case "set_provider_key": {
      // Write-only in the mock too: the value is READ and DROPPED, never
      // stored and never echoed back.
      MOCK_PRESENT_KEYS.add(String(args.var));
      return { var: String(args.var), stored: true, backend: "keychain", warning: null };
    }
    case "delete_provider_key": {
      const had = MOCK_PRESENT_KEYS.delete(String(args.var));
      return { var: String(args.var), removed: had, backend: "keychain", warning: null };
    }
    case "provider_rows":
      return {
        result: "providers",
        providers: MOCK_PROVIDERS,
        backend_key_vars: mockBackendKeyVars(),
      };
    case "test_provider_key": {
      // The mock NEVER contacts a provider (doctrine 3). It answers the shape
      // the button renders, honouring the row's own `test: null`.
      const row = MOCK_PROVIDERS.find((r) => r.id === String(args.provider));
      if (!row?.test)
        return {
          id: String(args.provider),
          ran: false,
          ok: false,
          status: null,
          reason: `${row?.label ?? args.provider} publishes no free authenticated endpoint — a test would have to run a paid generation, which this button never does.`,
        };
      return {
        id: row.id,
        ran: true,
        ok: MOCK_PRESENT_KEYS.has(row.env_var),
        status: MOCK_PRESENT_KEYS.has(row.env_var) ? 200 : 401,
        reason: MOCK_PRESENT_KEYS.has(row.env_var)
          ? "the provider accepted the key (mock: nothing was contacted)"
          : "the provider rejected the key (mock: nothing was contacted)",
      };
    }
    case "environment_status":
      return {
        canon: dispatch("runtime_status", {}, d),
        godot: {
          tool: "godot",
          label: "Godot",
          env_var: "GODOT_BIN",
          found: true,
          origin: "path",
          path: "/usr/local/bin/godot",
          version: "4.3.stable.official",
          major: 4,
          gate: "unpinned",
          note: "Godot is available.",
          install: "https://godotengine.org/download",
          legs: [],
        },
        blender: {
          tool: "blender",
          label: "Blender",
          env_var: "BLENDER_BIN",
          found: false,
          origin: null,
          path: null,
          version: null,
          major: null,
          gate: "missing",
          note: "Blender is not installed here. Set $BLENDER_BIN to its binary, put `blender` on PATH, or install it.",
          install: "https://www.blender.org/download/",
          legs: [],
        },
        project_store: dispatch("project_store", {}, d),
        config_dir: "mock://config/cradle",
      };
    case "set_project_store":
      MOCK_PROJECT_STORE = args.path ? String(args.path) : null;
      return dispatch("project_store", {}, d);
    case "play_game":
      return {
        launched: false,
        mode: args.animTarget ? "anim" : args.sandbox ? "sandbox" : "play",
        note: args.animTarget
          ? `mock: the Godot ${String(args.animMode ?? "grid")} animation viewer for ${args.animTarget} opens in the native app`
          : args.sandbox
            ? "mock: the Godot movement sandbox opens in the native app"
            : "mock: playtesting launches from the native app",
      };
    // Row P0-9's dialogue and scene verbs. The mock stands in for CANON here,
    // so it is the mock — never a component — that evaluates a gate. `improve`
    // answers a PROPOSAL and never calls a provider (doctrine 3).
    case "dialogue_show":
      return mockDialogueShow(String(args.npc));
    case "dialogue_validate":
      return mockDialogueValidate(String(args.npc));
    case "dialogue_update":
      return mockDialogueUpdate(
        String(args.npc),
        (args.ops ?? []) as Parameters<typeof mockDialogueUpdate>[1],
      );
    case "dialogue_test":
      return mockDialogueTest(
        args.tree as Parameters<typeof mockDialogueTest>[0],
        args.state,
        (args.node ?? null) as string | null,
        (args.choose ?? null) as number | null,
      );
    case "dialogue_select":
      return mockDialogueSelect(String(args.npc), args.state);
    case "dialogue_improve":
      return mockDialogueImprove(String(args.npc), args as Record<string, unknown>);
    case "scene_update":
      return mockSceneUpdate(
        args.scene === null || args.scene === undefined ? null : String(args.scene),
        (args.ops ?? []) as Parameters<typeof mockSceneUpdate>[1],
        !!args.create,
        String(args.title ?? ""),
      );
    case "scene_validate":
      return mockSceneValidate(String(args.scene));
    case "scene_test":
      return mockSceneTest(args.scene, args.state);
    case "db_schema": {
      const t = String(args.entityType);
      const schemas = (d.dbSchemas ??= {});
      const local = schemas[t];
      return {
        type: t,
        source: local ? "pack" : "default",
        schema: local ?? FALLBACK_SCHEMAS[t] ?? { fields: {} },
      };
    }
    case "db_update_schema": {
      const t = String(args.entityType);
      const set = (args.set as { fields?: Record<string, unknown> }) ?? {};
      const schemas = (d.dbSchemas ??= {});
      const base = JSON.parse(
        JSON.stringify(schemas[t] ?? FALLBACK_SCHEMAS[t] ?? { fields: {} }),
      ) as { fields: Record<string, unknown> };
      for (const [name, entry] of Object.entries(set.fields ?? {})) {
        if (entry === null) delete base.fields[name];
        else base.fields[name] = entry;
      }
      schemas[t] = base;
      return { type: t, source: "pack", schema: base, changed: set.fields ?? {} };
    }
    case "generate_asset":
      return simulateJob(args.jobId as string, {
        target: String(args.target),
        generated: true,
        changed: true,
        changed_artifacts: [String(args.target)],
        cost: { usd: 0, input_tokens: 0, output_tokens: 0, calls: 0, backend: "fake" },
        warnings: ["mock: real bytes need the native app"],
      });
    case "animate_asset":
      return simulateJob(args.jobId as string, {
        target: String(args.target),
        animated: true,
        states: args.reuseSpec ? ["idle", "walk"] : ["idle", "walk", "hurt", "death"],
        changed: true,
        changed_artifacts: [String(args.target)],
        // Echo the knobs back so the mock proves the full parameter set
        // actually reaches the command (the whole point of this change).
        gen: {
          image_model: args.imageModel ?? args.imageEditModel ?? "fal-ai/nano-banana",
          vlm_model: args.vlmModel ?? "claude-sonnet-4-6",
          reused_spec: Boolean(args.reuseSpec),
        },
        cost: { usd: 0, input_tokens: 0, output_tokens: 0, calls: 0, backend: "fake" },
        warnings: ["mock: real animation needs the native app"],
      });
    case "replace_asset":
      // Real byte replacement needs the native app (file picker + canon).
      return { target: String(args.target), pinned: false };
    case "publish_level": {
      // Mock: flip the draft's display name; real ordering happens canon-side.
      const lid = String(args.levelId);
      const b = d.bundles[lid] as { display_name: string | null } | undefined;
      if (b) b.display_name = "P-?";
      const ref = d.levels.find((r) => r.id === lid);
      if (ref) ref.name = lid;
      return { level_id: lid, published: !args.remove };
    }
    case "resolve_asset": {
      // The pack is symlinked at public/__mockassets__ — map pack-relative
      // hints onto it; absolute/mock paths pass through.
      const hint = String(args.hint ?? "");
      if (!hint) return null;
      if (hint.startsWith("/__mockassets__") || hint.startsWith("http")) return hint;
      if (hint.startsWith("/")) return null; // foreign absolute path: no match
      return "/__mockassets__/" + hint;
    }
    case "generate_level_music": {
      const lid = String(args.levelId);
      const b = d.bundles[lid] as Record<string, unknown> | undefined;
      const stage = b ? String(b.stage_id ?? "s1") : "s1";
      const section = args.section as number | null | undefined;
      const rel = `music/${stage}/${lid}/${section != null ? "sec" + section : "theme"}.mp3`;
      if (b) {
        if (section == null) {
          b.music_path = rel;
        } else {
          const secs = ((b.music_sections as Record<string, unknown>[]) ?? []).slice();
          if (secs[section]) secs[section] = { ...secs[section], music_path: rel };
          b.music_sections = secs;
        }
      }
      return simulateJob(args.jobId as string, {
        level_id: lid,
        stage_id: stage,
        target: `music:${stage}/${lid}`,
        music_path: rel,
        cost: {
          usd: 0,
          llm_usd: 0,
          image_usd: 0,
          audio_usd: 0,
          input_tokens: 0,
          output_tokens: 0,
          calls: 0,
          backend: String(args.musicBackend ?? "fake"),
        },
        warnings: [],
        changed: true,
        changed_artifacts: [`level:${stage}/${lid}/music`],
      });
    }
    case "list_music_tracks": {
      const seen = new Set<string>();
      const tracks: { path: string; label: string }[] = [];
      for (const bb of Object.values(d.bundles) as Record<string, unknown>[]) {
        const st = String(bb.stage_id ?? "s1");
        const p = `music/${st}/theme.mp3`;
        if (!seen.has(p)) {
          seen.add(p);
          tracks.push({ path: p, label: `${st}/theme.mp3` });
        }
        if (bb.music_path) {
          const mp = String(bb.music_path);
          if (!seen.has(mp)) {
            seen.add(mp);
            tracks.push({ path: mp, label: mp.slice("music/".length) });
          }
        }
      }
      return { tracks };
    }
    case "estimate_world": {
      const c = (args.counts ?? {}) as Record<string, number>;
      // The dungeon prices per ROOM; the platformer per stage × level. Enough
      // shape for the wizard's chip to move as the numbers move.
      const rooms = Number(c.rooms ?? 0);
      return {
        result: "estimate",
        estimate: mockEstimate(
          "world",
          rooms
            ? {
                stages: rooms,
                levels: rooms,
                enemies: rooms * Number(c.monster ?? 2),
                items: rooms * Number(c.item ?? 3),
              }
            : {
                stages: Number(c.stages ?? 3),
                levels: Number(c.levels ?? 9),
                enemies: Number(c.enemies ?? 7),
                items: Number(c.items ?? 5),
              },
          {
            llm: String(args.llmBackend ?? "fake"),
            image: String(args.imageBackend ?? "fake"),
            music: String(args.musicBackend ?? "none"),
            sfx: String(args.sfxBackend ?? "none"),
            vlm: String(args.vlmBackend ?? "none"),
          },
        ),
      };
    }
    case "estimate_level":
      return {
        result: "estimate",
        estimate: mockEstimate(String(args.op ?? "generate"), null, {
          llm: String(args.llmBackend ?? "fake"),
        }),
      };
    // Animation geometry. Shaped like the real pack's PLAYER, including the
    // defect: every state flush to the cell edge, `fall` narrow-but-full-height.
    // A mock showing healthy art would never exercise the warnings.
    case "anim_inspect": {
      const mk = (
        state: string,
        n: number,
        loop: string,
        boxes: [number, number, number, number][],
      ) => {
        const key = `${String(args.target)}::${state}`;
        return {
          state,
          frames: n,
          frame_width: 32,
          frame_height: 32,
          path: `sprite/player/${state}.png`,
          path_abs: `/__mockassets__/sprite/player/${state}.png`,
          loop: MOCK_ANIM[key]?.loop ?? loop,
          durations_ms: MOCK_ANIM[key]?.durations_ms ?? Array(n).fill(120),
          offsets: MOCK_ANIM[key]?.offsets ?? null,
          boxes: boxes.map(([x, y, w, h], index) => ({
            index,
            box: { x, y, w, h },
            foot_gap: 32 - (y + h),
          })),
          widest: Math.max(...boxes.map((b) => b[2])),
          tallest: Math.max(...boxes.map((b) => b[3])),
          flush: boxes.some((b) => b[2] >= 31 || b[3] >= 31),
          foot_wander:
            Math.max(...boxes.map((b) => 32 - (b[1] + b[3]))) -
            Math.min(...boxes.map((b) => 32 - (b[1] + b[3]))),
        };
      };
      const states = [
        mk("fall", 3, "loop", [
          [9, 12, 14, 20],
          [11, 0, 10, 32],
          [11, 0, 10, 32],
        ]),
        mk("idle", 3, "loop", [
          [5, 0, 22, 32],
          [4, 1, 24, 31],
          [4, 0, 24, 32],
        ]),
        mk("jump", 4, "once", [
          [2, 0, 28, 32],
          [3, 0, 26, 32],
          [2, 0, 28, 32],
          [3, 1, 26, 31],
        ]),
        mk("land", 3, "once", [
          [3, 0, 26, 32],
          [3, 2, 26, 30],
          [3, 0, 26, 32],
        ]),
        mk("walk", 8, "loop", [
          [6, 1, 20, 31],
          [6, 0, 20, 32],
          [7, 1, 18, 31],
          [6, 0, 20, 32],
          [6, 1, 20, 31],
          [6, 0, 20, 32],
          [7, 1, 18, 31],
          [6, 0, 20, 32],
        ]),
      ];
      const flush = states.filter((s) => s.flush).map((s) => s.state);
      return {
        animation: {
          target: String(args.target ?? "player"),
          label: String(args.target ?? "player")
            .split(":")
            .pop(),
          sprite_dir: "sprite/player",
          has_atlas: true,
          atlas_path_abs: "/__mockassets__/sprite/player/atlas.png",
          states,
          flush_states: flush,
          independently_sized: flush.length > 1,
          // What an animate run works FROM (the Generate-animation dialog).
          base_sprite: "sprite/player/base.png",
          base_sprite_abs: "/__mockassets__/sprite/player/base.png",
          planned_states: ["idle", "walk", "jump", "fall", "land", "skid"],
          briefs: {
            idle: "at rest / holding position",
            walk: "actively moving along its path",
            jump: "the RISING launch — a compact crouch then push-off, moving UP",
            fall: "the DESCENT past the peak — body stretched tall and vertical",
            land: "the touchdown SQUASH — body compressed low and WIDE",
            skid: "braking against carried momentum — torso leaned BACK",
          },
          // Empty like a runner-built pack's player: the briefs carry it.
          spec: {},
        },
      };
    }
    case "anim_edit": {
      const key = `${String(args.target)}::${String(args.state)}`;
      const patch = (args.edit ?? {}) as Record<string, unknown>;
      const cur = MOCK_ANIM[key] ?? {};
      const next = { ...cur };
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) {
          if (k in next) {
            delete (next as Record<string, unknown>)[k];
            changed = true;
          }
          continue;
        }
        if (JSON.stringify((next as Record<string, unknown>)[k]) !== JSON.stringify(v)) {
          (next as Record<string, unknown>)[k] = v;
          changed = true;
        }
      }
      MOCK_ANIM[key] = next;
      return changed
        ? {
            frames_edit: "updated",
            target: args.target,
            state: args.state,
            fields: Object.keys(patch).sort(),
          }
        : { frames_edit: "no_change", target: args.target, state: args.state };
    }
    // Engine runtime staleness. The mock starts BEHIND on purpose — that's
    // the state every real pack was in when this was built, and a mock that
    // starts current would never exercise the chip.
    case "engine_status":
      return {
        status: {
          pack: String(args.path ?? ""),
          has_engine: true,
          stamped: MOCK_ENGINE.stamped,
          current: MOCK_ENGINE.current,
          template_hash: "sha256:c65aea07f2de2865",
          pack_hash: MOCK_ENGINE.stamped ? "sha256:0000000000000000" : null,
          files: [
            {
              path: "godot/main.gd",
              state: MOCK_ENGINE.current ? "current" : MOCK_ENGINE.stamped ? "stale" : "unstamped",
            },
            { path: "godot/main.tscn", state: "current" },
            { path: "project.godot", state: "current" },
          ],
          behind: MOCK_ENGINE.current ? [] : ["godot/main.gd"],
          modified: [],
        },
      };
    case "engine_sync": {
      if (args.dryRun) {
        return {
          engine: "dry_run",
          would_write: MOCK_ENGINE.current ? [] : ["godot/main.gd"],
          refused: [],
          current: MOCK_ENGINE.current,
        };
      }
      if (MOCK_ENGINE.current) {
        return { engine: "no_change", written: [], refused: [] };
      }
      MOCK_ENGINE.current = true;
      MOCK_ENGINE.stamped = true;
      return {
        engine: "updated",
        written: ["godot/main.gd"],
        refused: [],
        template_hash: "sha256:c65aea07f2de2865",
      };
    }
    case "world_map": {
      // Mock: derive the graph from the mock pack's own levels + stages so the
      // canvas is exercised against realistic shape (13 levels, 3 stages).
      if (!MOCK_WORLD_MAP.nodes.length) {
        const stages = ["ember_grove", "sunken_hollow", "ashen_crags"];
        const perStage = 3;
        let i = 0;
        for (let si = 0; si < stages.length; si++) {
          for (let li = 1; li <= perStage; li++) {
            const lid = `l${i + 1}`;
            MOCK_WORLD_MAP.nodes.push({
              level_id: lid,
              display_name: `${si + 1}-${li}`,
              stage_id: stages[si],
              pos: [0.05 + i * 0.11, 0.5 + (i % 2 ? 0.14 : -0.14)],
              size: `${40 + i * 3}×16`,
              entities: 3 + (i % 5),
              items: 6 + (i % 4),
              ...(li === 1 ? { rooms: [`${lid}r1`] } : {}),
              ...(li === 3 ? { overrides: ["physics"] } : {}),
            });
            if (i > 0) {
              MOCK_WORLD_MAP.edges.push({
                a: `l${i}`,
                b: lid,
                kind: "path",
              });
            }
            i++;
          }
        }
        MOCK_WORLD_MAP.areas = stages.map((sid, idx) => ({
          stage_id: sid,
          index: idx,
          theme: ["autumn lantern forest", "flooded hollow", "ashen crags"][idx],
          biome: ["forest", "caves", "volcanic"][idx],
          level_ids: MOCK_WORLD_MAP.nodes.filter((n) => n.stage_id === sid).map((n) => n.level_id),
          music: null,
          blocks: sid,
          enemy_pool: ["lantern_sentinel", "tallow_bloom", "ember_hopper"],
          boss: "",
        }));
      }
      return JSON.parse(JSON.stringify(MOCK_WORLD_MAP));
    }
    case "world_map_edit": {
      const edit = (args.edit ?? {}) as Record<string, unknown>;
      const changed: string[] = [];
      if (edit.nodes) {
        for (const [lid, v] of Object.entries(edit.nodes as Record<string, unknown>)) {
          const node = MOCK_WORLD_MAP.nodes.find((n) => n.level_id === lid);
          if (!node) continue;
          if (v === null) {
            delete node.origin;
            changed.push(`unplaced ${lid}`);
          } else {
            node.pos = (v as { pos: [number, number] }).pos;
            node.origin = "manual";
            changed.push(`placed ${lid}`);
          }
        }
        MOCK_WORLD_MAP.manual_count = MOCK_WORLD_MAP.nodes.filter((n) => n.origin).length;
      }
      if (edit.edges) {
        MOCK_WORLD_MAP.edges = edit.edges as typeof MOCK_WORLD_MAP.edges;
        changed.push(`${MOCK_WORLD_MAP.edges.length} edge(s)`);
      }
      if ("locked" in edit) {
        MOCK_WORLD_MAP.locked = Boolean(edit.locked);
        changed.push(MOCK_WORLD_MAP.locked ? "locked" : "unlocked");
      }
      return { world_map: changed.length ? "updated" : "no_change", changed };
    }
    case "estimate_asset":
      return {
        result: "estimate",
        estimate: mockEstimate(String(args.op ?? "animate"), null, {
          image: String(args.imageBackend ?? "fake"),
          vlm: args.reuseSpec ? "none" : String(args.vlmBackend ?? "none"),
        }),
      };
    case "spend_record": {
      const entry = (args.entry ?? {}) as Record<string, unknown>;
      const line = { schema: "cradle-spend/v1", ts: new Date().toISOString(), ...entry };
      MOCK_SPEND.push(line);
      return { result: "spend_record", entry: line };
    }
    case "jobs_record": {
      const entry = (args.entry ?? {}) as Record<string, unknown>;
      const line = { schema: "cradle-jobs/v1", ts: new Date().toISOString(), ...entry };
      MOCK_JOBS.push(line);
      return { result: "jobs_record", entry: line };
    }
    case "jobs_list": {
      const byOp: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const e of MOCK_JOBS) {
        const op = String(e.op ?? e.scope ?? "unknown");
        const status = String(e.status ?? "unknown");
        byOp[op] = (byOp[op] ?? 0) + 1;
        byStatus[status] = (byStatus[status] ?? 0) + 1;
      }
      return {
        result: "jobs_list",
        jobs: { count: MOCK_JOBS.length, by_op: byOp, by_status: byStatus, entries: MOCK_JOBS },
      };
    }
    case "journal_list": {
      // I7 parity: same filters, same read-time defaults, same roll-up the
      // canon verb applies — computed by the SAME function the dashboard
      // falls back on, so the mock can never drift from the real shape.
      let events = MOCK_JOURNAL.map((e) => ({
        ...e,
        identity: e.identity || (e.actor?.startsWith("agent:") ? e.actor : "user"),
      }));
      if (args.identity) events = events.filter((e) => e.identity === args.identity);
      if (args.session) events = events.filter((e) => e.session === args.session);
      if (args.genKind) events = events.filter((e) => e.genKind === args.genKind);
      if (args.since) events = events.filter((e) => (e.ts ?? "") >= String(args.since));
      if (args.artifactPrefix) {
        events = events.filter((e) =>
          (e.artifact_id ?? "").startsWith(String(args.artifactPrefix)),
        );
      }
      if (typeof args.limit === "number") events = events.slice(-args.limit);
      // Parity with the verb: `--summary` REPLACES the event list unless the
      // caller bounded the read itself (canon `cli/main.py` journal_list).
      if (args.summary) {
        const summary = summarizeJournal(events, "2026-09-13");
        return typeof args.limit === "number"
          ? { result: "journal_list", events, summary }
          : { result: "journal_list", summary };
      }
      return { result: "journal_list", events };
    }
    case "spend_list": {
      const byOp: Record<string, { count: number; actual_usd: number; estimate_usd: number }> = {};
      let totalActual = 0;
      let totalEst = 0;
      for (const e of MOCK_SPEND) {
        const op = String(e.op ?? e.scope ?? "unknown");
        const actual = typeof e.actual_usd === "number" ? e.actual_usd : 0;
        const est = (e.estimate as { best?: number } | undefined)?.best ?? 0;
        const agg = (byOp[op] ??= { count: 0, actual_usd: 0, estimate_usd: 0 });
        agg.count += 1;
        agg.actual_usd += actual;
        agg.estimate_usd += est;
        totalActual += actual;
        totalEst += est;
      }
      return {
        result: "spend_list",
        spend: {
          count: MOCK_SPEND.length,
          total_actual_usd: Number(totalActual.toFixed(6)),
          total_estimate_usd: Number(totalEst.toFixed(6)),
          by_op: byOp,
          entries: MOCK_SPEND,
        },
      };
    }
    default:
      throw new Error(`devMock: unhandled command ${cmd}`);
  }
}

/** In-memory spend ledger for the browser mock (native writes .canon/spend.jsonl). */
// Typed against the real payload so a field canon adds can't be forgotten here
// — a mock that drifts from the read verb hides exactly the bugs it should
// catch (this file once made a read/write split invisible for a whole cycle).
const MOCK_WORLD_MAP: WorldMap = {
  world: "The Wandering Wick",
  nodes: [],
  edges: [],
  areas: [],
  locked: false,
  manual_count: 0,
};

/** Engine-runtime staleness for the mock. Starts BEHIND, like every real pack
 *  did — syncing flips it so the chip's whole lifecycle is exercisable. */
const MOCK_ENGINE = { current: false, stamped: false };

/** Hand-authored animation playback, keyed `<target>::<state>`. */
const MOCK_ANIM: Record<
  string,
  { offsets?: [number, number][]; durations_ms?: number[]; loop?: string }
> = {};

const MOCK_SPEND: Record<string, unknown>[] = [];
/** In-memory job ledger for the browser mock (native writes .canon/jobs.jsonl). */
const MOCK_JOBS: Record<string, unknown>[] = [];

/** In-memory provenance journal for the browser mock (row P1-A6; native reads
 *  `.canon/journal.jsonl` through `canon journal list`). Seeded with a spread
 *  the cost dashboard can actually be looked at: both doors (editor buttons and
 *  two agent conversations), tokens beside generation, a measured lane and an
 *  estimated one, an unpriced run, and a kind that is NOT in the launch list —
 *  because "a new generation kind is a field value, not a schema change"
 *  (README §12) is only true if the mock proves it. */
const MOCK_JOURNAL: JournalEvent[] = (() => {
  const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T12:0${n % 10}:00+00:00`;
  const row = (
    i: number,
    actor: string,
    genKind: string,
    costCents: number,
    backend: string,
    model: string,
    accuracy: string,
    extra: Partial<JournalEvent> = {},
  ): JournalEvent => {
    const identity = isAgentActor(actor) ? actor : "user";
    const session = parseActor(identity).conversation ?? undefined;
    return {
      schema: 1,
      ts: day(i),
      artifact_id: genKind === "tokens" ? `conversation:${session}` : `enemy:mock_${i}`,
      op: "generate",
      source: "llm",
      actor,
      identity,
      ...(session ? { session } : {}),
      detail: { kind: genKind === "tokens" ? "turn" : "asset_generate" },
      gen: { backend, model, cost_usd: costCents / 100 },
      genKind,
      costCents,
      accuracy,
      ...extra,
    };
  };
  return [
    row(1, USER_ACTOR, "image", 510, "fal", "flux-pixel-v2", "estimated"),
    row(2, USER_ACTOR, "animation", 162, "fal", "anim-lcm", "estimated"),
    row(3, USER_ACTOR, "video", 140, "runway", "gen-4", "estimated"),
    row(4, USER_ACTOR, "code", 31, "anthropic", "sonnet-4-6", "measured"),
    row(5, USER_ACTOR, "audio", 20, "fal", "stable-audio", "estimated"),
    row(6, agentActor("wick", "artist"), "image", 341, "pixellab", "pixflux", "measured"),
    row(7, agentActor("wick", "artist"), "tokens", 22, "anthropic", "sonnet-4-6", "measured"),
    row(8, agentActor("wick", "level_designer"), "animation", 16, "fal", "anim-lcm", "estimated"),
    row(
      9,
      agentActor("wick", "level_designer"),
      "tokens",
      48,
      "anthropic",
      "sonnet-4-6",
      "measured",
    ),
    row(10, agentActor("wick", "writer"), "tokens", 39, "anthropic", "sonnet-4-6", "measured"),
    // A kind nothing in the launch vocabulary knows about — it must render.
    row(11, agentActor("ember", "mesh_smith"), "mesh", 84, "meshy", "preview", "estimated"),
    row(12, agentActor("ember", "mesh_smith"), "tokens", 12, "anthropic", "sonnet-4-6", "measured"),
    // A paid run canon could not price: no costCents, no accuracy, a reason.
    {
      schema: 1,
      ts: day(13),
      artifact_id: "enemy:mock_unpriced",
      op: "regenerate",
      source: "llm",
      actor: USER_ACTOR,
      identity: "user",
      detail: { kind: "asset_generate", cost_error: "fal: no price row for 'fal-ai/new-thing'" },
      gen: { backend: "fal", model: "fal-ai/new-thing" },
      genKind: "image",
    },
  ];
})();

/** FNV-1a → 8 hex; a cheap synchronous content hash for the mock revision id
 *  (native uses a real sha256 over the level's state files). */
function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A mock revision derived from the bundle's mutable content — changes exactly
 *  when the content changes (mirrors canon's composite state hash). */
function mockRevision(b: Record<string, unknown>): { revision: string; revision_short: string } {
  const content = JSON.stringify([
    b.grids,
    b.entities,
    b.items,
    b.spawn,
    b.exit,
    b.hazards,
    b.music_path,
    b.music_sections,
  ]);
  const hex = hashStr(content) + hashStr(`${content.length}:${content}`);
  return { revision: `sha256:${hex}`, revision_short: hex.slice(0, 10) };
}

/** Record how the mock bundle last changed (the revision chip reads this). */
function stampChange(
  b: Record<string, unknown>,
  label: string,
  op = "edit",
  source = "user",
): void {
  b._last_change = {
    op,
    source,
    kind: "",
    actor: USER_ACTOR,
    ts: new Date().toISOString(),
    hash: "",
    label,
  };
}

/** Simulate the background-job lifecycle for the browser mock, which has no
 *  Tauri event bus. The gen handler has already applied its mutation; here we
 *  drive the same store transitions the Rust worker + App listener would
 *  (queued → running → done) via handleJobEvent, then return the queued ack so
 *  the enqueue call resolves immediately — the tray, badge, change-badge, and
 *  completion reload are all exercisable headless. */
function simulateJob(jobId: string | undefined, result: Record<string, unknown>): unknown {
  const id = String(jobId ?? "");
  if (!id) return result; // not a queued op (shouldn't happen) — behave synchronously
  setTimeout(() => void handleJobEvent({ id, status: "running" }), 60);
  setTimeout(() => void handleJobEvent({ id, status: "done", result }), 320);
  return { job_id: id, status: "queued" };
}

/** One node of a mocked run. `per` names the sub-phase unit a phase loops
 *  over, so the mock exercises the item line too. */
type MockPhase = { node: string; per?: "levels" | "enemies" | "sprites" | "stages" | "rooms" };

/** One SEGMENT of a run: canon's schedulers each open with a `run_start` and
 *  close with a `run_end`, and an ORCHESTRATED create is two of them (the
 *  macro bootstrap pass, then the full graph, which re-reports the macro nodes
 *  as skipped). `key` is the name that scheduler gives the step total —
 *  `phases` sequential, `nodes` orchestrated — because the relay must read
 *  either. */
type MockSegment = { key: "phases" | "nodes"; phases: MockPhase[]; skip?: string[] };

/** The platformer's MACRO pass — the six design phases that invent the stage
 *  plan the per-level graph expands against. */
const MOCK_MACRO: MockPhase[] = [
  { node: "phase:plat:world" },
  { node: "phase:plat:stage", per: "stages" },
  { node: "phase:plat:style" },
  { node: "phase:plat:enemies" },
  { node: "phase:plat:items" },
  { node: "phase:plat:tileset" },
];

/** The per-artifact layers the orchestrator emits for every level, in canon's
 *  dependency order — `level:<stage>/<level>/<layer>`. */
const MOCK_LEVEL_LAYERS = [
  "collision",
  "terrain",
  "background",
  "hazards",
  "triggers",
  "entities",
  "items",
  "foreground",
  "level",
];

/** The platformer's art/audio phases, which the graph pass runs beside the
 *  level nodes. */
const MOCK_PLAT_ART: MockPhase[] = [
  { node: "phase:plat:tileset_art", per: "stages" },
  { node: "phase:plat:sprite_art", per: "sprites" },
  { node: "phase:plat:sprite_animation", per: "enemies" },
  { node: "phase:plat:backdrop_art", per: "stages" },
  { node: "phase:plat:world_art" },
  { node: "phase:plat:audio", per: "stages" },
];

/** The two passes `canon world new --template platformer` emits under the
 *  create default (master §8 Q6, `--orchestrate`): 55-ish per-ARTIFACT nodes
 *  under `nodes`, not 21 phases under `phases`. I7 parity is the point — the
 *  mock must exercise the same relay path the native create does, or the
 *  browser proves a stream the app never sends. */
function mockPlatformerSegments(stages: number, levelsPerStage: number): MockSegment[] {
  const graph: MockPhase[] = [];
  for (let s = 1; s <= stages; s++) {
    for (let l = 1; l <= levelsPerStage; l++) {
      for (const layer of MOCK_LEVEL_LAYERS)
        graph.push({ node: `level:stage_${s}/l${l}/${layer}` });
      graph.push({ node: `review:stage_${s}/l${l}` });
    }
  }
  graph.push(...MOCK_PLAT_ART);
  graph.push({ node: "review:legend" });
  graph.push({ node: "plat:vlm_qa" });
  graph.push({ node: "plat:manifest" });
  const macro = MOCK_MACRO.map((p) => p.node);
  return [
    { key: "nodes", phases: MOCK_MACRO },
    { key: "nodes", phases: graph, skip: macro },
  ];
}

/** The dungeon pipeline (row P0-10), in canon's run order — the ids
 *  `canon.packs.dungeon.run_world`'s StepLog emits, so the mock exercises the
 *  SAME relay and the SAME template label map the native dungeon create does
 *  (I7 devMock parity). */
const MOCK_DUNGEON_PIPELINE: MockPhase[] = [
  { node: "phase:story" },
  { node: "phase:classes" },
  { node: "phase:maze_layout", per: "rooms" },
  { node: "phase:db:item", per: "rooms" },
  { node: "phase:db:monster", per: "rooms" },
  { node: "phase:db:npc", per: "rooms" },
  { node: "phase:db:event", per: "rooms" },
  { node: "phase:db:quest", per: "rooms" },
  { node: "phase:mazeworld_dialogue", per: "rooms" },
  { node: "phase:spell_pool" },
  { node: "phase:assets", per: "rooms" },
  { node: "phase:narrative", per: "rooms" },
  { node: "phase:mazeworld_placement", per: "rooms" },
  { node: "phase:validation" },
  { node: "phase:manifest" },
];

/** Pack dirs this session already handed out — the mock's stand-in for the
 *  native auto-uniquify (row P0-10). */
const MOCK_CREATED = new Set<string>();

/** Simulate a whole `world new` run for the browser mock: the `job-progress`
 *  step-log stream AND the lifecycle events, on one clock so they stay
 *  coherent. Paced so the tracker is actually WATCHABLE headless — the native
 *  $0 run is over in three seconds, and the case this display exists for is
 *  the paid one that takes minutes.
 *
 *  Row P0-10 parity (I7): the platformer replays the ORCHESTRATED shape the
 *  create default now emits — two `run_start`/`run_end` segments, the step
 *  total under `nodes`, and per-artifact `level:*` / `review:*` ids — so the
 *  browser exercises the same relay the app does. The dungeon is sequential
 *  (`phases`, one segment), which is what its runner emits. */
function simulateWorldRun(
  jobId: string,
  template: string,
  counts: Record<string, number>,
  result: Record<string, unknown>,
): void {
  if (!jobId) return;
  const n = (key: string, fallback: number) => Math.max(1, Number(counts[key] ?? fallback));
  const segments: MockSegment[] =
    template === "dungeon"
      ? [{ key: "phases", phases: MOCK_DUNGEON_PIPELINE }]
      : mockPlatformerSegments(n("stages", 1), n("levels", 2));
  const unit: Record<string, number> = {
    stages: n("stages", 1),
    levels: n("stages", 1) * n("levels", 2),
    enemies: n("enemies", 4),
    sprites: n("enemies", 4) + n("items", 4) + 1,
    rooms: n("rooms", 3),
  };
  const names: Record<string, (i: number) => string> = {
    stages: (i: number) => `stage_${i}`,
    levels: (i: number) => `l${i}`,
    enemies: (i: number) => `enemy:e${i}`,
    sprites: (i: number) => `sprite ${i}`,
    rooms: (i: number) => `room_${i - 1}`,
  };
  const stamp = () => new Date().toISOString();
  let at = 60;
  // Paced so the tracker is watchable whatever the run's size: ~6s of events,
  // floored so a short dungeon run doesn't blur past.
  const nodeCount = segments.reduce((sum, s) => sum + s.phases.length, 0);
  const step = Math.max(50, Math.min(260, Math.round(6000 / Math.max(1, nodeCount))));
  const fire = (fn: () => void, gap = step) => {
    setTimeout(fn, at);
    at += gap;
  };

  fire(() => void handleJobEvent({ id: jobId, status: "running" }), 40);
  for (const seg of segments) {
    const size = seg.phases.length + (seg.skip?.length ?? 0);
    fire(() =>
      handleJobProgress({
        id: jobId,
        ts: stamp(),
        event: "run_start",
        ...(seg.key === "phases" ? { phases: size } : { nodes: size }),
      }),
    );
    // The graph pass re-reports what the macro pass of the SAME run finished.
    for (const node of seg.skip ?? []) {
      fire(
        () =>
          handleJobProgress({
            id: jobId,
            ts: stamp(),
            event: "node_skipped",
            node,
            reason: "done",
          }),
        0,
      );
    }
    for (const phase of seg.phases) {
      fire(() =>
        handleJobProgress({ id: jobId, ts: stamp(), event: "node_start", node: phase.node }),
      );
      if (phase.per) {
        const total = unit[phase.per];
        const label = names[phase.per];
        for (let i = 1; i <= total; i++) {
          fire(
            () =>
              handleJobProgress({
                id: jobId,
                ts: stamp(),
                event: "node_item",
                node: phase.node,
                item: label(i),
                index: i,
                total,
              }),
            Math.max(60, step / total),
          );
        }
      }
      fire(() =>
        handleJobProgress({ id: jobId, ts: stamp(), event: "node_done", node: phase.node }),
      );
    }
    // NOT the end of the run when another segment follows — the terminal
    // event is the job's own `job-updated`, below.
    fire(() => handleJobProgress({ id: jobId, ts: stamp(), event: "run_end", ok: true }));
  }
  fire(() => void handleJobEvent({ id: jobId, status: "done", result }));
}

/** A plausible, backend-MASKED cost estimate for the mock — mirrors canon's
 *  masking (fake/none = $0, counts preserved) so the gate/dashboard UI is
 *  exercisable in the browser without the native pricing engine. */
function mockEstimate(
  scope: string,
  counts: { stages: number; levels: number; enemies: number; items: number } | null,
  backends: Record<string, string>,
): Record<string, unknown> {
  const paid = (kind: string, v?: string) => {
    const b = (v ?? "").toLowerCase();
    if (kind === "llm" || kind === "vlm") return b === "anthropic";
    if (kind === "image") return ["fal", "retro", "pixellab"].includes(b);
    if (kind === "music") return b === "lyria";
    if (kind === "sfx") return b === "elevenlabs";
    return false;
  };
  if (scope === "world" && counts) {
    const images = counts.stages * 18 + counts.enemies * 6 + counts.items + 8;
    const llmBest = Number((counts.levels * 0.13 + counts.stages * 0.05).toFixed(4));
    const imgUsd = paid("image", backends.image) ? Number((images * 0.04).toFixed(4)) : 0;
    const musicUsd = paid("music", backends.music) ? counts.stages * 0.1 : 0;
    const sfxUsd = paid("sfx", backends.sfx) ? 4 * 0.05 : 0;
    const vlmUsd = paid("vlm", backends.vlm) ? Number((counts.levels * 0.03).toFixed(4)) : 0;
    const llm = paid("llm", backends.llm)
      ? { best: llmBest, worst: Number((llmBest * 4).toFixed(4)) }
      : { best: 0, worst: 0 };
    const assetsBest = imgUsd + musicUsd + sfxUsd + vlmUsd;
    return {
      scope,
      backends,
      llm: { by_task: {}, calls: counts.levels + counts.stages, usd: llm },
      assets: {
        images: { count: images, usd: imgUsd },
        music: { count: paid("music", backends.music) ? counts.stages : 0, usd: musicUsd },
        sfx: { count: 4, usd: sfxUsd },
        vlm: { usd: { best: vlmUsd, worst: vlmUsd } },
        usd: { best: Number(assetsBest.toFixed(4)), worst: Number(assetsBest.toFixed(4)) },
      },
      total_usd: {
        best: Number((llm.best + assetsBest).toFixed(4)),
        worst: Number((llm.worst + assetsBest).toFixed(4)),
      },
      warnings: [],
    };
  }
  if (scope === "animate") {
    // Mock: 5 states x 1 facing (the canned enemy shape), one image call per
    // state — priced BY STATES, mirroring the real scope. reuse_spec drops
    // the vision call, which is passed in as vlm="none".
    const states = 5;
    const imgUsd = paid("image", backends.image) ? Number((states * 0.04).toFixed(4)) : 0;
    const vlmUsd = paid("vlm", backends.vlm) ? 0.0081 : 0;
    const assetsBest = imgUsd + vlmUsd;
    return {
      scope,
      backends,
      llm: { by_task: {}, calls: 0, usd: { best: 0, worst: 0 } },
      assets: {
        images: { count: states, usd: imgUsd },
        music: { count: 0, usd: 0 },
        sfx: { count: 0, usd: 0 },
        vlm: vlmUsd
          ? {
              model: "claude-sonnet-4-6",
              animation_authoring: 1,
              usd: { best: vlmUsd, worst: vlmUsd },
            }
          : {},
        usd: { best: assetsBest, worst: assetsBest },
      },
      total_usd: { best: assetsBest, worst: assetsBest },
      warnings: [],
    };
  }
  // Per-op: LLM-only, cents.
  const base: Record<string, number> = {
    generate: 0.075,
    layout: 0.064,
    enemies: 0.005,
    items: 0.005,
  };
  const best = paid("llm", backends.llm) ? (base[scope] ?? 0.03) : 0;
  return {
    scope,
    backends,
    llm: {
      by_task: {},
      calls: scope === "generate" ? 6 : 1,
      usd: { best, worst: Number((best * 4).toFixed(4)) },
    },
    assets: {
      images: { count: 0, usd: 0 },
      music: { count: 0, usd: 0 },
      sfx: { count: 0, usd: 0 },
      vlm: {},
      usd: { best: 0, worst: 0 },
    },
    total_usd: { best, worst: Number((best * 4).toFixed(4)) },
    warnings: [],
  };
}

export function installDevMock(): void {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (...a: unknown[]) => unknown };
  };
  if (w.__TAURI_INTERNALS__?.invoke) return; // real Tauri backend present
  // A fresh mock world per install: the dialogue store is module state that a
  // `dialogue_update` mutates, exactly as canon mutates a pack file.
  resetDialogueMock();
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      ensureData().then((d) => dispatch(cmd, args ?? {}, d)),
    transformCallback: (cb: unknown) => cb,
    // convertFileSrc identity: mock paths are already same-origin URLs.
    convertFileSrc: (p: string) => p,
  } as never;
  // The scripted agent behind `agentApi` (row P1-A5): every panel state
  // headless — streaming, the four errors, chips, the paid card's states,
  // run cards, plans, Stop. `mock:` commands drive the service states.
  installAgentMock(setAgentTransport);
  onMockServiceState((state) =>
    useStore.getState().setAgent((a) => ({ service: { ...a.service, ...(state as object) } })),
  );
}
