import { useEffect, useState } from "react";
import { api, type EntityRow } from "../lib/invoke";
import { useStore } from "../store";

/** Inline "+ New level" form for platformer packs (creates a DRAFT level). */
function NewLevelForm({ onDone }: { onDone: () => void }) {
  const { worldPath, setEntities, select, setError } = useStore();
  const [stages, setStages] = useState<string[]>([]);
  const [stage, setStage] = useState("");
  const [width, setWidth] = useState(60);
  const [height, setHeight] = useState(16);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listEntities(worldPath, "tilesets")
      .then((refs) => {
        const ids = refs.map((r) => r.id);
        setStages(ids);
        if (ids.length) setStage(ids[0]);
      })
      .catch(() => {});
  }, [worldPath]);

  const create = async () => {
    if (!stage) return;
    setBusy(true);
    try {
      const result = await api.createLevel(worldPath, stage, width, height);
      setEntities("levels", await api.listEntities(worldPath, "levels"));
      select({ kind: "entity", typeId: "levels", id: result.level_id });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = { width: 52, fontSize: 11 };
  return (
    <div style={{ padding: "6px 10px 8px 26px", display: "flex", flexDirection: "column", gap: 5 }}>
      <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ fontSize: 11 }}>
        {stages.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
        W <input type="number" min={8} value={width} onChange={(e) => setWidth(+e.target.value)} style={field} />
        H <input type="number" min={8} value={height} onChange={(e) => setHeight(+e.target.value)} style={field} />
      </div>
      <button onClick={create} disabled={busy || !stage} style={{ fontSize: 11, cursor: "pointer" }}>
        {busy ? "creating…" : "create draft"}
      </button>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  npcs: "NPCs",
  items: "Items",
  monsters: "Monsters",
  quests: "Quests",
  rooms: "Rooms",
  events: "Events",
  classes: "Classes",
  music: "Music",
  sfx: "SFX",
  levels: "Levels",
  enemies: "Enemies",
  tilesets: "Tilesets",
  backdrops: "Backdrops",
  audio: "Audio",
};

const PARTITION_FIELD: Record<string, string> = {
  items: "category",
  events: "type",
};

type PartitionCount = { value: string; count: number };

export function LeftNav() {
  const { world, worldPath, entities, selection, select, setEntities, setError } = useStore();
  const worldStoryTitle = useStore((s) => s.worldStoryTitle);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [partitionCounts, setPartitionCounts] = useState<Record<string, PartitionCount[]>>({});
  const [newLevelOpen, setNewLevelOpen] = useState(false);
  // Platformer packs expose tilesets — that's the "can create levels" signal.
  const isPlatformer = !!world?.entity_counts.some((c) => c.type_id === "tilesets");

  useEffect(() => {
    setExpanded({});
    setPartitionCounts({});
    setNewLevelOpen(false);
  }, [worldPath]);

  if (!world) {
    return <aside className="leftnav leftnav-empty">Load a world to begin.</aside>;
  }

  async function toggleType(typeId: string) {
    const next = !expanded[typeId];
    setExpanded((e) => ({ ...e, [typeId]: next }));
    if (!next) return;
    const partitionKey = PARTITION_FIELD[typeId];
    if (partitionKey) {
      if (!partitionCounts[typeId]) {
        try {
          const rows: EntityRow[] = await api.listEntityRows(worldPath, typeId);
          const counts = new Map<string, number>();
          for (const r of rows) {
            const v = r.data?.[partitionKey];
            if (typeof v !== "string") continue;
            counts.set(v, (counts.get(v) ?? 0) + 1);
          }
          const arr = Array.from(counts.entries())
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count);
          setPartitionCounts((p) => ({ ...p, [typeId]: arr }));
        } catch (e) {
          setError(String(e));
        }
      }
      return;
    }
    if (!entities[typeId]) {
      try {
        const refs = await api.listEntities(worldPath, typeId);
        setEntities(typeId, refs);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  const isTypeSelected = (typeId: string, partition?: string) =>
    selection.kind === "type" &&
    selection.typeId === typeId &&
    (selection.partition ?? null) === (partition ?? null);
  const isEntitySelected = (typeId: string, id: string) =>
    selection.kind === "entity" && selection.typeId === typeId && selection.id === id;
  const isBibleSelected = selection.kind === "bible";

  return (
    <aside className="leftnav">
      <button
        className={`nav-root ${isBibleSelected ? "selected" : ""}`}
        onClick={() => select({ kind: "bible" })}
        title={worldStoryTitle ?? world?.name ?? "World Bible"}
      >
        {worldStoryTitle ?? world?.name ?? "World Bible"}
      </button>
      <div className="nav-types">
        {world.entity_counts.map(({ type_id, count }) => {
          const hasPartition = !!PARTITION_FIELD[type_id];
          const parts = partitionCounts[type_id];
          return (
            <div key={type_id} className="nav-type">
              <button
                className={`nav-type-header ${isTypeSelected(type_id) ? "selected" : ""}`}
                onClick={() => {
                  select({ kind: "type", typeId: type_id });
                  if (!expanded[type_id]) toggleType(type_id);
                }}
              >
                <span
                  className="caret"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleType(type_id);
                  }}
                >
                  {expanded[type_id] ? "▼" : "▶"}
                </span>
                <span className="nav-label">{TYPE_LABELS[type_id] ?? type_id}</span>
                <span className="nav-count">({count})</span>
                {type_id === "levels" && isPlatformer && (
                  <span
                    title="New draft level"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewLevelOpen((v) => !v);
                    }}
                    style={{ marginLeft: 6, cursor: "pointer", opacity: 0.8 }}
                  >
                    ＋
                  </span>
                )}
              </button>
              {type_id === "levels" && newLevelOpen && (
                <NewLevelForm onDone={() => setNewLevelOpen(false)} />
              )}

              {expanded[type_id] && hasPartition && parts && (
                <ul className="nav-entities">
                  {parts.map((p) => (
                    <li key={p.value}>
                      <button
                        className={`nav-entity ${
                          isTypeSelected(type_id, p.value) ? "selected" : ""
                        }`}
                        onClick={() =>
                          select({ kind: "type", typeId: type_id, partition: p.value })
                        }
                      >
                        <span className="nav-part-label">{p.value}</span>
                        <span className="nav-count">({p.count})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {expanded[type_id] && !hasPartition && entities[type_id] && (
                <ul className="nav-entities">
                  {entities[type_id].map((ref) => (
                    <li key={ref.id}>
                      <button
                        className={`nav-entity ${
                          isEntitySelected(type_id, ref.id) ? "selected" : ""
                        }`}
                        onClick={() => select({ kind: "entity", typeId: type_id, id: ref.id })}
                      >
                        {ref.name ?? ref.id}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
