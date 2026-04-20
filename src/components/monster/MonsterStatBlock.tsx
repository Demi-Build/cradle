type MonsterAbility = {
  name?: string;
  effect_type?: string;
  damage_dice?: string;
  chance?: number;
};

type Monster = {
  hp_range?: [number, number];
  ac_range?: [number, number];
  level?: number;
  damage_type?: string;
  physical_type?: string;
  elemental_affinity?: string;
  weakness?: string;
  is_boss?: boolean;
  species?: string;
  time_availability?: string;
  abilities?: MonsterAbility[];
};

function range(r: [number, number] | undefined): string {
  if (!r || r.length < 2) return "—";
  return r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`;
}

function isDamageDice(d: string | undefined): boolean {
  if (!d) return false;
  const m = /^(\d+)d(\d+)$/.exec(d);
  if (!m) return false;
  return Number(m[1]) > 0 && Number(m[2]) > 0;
}

export function MonsterStatBlock({ data }: { data: Monster }) {
  return (
    <section className="stat-block">
      <div className="stat-block-row">
        <Stat label="HP" value={range(data.hp_range)} />
        <Stat label="AC" value={range(data.ac_range)} />
        {typeof data.level === "number" && <Stat label="Level" value={String(data.level)} />}
        {data.species && <Stat label="Species" value={data.species} />}
      </div>
      <div className="stat-block-chips">
        {data.damage_type && (
          <span className={`element-chip el-${data.damage_type}`}>{data.damage_type}</span>
        )}
        {data.physical_type && <span className="chip chip-muted">{data.physical_type}</span>}
        {data.elemental_affinity && (
          <span className="chip chip-muted">affinity: {data.elemental_affinity}</span>
        )}
        {data.weakness && (
          <span className={`chip weakness-chip el-${data.weakness}`}>weak: {data.weakness}</span>
        )}
        {data.time_availability && data.time_availability !== "always" && (
          <span className="chip chip-muted">{data.time_availability}</span>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-slot">
      <div className="stat-slot-label">{label}</div>
      <div className="stat-slot-value">{value}</div>
    </div>
  );
}

export function MonsterAbilities({ abilities }: { abilities: MonsterAbility[] }) {
  if (!abilities || abilities.length === 0) return null;
  return (
    <details className="ability-section" open>
      <summary className="ability-heading">
        Abilities <span className="ability-count">{abilities.length}</span>
      </summary>
      <div className="ability-grid">
        {abilities.map((a, i) => {
          const dmg = isDamageDice(a.damage_dice);
          return (
            <article
              key={a.name ?? i}
              className={`ability-card spell-card ${dmg ? "weapon-like" : ""}`}
            >
              <header>
                <span className="ability-name">{a.name ?? "(unnamed)"}</span>
                {a.effect_type && (
                  <span className={`ability-badge ${a.effect_type === "damage" ? "starting" : ""}`}>
                    {a.effect_type}
                  </span>
                )}
              </header>
              {dmg ? (
                <div className="weapon-block">
                  <div className="weapon-dice">{a.damage_dice}</div>
                  <div className="weapon-meta">
                    {typeof a.chance === "number" && (
                      <span className="chip chip-muted">{(a.chance * 100).toFixed(0)}% chance</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="ability-chips">
                  {typeof a.chance === "number" && (
                    <span className="chip chip-muted">{(a.chance * 100).toFixed(0)}% chance</span>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </details>
  );
}
