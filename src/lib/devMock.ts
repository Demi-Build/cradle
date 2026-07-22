// Dev-only Tauri shim. When VITE_CRADLE_MOCK is set, stands in for the Rust
// backend so the real cradle UI can run in a plain browser against real data
// (built by scratchpad/build_mockdata.py from an actual platformer pack). NOT
// bundled in production — main.tsx only imports this behind the env flag.

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
