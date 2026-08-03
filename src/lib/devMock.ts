// Dev-only Tauri shim. When VITE_CRADLE_MOCK is set, stands in for the Rust
// backend so the real cradle UI can run in a plain browser against real data
// (built by scratchpad/build_mockdata.py from an actual platformer pack). NOT
// bundled in production — main.tsx only imports this behind the env flag.

import { DB_NESTING } from "./dbNesting";
import { handleJobEvent } from "./jobs";
import type { WorldMap } from "./invoke";

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
      archetype: { choices: [["patroller", 5], ["sentry", 1], ["swimmer", 3], ["flyer", 2], ["hopper", 4]] },
      rarity: { choices: [["common", 3], ["uncommon", 2], ["rare", 1]] },
      size: { choices: [[1.0, 4], [1.5, 2], [2.0, 1]] },
      hp: { lookup: [[1.0, [4, 6]], [1.5, [7, 12]], [2.0, [13, 18]]], depends_on: "size", lookup_ranges: true },
      speed: { lookup: [["patroller", 2], ["sentry", 0], ["swimmer", 2], ["flyer", 2], ["hopper", 4]], depends_on: "archetype" },
      patrol_range: { range: [3, 8] },
    },
  },
  item: {
    schema_version: "3",
    entity_type: "item",
    fields: {
      kind: { choices: [["coin", 6], ["heal", 3], ["shield", 1], ["double_jump", 1], ["run_boost", 1]] },
      rarity: { choices: [["common", 3], ["uncommon", 2], ["rare", 1]] },
      coin_value: { lookup: [["coin", 1], ["heal", 0], ["shield", 0], ["double_jump", 0], ["run_boost", 0]], depends_on: "kind" },
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
const MOCK_PLAYER_REF: Ref[] = [
  { type_id: "player", id: "player", name: "Player" },
];

function dispatch(cmd: string, args: Record<string, unknown>, d: MockData): unknown {
  switch (cmd) {
    case "load_world":
      return {
        path: String(args.path ?? "mock://pack"),
        name: d.name,
        // Splice the synthesized player in after levels, matching the Rust
        // registry order so the ACTORS group renders contiguously.
        entity_counts: d.entity_counts.some((c) => c.type_id === "player")
          ? d.entity_counts
          : [
              ...d.entity_counts.slice(0, 1),
              { type_id: "player", count: 1 },
              ...d.entity_counts.slice(1),
            ],
      };
    case "list_entities":
      return String(args.typeId) === "player"
        ? MOCK_PLAYER_REF
        : refsFor(d, String(args.typeId));
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
      return String(args.typeId) === "player"
        ? (MOCK_PLAYER_ROW[String(args.id)] ?? {})
        : (jsonFor(d, String(args.typeId))[String(args.id)] ?? {});
    case "export_level": {
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
      const b = d.bundles[String(args.levelId)] as Record<string, unknown> | undefined;
      if (b) {
        if (edit.entities) {
          const prev = b.entities as Record<string, unknown>[];
          b.entities = (edit.entities as Record<string, unknown>[]).map((e) => ({
            ...(prev.find((p) => p.enemy_id === e.enemy_id && p.x === e.x && p.y === e.y) ?? {
              name: e.enemy_id, archetype: null, size: 1,
              placeholder_color: "#ff00ff", sprite_path_abs: null,
            }),
            ...e,
          }));
        }
        if (edit.items) {
          const prev = b.items as Record<string, unknown>[];
          b.items = (edit.items as Record<string, unknown>[]).map((it) => ({
            ...(prev.find((p) => p.item_id === it.item_id && p.x === it.x && p.y === it.y) ?? {
              name: it.item_id, kind: null,
              placeholder_color: "#ffd700", sprite_path_abs: null,
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
        stampChange(b as unknown as Record<string, unknown>, "Hand-painted terrain", "edit", "user");
      }
      return { level_id: String(args.levelId), updated: ["collision"], status: "user_edited" };
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
      // Mock: the browser can't scaffold a real pack — hand back the demo
      // path so the open-flow works for UI testing. Real scaffold is native.
      return {
        pack_dir: "mock://plat_pack",
        world: String(args.name ?? "My Platformer"),
        seed: "mock",
      };
    }
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
        level_id: lid, stage_id: stageId, ok: true, repair_count: 0,
        layout_fallback: false, seed: "mock-seed", warnings: [],
        changed: true, changed_artifacts: [`level:${stageId}/${lid}/collision`],
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
        b, cmd === "place_enemies" ? "Placed enemies" : "Placed items",
        "generate", "llm",
      );
      return simulateJob(args.jobId as string, {
        level_id: lid, stage_id: b.stage_id, ok: true, repair_count: 0,
        layout_fallback: false, seed: "mock-seed", warnings: [],
        changed: true, changed_artifacts: [`level:${b.stage_id}/${lid}/${step}`],
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
        level_id: lid, stage_id: b.stage_id, ok: true, repair_count: 0,
        layout_fallback: false, seed: "mock-seed", warnings: [],
        changed: true, changed_artifacts: [`level:${b.stage_id}/${lid}/collision`],
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
        level_id: lid, stage_id: b.stage_id, ok: true, repair_count: 0,
        layout_fallback: false, seed: "mock-seed", improved: true, warnings: [],
        cost: { usd: 0, input_tokens: 0, output_tokens: 0, calls: 1, backend: "fake" },
        changed,
        changed_artifacts: changed ? [`level:${b.stage_id}/${lid}/collision`] : [],
      });
    }
    case "db_types":
      return { types: d.dbTypes ?? {} };
    case "db_new": {
      // Mock: synthesize a row locally so the table flow is visible; native
      // runs the real anchored generation via canon.
      const t = String(args.entityType);
      const f = (args.fields as Record<string, unknown>) ?? {};
      const name = String(f.name ?? `Mock ${t}`);
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const row = {
        [`${t}_id`]: id, name,
        archetype: f.archetype ?? "patroller", kind: f.kind ?? "coin",
        size: f.size ?? 1, rarity: f.rarity ?? "common",
        stats: { hp: 6, damage: 1, speed: 2, flavor: "(mock roll — native runs canon)", placeholder_color: "#7c5cff" },
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
        const tilesets = (d.tilesetJson ?? {}) as Record<string, { stage_id?: string; slots?: Record<string, unknown>[] }>;
        const manifest = Object.values(tilesets).find((m) => m?.stage_id === stageId);
        const slots = (manifest?.slots ?? []).filter((s) => s.name === tileName);
        for (const slot of slots) {
          if (typeof set.collision === "string") slot.collision = set.collision;
          if (set.params && typeof set.params === "object") {
            slot.params = { ...(slot.params as Record<string, unknown>), ...(set.params as Record<string, unknown>) };
          }
        }
        return { stage: stageId, tile: tileName, slots: slots.length, changed: set };
      }
      const jmapKey = t === "enemy" ? "enemyJson" : "itemJson";
      const jmap = ((d[jmapKey as "enemyJson"] as JsonMap) ?? {});
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
            library_id: "lib-mock-wisp", ts: "2026-07-22T18:00:00", kind: "enemy_def",
            name: "Ember Wisp", tags: ["fire", "flyer"],
            source: { pack: "/mock/plat_other", world: "Cinder Vale", artifact_id: "enemy:ember_wisp", target: "enemy:ember_wisp" },
            objects: { row: "sha256:mockrow-wisp", sprite: "sha256:mocksprite-wisp" },
            meta: {}, preview: "sha256:mocksprite-wisp", actor: "cradle:user",
          },
          {
            library_id: "lib-mock-band", ts: "2026-07-21T10:00:00", kind: "backdrop",
            name: "dusk pines band", tags: [],
            source: { pack: String(args.project ?? "/mock/this"), world: d.name, artifact_id: "backdrop:s1", target: "backdrop:s1/1" },
            objects: { art: "sha256:mocksprite-band" },
            meta: { depth: 0.5 }, preview: "sha256:mocksprite-band", actor: "cradle:user",
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
        library_id: "lib-mock-new", kind: "enemy_def",
        name: String(args.target), tags: [],
        source: { pack: "/mock/this", world: d.name, artifact_id: String(args.target), target: String(args.target) },
        objects: {}, meta: {}, preview: "", actor: "cradle:user",
      };
    case "library_import": {
      // Mock: land a visible row so the select-after-import flow demos.
      const id = "ember_wisp";
      const row = {
        enemy_id: id, name: "Ember Wisp", archetype: "flyer", size: 1, rarity: "uncommon",
        status: "user_edited",
        stats: {
          hp: 5, damage: 1, speed: 2, flavor: "(imported from the library — mock)",
          placeholder_color: "#ff7043",
          library_ref: { library_id: String(args.id), source_pack: "/mock/plat_other", source_artifact: "enemy:ember_wisp" },
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
        hash: String(args.hash), size: 68,
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
          { id: rowA, facet: "row", op: "generate", source: "llm", actor: "canon", ts: "2026-07-20T10:00:00", gen: { llm_model: "claude-haiku", prompt: "Design a small patrolling creature themed to candle-lit woods. Return JSON with name and flavor." }, artifacts: [target], current_of: [], usage: { [target]: ["l1", "l3"] }, detail: {}, depth: 0 },
          { id: rowB, facet: "row", op: "edit", source: "user", actor: "cradle:user", ts: "2026-07-22T09:00:00", gen: null, artifacts: [target], current_of: [`${target}#row`], usage: { [target]: ["l1", "l3"] }, detail: {}, depth: 1 },
          { id: spr, facet: "sprite", op: "import", source: "import", actor: "cradle:user", ts: "2026-07-21T12:00:00", gen: null, artifacts: [target], current_of: [`${target}#sprite`], usage: {}, detail: {}, depth: 0 },
        ],
        edges: [{ from: rowA, to: rowB, op: "edit", kind: "db_update", actor: "cradle:user", ts: "" }],
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
          hash: h, size: 68,
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
          { name: "terrain", problems: [], notes: ["mock: native runs canon's jump-arc simulation"] },
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
          sprite: "image", music: "audio", animate: "vlm",
        };
        const PROMPTS: Record<string, string> = {
          sprite: `Single game sprite: ${args.target ?? "the actor"}, full body, side view facing right, centered, isolated on a plain solid white background. No shadow, no text. (mock)`,
          music:
            "Looping instrumental theme for a retro platformer level. Melodic, atmospheric, seamless loop, no vocals. (mock)",
          // The VLM's motion-spec AUTHORING prompt — one call per run, NOT the
          // per-state img2img sheet prompt.
          animate:
            `### TASK: plat_animate\n### ACTOR: ${args.target ?? "the actor"}\n\nYou are a 2D sprite animator. The attached image is the ACTUAL generated sprite for this character — describe how THIS character moves in each state.\n\nStates to author (use these exact keys):\n  - "idle": at rest / holding position\n  - "walk": actively moving along its path\n  - "hurt": recoiling from a hit\n  - "death": defeated\n  - "jump": the RISING launch\n\nReturn ONE JSON object. (mock)`,
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
    case "sandbox_level":
      // Mock the canon verb: a reserved-id draft room, idempotent.
      return { level_id: "sandbox", stage_id: "mock_stage", created: false };
    case "provider_keys":
      // Mock: pretend the usual keys are present so paid gates are reachable
      // headless; the native app reports what it can actually see.
      return {
        env_file: "mock://.env",
        keys: ["ANTHROPIC_API_KEY", "FAL_KEY", "GOOGLE_API_KEY"],
      };
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
        target: String(args.target), generated: true, changed: true,
        changed_artifacts: [String(args.target)],
        cost: { usd: 0, input_tokens: 0, output_tokens: 0, calls: 0, backend: "fake" },
        warnings: ["mock: real bytes need the native app"],
      });
    case "animate_asset":
      return simulateJob(args.jobId as string, {
        target: String(args.target), animated: true,
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
        level_id: lid, stage_id: stage, target: `music:${stage}/${lid}`,
        music_path: rel,
        cost: {
          usd: 0, llm_usd: 0, image_usd: 0, audio_usd: 0,
          input_tokens: 0, output_tokens: 0, calls: 0,
          backend: String(args.musicBackend ?? "fake"),
        },
        warnings: [],
        changed: true, changed_artifacts: [`level:${stage}/${lid}/music`],
      });
    }
    case "list_music_tracks": {
      const seen = new Set<string>();
      const tracks: { path: string; label: string }[] = [];
      for (const bb of Object.values(d.bundles) as Record<string, unknown>[]) {
        const st = String(bb.stage_id ?? "s1");
        const p = `music/${st}/theme.mp3`;
        if (!seen.has(p)) { seen.add(p); tracks.push({ path: p, label: `${st}/theme.mp3` }); }
        if (bb.music_path) {
          const mp = String(bb.music_path);
          if (!seen.has(mp)) { seen.add(mp); tracks.push({ path: mp, label: mp.slice("music/".length) }); }
        }
      }
      return { tracks };
    }
    case "estimate_world":
      return {
        result: "estimate",
        estimate: mockEstimate("world", {
          stages: Number(args.stages ?? 3),
          levels: Number(args.levels ?? 9),
          enemies: Number(args.enemies ?? 7),
          items: Number(args.items ?? 5),
        }, {
          llm: String(args.llmBackend ?? "fake"),
          image: String(args.imageBackend ?? "fake"),
          music: String(args.musicBackend ?? "none"),
          sfx: String(args.sfxBackend ?? "none"),
          vlm: String(args.vlmBackend ?? "none"),
        }),
      };
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
        mk("fall", 3, "loop", [[9, 12, 14, 20], [11, 0, 10, 32], [11, 0, 10, 32]]),
        mk("idle", 3, "loop", [[5, 0, 22, 32], [4, 1, 24, 31], [4, 0, 24, 32]]),
        mk("jump", 4, "once", [[2, 0, 28, 32], [3, 0, 26, 32], [2, 0, 28, 32], [3, 1, 26, 31]]),
        mk("land", 3, "once", [[3, 0, 26, 32], [3, 2, 26, 30], [3, 0, 26, 32]]),
        mk("walk", 8, "loop", [
          [6, 1, 20, 31], [6, 0, 20, 32], [7, 1, 18, 31], [6, 0, 20, 32],
          [6, 1, 20, 31], [6, 0, 20, 32], [7, 1, 18, 31], [6, 0, 20, 32],
        ]),
      ];
      const flush = states.filter((s) => s.flush).map((s) => s.state);
      return {
        animation: {
          target: String(args.target ?? "player"),
          label: String(args.target ?? "player").split(":").pop(),
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
        ? { frames_edit: "updated", target: args.target, state: args.state, fields: Object.keys(patch).sort() }
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
              state: MOCK_ENGINE.current
                ? "current"
                : MOCK_ENGINE.stamped
                  ? "stale"
                  : "unstamped",
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
                a: `l${i}`, b: lid, kind: "path",
              });
            }
            i++;
          }
        }
        MOCK_WORLD_MAP.areas = stages.map((sid, idx) => ({
          stage_id: sid, index: idx,
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
    b.grids, b.entities, b.items, b.spawn, b.exit, b.hazards,
    b.music_path, b.music_sections,
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
    op, source, kind: "", actor: "cradle:user",
    ts: new Date().toISOString(), hash: "", label,
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
    const llm = paid("llm", backends.llm) ? { best: llmBest, worst: Number((llmBest * 4).toFixed(4)) } : { best: 0, worst: 0 };
    const assetsBest = imgUsd + musicUsd + sfxUsd + vlmUsd;
    return {
      scope, backends,
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
      scope, backends,
      llm: { by_task: {}, calls: 0, usd: { best: 0, worst: 0 } },
      assets: {
        images: { count: states, usd: imgUsd },
        music: { count: 0, usd: 0 },
        sfx: { count: 0, usd: 0 },
        vlm: vlmUsd
          ? { model: "claude-sonnet-4-6", animation_authoring: 1, usd: { best: vlmUsd, worst: vlmUsd } }
          : {},
        usd: { best: assetsBest, worst: assetsBest },
      },
      total_usd: { best: assetsBest, worst: assetsBest },
      warnings: [],
    };
  }
  // Per-op: LLM-only, cents.
  const base: Record<string, number> = { generate: 0.075, layout: 0.064, enemies: 0.005, items: 0.005 };
  const best = paid("llm", backends.llm) ? (base[scope] ?? 0.03) : 0;
  return {
    scope, backends,
    llm: { by_task: {}, calls: scope === "generate" ? 6 : 1, usd: { best, worst: Number((best * 4).toFixed(4)) } },
    assets: { images: { count: 0, usd: 0 }, music: { count: 0, usd: 0 }, sfx: { count: 0, usd: 0 }, vlm: {}, usd: { best: 0, worst: 0 } },
    total_usd: { best, worst: Number((best * 4).toFixed(4)) },
    warnings: [],
  };
}

export function installDevMock(): void {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (...a: unknown[]) => unknown };
  };
  if (w.__TAURI_INTERNALS__?.invoke) return; // real Tauri backend present
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      ensureData().then((d) => dispatch(cmd, args ?? {}, d)),
    transformCallback: (cb: unknown) => cb,
    // convertFileSrc identity: mock paths are already same-origin URLs.
    convertFileSrc: (p: string) => p,
  } as never;
}
