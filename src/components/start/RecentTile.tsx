import type { RecentProject } from "../../lib/recents";
import { envKeyFor } from "../../lib/recents";
import { envImageFor } from "./envImages";
import { useAssetUrl } from "./useAssetUrl";

export function RecentTile({ recent, onClick }: { recent: RecentProject; onClick: () => void }) {
  const env = envKeyFor(recent.primaryEnv, recent.path);
  const resolved = useAssetUrl(recent.path, recent.startPortrait);
  const thumbUrl = resolved ?? envImageFor(env);
  const sub = [
    typeof recent.seed === "number" ? `seed ${recent.seed}` : null,
    recent.rooms !== undefined ? `${recent.rooms} rooms` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button className="recent-tile" onClick={onClick} title={recent.path}>
      <div className="thumb">
        <img src={thumbUrl} alt="" className="thumb-img" loading="lazy" />
      </div>
      <div className="meta">
        <div className="t">{recent.storyTitle ?? recent.name}</div>
        <div className="sub">{sub}</div>
      </div>
    </button>
  );
}
