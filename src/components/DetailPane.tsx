import { useEffect, useMemo, useState } from "react";
import { api, type EntityRow } from "../lib/invoke";
import { useStore } from "../store";
import { Tabs } from "./Tabs";
import { EntityOverview } from "./EntityOverview";
import { EntityTable } from "./EntityTable";
import { DialogueTab } from "./dialogue/DialogueTab";
import type { DialogueTree } from "./dialogue/types";
import { PuzzleTab } from "./event/PuzzleTab";
import { hasTreeView, type PuzzleEvent } from "./event/types";
import { QuestDetail } from "./quest/QuestDetail";
import { LevelDetail } from "./level/LevelDetail";
import { LibraryPanel } from "./db/LibraryPanel";
import { WorldMapView } from "./world/WorldMapView";
import { LineagePanel } from "./db/LineagePanel";
import { WorldBibleView } from "./WorldBibleView";

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
    setActiveTab(selection.kind === "entity" && selection.tab ? selection.tab : "overview");
    if (
      !worldPath ||
      selection.kind === "none" ||
      selection.kind === "library" ||
      selection.kind === "worldmap"
    )
      return;
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
    const overviewContent =
      selection.typeId === "levels" ? (
        <LevelDetail levelId={selection.id} />
      ) : selection.typeId === "quests" ? (
        <QuestDetail
          data={data as Parameters<typeof QuestDetail>[0]["data"]}
          entityId={selection.id}
        />
      ) : (
        <EntityOverview data={data} typeId={selection.typeId} entityId={selection.id} />
      );
    const tabs = [
      {
        id: "overview",
        label: "Overview",
        content: overviewContent,
      },
    ];
    if (selection.typeId === "npcs") {
      const asNpc = data as {
        dialogue_tree?: DialogueTree;
        opening_greeting?: string;
        exhausted_dialogue?: string;
        quest_id?: number | string | null;
        max_exchanges?: number;
      };
      const hasAny =
        !!(
          asNpc.dialogue_tree &&
          asNpc.dialogue_tree.nodes &&
          Object.keys(asNpc.dialogue_tree.nodes).length > 0
        ) ||
        typeof asNpc.opening_greeting === "string" ||
        typeof asNpc.exhausted_dialogue === "string";
      if (hasAny) {
        tabs.push({
          id: "dialogue",
          label: "Dialogue",
          content: <DialogueTab npc={asNpc} />,
        });
      }
    }
    if (selection.typeId === "events" && hasTreeView(data as PuzzleEvent)) {
      const label = (data as PuzzleEvent).type === "puzzle" ? "Puzzle" : "Choices";
      tabs.push({
        id: "puzzle",
        label,
        content: <PuzzleTab event={data as PuzzleEvent} />,
      });
    }
    // Lineage/History (Library A): platformer asset artifacts whose journal
    // chains cradle can browse and restore from.
    const artifactPrefix: Record<string, string> = {
      enemies: "enemy", items: "item", tilesets: "tileset", backdrops: "backdrop",
    };
    // The player's artifact id is the BARE string "player" — canon journals it
    // that way (there is no "player:player"), so a prefixed id would look up an
    // empty history.
    const artifactId =
      selection.typeId === "player"
        ? "player"
        : artifactPrefix[selection.typeId]
          ? `${artifactPrefix[selection.typeId]}:${selection.id}`
          : null;
    if (artifactId) {
      tabs.push({
        id: "history",
        label: "History",
        content: (
          <LineagePanel
            artifactId={artifactId}
            typeId={selection.typeId}
            entityId={selection.id}
          />
        ),
      });
    }
    tabs.push({
      id: "raw",
      label: "Raw JSON",
      content: <pre className="detail-json">{JSON.stringify(data, null, 2)}</pre>,
    });
    return tabs;
  }, [selection, payload]);

  // Tab / Shift+Tab cycles tabs on the focused entity.
  useEffect(() => {
    if (selection.kind !== "entity") return;
    if (!entityTabs || entityTabs.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = entityTabs.map((t) => t.id);
      const currentIdx = ids.indexOf(activeTab);
      if (currentIdx < 0) return;
      const delta = e.shiftKey ? -1 : 1;
      const nextIdx = (currentIdx + delta + ids.length) % ids.length;
      e.preventDefault();
      setActiveTab(ids[nextIdx]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, entityTabs, activeTab]);

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
  // The library browser needs no per-entity payload — render before the
  // loading/payload guards.
  if (selection.kind === "library") {
    return (
      <main className="detail">
        <LibraryPanel />
      </main>
    );
  }
  // Same as the library: no per-entity payload, so it must render before the
  // loading/payload guards below.
  if (selection.kind === "worldmap") {
    return (
      <main className="detail">
        <WorldMapView />
      </main>
    );
  }
  if (loading)
    return (
      <main className="detail">
        <p>Loading…</p>
      </main>
    );
  if (localErr)
    return (
      <main className="detail">
        <p className="detail-error">{localErr}</p>
      </main>
    );
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
    const partition = selection.partition ?? null;
    const headerLabel = partition ? `${selection.typeId} · ${partition}` : selection.typeId;
    return (
      <main className="detail">
        <div className="detail-header">
          <h2>{headerLabel}</h2>
        </div>
        <EntityTable
          key={`${selection.typeId}:${partition ?? ""}`}
          typeId={selection.typeId}
          rows={rows}
          initialPartition={partition}
        />
      </main>
    );
  }

  if (selection.kind === "bible") {
    const bibleTabs = [
      { id: "overview", label: "Overview", content: <WorldBibleView /> },
      {
        id: "raw",
        label: "Raw JSON",
        content: <pre className="detail-json">{JSON.stringify(payload, null, 2)}</pre>,
      },
    ];
    return (
      <main className="detail">
        <Tabs tabs={bibleTabs} active={activeTab} onChange={setActiveTab} />
      </main>
    );
  }

  return <main className="detail" />;
}
