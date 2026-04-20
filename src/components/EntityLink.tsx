import { useEffect } from "react";
import { api } from "../lib/invoke";
import { useStore } from "../store";

export function EntityLink({ typeId, id, fallbackLabel }: { typeId: string; id: string; fallbackLabel?: string }) {
  const { entities, worldPath, setEntities, select } = useStore();
  const list = entities[typeId];
  const match = list?.find((r) => r.id === id);

  useEffect(() => {
    if (!list && worldPath) {
      api
        .listEntities(worldPath, typeId)
        .then((rows) => setEntities(typeId, rows))
        .catch(() => {});
    }
  }, [list, worldPath, typeId, setEntities]);

  const label = match?.name ?? fallbackLabel ?? id;

  return (
    <button
      className="entity-link"
      onClick={(e) => {
        e.stopPropagation();
        select({ kind: "entity", typeId, id });
      }}
      title={`${typeId}/${id}`}
    >
      <span className="entity-link-type">{typeId.replace(/s$/, "")}</span>
      <span className="entity-link-label">{label}</span>
    </button>
  );
}
