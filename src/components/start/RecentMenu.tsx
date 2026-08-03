import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecentProject } from "../../lib/recents";

/** The recents card's `⋯` menu.
 *
 *  Its whole point is the distinction the README asks to keep explicit:
 *  **remove from recents ≠ delete**. Removing hides the card and says so;
 *  the project is still on disk and still openable from "Open another…".
 *  Deleting is a separate, confirmed, destructive act.
 *
 *  Right-aligned under its trigger, clamped above the statusbar, and closed by
 *  an outside click or Escape.
 */
export function RecentMenu({
  recent,
  anchor,
  onClose,
  onOpen,
  onToggleHidden,
  onDelete,
}: {
  recent: RecentProject;
  anchor: DOMRect;
  onClose: () => void;
  onOpen: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.right - 206, top: anchor.bottom + 6 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Clamp above the 26px statusbar and inside the window.
    const maxTop = window.innerHeight - 26 - r.height - 8;
    const next = {
      left: Math.max(8, Math.min(window.innerWidth - r.width - 8, anchor.right - r.width)),
      top: Math.min(maxTop, anchor.bottom + 6),
    };
    setPos((p) => (p.left === next.left && p.top === next.top ? p : next));
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Deferred so the click that OPENED the menu doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return createPortal(
    <div ref={ref} className="rmenu" style={{ left: pos.left, top: pos.top }} role="menu">
      <button className="rmenu-item" onClick={act(onOpen)}>
        Open project
      </button>
      <button
        className="rmenu-item"
        disabled
        title="Showing a folder in Finder needs the opener plugin, which isn't wired yet."
      >
        Reveal on disk
      </button>
      <button
        className="rmenu-item"
        disabled
        title="Copying a project needs a duplicate command canon doesn't have yet."
      >
        Duplicate
      </button>
      <div className="rmenu-div" />
      <button className="rmenu-item" onClick={act(onToggleHidden)}>
        {recent.hidden ? "Show in recents again" : "Remove from recents"}
      </button>
      {!recent.hidden && (
        <div className="rmenu-hint">
          Hides the card only — the project stays on disk and stays openable
          from Open another…
        </div>
      )}
      <div className="rmenu-div" />
      <button className="rmenu-item dang" onClick={act(onDelete)}>
        Delete project…
      </button>
    </div>,
    document.body,
  );
}
