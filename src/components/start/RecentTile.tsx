import { useRef, useState } from "react";
import type { RecentProject } from "../../lib/recents";
import { envKeyFor } from "../../lib/recents";
import { envImageFor } from "./envImages";
import { useAssetUrl } from "./useAssetUrl";
import { RecentMenu } from "./RecentMenu";

export function RecentTile({
  recent,
  onClick,
  onToggleHidden,
  onDelete,
}: {
  recent: RecentProject;
  onClick: () => void;
  onToggleHidden?: () => void;
  onDelete?: () => void;
}) {
  const env = envKeyFor(recent.primaryEnv, recent.path);
  const resolved = useAssetUrl(recent.path, recent.startPortrait);
  const thumbUrl = resolved ?? envImageFor(env);
  const dotsRef = useRef<HTMLButtonElement>(null);
  // The anchor rect is captured at open time; the menu portals out of the
  // tile so an `overflow: hidden` scroller can't clip it.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const sub = [
    typeof recent.seed === "number" ? `seed ${recent.seed}` : null,
    recent.rooms !== undefined ? `${recent.rooms} rooms` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="recent-tile-wrap" data-hidden={recent.hidden ? "1" : "0"}>
      <button className="recent-tile" onClick={onClick} title={recent.path}>
        <div className="thumb">
          <img src={thumbUrl} alt="" className="thumb-img" loading="lazy" />
          {recent.hidden && <span className="tile-pin">hidden</span>}
        </div>
        <div className="meta">
          <div className="t">{recent.storyTitle ?? recent.name}</div>
          <div className="sub">{sub}</div>
        </div>
      </button>
      {onToggleHidden && onDelete && (
        <button
          ref={dotsRef}
          className={`tile-dots ${anchor ? "on" : ""}`}
          aria-label={`Actions for ${recent.storyTitle ?? recent.name}`}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect());
          }}
        >
          ⋯
        </button>
      )}
      {anchor && onToggleHidden && onDelete && (
        <RecentMenu
          recent={recent}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          onOpen={onClick}
          onToggleHidden={onToggleHidden}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
