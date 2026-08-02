// Renders the level graph — nodes, typed edges, and the auto-hulled areas
// levels cluster under. Pure function of (map, mode, camera), mirroring
// drawLevel.ts so the two canvases share one shape.
//
// The design ships TWO canvas treatments over ONE graph — `schematic`
// (labelled cards, straight edges, dashed area hulls) and `overworld`
// (SMW-style tiles, dotted trails, painted areas). They are a RESTYLE, never a
// fork: same nodes, same edges, same hulls, different paint.

import type { WorldMap, WorldMapArea, WorldMapEdge, WorldMapNode } from "../../lib/invoke";

export type WorldMode = "schematic" | "overworld";
export type WorldSel =
  | { kind: "node"; id: string }
  | { kind: "area"; id: string }
  | { kind: "edge"; index: number };

export interface WorldCamera {
  ox: number;
  oy: number;
  zoom: number;
  viewW: number;
  viewH: number;
}

/** Logical world size the normalised 0..1 positions map onto. */
export const WORLD_W = 1120;
export const WORLD_H = 640;

const NODE_W = { schematic: 120, overworld: 54 };
const NODE_H = { schematic: 40, overworld: 54 };
/** Hull padding around member nodes (design: 22 schematic / 30 overworld). */
const HULL_PAD = { schematic: 22, overworld: 30 };

/** Per-area colour. Generated, not a fixed token: hues spaced around the wheel
 *  at one lightness so any number of areas stays distinguishable. */
export function areaHue(index: number): number {
  return (78 + index * 97) % 360;
}
const areaStroke = (i: number) => `oklch(72% 0.13 ${areaHue(i)})`;
const areaFill = (i: number) => `oklch(60% 0.13 ${areaHue(i)} / 0.10)`;
const areaInk = (i: number) => `oklch(82% 0.10 ${areaHue(i)})`;

export function nodeXY(n: WorldMapNode): { x: number; y: number } {
  return { x: n.pos[0] * WORLD_W, y: n.pos[1] * WORLD_H };
}

/** Area hulls are COMPUTED from member node bounds every render — never
 *  stored — so they re-fit on drag, on add, and across mode switches. */
export function areaHull(
  area: WorldMapArea,
  nodes: WorldMapNode[],
  mode: WorldMode,
): { x: number; y: number; w: number; h: number } | null {
  const members = nodes.filter((n) => area.level_ids.includes(n.level_id));
  if (!members.length) return null;
  const pad = HULL_PAD[mode];
  const halfW = NODE_W[mode] / 2;
  const halfH = NODE_H[mode] / 2;
  const xs = members.map((n) => nodeXY(n).x);
  const ys = members.map((n) => nodeXY(n).y);
  const x = Math.min(...xs) - halfW - pad;
  const y = Math.min(...ys) - halfH - pad;
  return {
    x,
    y,
    w: Math.max(...xs) + halfW + pad - x,
    h: Math.max(...ys) + halfH + pad - y,
  };
}

/** Hit-test in WORLD coordinates. Nodes win over areas — they sit on top. */
export function hitTest(
  map: WorldMap,
  mode: WorldMode,
  wx: number,
  wy: number,
): WorldSel | null {
  const halfW = NODE_W[mode] / 2;
  const halfH = NODE_H[mode] / 2;
  for (const n of map.nodes) {
    const { x, y } = nodeXY(n);
    if (Math.abs(wx - x) <= halfW && Math.abs(wy - y) <= halfH) {
      return { kind: "node", id: n.level_id };
    }
  }
  const byId = new Map(map.nodes.map((n) => [n.level_id, n]));
  for (let i = 0; i < map.edges.length; i++) {
    const e = map.edges[i];
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) continue;
    const p = nodeXY(a);
    const q = nodeXY(b);
    // Distance to the segment; 8px in world units is a comfortable target.
    const vx = q.x - p.x;
    const vy = q.y - p.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((wx - p.x) * vx + (wy - p.y) * vy) / len2));
    const dx = wx - (p.x + t * vx);
    const dy = wy - (p.y + t * vy);
    if (dx * dx + dy * dy <= 64) return { kind: "edge", index: i };
  }
  for (const area of map.areas) {
    const h = areaHull(area, map.nodes, mode);
    if (h && wx >= h.x && wx <= h.x + h.w && wy >= h.y && wy <= h.y + h.h) {
      return { kind: "area", id: area.stage_id };
    }
  }
  return null;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface DrawWorldOpts {
  mode?: WorldMode;
  camera: WorldCamera;
  selection?: WorldSel | null;
  /** Level thumbnails by level id (review renders), when loaded. */
  thumbs?: Record<string, HTMLImageElement>;
  /** Per-level validation verdicts, for the status dot. Absent = never
   *  validated, which is drawn as "unknown", NOT as passing. */
  status?: Record<string, { ok: boolean; problems: number }>;
  showStops?: boolean;
}

export function drawWorld(
  canvas: HTMLCanvasElement,
  map: WorldMap,
  opts: DrawWorldOpts,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const mode: WorldMode = opts.mode ?? "schematic";
  const cam = opts.camera;
  const sel = opts.selection ?? null;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  canvas.width = cam.viewW * dpr;
  canvas.height = cam.viewH * dpr;
  canvas.style.width = `${cam.viewW}px`;
  canvas.style.height = `${cam.viewH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cam.viewW, cam.viewH);

  // Backdrop, then the world through the camera.
  ctx.fillStyle = mode === "overworld" ? "#100e0b" : "#08090b";
  ctx.fillRect(0, 0, cam.viewW, cam.viewH);
  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.ox * dpr * cam.zoom, -cam.oy * dpr * cam.zoom);
  ctx.imageSmoothingEnabled = false;

  if (mode === "schematic") drawDotGrid(ctx, cam);

  const byId = new Map(map.nodes.map((n) => [n.level_id, n]));

  // Areas first — they sit under everything.
  map.areas.forEach((area, i) => {
    const h = areaHull(area, map.nodes, mode);
    if (!h) return;
    const selected = sel?.kind === "area" && sel.id === area.stage_id;
    ctx.save();
    ctx.strokeStyle = areaStroke(i);
    ctx.fillStyle = areaFill(i);
    ctx.lineWidth = mode === "overworld" ? 2 : 1;
    if (mode === "schematic" && !selected) ctx.setLineDash([6, 5]);
    roundRect(ctx, h.x, h.y, h.w, h.h, mode === "overworld" ? 30 : 16);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (selected) {
      ctx.strokeStyle = areaStroke(i);
      ctx.lineWidth = 2;
      roundRect(ctx, h.x - 2, h.y - 2, h.w + 4, h.h + 4, 18);
      ctx.stroke();
    }
    // Label tab: top-left in schematic, centred banner in overworld.
    const label = (area.biome || area.stage_id).toUpperCase();
    ctx.font =
      mode === "overworld"
        ? "600 12.5px ui-monospace, monospace"
        : "500 9.5px ui-monospace, monospace";
    const tw = ctx.measureText(label).width;
    const padX = mode === "overworld" ? 16 : 8;
    const bx = mode === "overworld" ? h.x + h.w / 2 - (tw + padX * 2) / 2 : h.x + 14;
    const by = mode === "overworld" ? h.y - 13 : h.y - 9;
    const bh = mode === "overworld" ? 24 : 16;
    ctx.fillStyle = "#0a0b0e";
    ctx.strokeStyle = areaStroke(i);
    roundRect(ctx, bx, by, tw + padX * 2, bh, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = areaInk(i);
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + padX, by + bh / 2);
    // Member count, bottom-right inside the hull.
    ctx.font = "9.5px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.globalAlpha = 0.8;
    ctx.fillText(`${area.level_ids.length} levels`, h.x + h.w - 12, h.y + h.h - 12);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.restore();
  });

  // Edges.
  map.edges.forEach((e, i) => {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) return;
    const p = nodeXY(a);
    const q = nodeXY(b);
    const selected = sel?.kind === "edge" && sel.index === i;
    ctx.save();
    ctx.lineCap = mode === "overworld" ? "round" : "butt";
    ctx.lineWidth = mode === "overworld" ? 4 : 2;
    ctx.strokeStyle = edgeColor(e, mode);
    if (mode === "overworld") ctx.setLineDash([2, 9]);
    if (e.kind === "lock") ctx.setLineDash([7, 5]);
    if (e.kind === "new") ctx.setLineDash([3, 6]);
    if (selected) {
      ctx.strokeStyle = "oklch(72% 0.13 78)";
      ctx.lineWidth = mode === "overworld" ? 5 : 3;
    }
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // One-way gets an arrowhead at the midpoint.
    if (e.kind === "one") {
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      ctx.fillStyle = "rgba(232,230,223,0.6)";
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(ang) * 8, my + Math.sin(ang) * 8);
      ctx.lineTo(mx + Math.cos(ang + 2.5) * 8, my + Math.sin(ang + 2.5) * 8);
      ctx.lineTo(mx + Math.cos(ang - 2.5) * 8, my + Math.sin(ang - 2.5) * 8);
      ctx.closePath();
      ctx.fill();
    }
    // Path stop: a diamond where the player can pause and hunt secret exits.
    if (e.stop && opts.showStops !== false) {
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#0a0b0e";
      ctx.strokeStyle = "oklch(74% 0.12 300)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    }
    ctx.restore();
  });

  // Nodes on top.
  for (const n of map.nodes) {
    const { x, y } = nodeXY(n);
    const w = NODE_W[mode];
    const h = NODE_H[mode];
    const selected = sel?.kind === "node" && sel.id === n.level_id;
    const planned = n.status === "planned";
    const left = x - w / 2;
    const top = y - h / 2;
    ctx.save();
    // A planned node is translucent + dashed: placed, but not yet built.
    ctx.fillStyle = planned ? "rgba(21,23,28,0.5)" : "#15171c";
    ctx.strokeStyle = selected ? "#e8e6df" : "#2e323b";
    ctx.lineWidth = selected ? 2 : mode === "overworld" ? 2 : 1;
    if (planned && !selected) ctx.setLineDash([4, 4]);
    roundRect(ctx, left, top, w, h, mode === "overworld" ? 7 : 5);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    const thumb = opts.thumbs?.[n.level_id];
    if (mode === "overworld") {
      if (thumb) {
        ctx.save();
        roundRect(ctx, left + 2, top + 2, w - 4, h - 4, 4);
        ctx.clip();
        ctx.drawImage(thumb, left + 2, top + 2, w - 4, h - 4);
        ctx.restore();
      }
      // Id pill below the tile.
      ctx.font = "500 10px ui-monospace, monospace";
      const label = n.display_name ?? n.level_id;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(10,11,14,0.86)";
      ctx.strokeStyle = "#2e323b";
      ctx.lineWidth = 1;
      roundRect(ctx, x - (tw + 14) / 2, top + h + 7, tw + 14, 16, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e8e6df";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x - tw / 2, top + h + 15);
    } else {
      if (thumb) {
        ctx.save();
        roundRect(ctx, left + 8, top + 8, 24, 24, 3);
        ctx.clip();
        ctx.drawImage(thumb, left + 8, top + 8, 24, 24);
        ctx.restore();
      } else {
        ctx.fillStyle = "#0a0a0d";
        roundRect(ctx, left + 8, top + 8, 24, 24, 3);
        ctx.fill();
        if (planned) {
          // No art yet — the design uses a + glyph in place of a thumbnail.
          ctx.fillStyle = "#5e5d55";
          ctx.font = "15px ui-monospace, monospace";
          ctx.textBaseline = "middle";
          ctx.fillText("+", left + 16, y);
        }
      }
      ctx.textBaseline = "middle";
      ctx.font = "500 11px ui-monospace, monospace";
      ctx.fillStyle = planned ? "#9a988e" : "#e8e6df";
      ctx.fillText(n.display_name ?? n.level_id, left + 40, y - 6);
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillStyle = "#5e5d55";
      ctx.fillText(n.level_id, left + 40, y + 7);
      // Manual placement gets an accent bar on the card's left edge.
      if (n.origin === "manual") {
        ctx.fillStyle = "oklch(72% 0.13 78)";
        ctx.fillRect(left, top + 1, 2, h - 2);
      }
    }
    drawStatusDot(ctx, n, opts.status?.[n.level_id], left + w, top);
    ctx.restore();
  }
}

/** ok = green · problems = amber · planned = dim · never validated = hollow.
 *  An unvalidated level must NOT read as passing — that would be a lie the
 *  map tells at a glance. */
function drawStatusDot(
  ctx: CanvasRenderingContext2D,
  n: WorldMapNode,
  verdict: { ok: boolean; problems: number } | undefined,
  x: number,
  y: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x - 3, y + 3, 3.5, 0, Math.PI * 2);
  if (n.status === "planned") {
    ctx.fillStyle = "#5e5d55";
    ctx.fill();
  } else if (!verdict) {
    ctx.strokeStyle = "#5e5d55";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    ctx.fillStyle = verdict.ok
      ? "oklch(68% 0.13 150)"
      : "oklch(62% 0.18 25)";
    ctx.fill();
  }
  ctx.strokeStyle = "#0e0f12";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function edgeColor(e: WorldMapEdge, mode: WorldMode): string {
  if (e.kind === "lock") return "oklch(72% 0.14 45 / 0.8)";
  if (e.kind === "new") return "#5e5d55";
  if (mode === "overworld") return "rgba(232,230,223,0.5)";
  return e.kind === "one" ? "rgba(232,230,223,0.38)" : "rgba(232,230,223,0.26)";
}

function drawDotGrid(ctx: CanvasRenderingContext2D, cam: WorldCamera) {
  const step = 26;
  const x0 = Math.floor(cam.ox / step) * step;
  const y0 = Math.floor(cam.oy / step) * step;
  const x1 = cam.ox + cam.viewW / cam.zoom;
  const y1 = cam.oy + cam.viewH / cam.zoom;
  ctx.fillStyle = "rgba(232,230,223,0.085)";
  for (let x = x0; x <= x1; x += step) {
    for (let y = y0; y <= y1; y += step) ctx.fillRect(x, y, 1, 1);
  }
}
