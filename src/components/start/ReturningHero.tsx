import type { RecentProject } from "../../lib/recents";
import { envKeyFor } from "../../lib/recents";
import { Branding } from "./BrandMark";
import { Icon } from "./Icons";
import { envImageFor } from "./envImages";
import { useAssetUrl } from "./useAssetUrl";

export function ReturningHero({
  last,
  onEnter,
  onOpenAnother,
}: {
  last: RecentProject;
  onEnter: () => void;
  onOpenAnother: () => void;
}) {
  const env = envKeyFor(last.primaryEnv, last.path);
  const resolvedStart = useAssetUrl(last.path, last.startPortrait);
  const heroUrl = resolvedStart ?? envImageFor(env);

  const factionLabel = last.envName ? `Last world · ${last.envName}` : "Last world";
  const counts = [
    typeof last.seed === "number" ? { k: "seed", v: String(last.seed) } : null,
    last.rooms !== undefined ? { k: "rooms", v: String(last.rooms), suffix: true } : null,
    last.npcs !== undefined ? { k: "NPCs", v: String(last.npcs), suffix: true } : null,
    last.events !== undefined ? { k: "events", v: String(last.events), suffix: true } : null,
    last.quests !== undefined ? { k: "quests", v: String(last.quests), suffix: true } : null,
  ].filter(Boolean) as Array<{ k: string; v: string; suffix?: boolean }>;

  return (
    <>
      <div className="atmo-bg">
        <img src={heroUrl} alt="" className="atmo-bg-img" />
      </div>
      <div className="atmo-grad" />
      <div className="atmo-scrim" />

      <div className="atmo-body">
        <div>
          <Branding />

          <p className="last-world-label">{factionLabel}</p>
          <h1 className="last-world-title">{last.storyTitle ?? last.name}</h1>
          {last.synopsis && (
            <p className="last-world-synopsis">{last.synopsis}</p>
          )}
          <div className="last-world-meta">
            {counts.map((c, i) => (
              <span key={c.k}>
                {i > 0 && <span className="dot">·&nbsp;</span>}
                {c.suffix ? (
                  <>
                    <code>{c.v}</code> {c.k}
                  </>
                ) : (
                  <>
                    {c.k} <code>{c.v}</code>
                  </>
                )}
              </span>
            ))}
            {last.validation === "validated" && (
              <>
                <span className="dot">·&nbsp;</span>
                <span className="ok">validated ✓</span>
              </>
            )}
          </div>
          <div className="cta-row">
            <button className="cta-primary" onClick={onEnter}>
              Enter world
              <span className="kbd">⏎</span>
            </button>
            <button className="cta-secondary" onClick={onOpenAnother}>
              <Icon id="g-folder" size={14} />
              Open another…
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
