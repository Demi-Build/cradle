import type { RecentProject } from "../../lib/recents";
import { envChipLabel, envKeyFor, relativeTimeFrom } from "../../lib/recents";
import { envImageFor } from "../start/envImages";
import { Icon } from "../start/Icons";
import { useAssetUrl } from "../start/useAssetUrl";

export function RecentRow({
  recent,
  onClick,
  onTogglePin,
}: {
  recent: RecentProject;
  onClick: () => void;
  onTogglePin: () => void;
}) {
  const env = envKeyFor(recent.primaryEnv, recent.path);
  const resolved = useAssetUrl(recent.path, recent.startPortrait);
  const thumbUrl = resolved ?? envImageFor(env);
  const validation = recent.validation ?? "validated";
  const valClass = validation === "warn" ? "warn" : validation === "failed" ? "err" : "ok";
  const valLabel =
    validation === "warn" ? "2 warnings" : validation === "failed" ? "failed" : "validated";

  return (
    <button className="list-row" onClick={onClick} title={recent.path}>
      <div className="lr-thumb">
        <img src={thumbUrl} alt="" className="lr-thumb-img" loading="lazy" />
      </div>
      <div>
        <div className="lr-title">{recent.storyTitle ?? recent.name}</div>
        <div className="lr-sub">
          {typeof recent.seed === "number" && `seed ${recent.seed} · `}
          {envChipLabel(recent.primaryEnv)}
          {recent.cost !== undefined && ` · $${recent.cost.toFixed(2)}`}
        </div>
      </div>
      <div className="lr-path" title={recent.path}>
        {recent.synopsis
          ? recent.synopsis.length > 80
            ? `${recent.synopsis.slice(0, 80)}…`
            : recent.synopsis
          : recent.path}
      </div>
      <div className="lr-num" style={{ textAlign: "right" }}>
        {recent.rooms ?? "—"}
      </div>
      <div className="lr-num" style={{ textAlign: "right" }}>
        {recent.npcs ?? "—"}
      </div>
      <div className="lr-num" style={{ textAlign: "right" }}>
        {recent.events ?? "—"}
      </div>
      <div className={`lr-status ${valClass}`}>
        <i />
        {valLabel}
      </div>
      <div className="lr-time">{relativeTimeFrom(recent.lastOpenedAt)}</div>
      <div>
        <span
          className={`lr-pin ${recent.pinned ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
        >
          <Icon id="g-pin" size={12} />
        </span>
      </div>
    </button>
  );
}
