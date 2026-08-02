// Interactive viewport around drawLevel(). A fixed-size canvas fills the
// container; a camera (pan offset + zoom) maps it onto the level, so maps
// bigger than the window are navigable:
//   · scroll / trackpad        → pan
//   · ⌘/Ctrl+scroll or pinch   → zoom around the cursor
//   · drag empty space         → pan (grab cursor)
//   · drag a placement         → move it (existing edit path)
// Overlay buttons: zoom −/+, fit, 1:1. Parent owns the bundle + selection;
// this component hit-tests through the camera and reports intents.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  collectImageUrls,
  drawLevel,
  levelHandles,
  type Brush,
  type Camera,
  type LevelBundle,
  type RenderMode,
  type Selection,
} from "./drawLevel";
import type { Tool } from "./ToolRail";

interface LevelCanvasProps {
  bundle: LevelBundle;
  scale?: number;
  mode?: RenderMode;
  showGrid?: boolean;
  showLabels?: boolean;
  showBounds?: boolean;
  showRulers?: boolean;
  /** CSS height of the viewport. The level editor passes "100%" so the
   *  canvas flexes and the dock stays pinned below it. */
  height?: string;
  selection?: Selection | null;
  brush?: Brush | null;
  /** Active tool from the rail. `brush` says WHAT to paint; `tool` says what a
   *  left-click DOES. Right-click erases regardless (user-locked). */
  tool?: Tool;
  painted?: Set<string>;
  onSelect?: (sel: Selection | null) => void;
  onMove?: (sel: Selection, x: number, y: number) => void;
  onCommit?: (sel: Selection) => void;
  onPaint?: (x: number, y: number) => void;
  onPlace?: (x: number, y: number) => void;
  onErase?: (x: number, y: number) => void;
  onFill?: (x: number, y: number) => void;
  /** Reports the live camera after every draw — the minimap draws its
   *  viewport rectangle from this. */
  onCamera?: (c: CamState) => void;
  /** Populated with an imperative handle so the minimap can drive the camera
   *  without lifting it into state (it mutates on every wheel tick). */
  camApi?: { current: CamApi | null };
}

export type CamState = { ox: number; oy: number; zoom: number; viewW: number; viewH: number };
export type CamApi = { setOrigin: (ox: number, oy: number) => void };

function useImageCache(urls: string[]): Record<string, HTMLImageElement> {
  const [cache, setCache] = useState<Record<string, HTMLImageElement>>({});
  const key = urls.join("|");
  useEffect(() => {
    let alive = true;
    const next: Record<string, HTMLImageElement> = {};
    let pending = urls.length;
    if (pending === 0) {
      setCache({});
      return;
    }
    const done = () => {
      if (alive && --pending <= 0) setCache({ ...next });
    };
    for (const url of urls) {
      const image = new Image();
      image.onload = done;
      image.onerror = done;
      image.src = url;
      next[url] = image;
    }
    const timer = setInterval(() => alive && setCache({ ...next }), 120);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cache;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

export function LevelCanvas({
  bundle,
  scale = 24,
  mode = "blocks",
  showGrid,
  showLabels,
  selection = null,
  brush = null,
  tool = "select",
  showBounds,
  showRulers,
  height = "min(68vh, 820px)",
  painted,
  onSelect,
  onMove,
  onCommit,
  onPaint,
  onPlace,
  onErase,
  onFill,
  onCamera,
  camApi,
}: LevelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const images = useImageCache(collectImageUrls(bundle));
  const drag = useRef<Selection | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const stroke = useRef<null | "paint" | "erase">(null);
  const [viewSize, setViewSize] = useState({ w: 800, h: 480 });
  // Camera lives in a ref (mutated by input handlers, no re-render churn);
  // zoomPct mirrors it for the overlay label.
  const cam = useRef({ ox: 0, oy: 0, zoom: 1 });
  const [zoomPct, setZoomPct] = useState(100);
  const lastCam = useRef<CamState | null>(null);

  const worldW = bundle.grid_width * scale;
  const worldH = bundle.grid_height * scale;

  const clampCam = () => {
    const c = cam.current;
    c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom));
    const vw = viewSize.w / c.zoom;
    const vh = viewSize.h / c.zoom;
    // Clamp into the world; center when the world is smaller than the view.
    c.ox = worldW <= vw ? -(vw - worldW) / 2 : Math.min(Math.max(c.ox, 0), worldW - vw);
    c.oy = worldH <= vh ? -(vh - worldH) / 2 : Math.min(Math.max(c.oy, 0), worldH - vh);
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    clampCam();
    const camera: Camera = { ...cam.current, viewW: viewSize.w, viewH: viewSize.h };
    drawLevel(canvas, bundle, {
      scale, mode, images, showGrid, showLabels, selection, camera, painted,
      showBounds, showRulers,
    });
    setZoomPct(Math.round(cam.current.zoom * 100));
    // Notify ONLY on a real change. redraw() runs after every render, so
    // handing out a fresh object each time made the parent's setState see a
    // new reference forever: render -> redraw -> setCam -> render.
    const next = { ...cam.current, viewW: viewSize.w, viewH: viewSize.h };
    const prev = lastCam.current;
    if (
      !prev ||
      prev.ox !== next.ox ||
      prev.oy !== next.oy ||
      prev.zoom !== next.zoom ||
      prev.viewW !== next.viewW ||
      prev.viewH !== next.viewH
    ) {
      lastCam.current = next;
      onCamera?.(next);
    }
  };

  if (camApi) {
    camApi.current = {
      setOrigin: (ox, oy) => {
        cam.current.ox = ox;
        cam.current.oy = oy;
        redraw();
      },
    };
  }

  /** Pull the box's real size into state, no-op when unchanged. */
  const syncViewSize = () => {
    const box = boxRef.current;
    if (!box) return;
    const w = Math.max(80, box.clientWidth);
    const h = Math.max(80, box.clientHeight);
    setViewSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  };

  // Track the container size. BOTH paths are needed:
  //  · the observer catches window resizes that cause no React render;
  //  · the layout effect catches layout changes that DO render but that the
  //    observer misses. It measured once and then went quiet, so the canvas
  //    stayed at whatever size it happened to see first — invisible while the
  //    box had a fixed height, obvious once it started flexing under the dock.
  // Returning the previous object when nothing changed is what stops this
  // from looping.
  useLayoutEffect(syncViewSize);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(syncViewSize);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset camera when switching levels.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    cam.current = { ox: 0, oy: 0, zoom: 1 };
    redraw();
  }, [bundle.level_id, bundle.stage_id]);

  // Redraw after every render — a full draw is cheap at this scale, dep-array
  // bookkeeping for nine inputs is not (and setZoomPct bails on equal values,
  // so this cannot loop).
  useEffect(redraw);

  // Wheel: native non-passive listener so preventDefault stops page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current;
      if (e.ctrlKey || e.metaKey) {
        // Zoom around the cursor (pinch arrives as ctrl+wheel).
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const wx = sx / c.zoom + c.ox;
        const wy = sy / c.zoom + c.oy;
        c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * Math.exp(-e.deltaY * 0.01)));
        c.ox = wx - sx / c.zoom;
        c.oy = wy - sy / c.zoom;
      } else {
        c.ox += e.deltaX / c.zoom;
        c.oy += e.deltaY / c.zoom;
      }
      redraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSize, bundle, images, mode, showGrid, showLabels, selection]);

  const cellAt = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const c = cam.current;
    return {
      x: ((e.clientX - rect.left) / c.zoom + c.ox) / scale,
      y: ((e.clientY - rect.top) / c.zoom + c.oy) / scale,
    };
  };

  const hitHandle = (p: { x: number; y: number }): Selection | null => {
    let best: Selection | null = null;
    let bestD = 0.65 * 0.65;
    for (const h of levelHandles(bundle)) {
      const d = (h.cx - p.x) ** 2 + (h.cy - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { kind: h.kind, index: h.index };
      }
    }
    return best;
  };

  const clampCell = (p: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(bundle.grid_width - 1, Math.floor(p.x))),
    y: Math.max(0, Math.min(bundle.grid_height - 1, Math.floor(p.y))),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    const cell = clampCell(cellAt(e));
    canvasRef.current!.setPointerCapture(e.pointerId);
    // Right-click (and right-drag) ERASES — the discoverable delete gesture,
    // independent of the armed brush: removes the topmost placement at the
    // cell, else clears the painted tile (same cascade as the eraser brush).
    if (e.button === 2) {
      stroke.current = "erase";
      onErase?.(cell.x, cell.y);
      return;
    }
    // The ERASE tool makes left-click do what right-click always does.
    if (tool === "erase") {
      stroke.current = "erase";
      onErase?.(cell.x, cell.y);
      return;
    }
    // FILL is a single click, never a drag — flooding on pointer-move would
    // repaint the whole region on every pixel of travel.
    if (tool === "fill" && brush?.kind === "tile") {
      onFill?.(cell.x, cell.y);
      return;
    }
    // An armed brush takes priority over select/pan.
    if (brush) {
      if (brush.kind === "tile") {
        stroke.current = "paint";
        onPaint?.(cell.x, cell.y);
      } else if (brush.kind === "eraser") {
        stroke.current = "erase";
        onErase?.(cell.x, cell.y);
      } else {
        onPlace?.(cell.x, cell.y);
      }
      return;
    }
    const hit = hitHandle(cellAt(e));
    if (hit) {
      onSelect?.(hit);
      drag.current = hit;
    } else {
      onSelect?.(null);
      pan.current = { x: e.clientX, y: e.clientY };
      canvasRef.current!.style.cursor = "grabbing";
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (stroke.current) {
      const cell = clampCell(cellAt(e));
      if (stroke.current === "paint") onPaint?.(cell.x, cell.y);
      else onErase?.(cell.x, cell.y);
      return;
    }
    if (drag.current) {
      const cell = clampCell(cellAt(e));
      onMove?.(drag.current, cell.x, cell.y);
      return;
    }
    if (pan.current) {
      const c = cam.current;
      c.ox -= (e.clientX - pan.current.x) / c.zoom;
      c.oy -= (e.clientY - pan.current.y) / c.zoom;
      pan.current = { x: e.clientX, y: e.clientY };
      redraw();
      return;
    }
    // Idle hover: crosshair when a brush is armed, pointer over a handle,
    // grab elsewhere.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = brush
        ? "crosshair"
        : hitHandle(cellAt(e))
          ? "pointer"
          : "grab";
    }
  };

  const endDrag = () => {
    stroke.current = null;
    if (drag.current) {
      onCommit?.(drag.current);
      drag.current = null;
    }
    pan.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = brush ? "crosshair" : "grab";
  };

  const setZoom = (mutate: (z: number) => number) => {
    const c = cam.current;
    // Keep the view center fixed while zooming via buttons.
    const cx = c.ox + viewSize.w / c.zoom / 2;
    const cy = c.oy + viewSize.h / c.zoom / 2;
    c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, mutate(c.zoom)));
    c.ox = cx - viewSize.w / c.zoom / 2;
    c.oy = cy - viewSize.h / c.zoom / 2;
    redraw();
  };
  const fit = () => {
    const c = cam.current;
    c.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewSize.w / worldW, viewSize.h / worldH)));
    c.ox = 0;
    c.oy = 0;
    redraw();
  };

  return (
    <div
      ref={boxRef}
      style={{
        position: "relative",
        width: "100%",
        height,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: "block", imageRendering: "pixelated", cursor: "grab", touchAction: "none" }}
      />
      <div
        style={{
          position: "absolute",
          right: 10,
          // Same clearance as the tool rail — the floating dock covers the
          // bottom of the stage in focus mode.
          bottom: "var(--dock-clear, 10px)",
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <button className="btn" onClick={() => setZoom((z) => z / 1.25)} title="Zoom out">−</button>
        <span className="btn" style={{ cursor: "default" }}>{zoomPct}%</span>
        <button className="btn" onClick={() => setZoom((z) => z * 1.25)} title="Zoom in">+</button>
        <button className="btn" onClick={fit} title="Fit level in view">fit</button>
        <button className="btn" onClick={() => setZoom(() => 1)} title="Actual size">1:1</button>
      </div>
    </div>
  );
}
