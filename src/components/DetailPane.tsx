import { useEffect, useState } from "react";
import { api } from "../lib/invoke";
import { useStore } from "../store";

export function DetailPane() {
  const { selection, worldPath, world, error } = useStore();
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    setPayload(null);
    setLocalErr(null);
    if (!worldPath || selection.kind === "none") return;
    setLoading(true);
    (async () => {
      try {
        if (selection.kind === "bible") {
          setPayload(await api.getWorldBible(worldPath));
        } else if (selection.kind === "type") {
          setPayload(await api.listEntities(worldPath, selection.typeId));
        } else if (selection.kind === "entity") {
          setPayload(await api.getEntity(worldPath, selection.typeId, selection.id));
        }
      } catch (e) {
        setLocalErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [selection, worldPath]);

  if (error) return <main className="detail detail-error">Error: {error}</main>;
  if (!world) {
    return (
      <main className="detail detail-empty">
        <h2>Cradle v0.1</h2>
        <p>A read-only inspector for canon-generated worlds.</p>
        <p>Enter a world path above and click Load.</p>
      </main>
    );
  }
  if (selection.kind === "none") {
    return <main className="detail detail-empty">Select something in the nav.</main>;
  }

  return (
    <main className="detail">
      <div className="detail-header">
        {selection.kind === "bible" && <h2>World Bible</h2>}
        {selection.kind === "type" && <h2>{selection.typeId}</h2>}
        {selection.kind === "entity" && (
          <h2>
            {selection.typeId} / {selection.id}
          </h2>
        )}
      </div>
      {loading && <p>Loading…</p>}
      {localErr && <p className="detail-error">{localErr}</p>}
      {!loading && payload !== null && (
        <pre className="detail-json">{JSON.stringify(payload, null, 2)}</pre>
      )}
    </main>
  );
}
