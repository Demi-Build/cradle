import { useEffect, useState } from "react";
import { api } from "../lib/invoke";
import { useStore } from "../store";
import { ExpandableText } from "./ExpandableText";

type Faction = {
  name?: string;
  description?: string;
  history?: string;
  leader?: string;
  threat_level?: number;
};
type Beat = {
  room_id?: string;
  summary?: string;
  faction_presence?: string;
  escalation?: number;
  boss_name?: string;
  boss_lore?: string;
};
type Story = {
  seed?: string;
  title?: string;
  synopsis?: string;
  faction?: Faction;
  escalation_arc?: string[];
  climax?: string;
  final_boss_name?: string;
  final_boss_lore?: string;
  key_npc_names?: string[];
  beats?: Beat[];
};
type Bible = {
  story?: Story;
  rooms?: Record<string, unknown>;
  player_classes?: unknown[];
  entity_index?: Record<string, unknown>;
};
type Manifest = {
  seed?: string;
  generated_at?: string;
  num_rooms?: number;
  environment_names?: string[];
  npc_count?: number;
  quest_count?: number;
  event_count?: number;
  class_count?: number;
  portraits_generated?: number;
  game_mode?: string;
  story_title?: string;
  faction_name?: string;
};
type Stats = {
  llm_backend?: string;
  image_backend?: string;
  llm_calls?: number;
  total_tokens?: number;
  images_generated?: number;
  images_succeeded?: number;
  llm_cost_usd?: number;
  image_cost_usd?: number;
  audio_cost_usd?: number;
  total_cost_usd?: number;
  generation_time_human?: string;
};

function formatUSD(v: number | undefined): string {
  if (v === undefined || v === null) return "—";
  return `$${v.toFixed(4)}`;
}

export function WorldBibleView() {
  const { worldPath, world, select } = useStore();
  const [bible, setBible] = useState<Bible | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!worldPath) return;
    setBible(null);
    setManifest(null);
    setStats(null);
    setErr(null);
    (async () => {
      try {
        const [b, m, s] = await Promise.all([
          api.getWorldBible(worldPath),
          api.readWorldJson(worldPath, "manifest").catch(() => null),
          api.readWorldJson(worldPath, "generation_stats").catch(() => null),
        ]);
        setBible(b as Bible);
        setManifest(m as Manifest | null);
        setStats(s as Stats | null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [worldPath]);

  if (err) return <div className="bible-err">Error: {err}</div>;
  if (!bible) return <div className="bible-loading">Loading World Bible…</div>;

  const story = bible.story ?? {};
  const faction = story.faction ?? {};
  const beats = story.beats ?? [];

  return (
    <div className="bible">
      <section className="bible-hero">
        <div className="bible-eyebrow">World Bible</div>
        <h1 className="bible-title">{story.title ?? "(untitled)"}</h1>
        {story.synopsis && (
          <p className="bible-synopsis">
            <ExpandableText text={story.synopsis} limit={600} />
          </p>
        )}
        <div className="bible-meta">
          {manifest?.generated_at && (
            <div className="meta-item">
              <span className="meta-k">generated</span>
              <span className="meta-v">{manifest.generated_at}</span>
            </div>
          )}
          {manifest?.game_mode && (
            <div className="meta-item">
              <span className="meta-k">mode</span>
              <span className="meta-v">{manifest.game_mode}</span>
            </div>
          )}
        </div>
        {story.seed && (
          <div className="bible-seed">
            <div className="meta-k">story seed</div>
            <div className="seed-text">
              <ExpandableText text={story.seed} limit={280} />
            </div>
          </div>
        )}
      </section>

      {world?.entity_counts && (
        <section className="bible-counts">
          {world.entity_counts.map((c) => (
            <button
              key={c.type_id}
              className="count-chip"
              onClick={() => select({ kind: "type", typeId: c.type_id })}
            >
              <span className="count-n">{c.count}</span>
              <span className="count-t">{c.type_id}</span>
            </button>
          ))}
        </section>
      )}

      {faction.name && (
        <section className="bible-section">
          <h2>Faction</h2>
          <div className="faction-card">
            <header>
              <span className="faction-name">{faction.name}</span>
              {typeof faction.threat_level === "number" && (
                <span className="chip chip-muted">threat {faction.threat_level}</span>
              )}
              {faction.leader && (
                <span className="chip chip-muted">led by {faction.leader}</span>
              )}
            </header>
            {faction.description && (
              <p><ExpandableText text={faction.description} limit={400} /></p>
            )}
            {faction.history && (
              <details>
                <summary>History</summary>
                <p><ExpandableText text={faction.history} limit={600} /></p>
              </details>
            )}
          </div>
        </section>
      )}

      {story.escalation_arc && story.escalation_arc.length > 0 && (
        <section className="bible-section">
          <h2>Escalation Arc</h2>
          <ol className="arc-list">
            {story.escalation_arc.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {beats.length > 0 && (
        <section className="bible-section">
          <h2>Beats</h2>
          <div className="beats-grid">
            {beats.map((b, i) => (
              <article className="beat-card" key={i}>
                <header>
                  {b.room_id ? (
                    <button
                      className="beat-room"
                      onClick={() => select({ kind: "entity", typeId: "rooms", id: b.room_id! })}
                    >
                      {b.room_id}
                    </button>
                  ) : (
                    <span className="beat-room">beat {i}</span>
                  )}
                  {typeof b.escalation === "number" && (
                    <span className="chip chip-muted">escalation {b.escalation}</span>
                  )}
                  {b.boss_name && <span className="chip">{b.boss_name}</span>}
                </header>
                {b.summary && (
                  <p className="beat-summary">
                    <ExpandableText text={b.summary} limit={400} />
                  </p>
                )}
                {b.faction_presence && (
                  <details>
                    <summary>Faction presence</summary>
                    <p><ExpandableText text={b.faction_presence} limit={500} /></p>
                  </details>
                )}
                {b.boss_lore && (
                  <details>
                    <summary>Boss lore</summary>
                    <p><ExpandableText text={b.boss_lore} limit={500} /></p>
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {(story.climax || story.final_boss_name || story.final_boss_lore) && (
        <section className="bible-section">
          <h2>Climax</h2>
          {story.climax && <p><ExpandableText text={story.climax} limit={500} /></p>}
          {story.final_boss_name && (
            <div className="final-boss">
              <div className="meta-k">final boss</div>
              <div className="final-boss-name">{story.final_boss_name}</div>
              {story.final_boss_lore && (
                <p className="final-boss-lore">
                  <ExpandableText text={story.final_boss_lore} limit={500} />
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {story.key_npc_names && story.key_npc_names.length > 0 && (
        <section className="bible-section">
          <h2>Key NPCs</h2>
          <div className="npc-chips">
            {story.key_npc_names.map((n) => (
              <span key={n} className="chip chip-muted">{n}</span>
            ))}
          </div>
        </section>
      )}

      {stats && (
        <section className="bible-section bible-stats">
          <h2>Generation</h2>
          <div className="stats-grid">
            {stats.llm_backend && <StatCell k="llm" v={stats.llm_backend} />}
            {stats.image_backend && <StatCell k="images" v={stats.image_backend} />}
            {typeof stats.llm_calls === "number" && <StatCell k="llm calls" v={String(stats.llm_calls)} />}
            {typeof stats.total_tokens === "number" && <StatCell k="tokens" v={stats.total_tokens.toLocaleString()} />}
            {typeof stats.llm_cost_usd === "number" && <StatCell k="llm cost" v={formatUSD(stats.llm_cost_usd)} />}
            {typeof stats.image_cost_usd === "number" && <StatCell k="image cost" v={formatUSD(stats.image_cost_usd)} />}
            {typeof stats.audio_cost_usd === "number" && <StatCell k="audio cost" v={formatUSD(stats.audio_cost_usd)} />}
            {typeof stats.total_cost_usd === "number" && <StatCell k="total cost" v={formatUSD(stats.total_cost_usd)} />}
            {stats.generation_time_human && <StatCell k="time" v={stats.generation_time_human} />}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCell({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat-cell">
      <div className="meta-k">{k}</div>
      <div className="stat-v">{v}</div>
    </div>
  );
}
