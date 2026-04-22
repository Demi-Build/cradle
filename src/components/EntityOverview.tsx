import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Portrait } from "./Portrait";
import { EntityLink } from "./EntityLink";
import { refFromField, REF_FIELDS } from "../lib/refs";
import { AbilityList, SpellList } from "./class/AbilityList";
import { RoomContents, RoomLayout } from "./room/RoomContents";
import { RoomStory } from "./room/RoomStory";
import { MonsterStatBlock, MonsterAbilities } from "./monster/MonsterStatBlock";
import { AudioPlayer } from "./AudioPlayer";
import { useStore } from "../store";
import { api } from "../lib/invoke";
import { Icon } from "./start/Icons";

function useStoreWorldPath() {
  return useStore((s) => s.worldPath);
}
function useStoreOpenLightbox() {
  return useStore((s) => s.openLightbox);
}
function useAssetUrlInline(worldPath: string, hint: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!worldPath || !hint) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await api.resolveAsset(worldPath, hint);
        if (cancelled) return;
        if (resolved) setUrl(convertFileSrc(resolved));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [worldPath, hint]);
  return url;
}

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

const NPC_PROSE_ORDER = [
  "hobby",
  "personality",
  "opening_greeting",
  "exhausted_dialogue",
  "portrait_prompt",
];

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
  const isNpc = typeId === "npcs";
  const isItem = typeId === "items";
  const isEvent = typeId === "events";
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
  if (isClass) ["abilities", "ability_pool", "spells", "spell_pool", "stats", "starting_weapon"].forEach((k) => typeSkip.add(k));
  if (isItem) typeSkip.add("item_stats");
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
  const noteLists: Array<[string, string[]]> = [];

  const npcQuestHide = new Set([
    "quest_id",          // shown in Quest badge
    "quest_type",        // shown in Quest badge
    "quest_target_tile", // belongs on the quest, not the NPC
    "dialogue_tree",           // rendered in the Dialogue tab
    "dialogue_tree_complete",
    "dialogue_tree_failed",
    "dialogue_tree_incomplete",
    "npc_monster",       // rendered in the combat-form section
  ]);

  for (const [key, value] of Object.entries(data)) {
    if (HIDE_FIELDS.has(key)) continue;
    if (typeSkip.has(key)) continue;
    // For NPCs, backstory is rendered in the header column — skip from regular prose.
    if (isNpc && key === "backstory") continue;
    if (isNpc && npcQuestHide.has(key)) continue;
    // For events, money_drop is already surfaced as a row inside LootTable; don't re-render below.
    if (isEvent && key === "money_drop") continue;
    // For events, choices render in the Puzzle/Choices tab — skip from overview.
    if (isEvent && key === "choices") continue;
    // For events, failure_damage_type + failure_damage_range are rendered together
    // as a synthesized "failure damage" scalar below. Skip the individual fields.
    if (isEvent && (key === "failure_damage_type" || key === "failure_damage_range")) continue;
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
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "string" && v.length > 0)
    ) {
      noteLists.push([key, value as string[]]);
      continue;
    }
    // For NPCs: anything in the prose-order list goes to prose regardless of length.
    const isNpcProse = isNpc && NPC_PROSE_ORDER.includes(key) && typeof value === "string";
    if (isNpcProse || (PROSE_FIELDS.has(key) && typeof value === "string" && value.length > 60)) {
      prose.push([key, value as string]);
    } else if (isScalar(value)) {
      scalars.push([key, formatValue(value)]);
    } else {
      complex.push([key, value]);
    }
  }

  // For NPCs, sort prose by the explicit order.
  if (isNpc) {
    prose.sort((a, b) => {
      const ai = NPC_PROSE_ORDER.indexOf(a[0]);
      const bi = NPC_PROSE_ORDER.indexOf(b[0]);
      const av = ai === -1 ? 999 : ai;
      const bv = bi === -1 ? 999 : bi;
      return av - bv;
    });
  }

  // For events, inject a synthesized "failure damage" scalar combining type + range,
  // placed alongside other combat-outcome stats.
  if (isEvent) {
    const fType = data.failure_damage_type;
    const fRange = data.failure_damage_range;
    const typeStr = typeof fType === "string" ? fType : null;
    const hasRange =
      Array.isArray(fRange) &&
      fRange.length >= 2 &&
      typeof fRange[0] === "number" &&
      typeof fRange[1] === "number";
    if (typeStr || hasRange) {
      let value: string;
      if (typeStr && hasRange) {
        value = `${typeStr} ${(fRange as number[])[0]}–${(fRange as number[])[1]}`;
      } else if (typeStr) {
        value = typeStr;
      } else {
        const r = fRange as number[];
        value = `${r[0]}–${r[1]}`;
      }
      scalars.push(["failure_damage", value]);
    }
  }

  const abilities = (data.abilities as unknown[] | undefined) ?? [];
  const abilityPool = (data.ability_pool as unknown[] | undefined) ?? [];
  const spells = (data.spells as unknown[] | undefined) ?? [];
  const spellPool = (data.spell_pool as unknown[] | undefined) ?? [];
  const isBoss = isMonster && data.is_boss === true;
  const classStats = isClass && typeof data.stats === "object" && data.stats !== null
    ? (data.stats as Record<string, number>)
    : null;
  const itemStats = isItem && typeof data.item_stats === "object" && data.item_stats !== null
    ? (data.item_stats as Record<string, string | number>)
    : null;

  const npcHasQuest = isNpc && data.quest_id !== null && data.quest_id !== undefined;
  const npcIsStory = isNpc && data.is_story_npc === true;
  const npcBackstory = isNpc && typeof data.backstory === "string" ? data.backstory : null;
  const portraitPrompt = typeof data.portrait_prompt === "string" ? data.portrait_prompt : undefined;

  return (
    <div className="overview">
      {isRoom ? (
        <RoomHero data={data} entityId={entityId} />
      ) : (
        <header className={`overview-header ${isNpc ? "overview-header--npc" : ""} ${isMonster ? "overview-header--monster" : ""} ${isEvent ? "overview-header--event" : ""} ${isClass ? "overview-header--class" : ""}`}>
          <div className="overview-portrait-col">
            <Portrait hint={portraitHint} alt={name} size={480} tooltip={portraitPrompt} />
            {npcIsStory && (
              <div className="portrait-badge story">
                <Icon id="g-star" size={14} className="portrait-badge-icon" />
                <span className="portrait-badge-label">Story NPC</span>
              </div>
            )}
            {npcHasQuest && (
              <QuestBadge
                questId={String(data.quest_id)}
                questType={typeof data.quest_type === "string" ? data.quest_type : undefined}
              />
            )}
          </div>
          <div className="overview-titleblock">
            <h2 className="overview-name">{name}</h2>
            <div className="overview-sub">
              <span className="chip">{typeId}</span>
              {typeof data.id !== "undefined" && <span className="chip chip-muted">id {String(data.id)}</span>}
              {typeof data.type === "string" && <span className="chip chip-muted">{data.type}</span>}
              {isBoss && <span className="ability-badge starting">boss</span>}
            </div>
            {scalars.length > 0 && (
              <div className="overview-fields-inline">
                {scalars.map(([k, v]) => (
                  <div key={k} className="field-row">
                    <div className="field-key">{labelFor(k)}</div>
                    <div className="field-val">{v}</div>
                  </div>
                ))}
              </div>
            )}
            {itemStats && <ItemStatsTable stats={itemStats} />}
            {isClass && typeof data.starting_weapon === "string" && (
              <StartingWeaponField name={data.starting_weapon} />
            )}
            {classStats && <ClassStatsTable stats={classStats} />}
            {isMonster && <MonsterStatBlock data={data as Parameters<typeof MonsterStatBlock>[0]["data"]} />}
            {isMonster && Array.isArray(data.abilities) && (data.abilities as unknown[]).length > 0 && (
              <MonsterAbilities abilities={data.abilities as Parameters<typeof MonsterAbilities>[0]["abilities"]} />
            )}
            {isNpc && npcBackstory && (
              <div className="overview-backstory">
                <div className="prose-label">backstory</div>
                <div className="prose-body">{npcBackstory}</div>
              </div>
            )}
            {(isNpc || isMonster || isEvent || isClass) && prose.length > 0 && (
              <div className="overview-prose-inline">
                {prose.map(([k, v]) => (
                  <div key={k} className="prose-block">
                    <div className="prose-label">{labelFor(k)}</div>
                    <div className="prose-body">{v}</div>
                  </div>
                ))}
              </div>
            )}
            {(isNpc || isMonster || isEvent || isClass) && noteLists.length > 0 && (
              <div className="overview-notes-inline">
                {noteLists.map(([k, items]) => (
                  <div key={k} className="notes-block">
                    <div className="prose-label">{labelFor(k)}</div>
                    <ul className="notes-list">
                      {items.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </header>
      )}

      {!isNpc && !isMonster && !isEvent && !isClass && prose.length > 0 && (
        <section className="overview-prose">
          {prose.map(([k, v]) => (
            <div key={k} className="prose-block">
              <div className="prose-label">{labelFor(k)}</div>
              <div className="prose-body">{v}</div>
            </div>
          ))}
        </section>
      )}

      {!isNpc && !isMonster && !isEvent && !isClass && noteLists.length > 0 && (
        <section className="overview-notes">
          {noteLists.map(([k, items]) => (
            <div key={k} className="notes-block">
              <div className="prose-label">{labelFor(k)}</div>
              <ul className="notes-list">
                {items.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ))}
        </section>
      )}

      {isRoom && scalars.length > 0 && (
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

      {isRoom && <RoomLayout data={data as Parameters<typeof RoomLayout>[0]["data"]} />}
      {isRoom && <RoomStory roomId={entityId} />}
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
              const money = data.money_drop as [number, number] | undefined;
              return <LootTable key={k} rows={v as LootEntry[]} moneyDrop={money} />;
            }
            if (k === "shop_inventory" && Array.isArray(v)) {
              return <ShopInventoryTable key={k} rows={v as ShopRow[]} />;
            }
            return <ComplexField key={k} name={k} value={v} />;
          })}
        </section>
      )}

      {isNpc && typeof data.npc_monster === "object" && data.npc_monster !== null && (
        <CombatForm monster={data.npc_monster as CombatFormMonster} />
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
type ShopRow = { item_id?: number | string; price?: number; stock?: number };

type CombatFormMonster = {
  id?: number | string;
  name?: string;
  species?: string;
  description?: string;
  hp_range?: [number, number];
  ac_range?: [number, number];
  level?: number;
  damage_type?: string;
  physical_type?: string;
  elemental_affinity?: string;
  weakness?: string;
  is_boss?: boolean;
  time_availability?: string;
  abilities?: Array<{ name?: string; effect_type?: string; damage_dice?: string; chance?: number }>;
  portrait_prompt?: string;
  profile_image?: string;
};

function CombatForm({ monster }: { monster: CombatFormMonster }) {
  const name = monster.name ?? "(combat form)";
  const hasAbilities = Array.isArray(monster.abilities) && monster.abilities.length > 0;
  return (
    <section className="combat-form">
      <header className="combat-form-head">
        <span className="cf-icon" aria-hidden>⚔</span>
        <span className="cf-label">Combat form</span>
        <span className="cf-spacer" />
        {monster.id !== undefined && (
          <EntityLink typeId="monsters" id={String(monster.id)} fallbackLabel="open monster entry" />
        )}
      </header>
      <div className="combat-form-body">
        <div className="combat-form-hero">
          <Portrait
            hint={monster.profile_image ?? null}
            alt={name}
            size={120}
            tooltip={monster.portrait_prompt}
          />
          <div className="combat-form-title">
            <h3 className="cf-name">{name}</h3>
            <div className="overview-sub">
              {monster.id !== undefined && <span className="chip chip-muted">id {monster.id}</span>}
              {monster.species && <span className="chip chip-muted">{monster.species}</span>}
              {monster.is_boss && <span className="ability-badge starting">boss</span>}
            </div>
          </div>
        </div>
        {monster.description && <p className="combat-form-desc">{monster.description}</p>}
        <MonsterStatBlock data={monster} />
        {hasAbilities && <MonsterAbilities abilities={monster.abilities!} />}
      </div>
    </section>
  );
}

function ShopInventoryTable({ rows }: { rows: ShopRow[] }) {
  return (
    <div className="loot-table">
      <div className="loot-header">shop inventory</div>
      <table>
        <thead>
          <tr>
            <th>item</th>
            <th style={{ textAlign: "right" }}>price</th>
            <th style={{ textAlign: "right" }}>stock</th>
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
              <td className="loot-chance" style={{ textAlign: "right" }}>
                {typeof r.price === "number" ? r.price : "—"}
              </td>
              <td className="loot-chance" style={{ textAlign: "right" }}>
                {typeof r.stock === "number" ? r.stock : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LootTable({ rows, moneyDrop }: { rows: LootEntry[]; moneyDrop?: [number, number] }) {
  const hasMoney =
    Array.isArray(moneyDrop) &&
    moneyDrop.length >= 2 &&
    typeof moneyDrop[0] === "number" &&
    typeof moneyDrop[1] === "number" &&
    (moneyDrop[0] > 0 || moneyDrop[1] > 0);
  return (
    <div className="loot-table">
      <div className="loot-header">loot table</div>
      <table>
        <thead>
          <tr>
            <th>drop</th>
            <th>amount / chance</th>
          </tr>
        </thead>
        <tbody>
          {hasMoney && (
            <tr className="loot-money">
              <td>
                <span className="loot-kind">money</span>
              </td>
              <td className="loot-chance">
                {moneyDrop![0] === moneyDrop![1]
                  ? String(moneyDrop![0])
                  : `${moneyDrop![0]}–${moneyDrop![1]}`}
              </td>
            </tr>
          )}
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

function QuestBadge({ questId, questType }: { questId: string; questType?: string }) {
  const entities = useStore((s) => s.entities);
  const worldPath = useStore((s) => s.worldPath);
  const setEntities = useStore((s) => s.setEntities);
  const select = useStore((s) => s.select);
  const list = entities["quests"];
  const match = list?.find((r) => r.id === questId);

  useEffect(() => {
    if (!list && worldPath) {
      api
        .listEntities(worldPath, "quests")
        .then((rows) => setEntities("quests", rows))
        .catch(() => {});
    }
  }, [list, worldPath, setEntities]);

  const title = match?.name ?? `#${questId}`;

  return (
    <button
      className="portrait-badge quest"
      onClick={() => select({ kind: "entity", typeId: "quests", id: questId })}
      title="open quest"
    >
      <Icon id="g-exclaim" size={14} className="portrait-badge-icon" />
      <span className="portrait-badge-label">Quest</span>
      {questType && <span className="portrait-badge-sub">{questType}</span>}
      <span className="portrait-badge-title">{title}</span>
    </button>
  );
}

function ItemStatsTable({ stats }: { stats: Record<string, string | number> }) {
  const entries = Object.entries(stats).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="item-stats">
      <div className="item-stats-label">stats</div>
      <table className="item-stats-table">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td className="is-key">{k.replace(/_/g, " ")}</td>
              <td className={`is-val ${typeof v === "number" ? "is-val-num" : ""}`}>
                {String(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StartingWeaponField({ name }: { name: string }) {
  const worldPath = useStore((s) => s.worldPath);
  const [itemId, setItemId] = useState<string | null>(null);
  const [damage, setDamage] = useState<string | null>(null);

  useEffect(() => {
    setItemId(null);
    setDamage(null);
    if (!worldPath || !name) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await api.listEntityRows(worldPath, "items");
        if (cancelled) return;
        const needle = name.toLowerCase();
        const match = rows.find((r) => {
          const n = (r.data as Record<string, unknown> | undefined)?.name;
          return typeof n === "string" && n.toLowerCase() === needle;
        });
        if (!match) return;
        setItemId(String(match.id));
        const stats = (match.data as Record<string, unknown> | undefined)?.item_stats as
          | Record<string, unknown>
          | undefined;
        const dice = stats?.attack_dice;
        if (typeof dice === "string") setDamage(dice);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worldPath, name]);

  return (
    <div className="starting-weapon">
      <div className="starting-weapon-label">starting weapon</div>
      <div className="starting-weapon-body">
        {itemId ? (
          <EntityLink typeId="items" id={itemId} fallbackLabel={name} />
        ) : (
          <span className="starting-weapon-name">{name}</span>
        )}
        {damage && <span className="starting-weapon-dice">{damage}</span>}
      </div>
    </div>
  );
}

function ClassStatsTable({ stats }: { stats: Record<string, number> }) {
  const entries = Object.entries(stats).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;
  return (
    <div className="class-stats">
      <div className="class-stats-label">stats</div>
      <div className="class-stats-grid">
        {entries.map(([k, v]) => (
          <div key={k} className="class-stat">
            <div className="cs-key">{k}</div>
            <div className="cs-val">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomHero({
  data,
  entityId,
}: {
  data: Record<string, unknown>;
  entityId: string;
}) {
  const name =
    (typeof data.environment_name === "string" && data.environment_name) ||
    entityId;
  const env = typeof data.environment === "string" ? data.environment : undefined;
  const level = typeof data.level === "number" ? data.level : undefined;

  // e.g. "room_0" → index 0 → environment_0.png
  const match = /(\d+)$/.exec(entityId);
  const idx = match ? match[1] : null;
  const envHint = idx !== null ? `environment_${idx}.png` : null;
  const mapHint = idx !== null ? `room_${idx}_map.png` : null;

  return (
    <header className="room-hero">
      <div className="room-hero-images">
        <RoomHeroImg hint={envHint} alt={name} label="entry" />
        <RoomHeroImg hint={mapHint} alt={`${name} map`} label="layout" pixelated />
      </div>
      <div className="room-hero-meta">
        <h2 className="overview-name">{name}</h2>
        <div className="overview-sub">
          <span className="chip">room</span>
          <span className="chip chip-muted">id {entityId}</span>
          {env && <span className="chip chip-muted">{env}</span>}
          {level !== undefined && <span className="chip chip-muted">lvl {level}</span>}
        </div>
      </div>
    </header>
  );
}

function RoomHeroImg({
  hint,
  alt,
  label,
  pixelated,
}: {
  hint: string | null;
  alt: string;
  label: string;
  pixelated?: boolean;
}) {
  const worldPath = useStoreWorldPath();
  const openLightbox = useStoreOpenLightbox();
  const url = useAssetUrlInline(worldPath, hint);
  return (
    <figure className="room-hero-figure">
      <div
        className="room-hero-slot"
        onClick={() => url && openLightbox({ src: url, alt })}
        style={url ? { cursor: "zoom-in" } : undefined}
        title={url ? "click to enlarge" : undefined}
      >
        {url ? (
          <img
            src={url}
            alt={alt}
            className="room-hero-img"
            style={pixelated ? { imageRendering: "pixelated" } : undefined}
          />
        ) : (
          <div className="room-hero-missing">no image</div>
        )}
      </div>
      <figcaption className="room-hero-cap">{label}</figcaption>
    </figure>
  );
}
