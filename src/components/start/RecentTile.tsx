import { useRef, useState } from "react";
import type { RecentProject } from "../../lib/recents";
import { envKeyFor, relativeTimeFrom } from "../../lib/recents";
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
  // The meta line has to say something true about EITHER kind of project:
  // MazeWorld counts rooms and NPCs, a platformer counts levels and enemies.
  // Previously this only knew the MazeWorld fields, so every platformer card
  // rendered an empty strip under its name.
  const count = (n: number | undefined, one: string, many: string) =>
    n === undefined ? null : `${n} ${n === 1 ? one : many}`;
  const sub = [
    count(recent.levels, "level", "levels"),
    count(recent.enemies, "enemy", "enemies"),
    count(recent.rooms, "room", "rooms"),
    count(recent.npcs, "NPC", "NPCs"),
    typeof recent.seed === "number" ? `seed ${recent.seed}` : null,
  ]
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  // Footer: the design's status dot + a plain-language last-touched. `warn`
  // and `failed` are the only states worth colouring — a green dot on every
  // card is decoration, not information.
  const status = recent.validation;
  const statusLabel =
    status === "failed"
      ? "validation failed"
      : status === "warn"
        ? "has warnings"
        : status === "bundled"
          ? "bundled demo"
          : "ready";
  return (
    <div className="recent-tile-wrap" data-hidden={recent.hidden ? "1" : "0"}>
      <button className="recent-tile" onClick={onClick} title={recent.path}>
        <div className="thumb">
          <img src={thumbUrl} alt="" className="thumb-img" loading="lazy" />
          {recent.hidden && <span className="tile-pin">hidden</span>}
        </div>
        <div className="meta">
          <div className="t">{recent.storyTitle ?? recent.name}</div>
          {sub && <div className="sub">{sub}</div>}
          <div className="fo">
            <span className={`st ${status === "failed" || status === "warn" ? "w" : ""}`} />
            {statusLabel}
            <span className="fo-when">{relativeTimeFrom(recent.lastOpenedAt)}</span>
          </div>
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
