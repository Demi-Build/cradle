// Interactive viewport around drawLevel(). A fixed-size canvas fills the
// container; a camera (pan offset + zoom) maps it onto the level, so maps
// bigger than the window are navigable:
//   · scroll / trackpad        → pan
//   · ⌘/Ctrl+scroll or pinch   → zoom around the cursor
//   · drag empty space         → pan (grab cursor)
//   · drag a placement         → move it (existing edit path)
// Overlay buttons: zoom −/+, fit, 1:1. Parent owns the bundle + selection;
// this component hit-tests through the camera and reports intents.

import { useEffect, useRef, useState } from "react";
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

interface LevelCanvasProps {
  bundle: LevelBundle;
  scale?: number;
  mode?: RenderMode;
  showGrid?: boolean;
  showLabels?: boolean;
  selection?: Selection | null;
  brush?: Brush | null;
  painted?: Set<string>;
  onSelect?: (sel: Selection | null) => void;
  onMove?: (sel: Selection, x: number, y: number) => void;
  onCommit?: (sel: Selection) => void;
  onPaint?: (x: number, y: number) => void;
  onPlace?: (x: number, y: number) => void;
  onErase?: (x: number, y: number) => void;
}

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
  painted,
  onSelect,
  onMove,
  onCommit,
  onPaint,
  onPlace,
  onErase,
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
    });
    setZoomPct(Math.round(cam.current.zoom * 100));
  };

  // Track the container size.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      setViewSize({ w: Math.max(80, box.clientWidth), h: Math.max(80, box.clientHeight) });
    });
    ro.observe(box);
    return () => ro.disconnect();
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

  const btn: React.CSSProperties = {
    background: "var(--surface-2, #2a2136)",
    border: "1px solid var(--border, #3a2f4a)",
    color: "var(--text-2, #d9cfe8)",
    borderRadius: 6,
    fontSize: 12,
    padding: "2px 8px",
    cursor: "pointer",
  };

  return (
    <div
      ref={boxRef}
      style={{
        position: "relative",
        width: "100%",
        height: "min(68vh, 820px)",
        background: "var(--surface-0, #0e0a12)",
        border: "1px solid var(--border, #3a2f4a)",
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
      <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", gap: 6, alignItems: "center" }}>
        <button style={btn} onClick={() => setZoom((z) => z / 1.25)} title="Zoom out">−</button>
        <span style={{ ...btn, cursor: "default" }}>{zoomPct}%</span>
        <button style={btn} onClick={() => setZoom((z) => z * 1.25)} title="Zoom in">+</button>
        <button style={btn} onClick={fit} title="Fit level in view">fit</button>
        <button style={btn} onClick={() => setZoom(() => 1)} title="Actual size">1:1</button>
      </div>
    </div>
  );
}
