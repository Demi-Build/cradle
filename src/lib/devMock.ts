// Dev-only Tauri shim. When VITE_CRADLE_MOCK is set, stands in for the Rust
// backend so the real cradle UI can run in a plain browser against real data
// (built by scratchpad/build_mockdata.py from an actual platformer pack). NOT
// bundled in production — main.tsx only imports this behind the env flag.

import { DB_NESTING } from "./dbNesting";

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

function dispatch(cmd: string, args: Record<string, unknown>, d: MockData): unknown {
  switch (cmd) {
    case "load_world":
      return { path: String(args.path ?? "mock://pack"), name: d.name, entity_counts: d.entity_counts };
    case "list_entities":
      return refsFor(d, String(args.typeId));
    case "list_entity_rows":
      return refsFor(d, String(args.typeId)).map((r) => ({
        id: r.id,
        data: jsonFor(d, String(args.typeId))[r.id] ?? {},
      }));
    case "get_entity":
      return jsonFor(d, String(args.typeId))[String(args.id)] ?? {};
    case "export_level":
      return d.bundles[String(args.levelId)] ?? null;
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
      return { level_id: lid, stage_id: stageId, dims: [w, h], draft: true };
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
    case "play_level":
    case "play_game":
      return { launched: false, note: "mock: playtesting launches from the native app" };
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
      return { target: String(args.target), generated: false, warnings: ["mock: real generation needs the native app"] };
    case "animate_asset":
      return { target: String(args.target), animated: false, states: [], warnings: ["mock: real animation needs the native app"] };
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
    default:
      throw new Error(`devMock: unhandled command ${cmd}`);
  }
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
