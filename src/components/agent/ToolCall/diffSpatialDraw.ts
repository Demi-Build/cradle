// The spatial diff's pure half (row P1-A5, README §5). Lives beside
// `DiffSpatial.tsx` so the component file exports only a component; the
// drawing itself is the editor's own `drawLevel`, never a second renderer.

import {
  drawLevel,
  type LevelBundle,
  type LevelEntity,
  type LevelItem,
} from "../../level/drawLevel";
import { readCanvasTheme } from "../../../lib/canvasTheme";
import type { SpatialSnapshot } from "../../../lib/agentState";

const MAX_SCALE = 10;

/** A snapshot (whatever subset of a level the write payload carried) as a
 *  full `LevelBundle`, defaulting everything `drawLevel` needs. */
export function toBundle(snap: SpatialSnapshot): LevelBundle {
  const grids = (snap.grids ?? {}) as Record<string, number[][] | undefined>;
  const collision = grids.collision ?? [];
  const H = typeof snap.grid_height === "number" ? snap.grid_height : collision.length;
  const W =
    typeof snap.grid_width === "number"
      ? snap.grid_width
      : Math.max(0, ...collision.map((r) => r.length));
  const zeros = Array.from({ length: H }, () => Array.from({ length: W }, () => 0));
  const ent = (Array.isArray(snap.entities) ? snap.entities : []) as Partial<LevelEntity>[];
  const items = (Array.isArray(snap.items) ? snap.items : []) as Partial<LevelItem>[];
  const palette = {
    background: "#141018",
    ground: "#776459",
    platform: "#b8804a",
    wall: "#5b4d5e",
    danger: "#e0453a",
    water: "#3a6ea5",
    ...((snap.palette as Record<string, string>) ?? {}),
  };
  const slot = (index: number, name: string, collisionKind: string) => ({
    index,
    tile_type: index,
    name,
    px_region: [0, 0, 16, 16] as [number, number, number, number],
    collision: collisionKind,
    params: {},
  });
  const slots = [
    slot(0, "empty", "empty"),
    slot(1, "floor", "solid"),
    slot(2, "platform", "one_way"),
    slot(3, "wall", "solid"),
    slot(4, "spike", "hazard"),
    slot(5, "water", "volume"),
  ];
  const tiles_by_type: Record<string, (typeof slots)[number]> = {};
  for (const s of slots) tiles_by_type[String(s.tile_type)] = s;
  return {
    level_id: String(snap.level_id ?? "level"),
    stage_id: String(snap.stage_id ?? ""),
    display_name: null,
    grid_width: W,
    grid_height: H,
    spawn: (snap.spawn as [number, number] | null) ?? null,
    exit: (snap.exit as [number, number] | null) ?? null,
    layout_fallback: false,
    parent_level: null,
    brief: null,
    tile_px: 16,
    actor_scale: 1,
    water_alpha: 0.5,
    grids: {
      collision: collision.length ? collision : zeros,
      terrain: grids.terrain ?? (collision.length ? collision : zeros),
      background: grids.background ?? zeros,
    },
    tileset: { palette, slots, render_filter: "", tilesheet_path_abs: null },
    tiles_by_type,
    hazards: [],
    triggers: (snap.triggers as LevelBundle["triggers"]) ?? [],
    foreground: [],
    entities: ent.map((e, i) => ({
      enemy_id: String(e.enemy_id ?? "enemy"),
      x: Number(e.x ?? 0),
      y: Number(e.y ?? 0),
      variant: null,
      name: String(e.name ?? e.enemy_id ?? `enemy ${i + 1}`),
      archetype: null,
      size: Number(e.size ?? 1),
      placeholder_color: String(e.placeholder_color ?? "#e0453a"),
      sprite_path_abs: null,
    })),
    items: items.map((it, i) => ({
      item_id: String(it.item_id ?? "item"),
      x: Number(it.x ?? 0),
      y: Number(it.y ?? 0),
      source: null,
      name: String(it.name ?? it.item_id ?? `item ${i + 1}`),
      kind: null,
      placeholder_color: String(it.placeholder_color ?? "#f2c14e"),
      sprite_path_abs: null,
    })),
    props: {},
    backdrop: null,
  };
}

/** Integer scale that fits `W` cells into `avail` px: never fractional,
 *  never below 1 — the remainder letterboxes. */
export function integerScale(W: number, avail: number): number {
  if (W <= 0) return 1;
  return Math.max(1, Math.min(MAX_SCALE, Math.floor(avail / W)));
}

/** Cells occupied by placements (entities + items) in `after` and not in
 *  `before` — what the after canvas tints green. */
export function addedCells(before: LevelBundle, after: LevelBundle): [number, number][] {
  const key = (x: number, y: number, k: string) => `${k}:${x},${y}`;
  const had = new Set<string>();
  for (const e of before.entities) had.add(key(e.x, e.y, e.enemy_id));
  for (const i of before.items) had.add(key(i.x, i.y, i.item_id));
  const out: [number, number][] = [];
  for (const e of after.entities) if (!had.has(key(e.x, e.y, e.enemy_id))) out.push([e.x, e.y]);
  for (const i of after.items) if (!had.has(key(i.x, i.y, i.item_id))) out.push([i.x, i.y]);
  return out;
}

/** Draw one side. Exported so the test can drive it with a recording 2D
 *  context (jsdom has no canvas). */
export function drawSpatial(
  canvas: HTMLCanvasElement,
  bundle: LevelBundle,
  scale: number,
  added: [number, number][] = [],
): void {
  drawLevel(canvas, bundle, { scale, mode: "blocks", showGrid: false, showLabels: false });
  if (!added.length) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const theme = readCanvasTheme(canvas);
  ctx.save();
  ctx.fillStyle = theme.ok;
  ctx.globalAlpha = 0.55;
  for (const [x, y] of added) ctx.fillRect(x * scale, y * scale, scale, scale);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.ok;
  ctx.lineWidth = 1;
  for (const [x, y] of added)
    ctx.strokeRect(x * scale + 0.5, y * scale + 0.5, scale - 1, scale - 1);
  ctx.restore();
}
