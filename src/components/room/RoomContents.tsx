import { EntityLink } from "../EntityLink";

type NpcPositions = Record<string, [number, number]>;
type ItemPlacement = { x: number; y: number; item_id: number | string; name?: string };
type EventPosition = { x: number; y: number; event_id: number | string };

type RoomData = {
  grid?: number[][];
  environment?: string;
  environment_name?: string;
  door_position?: [number, number];
  door_revealed?: boolean;
  player_start?: [number, number];
  gate_encounter_id?: number | string | null;
  npc_positions?: NpcPositions;
  item_placements?: ItemPlacement[];
  event_positions?: EventPosition[];
  quest_ids?: Array<number | string>;
};

function coord(p: [number, number] | undefined): string {
  if (!p || p.length < 2) return "—";
  return `${p[0]}, ${p[1]}`;
}

function gridSize(g: number[][] | undefined): string | null {
  if (!g || !g.length) return null;
  const h = g.length;
  const w = g[0]?.length ?? 0;
  return `${w}×${h}`;
}

export function RoomLayout({ data }: { data: RoomData }) {
  const size = gridSize(data.grid);
  return (
    <section className="room-layout">
      {size && (
        <div className="field-row">
          <div className="field-key">grid</div>
          <div className="field-val">{size}</div>
        </div>
      )}
      {data.player_start && (
        <div className="field-row">
          <div className="field-key">player start</div>
          <div className="field-val">{coord(data.player_start)}</div>
        </div>
      )}
      {data.door_position && (
        <div className="field-row">
          <div className="field-key">door</div>
          <div className="field-val">
            {coord(data.door_position)}
            {" · "}
            {data.door_revealed ? "revealed" : "hidden"}
          </div>
        </div>
      )}
      {data.gate_encounter_id !== undefined && data.gate_encounter_id !== null && (
        <div className="field-row">
          <div className="field-key">gate encounter</div>
          <div className="field-val">
            <EntityLink typeId="events" id={String(data.gate_encounter_id)} />
          </div>
        </div>
      )}
    </section>
  );
}

export function RoomContents({ data }: { data: RoomData }) {
  const npcEntries = data.npc_positions ? Object.entries(data.npc_positions) : [];
  const items = data.item_placements ?? [];
  const events = data.event_positions ?? [];
  const quests = data.quest_ids ?? [];

  const total = npcEntries.length + items.length + events.length + quests.length;
  if (total === 0) return null;

  return (
    <details className="room-contents" open>
      <summary className="room-contents-heading">
        Contents{" "}
        <span className="ability-count">
          {npcEntries.length} npcs · {items.length} items · {events.length} events · {quests.length} quests
        </span>
      </summary>

      {npcEntries.length > 0 && (
        <div className="rc-group">
          <div className="rc-group-label">NPCs</div>
          <div className="rc-list">
            {npcEntries.map(([id, pos]) => (
              <span key={id} className="placed-entity">
                <EntityLink typeId="npcs" id={id} />
                <span className="placed-coord">@ {coord(pos)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="rc-group">
          <div className="rc-group-label">Items</div>
          <div className="rc-list">
            {items.map((it, i) => (
              <span key={`${it.item_id}-${i}`} className="placed-entity">
                <EntityLink typeId="items" id={String(it.item_id)} fallbackLabel={it.name} />
                <span className="placed-coord">@ {it.x}, {it.y}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="rc-group">
          <div className="rc-group-label">Events</div>
          <div className="rc-list">
            {events.map((ev, i) => (
              <span key={`${ev.event_id}-${i}`} className="placed-entity">
                <EntityLink typeId="events" id={String(ev.event_id)} />
                <span className="placed-coord">@ {ev.x}, {ev.y}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {quests.length > 0 && (
        <div className="rc-group">
          <div className="rc-group-label">Quests</div>
          <div className="rc-list">
            {quests.map((id) => (
              <EntityLink key={String(id)} typeId="quests" id={String(id)} />
            ))}
          </div>
        </div>
      )}
    </details>
  );
}
