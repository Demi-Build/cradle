import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Tooltip for icon buttons — the design gives every tool-rail button one,
 *  because a 30×30 glyph is otherwise unidentifiable.
 *
 *  Spec: 260ms delay, placed to the element's RIGHT, flipped left when it
 *  would overflow, vertically centered and clamped to the viewport. Rendered
 *  in a portal so an `overflow: hidden` ancestor (the canvas frame, the dock)
 *  can't clip it — a floating rail lives inside exactly such containers.
 *
 *  IT OPENS ON KEYBOARD FOCUS TOO, not on hover alone. A tooltip is often the
 *  only place a control's reason for being unavailable is written, and a
 *  pointer-only tip strands a keyboard user on a dead control with nothing on
 *  screen. Focus opens it WITHOUT the delay: the delay exists to stop tips
 *  flashing as a pointer sweeps a rail, and landing on a control by keyboard is
 *  a deliberate arrival, not a sweep. `Escape` dismisses it without moving
 *  focus, and does not stop propagating — an enclosing sheet still gets its own
 *  `Escape`.
 *
 *  Surface styling is `.tip` / `.tip-title` / `.tip-desc` in App.css.
 */

const DELAY_MS = 260;
const GAP = 8;
const MARGIN = 6;

export function Tooltip({
  title,
  desc,
  hint,
  children,
}: {
  title: string;
  desc?: string;
  /** Keyboard shortcut, rendered in a .kbd beside the title. */
  hint?: string;
  children: React.ReactElement;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; flipped: boolean } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const place = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    // Provisional: to the right, vertically centered. Measured and corrected
    // in the layout effect below, once the panel has a real width.
    setPos({ x: r.right + GAP, y: r.top + r.height / 2, flipped: false });
  };
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(place, DELAY_MS);
  };
  /** Focus arrives on purpose, so it opens at once — see the note above. */
  const showNow = () => {
    window.clearTimeout(timer.current);
    place();
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };

  // Flip + clamp AFTER measuring, so a long description doesn't run off-screen.
  useEffect(() => {
    if (!pos || !tipRef.current || !wrapRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    const anchor = wrapRef.current.getBoundingClientRect();
    let x = pos.x;
    let flipped = pos.flipped;
    if (!flipped && x + tip.width + MARGIN > window.innerWidth) {
      x = anchor.left - GAP - tip.width;
      flipped = true;
    }
    if (x < MARGIN) x = MARGIN;
    const half = tip.height / 2;
    const y = Math.min(Math.max(pos.y, half + MARGIN), window.innerHeight - half - MARGIN);
    if (x !== pos.x || y !== pos.y || flipped !== pos.flipped) {
      setPos({ x, y, flipped });
    }
  }, [pos]);

  return (
    <>
      <span
        ref={wrapRef}
        style={{ display: "inline-flex" }}
        onPointerEnter={show}
        onPointerLeave={hide}
        // A click means the user found it; keeping the tip up just covers
        // whatever they're about to look at.
        onPointerDown={hide}
        // React maps these to focusin/focusout, so focus on the wrapped
        // control — not the wrapper — is what opens and closes it.
        onFocus={showNow}
        onBlur={hide}
        // Dismiss without moving focus. NOT stopped: a sheet's own Escape
        // handler must still see it.
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            className="tip"
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: "translateY(-50%)" }}
          >
            <div className="tip-title">
              <span>{title}</span>
              {hint && <span className="kbd">{hint}</span>}
            </div>
            {desc && <div className="tip-desc">{desc}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
