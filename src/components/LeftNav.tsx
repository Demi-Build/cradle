import { useEffect, useState } from "react";
import { api } from "../lib/invoke";
import { useStore } from "../store";

const TYPE_LABELS: Record<string, string> = {
  npcs: "NPCs",
  items: "Items",
  monsters: "Monsters",
  quests: "Quests",
  rooms: "Rooms",
  events: "Events",
  classes: "Classes",
};

export function LeftNav() {
  const { world, worldPath, entities, selection, select, setEntities, setError } = useStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpanded({});
  }, [worldPath]);

  if (!world) {
    return <aside className="leftnav leftnav-empty">Load a world to begin.</aside>;
  }

  async function toggleType(typeId: string) {
    const next = !expanded[typeId];
    setExpanded((e) => ({ ...e, [typeId]: next }));
    if (next && !entities[typeId]) {
      try {
        const refs = await api.listEntities(worldPath, typeId);
        setEntities(typeId, refs);
      } catch (e) {
        setError(String(e));
      }
    }
  }

  const isSelected = (s: typeof selection): boolean =>
    selection.kind === s.kind &&
    (s.kind !== "type" || (selection.kind === "type" && selection.typeId === s.typeId)) &&
    (s.kind !== "entity" ||
      (selection.kind === "entity" && selection.typeId === s.typeId && selection.id === s.id));

  return (
    <aside className="leftnav">
      <button
        className={`nav-root ${isSelected({ kind: "bible" }) ? "selected" : ""}`}
        onClick={() => select({ kind: "bible" })}
      >
        World Bible
      </button>
      <div className="nav-types">
        {world.entity_counts.map(({ type_id, count }) => (
          <div key={type_id} className="nav-type">
            <button
              className={`nav-type-header ${
                isSelected({ kind: "type", typeId: type_id }) ? "selected" : ""
              }`}
              onClick={() => {
                select({ kind: "type", typeId: type_id });
                if (!expanded[type_id]) toggleType(type_id);
              }}
            >
              <span className="caret" onClick={(e) => { e.stopPropagation(); toggleType(type_id); }}>
                {expanded[type_id] ? "▼" : "▶"}
              </span>
              <span className="nav-label">{TYPE_LABELS[type_id] ?? type_id}</span>
              <span className="nav-count">({count})</span>
            </button>
            {expanded[type_id] && entities[type_id] && (
              <ul className="nav-entities">
                {entities[type_id].map((ref) => (
                  <li key={ref.id}>
                    <button
                      className={`nav-entity ${
                        isSelected({ kind: "entity", typeId: type_id, id: ref.id }) ? "selected" : ""
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
        ))}
      </div>
    </aside>
  );
}
