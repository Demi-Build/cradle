import { useEffect } from "react";
import { api, type EntityRef } from "../lib/invoke";
import { useStore } from "../store";

const inflight = new Map<string, Promise<EntityRef[]>>();

function fetchEntitiesOnce(
  worldPath: string,
  typeId: string,
  setEntities: (t: string, r: EntityRef[]) => void,
) {
  const key = `${worldPath}::${typeId}`;
  if (inflight.has(key)) return;
  const p = api
    .listEntities(worldPath, typeId)
    .then((rows) => {
      setEntities(typeId, rows);
      return rows;
    })
    .catch((e) => {
      console.error(`listEntities failed for ${typeId}:`, e);
      return [] as EntityRef[];
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
}

export function EntityLink({
  typeId,
  id,
  fallbackLabel,
}: {
  typeId: string;
  id: string;
  fallbackLabel?: string;
}) {
  const entities = useStore((s) => s.entities);
  const worldPath = useStore((s) => s.worldPath);
  const setEntities = useStore((s) => s.setEntities);
  const select = useStore((s) => s.select);
  const list = entities[typeId];
  const match = list?.find((r) => r.id === id);

  useEffect(() => {
    if (!list && worldPath) {
      fetchEntitiesOnce(worldPath, typeId, setEntities);
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
