import { useEffect, useMemo, useState } from "react";
import { api, type EntityRow } from "../lib/invoke";
import { useStore } from "../store";
import { Tabs } from "./Tabs";
import { EntityOverview } from "./EntityOverview";
import { EntityTable } from "./EntityTable";

type Json = Record<string, unknown>;

export function DetailPane() {
  const { selection, worldPath, world, error } = useStore();
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setPayload(null);
    setLocalErr(null);
    setActiveTab("overview");
    if (!worldPath || selection.kind === "none") return;
    setLoading(true);
    (async () => {
      try {
        if (selection.kind === "bible") {
          setPayload(await api.getWorldBible(worldPath));
        } else if (selection.kind === "type") {
          setPayload(await api.listEntityRows(worldPath, selection.typeId));
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

  const entityTabs = useMemo(() => {
    if (selection.kind !== "entity" || !payload) return null;
    const data = payload as Json;
    return [
      {
        id: "overview",
        label: "Overview",
        content: <EntityOverview data={data} typeId={selection.typeId} entityId={selection.id} />,
      },
      {
        id: "raw",
        label: "Raw JSON",
        content: <pre className="detail-json">{JSON.stringify(data, null, 2)}</pre>,
      },
    ];
  }, [selection, payload]);

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
  if (loading) return <main className="detail"><p>Loading…</p></main>;
  if (localErr) return <main className="detail"><p className="detail-error">{localErr}</p></main>;
  if (payload === null) return <main className="detail" />;

  if (selection.kind === "entity" && entityTabs) {
    return (
      <main className="detail">
        <Tabs tabs={entityTabs} active={activeTab} onChange={setActiveTab} />
      </main>
    );
  }

  if (selection.kind === "type") {
    const rows = (payload as EntityRow[]) ?? [];
    return (
      <main className="detail">
        <div className="detail-header">
          <h2>{selection.typeId}</h2>
        </div>
        <EntityTable typeId={selection.typeId} rows={rows} />
      </main>
    );
  }

  return (
    <main className="detail">
      <div className="detail-header">
        {selection.kind === "bible" && <h2>World Bible</h2>}
      </div>
      <pre className="detail-json">{JSON.stringify(payload, null, 2)}</pre>
    </main>
  );
}
