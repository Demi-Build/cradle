import type { ReactNode } from "react";
import { Portrait } from "./Portrait";
import { EntityLink } from "./EntityLink";
import { refFromField, REF_FIELDS } from "../lib/refs";
import { AbilityList, SpellList } from "./class/AbilityList";
import { RoomContents, RoomLayout } from "./room/RoomContents";
import { MonsterStatBlock, MonsterAbilities } from "./monster/MonsterStatBlock";
import { AudioPlayer } from "./AudioPlayer";

type Json = Record<string, unknown>;

const SCALAR_TYPES = ["string", "number", "boolean"];

const PORTRAIT_FIELDS = ["profile_image", "portrait_path"];

// Fields rendered verbatim as full-width prose, not as a key/value row.
const PROSE_FIELDS = new Set([
  "backstory",
  "description",
  "desc",
  "personality",
  "personality_notes",
  "flavor_text",
  "opening_greeting",
  "exhausted_dialogue",
  "hobby",
  "portrait_prompt",
]);

// Fields we never want in the overview (handled by other tabs, or noise).
const HIDE_FIELDS = new Set([
  "dialogue_tree",
  "profile_image",
  "portrait_path",
  "name",
  "id",
]);

function isScalar(v: unknown): v is string | number | boolean {
  return SCALAR_TYPES.includes(typeof v) || v === null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function labelFor(key: string): string {
  return key.replace(/_/g, " ");
}

export function EntityOverview({ data, typeId, entityId }: { data: Json; typeId: string; entityId: string }) {
  const name =
    (data.name as string | undefined) ??
    (data.environment_name as string | undefined) ??
    (data.id as string | number | undefined)?.toString() ??
    entityId ??
    "(unnamed)";
  const portraitHint =
    (data[PORTRAIT_FIELDS[0]] as string | undefined) ??
    (data[PORTRAIT_FIELDS[1]] as string | undefined) ??
    (typeId === "rooms" ? `${entityId}_map.png` : null);

  const isClass = typeId === "classes";
  const isRoom = typeId === "rooms";
  const isMonster = typeId === "monsters";
  const isAudio = typeId === "music" || typeId === "sfx";

  if (isAudio) {
    const filename = (data.filename as string | undefined) ?? `${entityId}.mp3`;
    const displayName = (data.name as string | undefined) ?? entityId;
    return (
      <div className="overview">
        <header className="overview-header">
          <div className="overview-titleblock">
            <h2 className="overview-name">{displayName}</h2>
            <div className="overview-sub">
              <span className="chip">{typeId}</span>
              <span className="chip chip-muted">{filename}</span>
            </div>
          </div>
        </header>
        <AudioPlayer hint={filename} name={displayName} kind={typeId} />
      </div>
    );
  }

  const typeSkip = new Set<string>();
  if (isClass) ["abilities", "ability_pool", "spells", "spell_pool"].forEach((k) => typeSkip.add(k));
  if (isRoom)
    ["grid", "npc_positions", "item_placements", "event_positions", "quest_ids",
      "gate_encounter_id", "door_position", "door_revealed", "player_start",
    ].forEach((k) => typeSkip.add(k));
  if (isMonster)
    ["abilities", "hp_range", "ac_range", "damage_type", "physical_type",
      "elemental_affinity", "weakness", "is_boss", "time_availability",
    ].forEach((k) => typeSkip.add(k));

  const prose: Array<[string, string]> = [];
  const scalars: Array<[string, string]> = [];
  const refs: Array<[string, ReturnType<typeof refFromField>]> = [];
  const complex: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(data)) {
    if (HIDE_FIELDS.has(key)) continue;
    if (typeSkip.has(key)) continue;
    if (key in REF_FIELDS) {
      const ref = refFromField(key, value);
      if (ref) {
        refs.push([key, ref]);
        continue;
      }
    }
    if (key === "loot_table" && Array.isArray(value) && value.length > 0) {
      complex.push([key, value]);
      continue;
    }
    if (PROSE_FIELDS.has(key) && typeof value === "string" && value.length > 60) {
      prose.push([key, value]);
    } else if (isScalar(value)) {
      scalars.push([key, formatValue(value)]);
    } else {
      complex.push([key, value]);
    }
  }

  const abilities = (data.abilities as unknown[] | undefined) ?? [];
  const abilityPool = (data.ability_pool as unknown[] | undefined) ?? [];
  const spells = (data.spells as unknown[] | undefined) ?? [];
  const spellPool = (data.spell_pool as unknown[] | undefined) ?? [];
  const isBoss = isMonster && data.is_boss === true;

  return (
    <div className="overview">
      <header className="overview-header">
        <Portrait hint={portraitHint} alt={name} size={160} />
        <div className="overview-titleblock">
          <h2 className="overview-name">{name}</h2>
          <div className="overview-sub">
            <span className="chip">{typeId}</span>
            {typeof data.id !== "undefined" && <span className="chip chip-muted">id {String(data.id)}</span>}
            {typeof data.type === "string" && <span className="chip chip-muted">{data.type}</span>}
            {isBoss && <span className="ability-badge starting">boss</span>}
          </div>
        </div>
      </header>

      {prose.length > 0 && (
        <section className="overview-prose">
          {prose.map(([k, v]) => (
            <div key={k} className="prose-block">
              <div className="prose-label">{labelFor(k)}</div>
              <div className="prose-body">{v}</div>
            </div>
          ))}
        </section>
      )}

      {scalars.length > 0 && (
        <section className="overview-fields">
          {scalars.map(([k, v]) => (
            <div key={k} className="field-row">
              <div className="field-key">{labelFor(k)}</div>
              <div className="field-val">{v}</div>
            </div>
          ))}
        </section>
      )}

      {refs.length > 0 && (
        <section className="overview-refs">
          {refs.map(([k, ref]) =>
            ref && ref.kind === "one" ? (
              <div key={k} className="ref-row">
                <div className="field-key">{labelFor(k)}</div>
                <div className="field-val">
                  <EntityLink typeId={ref.typeId} id={ref.id} />
                </div>
              </div>
            ) : ref && ref.kind === "many" ? (
              <div key={k} className="ref-row">
                <div className="field-key">{labelFor(k)}</div>
                <div className="field-val ref-list">
                  {ref.ids.map((id) => (
                    <EntityLink key={id} typeId={ref.typeId} id={id} />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </section>
      )}

      {isMonster && <MonsterStatBlock data={data as Parameters<typeof MonsterStatBlock>[0]["data"]} />}
      {isMonster && Array.isArray(data.abilities) && (
        <MonsterAbilities abilities={data.abilities as Parameters<typeof MonsterAbilities>[0]["abilities"]} />
      )}

      {isRoom && <RoomLayout data={data as Parameters<typeof RoomLayout>[0]["data"]} />}
      {isRoom && <RoomContents data={data as Parameters<typeof RoomContents>[0]["data"]} />}

      {isClass && (abilities.length > 0 || abilityPool.length > 0) && (
        <AbilityList
          starting={abilities as Parameters<typeof AbilityList>[0]["starting"]}
          pool={abilityPool as Parameters<typeof AbilityList>[0]["pool"]}
          label="Ability pool"
        />
      )}
      {isClass && (spells.length > 0 || spellPool.length > 0) && (
        <SpellList
          starting={spells as Parameters<typeof SpellList>[0]["starting"]}
          pool={spellPool as Parameters<typeof SpellList>[0]["pool"]}
          label="Spell pool"
        />
      )}

      {complex.length > 0 && (
        <section className="overview-complex">
          {complex.map(([k, v]) => {
            if (k === "loot_table" && Array.isArray(v)) {
              return <LootTable key={k} rows={v as LootEntry[]} />;
            }
            return <ComplexField key={k} name={k} value={v} />;
          })}
        </section>
      )}
    </div>
  );
}

function ComplexField({ name, value }: { name: string; value: unknown }): ReactNode {
  return (
    <details className="complex-field">
      <summary>{labelFor(name)}</summary>
      <pre className="complex-json">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

type LootEntry = { item_id?: number | string; drop_chance?: number };

function LootTable({ rows }: { rows: LootEntry[] }) {
  return (
    <div className="loot-table">
      <div className="loot-header">loot table</div>
      <table>
        <thead>
          <tr>
            <th>item</th>
            <th>drop chance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                {r.item_id !== undefined ? (
                  <EntityLink typeId="items" id={String(r.item_id)} />
                ) : (
                  "—"
                )}
              </td>
              <td className="loot-chance">
                {typeof r.drop_chance === "number" ? `${(r.drop_chance * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
