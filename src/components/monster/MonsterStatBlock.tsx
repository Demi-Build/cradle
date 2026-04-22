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
  // Root-level base-attack fields canon may emit in a future schema revision.
  // Any non-empty dice-notation string ("1d6", "2d8+1") on any of these keys
  // renders as a Damage stat slot. If none are present (current data), nothing
  // renders — cradle doesn't invent values.
  attack_dice?: string;
  damage_dice?: string;
  damage?: string;
};

function range(r: [number, number] | undefined): string {
  if (!r || r.length < 2) return "—";
  return r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`;
}

function baseAttackDice(m: Monster): string | null {
  const candidates = [m.attack_dice, m.damage_dice, m.damage];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Require actual dice notation; skip sentinel values like "0d0".
    const match = /^(\d+)d(\d+)/.exec(trimmed);
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) {
      return trimmed;
    }
  }
  return null;
}

function isDamageDice(d: string | undefined): boolean {
  if (!d) return false;
  const m = /^(\d+)d(\d+)$/.exec(d);
  if (!m) return false;
  return Number(m[1]) > 0 && Number(m[2]) > 0;
}

export function MonsterStatBlock({ data }: { data: Monster }) {
  const attack = baseAttackDice(data);
  return (
    <section className="stat-block">
      <div className="stat-block-row">
        <Stat label="HP" value={range(data.hp_range)} />
        <Stat label="AC" value={range(data.ac_range)} />
        {attack && <Stat label="Damage" value={attack} mono />}
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

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="stat-slot">
      <div className="stat-slot-label">{label}</div>
      <div className={`stat-slot-value ${mono ? "stat-slot-value-mono" : ""}`}>{value}</div>
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
