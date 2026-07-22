// Renders a canon platformer level bundle onto a 2D canvas in one of three
// modes — blocks (placeholder colors), art (real tilesheet + sprites, mirrors
// canon's *_skinned.png), or overlay (art + a collision tint for editing). The
// render is a pure function of (bundle, mode, images): the same edit interactions
// drive every mode. `images` is a preloaded url->HTMLImageElement cache; any
// missing image degrades gracefully to the block representation for that element.

export interface TileSlot {
  index: number;
  tile_type: number;
  name: string;
  px_region: [number, number, number, number];
  collision: string; // empty | solid | one_way | hazard | volume
  params: Record<string, unknown>;
}

export interface LevelEntity {
  enemy_id: string;
  x: number;
  y: number;
  variant: string | null;
  name: string;
  archetype: string | null;
  size: number;
  placeholder_color: string;
  sprite_path_abs: string | null;
}

export interface LevelItem {
  item_id: string;
  x: number;
  y: number;
  source: string | null;
  name: string;
  kind: string | null;
  placeholder_color: string;
  sprite_path_abs: string | null;
}

export interface SparseEntry {
  x: number;
  y: number;
  type: string;
  params?: Record<string, unknown>;
}

export interface LevelBundle {
  level_id: string;
  stage_id: string;
  display_name: string | null;
  grid_width: number;
  grid_height: number;
  spawn: [number, number] | null;
  exit: [number, number] | null;
  layout_fallback: boolean;
  parent_level: string | null;
  brief: string | null;
  variants?: string[];
  tile_px: number;
  actor_scale: number;
  water_alpha: number;
  grids: { collision: number[][]; terrain: number[][]; background: number[][] };
  tileset: {
    palette: Record<string, string>;
    slots: TileSlot[];
    render_filter: string;
    tilesheet_path_abs: string | null;
  };
  tiles_by_type: Record<string, TileSlot>;
  hazards: SparseEntry[];
  triggers: SparseEntry[];
  foreground: SparseEntry[];
  entities: LevelEntity[];
  items: LevelItem[];
  props: Record<string, string | null>;
  backdrop: { depths: number[]; band_paths_abs: (string | null)[] } | null;
}

export type RenderMode = "blocks" | "art" | "overlay";

export type SelKind = "enemy" | "item" | "trigger" | "spawn" | "exit";
export interface Selection {
  kind: SelKind;
  index: number;
}
export interface Handle extends Selection {
  cx: number; // cell-center coords
  cy: number;
}

/** Every draggable/selectable object in the level, as cell-center handles. */
export function levelHandles(b: LevelBundle): Handle[] {
  const h: Handle[] = [];
  b.entities.forEach((e, i) => h.push({ kind: "enemy", index: i, cx: e.x + 0.5, cy: e.y + 0.5 }));
  b.items.forEach((it, i) => h.push({ kind: "item", index: i, cx: it.x + 0.5, cy: it.y + 0.5 }));
  b.triggers.forEach((t, i) => h.push({ kind: "trigger", index: i, cx: t.x + 0.5, cy: t.y + 0.5 }));
  if (b.spawn) h.push({ kind: "spawn", index: 0, cx: b.spawn[0] + 0.5, cy: b.spawn[1] + 0.5 });
  if (b.exit) h.push({ kind: "exit", index: 0, cx: b.exit[0] + 0.5, cy: b.exit[1] + 0.5 });
  return h;
}

/** Viewport camera: world-px offset of the top-left corner + zoom factor.
 * World px = cell * scale (before zoom). */
export interface Camera {
  ox: number;
  oy: number;
  zoom: number;
  viewW: number;
  viewH: number;
}

export interface DrawOpts {
  scale?: number;
  mode?: RenderMode;
  images?: Record<string, HTMLImageElement>;
  showGrid?: boolean;
  showLabels?: boolean;
  selection?: Selection | null;
  camera?: Camera;
  /** Cells painted since the last save ("x,y") — drawn flat over art until
   * the save re-derives real terrain slots. */
  painted?: Set<string>;
}

const PALETTE_KEY: Record<string, string> = {
  floor: "ground",
  wall: "wall",
  platform: "platform",
  spike: "danger",
  water: "water",
  empty: "background",
};
const FALLBACK_COLORS: Record<string, string> = {
  background: "#141018",
  ground: "#776459",
  platform: "#b8804a",
  wall: "#5b4d5e",
  danger: "#e0453a",
  water: "#3a6ea5",
};

/** Block-mode color for a tile type (also used by the editor palette). */
export function tileColor(bundle: LevelBundle, tileType: number): string | null {
  const slot = bundle.tiles_by_type[String(tileType)];
  if (!slot || slot.name === "empty") return null;
  const key = PALETTE_KEY[slot.name] ?? "ground";
  return bundle.tileset.palette[key] ?? FALLBACK_COLORS[key] ?? "#888";
}

/** The editor's brush: what a canvas click paints/places. */
export type Brush =
  | { kind: "tile"; tileType: number }
  | { kind: "enemy"; enemyId: string; variant: string | null }
  | { kind: "item"; itemId: string; source: string }
  | { kind: "checkpoint" }
  | { kind: "eraser" };

/** All image URLs a bundle needs, for the caller to preload before drawing. */
export function collectImageUrls(bundle: LevelBundle): string[] {
  const urls = new Set<string>();
  if (bundle.tileset.tilesheet_path_abs) urls.add(bundle.tileset.tilesheet_path_abs);
  for (const e of bundle.entities) if (e.sprite_path_abs) urls.add(e.sprite_path_abs);
  for (const i of bundle.items) if (i.sprite_path_abs) urls.add(i.sprite_path_abs);
  for (const p of Object.values(bundle.props)) if (p) urls.add(p);
  for (const b of bundle.backdrop?.band_paths_abs ?? []) if (b) urls.add(b);
  return [...urls];
}

const img = (imgs: Record<string, HTMLImageElement>, url: string | null) =>
  (url && imgs[url]?.complete && imgs[url].naturalWidth > 0 ? imgs[url] : null);

/** Draw the whole level. Sizes the canvas to the grid × scale. */
export function drawLevel(canvas: HTMLCanvasElement, bundle: LevelBundle, opts: DrawOpts = {}): void {
  const scale = opts.scale ?? 24;
  const mode: RenderMode = opts.mode ?? "blocks";
  const images = opts.images ?? {};
  const W = bundle.grid_width;
  const H = bundle.grid_height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cam = opts.camera;
  if (cam) {
    // Viewport mode: fixed-size canvas, world drawn through the camera
    // transform. All draw code below stays in world px — the transform does
    // the pan/zoom.
    canvas.width = cam.viewW * dpr;
    canvas.height = cam.viewH * dpr;
    canvas.style.width = `${cam.viewW}px`;
    canvas.style.height = `${cam.viewH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cam.viewW, cam.viewH);
    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.ox * dpr * z, -cam.oy * dpr * z);
  } else {
    canvas.width = W * scale * dpr;
    canvas.height = H * scale * dpr;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = bundle.tileset.palette.background ?? FALLBACK_COLORS.background;
  ctx.fillRect(0, 0, W * scale, H * scale);

  const art = mode === "art" || mode === "overlay";
  if (art) drawArt(ctx, bundle, scale, images);
  else drawBlocksTerrain(ctx, bundle, scale);

  // Unsaved painted cells: the terrain grid still holds pre-paint slot
  // indices, so overlay the collision-type color until save re-derives.
  if (art && opts.painted?.size) {
    for (const key of opts.painted) {
      const [x, y] = key.split(",").map(Number);
      const tt = bundle.grids.collision[y]?.[x] ?? 0;
      const color = tileColor(bundle, tt);
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      } else {
        ctx.fillStyle = bundle.tileset.palette.background ?? FALLBACK_COLORS.background;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  // Actors + gameplay markers (art mode uses sprites, else placeholder shapes).
  drawItems(ctx, bundle, scale, images, art);
  drawCheckpoints(ctx, bundle, scale, images, art);
  drawEnemies(ctx, bundle, scale, images, art, opts.showLabels ?? false);
  drawMarkers(ctx, bundle, scale);

  if (mode === "overlay") drawCollisionTint(ctx, bundle, scale);
  if (opts.showGrid || mode === "overlay") drawGrid(ctx, W, H, scale);

  // Selection highlight — a dashed amber box on the selected handle's cell.
  if (opts.selection) {
    const sel = levelHandles(bundle).find(
      (h) => h.kind === opts.selection!.kind && h.index === opts.selection!.index,
    );
    if (sel) {
      ctx.save();
      ctx.strokeStyle = "#e2b714";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(sel.cx * scale - scale * 0.62, sel.cy * scale - scale * 0.62, scale * 1.24, scale * 1.24);
      ctx.restore();
    }
  }
}

// --- terrain -------------------------------------------------------------

function drawBlocksTerrain(ctx: CanvasRenderingContext2D, bundle: LevelBundle, scale: number) {
  const grid = bundle.grids.collision;
  for (let y = 0; y < bundle.grid_height; y++) {
    for (let x = 0; x < bundle.grid_width; x++) {
      const tt = grid[y]?.[x] ?? 0;
      const color = tileColor(bundle, tt);
      if (!color) continue;
      const slot = bundle.tiles_by_type[String(tt)];
      ctx.fillStyle = color;
      if (slot?.collision === "one_way") ctx.fillRect(x * scale, y * scale, scale, Math.max(3, scale * 0.28));
      else ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function drawArt(
  ctx: CanvasRenderingContext2D,
  bundle: LevelBundle,
  scale: number,
  images: Record<string, HTMLImageElement>,
) {
  const W = bundle.grid_width;
  const H = bundle.grid_height;

  // Parallax scenery bands: scaled to full level height, tiled horizontally
  // (camera-less, matching canon's flat skinned composite).
  for (const url of bundle.backdrop?.band_paths_abs ?? []) {
    const band = img(images, url);
    if (!band) continue;
    const bw = Math.max(1, Math.round((band.naturalWidth * (H * scale)) / band.naturalHeight));
    for (let x = 0; x < W * scale; x += bw) ctx.drawImage(band, x, 0, bw, H * scale);
  }

  // Terrain: terrain grid holds fully-resolved slot indices (autotile baked in);
  // slot.px_region crops the real tilesheet. Water draws translucent.
  const sheet = img(images, bundle.tileset.tilesheet_path_abs);
  const slotByIndex = new Map<number, TileSlot>();
  for (const s of bundle.tileset.slots) slotByIndex.set(s.index, s);
  const terrain = bundle.grids.terrain;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const slot = slotByIndex.get(terrain[y]?.[x] ?? 0);
      if (!slot || slot.collision === "empty") continue;
      if (sheet) {
        const [sx, sy, sw, sh] = slot.px_region;
        const wasAlpha = ctx.globalAlpha;
        if (slot.collision === "volume") ctx.globalAlpha = bundle.water_alpha;
        ctx.drawImage(sheet, sx, sy, sw, sh, x * scale, y * scale, scale, scale);
        ctx.globalAlpha = wasAlpha;
      } else {
        // No sheet yet — fall back to a flat color so structure still reads.
        const color = tileColor(bundle, slot.tile_type);
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }
}

// --- actors / items / props ---------------------------------------------

function drawItems(
  ctx: CanvasRenderingContext2D,
  bundle: LevelBundle,
  scale: number,
  images: Record<string, HTMLImageElement>,
  art: boolean,
) {
  for (const it of bundle.items) {
    const sprite = art ? img(images, it.sprite_path_abs) : null;
    if (sprite) {
      const side = scale * 0.7;
      ctx.drawImage(sprite, (it.x + 0.5) * scale - side / 2, (it.y + 0.5) * scale - side / 2, side, side);
    } else {
      ctx.fillStyle = it.placeholder_color;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc((it.x + 0.5) * scale, (it.y + 0.5) * scale, scale * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawEnemies(
  ctx: CanvasRenderingContext2D,
  bundle: LevelBundle,
  scale: number,
  images: Record<string, HTMLImageElement>,
  art: boolean,
  labels: boolean,
) {
  for (const e of bundle.entities) {
    const sprite = art ? img(images, e.sprite_path_abs) : null;
    if (sprite) {
      // Anchor at the feet cell; scale by body size × actor overdraw.
      const h = e.size * bundle.actor_scale * scale;
      const w = (sprite.naturalWidth / sprite.naturalHeight) * h;
      const footX = (e.x + 0.5) * scale;
      const footY = (e.y + 1) * scale;
      ctx.drawImage(sprite, footX - w / 2, footY - h, w, h);
    } else {
      const s = scale * e.size;
      const cx = (e.x + 0.5) * scale;
      const cy = (e.y + 0.5) * scale;
      ctx.fillStyle = e.placeholder_color;
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = Math.max(1, scale * 0.06);
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    }
    if (labels) {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.round(scale * 0.36)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(e.variant ?? e.enemy_id, (e.x + 0.5) * scale, e.y * scale - 2);
    }
  }
}

function drawCheckpoints(
  ctx: CanvasRenderingContext2D,
  bundle: LevelBundle,
  scale: number,
  images: Record<string, HTMLImageElement>,
  art: boolean,
) {
  const flag = art ? img(images, bundle.props.checkpoint ?? null) : null;
  for (const t of bundle.triggers) {
    if (t.type !== "checkpoint") continue;
    const footX = (t.x + 0.5) * scale;
    const footY = (t.y + 1) * scale;
    if (flag) {
      const side = scale * 1.5;
      ctx.drawImage(flag, footX - side / 2, footY - side, side, side);
      continue;
    }
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = Math.max(1, scale * 0.06);
    ctx.beginPath();
    ctx.moveTo(footX, footY);
    ctx.lineTo(footX, footY - scale * 1.6);
    ctx.stroke();
    ctx.fillStyle = "#e2b714";
    ctx.beginPath();
    ctx.moveTo(footX, footY - scale * 1.6);
    ctx.lineTo(footX + scale * 0.7, footY - scale * 1.35);
    ctx.lineTo(footX, footY - scale * 1.1);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMarkers(ctx: CanvasRenderingContext2D, bundle: LevelBundle, scale: number) {
  const marker = (cell: [number, number] | null, color: string) => {
    if (!cell) return;
    const cx = (cell[0] + 0.5) * scale;
    const cy = (cell[1] + 0.5) * scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, scale * 0.12);
    ctx.strokeRect(cx - scale * 0.4, cy - scale * 0.4, scale * 0.8, scale * 0.8);
  };
  marker(bundle.spawn, "#ffffff");
  marker(bundle.exit, "#3ddc84");
}

// --- overlay helpers -----------------------------------------------------

function drawCollisionTint(ctx: CanvasRenderingContext2D, bundle: LevelBundle, scale: number) {
  const grid = bundle.grids.collision;
  for (let y = 0; y < bundle.grid_height; y++) {
    for (let x = 0; x < bundle.grid_width; x++) {
      const slot = bundle.tiles_by_type[String(grid[y]?.[x] ?? 0)];
      if (!slot || slot.collision === "empty") continue;
      ctx.fillStyle =
        slot.collision === "hazard"
          ? "rgba(224,69,58,0.35)"
          : slot.collision === "one_way"
            ? "rgba(120,200,255,0.30)"
            : slot.collision === "volume"
              ? "rgba(58,110,165,0.25)"
              : "rgba(255,255,255,0.16)";
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number) {
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * scale + 0.5, 0);
    ctx.lineTo(x * scale + 0.5, H * scale);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * scale + 0.5);
    ctx.lineTo(W * scale, y * scale + 0.5);
    ctx.stroke();
  }
}
