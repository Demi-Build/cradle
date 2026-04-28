import { Portrait } from "../Portrait";
import { EntityLink } from "../EntityLink";
import { useStore } from "../../store";
import { Icon } from "../start/Icons";

type TargetItem = { item_id?: number | string; count?: number };

type Quest = {
  id?: number | string;
  type?: string;
  title?: string;
  description?: string;
  is_story_quest?: boolean;
  giver_npc_id?: number | string | null;
  room_id?: string | null;
  prerequisite_quest_id?: number | string | null;
  reward?: { xp?: number; item_id?: number | string | null };
  failure_penalty?: { hp_damage?: number };
  success_dialogue?: string;
  failure_dialogue?: string;
  portrait_prompt?: string;
  profile_image?: string;
  // type-driven targets
  escort_npc_id?: number | string | null;
  destination_room?: number | string | null;
  target_zone?: [number, number];
  target_event_id?: number | string | null;
  target_npc_id?: number | string | null;
  target_tile?: [number, number];
  item_category?: string;
  target_items?: TargetItem[];
};

export function QuestDetail({ data, entityId }: { data: Quest; entityId: string }) {
  const title = data.title ?? entityId;
  const type = data.type ?? "quest";
  const isStory = data.is_story_quest === true;

  return (
    <div className="overview">
      <header className="overview-header overview-header--quest">
        <div className="overview-portrait-col">
          <Portrait
            hint={data.profile_image ?? null}
            alt={title}
            size={480}
            tooltip={data.portrait_prompt}
          />
          {isStory && (
            <div className="portrait-badge story">
              <Icon id="g-star" size={14} className="portrait-badge-icon" />
              <span className="portrait-badge-label">Story quest</span>
            </div>
          )}
        </div>
        <div className="overview-titleblock">
          <h2 className="overview-name">{title}</h2>
          <div className="overview-sub">
            <span className="chip">quests</span>
            {data.id !== undefined && <span className="chip chip-muted">id {String(data.id)}</span>}
            <span className="chip chip-muted">{type}</span>
          </div>

          {data.description && (
            <div className="overview-prose-inline">
              <div className="prose-block">
                <div className="prose-label">description</div>
                <div className="prose-body">{data.description}</div>
              </div>
            </div>
          )}

          <QuestLinks quest={data} />
          <QuestObjective quest={data} />
          <QuestContract quest={data} />

          {data.success_dialogue && (
            <DialogueBlock
              label="success dialogue"
              kind="success"
              text={data.success_dialogue}
              giverNpcId={data.giver_npc_id}
            />
          )}
          {data.failure_dialogue && (
            <DialogueBlock
              label="failure dialogue"
              kind="failure"
              text={data.failure_dialogue}
              giverNpcId={data.giver_npc_id}
            />
          )}
        </div>
      </header>
    </div>
  );
}

function QuestLinks({ quest }: { quest: Quest }) {
  const rows: Array<[string, React.ReactNode]> = [];
  if (quest.giver_npc_id !== undefined && quest.giver_npc_id !== null) {
    rows.push(["giver", <EntityLink typeId="npcs" id={String(quest.giver_npc_id)} />]);
  }
  if (quest.room_id) {
    rows.push(["in room", <EntityLink typeId="rooms" id={String(quest.room_id)} />]);
  }
  if (quest.prerequisite_quest_id !== undefined && quest.prerequisite_quest_id !== null) {
    rows.push(["prereq", <EntityLink typeId="quests" id={String(quest.prerequisite_quest_id)} />]);
  }
  if (rows.length === 0) return null;
  return (
    <QuestBox label="Links">
      {rows.map(([k, v]) => (
        <QuestRow key={k} label={k} value={v} />
      ))}
    </QuestBox>
  );
}

function QuestObjective({ quest }: { quest: Quest }) {
  const rows: Array<[string, React.ReactNode]> = [];
  const type = quest.type;

  if (type === "escort") {
    if (quest.escort_npc_id !== undefined && quest.escort_npc_id !== null) {
      rows.push(["escort", <EntityLink typeId="npcs" id={String(quest.escort_npc_id)} />]);
    }
    if (quest.destination_room !== undefined && quest.destination_room !== null) {
      rows.push(["destination", <EntityLink typeId="rooms" id={String(quest.destination_room)} />]);
    }
    if (quest.target_zone) {
      rows.push(["target zone", <Coord xy={quest.target_zone} />]);
    }
  } else if (type === "solve") {
    if (quest.target_event_id !== undefined && quest.target_event_id !== null) {
      rows.push([
        "target event",
        <EntityLink typeId="events" id={String(quest.target_event_id)} />,
      ]);
    }
  } else if (type === "combat") {
    if (quest.target_npc_id !== undefined && quest.target_npc_id !== null) {
      rows.push(["target npc", <EntityLink typeId="npcs" id={String(quest.target_npc_id)} />]);
    }
  } else if (type === "fetch") {
    if (quest.item_category) {
      rows.push(["category", <span className="quest-val-text">{quest.item_category}</span>]);
    }
    if (quest.target_tile) {
      rows.push(["target tile", <Coord xy={quest.target_tile} />]);
    }
    if (Array.isArray(quest.target_items) && quest.target_items.length > 0) {
      rows.push([
        "items",
        <div className="quest-items-list">
          {quest.target_items.map((it, i) => (
            <div key={i} className="quest-item-row">
              {it.item_id !== undefined ? (
                <EntityLink typeId="items" id={String(it.item_id)} />
              ) : (
                <span>—</span>
              )}
              {typeof it.count === "number" && it.count !== 1 && (
                <span className="quest-item-count">×{it.count}</span>
              )}
            </div>
          ))}
        </div>,
      ]);
    }
  }

  if (rows.length === 0) return null;
  return (
    <QuestBox label={`Objective · ${type ?? "unknown"}`}>
      {rows.map(([k, v], i) => (
        <QuestRow key={`${k}-${i}`} label={k} value={v} />
      ))}
    </QuestBox>
  );
}

function QuestContract({ quest }: { quest: Quest }) {
  const xp = quest.reward?.xp;
  const itemId = quest.reward?.item_id;
  const hp = quest.failure_penalty?.hp_damage;
  const hasAny =
    typeof xp === "number" || (itemId !== null && itemId !== undefined) || typeof hp === "number";
  if (!hasAny) return null;
  return (
    <div className="quest-box">
      <div className="quest-box-label">Contract</div>
      <div className="quest-contract">
        <div className="qc-col qc-success">
          <div className="qc-col-head">on success</div>
          <QuestRow
            label="xp"
            value={
              typeof xp === "number" ? (
                <span className="quest-val-num">+{xp}</span>
              ) : (
                <span className="quest-val-dim">—</span>
              )
            }
          />
          <QuestRow
            label="item"
            value={
              itemId !== null && itemId !== undefined ? (
                <EntityLink typeId="items" id={String(itemId)} />
              ) : (
                <span className="quest-val-dim">—</span>
              )
            }
          />
        </div>
        <div className="qc-col qc-failure">
          <div className="qc-col-head">on failure</div>
          <QuestRow
            label="hp"
            value={
              typeof hp === "number" ? (
                <span className="quest-val-num">−{hp}</span>
              ) : (
                <span className="quest-val-dim">—</span>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

function DialogueBlock({
  label,
  kind,
  text,
  giverNpcId,
}: {
  label: string;
  kind: "success" | "failure";
  text: string;
  giverNpcId?: number | string | null;
}) {
  const select = useStore((s) => s.select);
  return (
    <div className={`quest-dialogue quest-dialogue--${kind}`}>
      <div className="quest-dialogue-head">
        <span className={`quest-dialogue-swatch kind-${kind}`} />
        <span className="prose-label">{label}</span>
        <span className="quest-dialogue-spacer" />
        {giverNpcId !== undefined && giverNpcId !== null && (
          <button
            className="quest-dialogue-link"
            onClick={() =>
              select({ kind: "entity", typeId: "npcs", id: String(giverNpcId), tab: "dialogue" })
            }
            title="open giver's dialogue tab"
          >
            open in npc dialogue →
          </button>
        )}
      </div>
      <div className="prose-body">{text}</div>
    </div>
  );
}

function QuestBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="quest-box">
      <div className="quest-box-label">{label}</div>
      <div className="quest-rows">{children}</div>
    </div>
  );
}

function QuestRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="quest-row">
      <div className="quest-row-key">{label}</div>
      <div className="quest-row-val">{value}</div>
    </div>
  );
}

function Coord({ xy }: { xy: [number, number] }) {
  return (
    <span className="quest-val-num">
      {xy[0]}, {xy[1]}
    </span>
  );
}
