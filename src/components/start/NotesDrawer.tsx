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
    ver: "v0.1.0",
    title: "First read-only release",
    tag: "new" as const,
    body: "Start screen with recent projects, four-lane NPC dialogue (default / complete / incomplete / failed) with quest-gate routing, monster stat blocks, NPC combat forms, quest contract cards with type-driven objectives, room hero (entry portrait + maze map), events with puzzle tab, items with per-category stats tables, classes with ability and spell pools, bible hero with clickable beats, float layouts for NPC / monster / event / class / quest.",
  },
  {
    ver: "v0.1.0",
    title: "Keyboard navigation",
    tag: "new" as const,
    body: "↑ / ↓ cycle within a type and spill across boundaries, ⌥↑ / ⌥↓ jump between types, ← / → step between list and entity, Tab cycles tabs inside an entity.",
  },
  {
    ver: "v0.1.0",
    title: "Design system",
    tag: "new" as const,
    body: "Dark + light theme tokens (Inter + JetBrains Mono, warm-neutral palette, oklch amber accent). Arc-style hidden scrollbars. Click-to-enlarge lightbox on every image, portrait prompt as hover tooltip.",
  },
  {
    ver: "v0.2",
    title: "Editing",
    tag: "next" as const,
    body: "Walk the generated world, change a line, regenerate a beat, re-run validation against canon. VS Code-style nav (activity bar + collapsible sidebar + breadcrumb). Canon schema types as a dependency.",
  },
  {
    ver: "v0.3",
    title: "Live dialogue",
    tag: "next" as const,
    body: "Talk to loaded NPCs via their dialogue tree at runtime, with the full state machine running against the LLM.",
  },
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
          {CHANGELOG.map((row, i) => (
            <div key={`${row.ver}-${i}`} className="cl-row">
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
