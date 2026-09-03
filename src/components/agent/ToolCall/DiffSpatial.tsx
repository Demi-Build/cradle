import { useLayoutEffect, useRef } from "react";
import type { SpatialSnapshot } from "../../../lib/agentState";
import { addedCells, drawSpatial, integerScale, toBundle } from "./diffSpatialDraw";

/** The spatial diff (README §5): side-by-side mini-canvases, before and
 *  after, added things in green. Drawn by the SAME pure `drawLevel` the
 *  editor's canvas uses — preview and canvas cannot disagree — at an integer
 *  scale, nearest-neighbour (`drawLevel` sets `imageSmoothingEnabled =
 *  false`; the canvas is `image-rendering: pixelated`). Block mode: no
 *  image loading, so a card renders the instant its payload lands. The pure
 *  half (`toBundle` / `integerScale` / `addedCells` / `drawSpatial`) is
 *  `diffSpatialDraw.ts`. */
export function DiffSpatial({
  before,
  after,
  added,
  summary,
}: {
  before: SpatialSnapshot;
  after: SpatialSnapshot;
  added?: number;
  summary?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const b = toBundle(before);
    const a = toBundle(after);
    const avail = Math.max(60, Math.floor(((wrap.current?.clientWidth ?? 380) - 30) / 2));
    const scale = integerScale(Math.max(b.grid_width, a.grid_width), avail);
    try {
      if (beforeRef.current) drawSpatial(beforeRef.current, b, scale);
      if (afterRef.current) drawSpatial(afterRef.current, a, scale, addedCells(b, a));
    } catch {
      /* no 2D context (tests) — the card still renders its text */
    }
  }, [before, after]);
  const a = toBundle(after);
  const b = toBundle(before);
  const addedCount = added ?? addedCells(b, a).length;
  return (
    <div>
      <div className="ag-diff-spatial" ref={wrap}>
        <div className="side">
          <div className="lbl">before</div>
          <canvas ref={beforeRef} data-testid="diff-before" />
        </div>
        <div className="arrow">→</div>
        <div className="side">
          <div className="lbl">after {addedCount > 0 && <b>+{addedCount}</b>}</div>
          <canvas ref={afterRef} data-testid="diff-after" />
        </div>
      </div>
      {summary && <div className="ag-card-mono">{summary}</div>}
    </div>
  );
}
