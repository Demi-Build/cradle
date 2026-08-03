import { useEffect, useRef, useState } from "react";
import { kbd } from "../../lib/keys";
import type { RecentProject } from "../../lib/recents";
import { useStore } from "../../store";
import { Icon } from "./Icons";
import { RecentTile } from "./RecentTile";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

/** How many projects the start-page rail shows before deferring to the
 *  projects page. Ten is two comfortable flicks; beyond that the rail stops
 *  being a shortcut. */
const RAIL_MAX = 10;

export function RecentsRail({
  recents,
  excludePath,
  onOpenRecent,
  onAddNew,
}: {
  recents: RecentProject[];
  /** Path of the project shown in the hero — excluded so it isn't listed twice. */
  excludePath?: string;
  onOpenRecent: (path: string) => void;
  onAddNew: () => void;
}) {
  const setRoute = useStore((s) => s.setRoute);
  const toggleHidden = useStore((s) => s.toggleRecentHidden);
  const setStartNote = useStore((s) => s.setStartNote);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  // Hidden cards stay in the list; the header offers them back rather than
  // pretending they were deleted.
  const [showHidden, setShowHidden] = useState(false);
  const [deleting, setDeleting] = useState<RecentProject | null>(null);
  const hiddenCount = recents.filter((r) => r.hidden).length;
  // The hero already IS the most recent project, in full. Repeating it as the
  // first card spent a slot saying nothing new — and made the row read as one
  // more project than the tier actually allows.
  const pool = excludePath ? recents.filter((r) => r.path !== excludePath) : recents;
  const all = showHidden ? pool : pool.filter((r) => !r.hidden);
  // The rail is a shortcut, not a browser. Past RAIL_MAX the scroller turns
  // into an endless flick and the real answer is the projects page — which
  // already exists (route "recents"), so "See all" is the overflow, not a
  // second implementation.
  const visible = all.slice(0, RAIL_MAX);
  const overflow = all.length - visible.length;

  useEffect(() => {
    update();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    function update() {
      const e = scrollerRef.current;
      if (!e) return;
      setCanPrev(e.scrollLeft > 2);
      setCanNext(e.scrollLeft < e.scrollWidth - e.clientWidth - 2);
    }
  }, [recents.length, visible.length]);

  return (
    <>
      <section className="recents-rail">
        <div className="rail-head">
          Recent{" "}
          <span className="count">
            · {visible.length}
            {overflow > 0 ? ` of ${all.length}` : ""}
          </span>
          {hiddenCount > 0 && (
            <button className="hidden-notice" onClick={() => setShowHidden((v) => !v)}>
              {hiddenCount} hidden from view · {showHidden ? "hide" : "show"}
            </button>
          )}
        </div>
        <div className="rail-arrows">
          <button
            className="rail-arrow"
            disabled={!canPrev}
            onClick={() => scrollerRef.current?.scrollBy({ left: -480, behavior: "smooth" })}
          >
            <Icon id="g-chev-l" size={14} />
          </button>
          <button
            className="rail-arrow"
            disabled={!canNext}
            onClick={() => scrollerRef.current?.scrollBy({ left: 480, behavior: "smooth" })}
          >
            <Icon id="g-chev-r" size={14} />
          </button>
        </div>
        <button className="see-all" onClick={() => setRoute("recents")}>
          {overflow > 0 ? `See all ${recents.length} projects →` : `All projects →`}
        </button>
      </section>

      <div className="recents-scroller" ref={scrollerRef}>
        {visible.map((r) => (
          <RecentTile
            key={r.path}
            recent={r}
            onClick={() => {
              if (import.meta.env.DEV)
                console.log("[cradle] tile clicked:", {
                  title: r.storyTitle ?? r.name,
                  path: r.path,
                });
              onOpenRecent(r.path);
            }}
            onToggleHidden={() => {
              toggleHidden(r.path);
              setStartNote(
                r.hidden
                  ? `${r.storyTitle ?? r.name} is back in recents`
                  : `removed ${r.storyTitle ?? r.name} from recents · still on disk`,
              );
            }}
            onDelete={() => setDeleting(r)}
          />
        ))}
        <button className="recent-tile add" onClick={onAddNew}>
          <div className="add-stack">
            <Icon id="g-plus" size={18} />
            <span>Open world from disk</span>
            <span className="kbd">{kbd("O")}</span>
          </div>
        </button>
      </div>

      {deleting && (
        <DeleteProjectDialog
          recent={deleting}
          onCancel={() => setDeleting(null)}
          onRemoveInstead={() => {
            toggleHidden(deleting.path);
            setStartNote(
              `removed ${deleting.storyTitle ?? deleting.name} from recents · still on disk`,
            );
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
