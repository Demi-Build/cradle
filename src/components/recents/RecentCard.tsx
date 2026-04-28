import type { RecentProject } from "../../lib/recents";
import { envChipLabel, envKeyFor, relativeTimeFrom } from "../../lib/recents";
import { envImageFor } from "../start/envImages";
import { useAssetUrl } from "../start/useAssetUrl";
import { Icon } from "../start/Icons";

export function RecentCard({
  recent,
  onClick,
  onTogglePin,
}: {
  recent: RecentProject;
  onClick: () => void;
  onTogglePin?: () => void;
}) {
  const env = envKeyFor(recent.primaryEnv, recent.path);
  const resolved = useAssetUrl(recent.path, recent.startPortrait);
  const thumbUrl = resolved ?? envImageFor(env);
  const validation = recent.validation ?? "validated";
  const validationLabel =
    validation === "warn"
      ? "warnings"
      : validation === "failed"
        ? "failed"
        : validation === "bundled"
          ? "bundled"
          : "validated";
  const valClass = validation === "warn" ? "warn" : validation === "failed" ? "err" : "";
  const ago = relativeTimeFrom(recent.lastOpenedAt);
  const synopsis = recent.synopsis
    ? recent.synopsis.length > 120
      ? `${recent.synopsis.slice(0, 120)}…`
      : recent.synopsis
    : undefined;

  return (
    <button className="card" onClick={onClick} title={recent.path}>
      <div className="thumb">
        <img src={thumbUrl} alt="" className="thumb-img" loading="lazy" />
        <span className="env-chip">{envChipLabel(recent.primaryEnv)}</span>
        <span className={`validation ${valClass}`}>
          <i />
          {validationLabel}
        </span>
        {onTogglePin && (
          <span
            className={`card-pin ${recent.pinned ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={recent.pinned ? "Unpin" : "Pin"}
          >
            <Icon id="g-pin" size={12} />
          </span>
        )}
      </div>
      <div className="body">
        <div className="title">{recent.storyTitle ?? recent.name}</div>
        {synopsis ? (
          <div className="card-syn">{synopsis}</div>
        ) : (
          <div className="path">{recent.path}</div>
        )}
        <div className="stats">
          <Stat n={recent.rooms} label="rooms" />
          <Stat n={recent.npcs} label="npcs" />
          <Stat n={recent.events} label="events" />
          <Stat n={recent.quests} label="quests" />
        </div>
        <div className="foot">
          <span>
            {typeof recent.seed === "number" ? `seed ${recent.seed}` : ""}
            {recent.cost !== undefined ? ` · $${recent.cost.toFixed(2)}` : ""}
          </span>
          <span className="ago">{ago}</span>
        </div>
      </div>
    </button>
  );
}

function Stat({ n, label }: { n?: number; label: string }) {
  return (
    <div className="s">
      <b>{n === undefined ? "—" : n}</b>
      <span>{label}</span>
    </div>
  );
}
