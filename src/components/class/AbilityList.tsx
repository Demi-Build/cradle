type Ability = {
  name?: string;
  description?: string;
  stat?: string;
  stamina_cost?: number;
};

type Spell = Ability & {
  spell_type?: string;
  element?: string;
  targets?: string;
  num_dice?: number;
  die_sides?: number;
  heal_amount?: number;
  buff_stat?: string | null;
  buff_value?: number;
  buff_duration?: number;
};

function isDamageSpell(s: Spell): boolean {
  if (
    typeof s.num_dice === "number" &&
    s.num_dice > 0 &&
    typeof s.die_sides === "number" &&
    s.die_sides > 0
  ) {
    return true;
  }
  return !!s.spell_type && s.spell_type.startsWith("damage");
}

type Entry<T> = T & { isStarting: boolean };

function merge<T extends { name?: string }>(starting: T[], pool: T[]): Entry<T>[] {
  const byName = new Map<string, Entry<T>>();
  for (const p of pool) {
    const k = p.name ?? JSON.stringify(p);
    byName.set(k, { ...p, isStarting: false });
  }
  for (const s of starting) {
    const k = s.name ?? JSON.stringify(s);
    byName.set(k, { ...s, isStarting: true });
  }
  return Array.from(byName.values()).sort((a, b) => {
    if (a.isStarting !== b.isStarting) return a.isStarting ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export function AbilityList({
  starting,
  pool,
  label,
}: {
  starting: Ability[];
  pool: Ability[];
  label: string;
}) {
  const merged = merge(starting, pool);
  if (!merged.length) return null;
  return (
    <details className="ability-section" open>
      <summary className="ability-heading">
        {label} <span className="ability-count">{merged.length}</span>
      </summary>
      <div className="ability-grid">
        {merged.map((a, i) => (
          <AbilityCard key={a.name ?? i} entry={a} />
        ))}
      </div>
    </details>
  );
}

export function SpellList({
  starting,
  pool,
  label,
}: {
  starting: Spell[];
  pool: Spell[];
  label: string;
}) {
  const merged = merge(starting, pool);
  if (!merged.length) return null;
  return (
    <details className="ability-section" open>
      <summary className="ability-heading">
        {label} <span className="ability-count">{merged.length}</span>
      </summary>
      <div className="ability-grid">
        {merged.map((s, i) => (
          <SpellCard key={s.name ?? i} entry={s} />
        ))}
      </div>
    </details>
  );
}

function AbilityCard({ entry }: { entry: Entry<Ability> }) {
  return (
    <article className={`ability-card ${entry.isStarting ? "starting" : ""}`}>
      <header>
        <span className="ability-name">{entry.name}</span>
        {entry.isStarting && <span className="ability-badge starting">starting</span>}
      </header>
      <div className="ability-chips">
        {entry.stat && <span className="chip chip-muted">{entry.stat}</span>}
        {typeof entry.stamina_cost === "number" && (
          <span className="chip chip-muted">{entry.stamina_cost} stamina</span>
        )}
      </div>
      {entry.description && <p className="ability-desc">{entry.description}</p>}
    </article>
  );
}

function SpellCard({ entry }: { entry: Entry<Spell> }) {
  const dice =
    typeof entry.num_dice === "number" &&
    entry.num_dice > 0 &&
    typeof entry.die_sides === "number" &&
    entry.die_sides > 0
      ? `${entry.num_dice}d${entry.die_sides}`
      : null;
  const damage = isDamageSpell(entry);

  return (
    <article
      className={`ability-card spell-card ${damage ? "weapon-like" : ""} ${entry.isStarting ? "starting" : ""}`}
    >
      <header>
        <span className="ability-name">{entry.name}</span>
        {entry.isStarting && <span className="ability-badge starting">starting</span>}
      </header>

      {damage && dice && (
        <div className="weapon-block">
          <div className="weapon-dice">{dice}</div>
          <div className="weapon-meta">
            {entry.element && (
              <span className={`element-chip el-${entry.element}`}>{entry.element}</span>
            )}
            {entry.stat && <span className="chip chip-muted">{entry.stat}</span>}
            {entry.targets && <span className="chip chip-muted">{entry.targets}</span>}
            {typeof entry.stamina_cost === "number" && (
              <span className="chip chip-muted">{entry.stamina_cost} stam</span>
            )}
          </div>
        </div>
      )}

      {!damage && (
        <div className="ability-chips">
          {entry.element && (
            <span className={`element-chip el-${entry.element}`}>{entry.element}</span>
          )}
          {entry.spell_type && <span className="chip chip-muted">{entry.spell_type}</span>}
          {entry.targets && <span className="chip chip-muted">{entry.targets}</span>}
          {entry.stat && <span className="chip chip-muted">{entry.stat}</span>}
          {typeof entry.heal_amount === "number" && entry.heal_amount > 0 && (
            <span className="chip chip-muted">heal {entry.heal_amount}</span>
          )}
          {typeof entry.stamina_cost === "number" && (
            <span className="chip chip-muted">{entry.stamina_cost} stam</span>
          )}
        </div>
      )}

      {entry.description && <p className="ability-desc">{entry.description}</p>}
      {entry.buff_stat && (
        <p className="ability-buff">
          buff: +{entry.buff_value} {entry.buff_stat}
          {entry.buff_duration ? ` for ${entry.buff_duration} turns` : ""}
        </p>
      )}
    </article>
  );
}
