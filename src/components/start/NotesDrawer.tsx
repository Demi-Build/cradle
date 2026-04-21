import { useEffect } from "react";
import { useStore } from "../../store";
import { Icon } from "./Icons";

// ============================================================
// Changelog — edit this array to update the drawer's changelog.
//   • Newest entries first.
//   • `tag`: "new" (ok color), "next" (dim color), or null.
// ============================================================
const CHANGELOG = [
  {
    ver: "v0.0.5",
    title: "Dialogue graph mode",
    tag: "new" as const,
    body: "Card view + graph view toggle on any NPC with a dialogue_tree. Dagre layout under the hood.",
  },
  {
    ver: "v0.0.1",
    title: "First run",
    tag: null,
    body: "Three-pane read-only shell: load a world, expand a type, click an entity, read JSON. Foundations for v0.2 editing.",
  }
];

export function NotesDrawer() {
  const open = useStore((s) => s.drawerOpen);
  const setOpen = useStore((s) => s.setDrawerOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <>
      <div className={`drawer-scrim ${open ? "on" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`drawer ${open ? "on" : ""}`}>
        <div className="drawer-head">
          <div className="drawer-tabs">
            <span className="drawer-tab on">Changelog</span>
          </div>
          <div className="spacer" />
          <button className="drawer-close" onClick={() => setOpen(false)} aria-label="close">
            <Icon id="g-x" size={14} />
          </button>
        </div>
        <div className="drawer-body">
          {CHANGELOG.map((row) => (
            <div key={row.ver} className="cl-row">
              <span className="cl-ver">{row.ver}</span>
              <div className="cl-body">
                <h4>
                  {row.tag && <span className={`cl-tag ${row.tag}`}>{row.tag}</span>}
                  {row.title}
                </h4>
                <p>{row.body}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
