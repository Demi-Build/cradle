import { useRef, useState } from "react";
import { useStore, type LayoutPrefs } from "../store";

/** Drag-to-move for a floating panel over a canvas stage.
 *
 *  Extracted from the level editor's tool rail so the minimap and the world
 *  map's rail get the same behaviour instead of a second copy: a DEDICATED
 *  grip (dragging from the panel body would eat the buttons' clicks), clamped
 *  inside the stage so the panel can never be lost, double-click to reset to
 *  the CSS anchor, and the position remembered app-wide.
 *
 *  The position is stored under a `LayoutPrefs` key, so a panel's placement
 *  survives restarts exactly like the theme does.
 */

export type PanelPos = { x: number; y: number } | null;

/** The `LayoutPrefs` keys that hold a panel position. */
export type PanelPosKey = {
  [K in keyof LayoutPrefs]: LayoutPrefs[K] extends PanelPos ? K : never;
}[keyof LayoutPrefs];

export function useDraggablePanel(key: PanelPosKey) {
  const saved = useStore((st) => st.layout[key]) as PanelPos;
  const setLayout = useStore((st) => st.setLayout);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [live, setLive] = useState<PanelPos>(null);
  // Mirror of `live` for the pointerup handler. State lags by a render, so a
  // fast drag — or any synthetic test where move and release land in ONE
  // frame — would read null and silently fail to persist.
  const liveRef = useRef<PanelPos>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const panel = ref.current;
    const stage = panel?.offsetParent as HTMLElement | null;
    if (!panel || !stage) return;
    const r = panel.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    liveRef.current = { x: r.left - s.left, y: r.top - s.top };
    setLive(liveRef.current);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const panel = ref.current;
    const stage = panel?.offsetParent as HTMLElement | null;
    if (!d || !panel || !stage) return;
    const s = stage.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    const x = Math.max(0, Math.min(s.width - r.width, e.clientX - s.left - d.dx));
    const y = Math.max(0, Math.min(s.height - r.height, e.clientY - s.top - d.dy));
    liveRef.current = { x, y };
    setLive(liveRef.current);
  };

  const onPointerUp = () => {
    if (drag.current && liveRef.current) setLayout({ [key]: liveRef.current });
    drag.current = null;
  };

  const reset = () => {
    liveRef.current = null;
    setLive(null);
    setLayout({ [key]: null });
  };

  const placed = live ?? saved;
  const style: React.CSSProperties = placed
    ? { left: placed.x, top: placed.y, right: "auto", bottom: "auto" }
    : {};

  /** Spread onto the grip element; give it `className="panel-grip"`. */
  const gripProps = {
    title: "Drag to move · double-click to reset",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDoubleClick: reset,
  };

  return { ref, style, gripProps, moved: placed !== null, reset };
}
