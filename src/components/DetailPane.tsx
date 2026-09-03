import { useEffect, useMemo, useState } from "react";
import { api, type EntityRow } from "../lib/invoke";
import { useStore } from "../store";
import { Tabs } from "./Tabs";
import { EntityOverview } from "./EntityOverview";
import { EntityTable } from "./EntityTable";
import { DialogueTab } from "./dialogue/DialogueTab";
import type { NpcRow } from "./dialogue/model";
import { isSceneRow } from "./dialogue/scene";
import { vocabOf } from "./dialogue/grammar";
import { PuzzleTab } from "./event/PuzzleTab";
import { SceneTab } from "./event/SceneTab";
import { hasTreeView, type PuzzleEvent } from "./event/types";
import { QuestDetail } from "./quest/QuestDetail";
import { QuestDialogueTab } from "./quest/QuestDialogueTab";
import { LevelDetail } from "./level/LevelDetail";
import { LibraryPanel } from "./db/LibraryPanel";
import { AnimationTab } from "./anim/AnimationTab";
import { WorldMapView } from "./world/WorldMapView";
import { LineagePanel, RoomHistory } from "./db/LineagePanel";
import { kindForTypeId, typeIdForKind } from "../lib/placements";
import { WorldBibleView } from "./WorldBibleView";

type Json = Record<string, unknown>;

export function DetailPane() {
  const { selection, worldPath, world, error } = useStore();
  const select = useStore((s) => s.select);
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
    // A room is a grid too (P0 paper P.6.3a): the SAME level editor renders it
    // from the one `grid export`, and since row P0-8 it edits it too. Which
    // type ids are grids comes from `pack info` — ids are data. The
    // platformer's `level` grid is the one with a tilesheet and gravity;
    // every other declared grid renders through the room path (blocks mode,
    // placements from the registry, the maze cell palette).
    const gridKinds = Object.keys(world?.pack_info?.grids ?? {});
    const gridKind =
      gridKinds.find((k) => typeIdForKind(k) === selection.typeId) ??
      (selection.typeId === "levels" ? "level" : selection.typeId === "rooms" ? "room" : null);
    const overviewContent =
      gridKind !== null ? (
        <LevelDetail levelId={selection.id} room={gridKind !== "level"} />
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
    if (gridKind !== null && gridKind !== "level") {
      // The room's story, contents and index row stay one tab over — the
      // maze took the overview, nothing was hidden.
      tabs.push({
        id: "details",
        label: "Details",
        content: <EntityOverview data={data} typeId={selection.typeId} entityId={selection.id} />,
      });
    }
    // Cross-surface entry (README Q9): a beat is reachable from its NPC, its
    // quest and its scene, and every rail deep-links to the others. All three
    // land on the same DetailPane, opened on the right tab.
    const openNpc = (npcId: string) =>
      select({ kind: "entity", typeId: "npcs", id: npcId, tab: "dialogue" });
    const openQuest = (questId: string) =>
      select({ kind: "entity", typeId: "quests", id: questId, tab: "dialogue" });
    const openScene = (sceneId: string) =>
      select({ kind: "entity", typeId: "events", id: sceneId, tab: "scene" });

    if (selection.typeId === "npcs") {
      const asNpc = data as NpcRow;
      // Row P0-9 widened this from "has any dialogue content" to "is an NPC":
      // screen 06 needs the tab for a character with NO tree at all, because
      // authoring one is exactly what you open the tab to do, and a hidden tab
      // is undiscoverable (doctrine 4). The surface says the greeting-only
      // fallback is legal rather than rendering an empty canvas.
      tabs.push({
        id: "dialogue",
        label: "Dialogue",
        content: (
          <DialogueTab
            npc={asNpc}
            npcId={selection.id}
            onOpenScene={openScene}
            onOpenQuest={openQuest}
          />
        ),
      });
    }
    // Row P0-9 step 11: the QUEST scope — the primary surface for authoring a
    // quest's conversation across every character in it. Always mounted for a
    // quest (doctrine 4): a quest with no beats yet says so, and authoring the
    // first one is exactly what you open the tab to do.
    if (selection.typeId === "quests") {
      tabs.push({
        id: "dialogue",
        label: "Dialogue",
        content: (
          <QuestDialogueTab
            quest={data as { id?: number | string; title?: string }}
            questId={selection.id}
            onOpenNpc={openNpc}
            onOpenScene={openScene}
          />
        ),
      });
    }
    // Step 12: the SCENE scope — a scene is an EVENT of type `scene`, so it
    // mounts on the event's own tab beside Puzzle/Choices. The event type comes
    // from the pack's `dialogue.scene.event_type`, never the literal.
    if (selection.typeId === "events" && isSceneRow(data, vocabOf(world?.pack_info ?? null))) {
      tabs.push({
        id: "scene",
        label: "Scene",
        content: <SceneTab event={data} sceneId={selection.id} onOpenNpc={openNpc} />,
      });
    }
    if (selection.typeId === "events" && hasTreeView(data as PuzzleEvent)) {
      const label = (data as PuzzleEvent).type === "puzzle" ? "Puzzle" : "Choices";
      tabs.push({
        id: "puzzle",
        label,
        content: <PuzzleTab event={data as PuzzleEvent} />,
      });
    }
    // Animation: the frame inspector. Only the types that HAVE animation —
    // canon animates actors, not tilesets or audio.
    const animTarget =
      selection.typeId === "player"
        ? "player"
        : selection.typeId === "enemies"
          ? `enemy:${selection.id}`
          : selection.typeId === "items"
            ? `item:${selection.id}`
            : null;
    if (animTarget) {
      tabs.push({
        id: "animation",
        label: "Animation",
        content: <AnimationTab target={animTarget} />,
      });
    }
    // Lineage/History (Library A): every artifact family whose journal chain
    // cradle can browse and restore from. Row P0-8 made this REGISTRY-driven
    // rather than a four-entry literal: any kind `pack info` declares
    // journals as `<kind>:<id>` (the db core's family — npc:1000, quest:4000,
    // class:warrior …), a grid as `room:<id>/<step>` (P.9 R1), and the
    // platformer's asset families keep their own prefixes.
    const assetPrefix: Record<string, string> = { tilesets: "tileset", backdrops: "backdrop" };
    const declaredKind =
      selection.typeId in (world?.pack_info?.entities ?? {})
        ? selection.typeId
        : Object.keys(world?.pack_info?.entities ?? {}).find(
            (k) => typeIdForKind(k) === selection.typeId,
          );
    // The player's artifact id is the BARE string "player" — canon journals it
    // that way (there is no "player:player"), so a prefixed id would look up an
    // empty history.
    // A single-file grid (the room) journals on TWO steps — `grid` for the
    // painted cells, `placements` for every drag, encounter and 🎲 roll — so
    // its History tab offers both chains instead of only asking for `/grid`,
    // which is where none of the hand edits land.
    const roomGrid = gridKind !== null && gridKind !== "level" ? gridKind : null;
    const artifactId =
      selection.typeId === "player"
        ? "player"
        : roomGrid !== null
          ? `${roomGrid}:${selection.id}/placements`
          : assetPrefix[selection.typeId]
            ? `${assetPrefix[selection.typeId]}:${selection.id}`
            : declaredKind
              ? `${kindForTypeId(world?.pack_info ?? null, selection.typeId)}:${selection.id}`
              : selection.typeId === "enemies" || selection.typeId === "items"
                ? `${selection.typeId.replace(/ies$/, "y").replace(/s$/, "")}:${selection.id}`
                : null;
    if (artifactId) {
      tabs.push({
        id: "history",
        label: "History",
        content:
          roomGrid !== null ? (
            <RoomHistory gridKind={roomGrid} roomId={selection.id} typeId={selection.typeId} />
          ) : (
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
  }, [selection, payload, select, world]);

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
