import { useEffect, useRef, useState } from "react";
import type { RecentProject } from "../../lib/recents";
import { useStore } from "../../store";
import { Icon } from "./Icons";
import { RecentTile } from "./RecentTile";

export function RecentsRail({
  recents,
  onOpenRecent,
  onAddNew,
}: {
  recents: RecentProject[];
  onOpenRecent: (path: string) => void;
  onAddNew: () => void;
}) {
  const setRoute = useStore((s) => s.setRoute);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

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
  }, [recents.length]);

  return (
    <>
      <section className="recents-rail">
        <div className="rail-head">
          Recent <span className="count">· {recents.length}</span>
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
          See all {recents.length} projects →
        </button>
      </section>

      <div className="recents-scroller" ref={scrollerRef}>
        {recents.map((r) => (
          <RecentTile
            key={r.path}
            recent={r}
            onClick={() => {
              if (import.meta.env.DEV) console.log("[cradle] tile clicked:", { title: r.storyTitle ?? r.name, path: r.path });
              onOpenRecent(r.path);
            }}
          />
        ))}
        <button className="recent-tile add" onClick={onAddNew}>
          <div className="add-stack">
            <Icon id="g-plus" size={18} />
            <span>Open world from disk</span>
            <span className="kbd">⌘O</span>
          </div>
        </button>
      </div>
    </>
  );
}
