import { useEffect, useRef } from "react";
import { drawLevel, type LevelBundle } from "./drawLevel";
import { useStore } from "../../store";
import { useDraggablePanel } from "../../lib/useDraggablePanel";
import type { CamApi, CamState } from "./LevelCanvas";

/** Whole-level overview with a draggable viewport rectangle (design: top-right
 *  of the stage, 334px).
 *
 *  Reuses `drawLevel` at a tiny scale rather than inventing a second renderer —
 *  in `blocks` mode the terrain and the placement markers ARE the design's
 *  pins, and it can never disagree with the main canvas about what's there.
 */

const WIDTH = 334;

export function Minimap({
  bundle,
  cam,
  camApi,
}: {
  bundle: LevelBundle;
  cam: CamState | null;
  camApi: { current: CamApi | null };
}) {
  // Collapsed state is an app-wide preference, not per-level: you either want
  // the overview while you work or you don't.
  const collapsed = useStore((st) => st.layout.minimapCollapsed);
  const setLayout = useStore((st) => st.setLayout);
  // Movable, through the same grip and persistence the tool rail uses.
  const { ref: panelRef, style, gripProps } = useDraggablePanel("minimapPos");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const inner = WIDTH - 16; // panel padding
  const scale = inner / bundle.grid_width;
  const mapH = Math.max(24, Math.round(bundle.grid_height * scale));

  useEffect(() => {
    const canvas = canvasRef.current;
    // Nothing to draw while collapsed — and the element isn't mounted.
    if (!canvas || collapsed) return;
    drawLevel(canvas, bundle, { scale, mode: "blocks" });
  }, [bundle, scale, collapsed]);

  /** Centre the main camera on the clicked point. */
  const jump = (clientX: number, clientY: number) => {
    const map = mapRef.current;
    const api = camApi.current;
    if (!map || !api || !cam) return;
    const r = map.getBoundingClientRect();
    const cellX = ((clientX - r.left) / r.width) * bundle.grid_width;
    const cellY = ((clientY - r.top) / r.height) * bundle.grid_height;
    // The main canvas works in world px at its own scale; ox/oy are the
    // top-left of the view, so centre means subtract half a viewport.
    const worldScale = 26; // LevelDetail's canvas scale
    api.setOrigin(
      cellX * worldScale - cam.viewW / cam.zoom / 2,
      cellY * worldScale - cam.viewH / cam.zoom / 2,
    );
  };

  // Viewport rectangle, in percentages of the level.
  const worldScale = 26;
  const vp = cam
    ? {
        left: `${(cam.ox / worldScale / bundle.grid_width) * 100}%`,
        top: `${(cam.oy / worldScale / bundle.grid_height) * 100}%`,
        width: `${(cam.viewW / cam.zoom / worldScale / bundle.grid_width) * 100}%`,
        height: `${(cam.viewH / cam.zoom / worldScale / bundle.grid_height) * 100}%`,
      }
    : null;

  return (
    <div ref={panelRef} className="mini" data-collapsed={collapsed ? "1" : "0"} style={style}>
      <span className="tool-grip mini-grip" {...gripProps} />
      <button
        className="mini-lbl"
        onClick={() => setLayout({ minimapCollapsed: !collapsed })}
        title={collapsed ? "Expand the minimap" : "Collapse to the header"}
        aria-expanded={!collapsed}
      >
        <span>Minimap</span>
        <span className="mini-meta">
          {collapsed ? "" : `${bundle.grid_width}×${bundle.grid_height}`}
          <span className="mini-chev">{collapsed ? "›" : "⌄"}</span>
        </span>
      </button>
      {!collapsed && (
        <div
          ref={mapRef}
          className="mini-map"
          style={{ height: mapH }}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            jump(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => dragging.current && jump(e.clientX, e.clientY)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
          {/* Out-of-play band under the floor, mirroring the bounds overlay. */}
          <div className="mini-kill" />
          {vp && <div className="mini-vp" style={vp} />}
        </div>
      )}
    </div>
  );
}
