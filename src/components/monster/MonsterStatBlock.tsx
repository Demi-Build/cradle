import type { Monster, MonsterAbility } from "./types";
import { ScalarInput, useDraftUpdater } from "../edit/inputs";

/* ============================================================
   Schema-driven presentation (PoC)
   ------------------------------------------------------------
   Each slot type below declares once: how to read the data, how
   to write it, what label/CSS to use. The renderer walks the
   declared schema and produces identical DOM in display vs edit
   modes — only the inner content (text vs ghost-input) swaps.
   This is what gives us zero layout shift by construction.
   ============================================================ */

type RangeSlot = {
  kind: "range";
  label: string;
  get: (m: Monster) => [number, number] | undefined;
  set: (m: Monster, v: [number, number]) => Monster;
};

type TextStatSlot = {
  kind: "text-stat";
  label: string;
  get: (m: Monster) => string | undefined;
  set: (m: Monster, v: string | undefined) => Monster;
  mono?: boolean;
};

type StatSlot = RangeSlot | TextStatSlot;

type ChipSlot = {
  kind: "chip";
  prefix?: string;
  placeholder?: string;
  get: (m: Monster) => string | undefined;
  set: (m: Monster, v: string | undefined) => Monster;
  chipClass: (value: string) => string;
};

/* ============================================================
   Monster schema definition
   ============================================================ */

function attackDice(m: Monster): string {
  const candidates = [m.attack_dice, m.damage_dice, m.damage];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = /^(\d+)d(\d+)/.exec(trimmed);
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) {
      return trimmed;
    }
  }
  return "";
}

const STAT_SLOTS: StatSlot[] = [
  {
    kind: "range",
    label: "HP",
    get: (m) => m.hp_range,
    set: (m, v) => ({ ...m, hp_range: v }),
  },
  {
    kind: "range",
    label: "AC",
    get: (m) => m.ac_range,
    set: (m, v) => ({ ...m, ac_range: v }),
  },
  {
    kind: "text-stat",
    label: "Damage",
    get: (m) => attackDice(m) || undefined,
    set: (m, v) => ({ ...m, attack_dice: v }),
    mono: true,
  },
];

const CHIP_SLOTS: ChipSlot[] = [
  {
    kind: "chip",
    placeholder: "damage type",
    get: (m) => m.damage_type,
    set: (m, v) => ({ ...m, damage_type: v }),
    chipClass: (v) => `element-chip ${v ? `el-${v}` : ""}`,
  },
  {
    kind: "chip",
    placeholder: "physical type",
    get: (m) => m.physical_type,
    set: (m, v) => ({ ...m, physical_type: v }),
    chipClass: () => "chip chip-muted",
  },
  {
    kind: "chip",
    prefix: "affinity: ",
    placeholder: "affinity",
    get: (m) => m.elemental_affinity,
    set: (m, v) => ({ ...m, elemental_affinity: v }),
    chipClass: () => "chip chip-muted",
  },
  {
    kind: "chip",
    prefix: "weak: ",
    placeholder: "weakness",
    get: (m) => m.weakness,
    set: (m, v) => ({ ...m, weakness: v }),
    chipClass: (v) => `chip weakness-chip ${v ? `el-${v}` : ""}`,
  },
  {
    kind: "chip",
    placeholder: "availability",
    get: (m) => m.time_availability,
    set: (m, v) => ({ ...m, time_availability: v }),
    chipClass: () => "chip chip-muted",
  },
];

/* ============================================================
   Renderers
   ============================================================ */

function rangeStr(r: [number, number] | undefined): string {
  if (!r || r.length < 2) return "";
  return r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`;
}

function StatSlotRenderer({
  slot,
  data,
  editable,
  update,
}: {
  slot: StatSlot;
  data: Monster;
  editable: boolean;
  update: (next: Monster) => void;
}) {
  const mono = slot.kind === "text-stat" && slot.mono;
  return (
    <div className="stat-slot">
      <div className="stat-slot-label">{slot.label}</div>
      <div className={`stat-slot-value ${mono ? "stat-slot-value-mono" : ""}`}>
        {slot.kind === "range" ? (
          <RangeValue slot={slot} data={data} editable={editable} update={update} />
        ) : (
          <TextStatValue slot={slot} data={data} editable={editable} update={update} />
        )}
      </div>
    </div>
  );
}

function RangeValue({
  slot,
  data,
  editable,
  update,
}: {
  slot: RangeSlot;
  data: Monster;
  editable: boolean;
  update: (next: Monster) => void;
}) {
  const value = slot.get(data);
  if (editable) {
    const cur = value ?? [0, 0];
    return (
      <>
        <ScalarInput
          type="number"
          value={cur[0]}
          onChange={(v) => update(slot.set(data, [typeof v === "number" ? v : 0, cur[1]]))}
          className="stat-slot-num"
        />
        <span>–</span>
        <ScalarInput
          type="number"
          value={cur[1]}
          onChange={(v) => update(slot.set(data, [cur[0], typeof v === "number" ? v : 0]))}
          className="stat-slot-num"
        />
      </>
    );
  }
  const text = rangeStr(value);
  return text ? <>{text}</> : <EmDash />;
}

function TextStatValue({
  slot,
  data,
  editable,
  update,
}: {
  slot: TextStatSlot;
  data: Monster;
  editable: boolean;
  update: (next: Monster) => void;
}) {
  const value = slot.get(data) ?? "";
  if (editable) {
    return (
      <ScalarInput
        type="string"
        value={value}
        onChange={(v) => update(slot.set(data, (typeof v === "string" && v) || undefined))}
      />
    );
  }
  return value ? <>{value}</> : <EmDash />;
}

function ChipSlotRenderer({
  slot,
  data,
  editable,
  update,
}: {
  slot: ChipSlot;
  data: Monster;
  editable: boolean;
  update: (next: Monster) => void;
}) {
  const value = slot.get(data) ?? "";
  const empty = !value;
  const cls = slot.chipClass(value);
  return (
    <span className={`${cls} ${empty ? "is-empty" : ""} ${editable ? "is-editable" : ""}`}>
      {slot.prefix}
      {editable ? (
        <ScalarInput
          type="string"
          value={value}
          onChange={(v) => update(slot.set(data, (typeof v === "string" && v) || undefined))}
          className="chip-edit-value"
        />
      ) : empty ? (
        <EmDash />
      ) : (
        value
      )}
    </span>
  );
}

function EmDash() {
  return <span className="slot-em">—</span>;
}

/* ============================================================
   Public component
   ============================================================ */

export function MonsterStatBlock({
  data,
  editMode = false,
  typeId,
  entityId,
}: {
  data: Monster;
  editMode?: boolean;
  typeId?: string;
  entityId?: string;
}) {
  const update = useDraftUpdater(typeId ?? "monsters", entityId ?? "");
  const editable = editMode && !!typeId && !!entityId;

  return (
    <section className="stat-block">
      <div className="stat-block-row">
        {STAT_SLOTS.map((slot) => (
          <StatSlotRenderer
            key={slot.label}
            slot={slot}
            data={data}
            editable={editable}
            update={update}
          />
        ))}
      </div>
      <div className="stat-block-chips">
        {CHIP_SLOTS.map((slot, i) => (
          <ChipSlotRenderer key={i} slot={slot} data={data} editable={editable} update={update} />
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   Abilities — schema-driven the same way as the stat block.
   Each card always renders: name slot, effect-type badge slot,
   dice row, chance chip. Empty fields show em-dash placeholders
   in display. DOM is identical between display and edit modes
   so the card heights don't shift on toggle.
   ============================================================ */

function isDamageDice(d: string | undefined): boolean {
  if (!d) return false;
  const m = /^(\d+)d(\d+)$/.exec(d);
  if (!m) return false;
  return Number(m[1]) > 0 && Number(m[2]) > 0;
}

export function MonsterAbilities({
  abilities,
  editMode = false,
  typeId,
  entityId,
  data,
}: {
  abilities: MonsterAbility[];
  editMode?: boolean;
  typeId?: string;
  entityId?: string;
  data?: Monster;
}) {
  const editable = editMode && !!typeId && !!entityId && !!data;
  const update = useDraftUpdater(typeId ?? "monsters", entityId ?? "");

  const updateAbility = (idx: number, field: keyof MonsterAbility, value: unknown) => {
    if (!data) return;
    const list = (data.abilities ?? []).map((a, i) =>
      i === idx ? { ...a, [field]: value === "" || value === null ? undefined : value } : a,
    );
    update({ ...data, abilities: list });
  };

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
              key={editable ? i : (a.name ?? i)}
              className={`ability-card spell-card ${dmg ? "weapon-like" : ""}`}
            >
              <header>
                <span className="ability-name">
                  {editable ? (
                    <ScalarInput
                      type="string"
                      value={a.name ?? ""}
                      onChange={(v) => updateAbility(i, "name", v)}
                    />
                  ) : (
                    a.name || <EmDash />
                  )}
                </span>
                <AbilityBadgeSlot
                  value={a.effect_type}
                  editable={editable}
                  onChange={(v) => updateAbility(i, "effect_type", v)}
                />
              </header>
              <div className="weapon-block">
                <div className="weapon-dice">
                  {editable ? (
                    <ScalarInput
                      type="string"
                      value={a.damage_dice ?? ""}
                      onChange={(v) => updateAbility(i, "damage_dice", v)}
                    />
                  ) : a.damage_dice ? (
                    a.damage_dice
                  ) : (
                    <EmDash />
                  )}
                </div>
                <div className="weapon-meta">
                  <ChanceChip
                    editable={editable}
                    chance={a.chance}
                    onChange={(v) => updateAbility(i, "chance", v)}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}

// Always render the badge slot — empty effect_type shows a dim em-dash.
function AbilityBadgeSlot({
  value,
  editable,
  onChange,
}: {
  value: string | undefined;
  editable: boolean;
  onChange: (v: string | undefined) => void;
}) {
  const empty = !value;
  return (
    <span
      className={`ability-badge ${value === "damage" ? "starting" : ""} ${empty ? "is-empty" : ""}`}
    >
      {editable ? (
        <ScalarInput
          type="string"
          value={value ?? ""}
          onChange={(v) => onChange((typeof v === "string" && v) || undefined)}
          className="chip-edit-value"
        />
      ) : empty ? (
        <EmDash />
      ) : (
        value
      )}
    </span>
  );
}

function ChanceChip({
  editable,
  chance,
  onChange,
}: {
  editable: boolean;
  chance: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const hasValue = typeof chance === "number";
  return (
    <span
      className={`chip chip-muted ${hasValue ? "" : "is-empty"} ${editable ? "is-editable" : ""}`}
    >
      {editable ? (
        <>
          <ScalarInput
            type="number"
            value={chance ?? null}
            onChange={(v) => onChange(typeof v === "number" ? v : undefined)}
            className="chip-edit-value"
          />
          <span>chance (0–1)</span>
        </>
      ) : hasValue ? (
        <>{(chance! * 100).toFixed(0)}% chance</>
      ) : (
        <>
          <EmDash /> chance
        </>
      )}
    </span>
  );
}
