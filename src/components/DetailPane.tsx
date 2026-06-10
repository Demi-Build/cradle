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
import { WorldBibleView } from "./WorldBibleView";
import { EditorFooter } from "./edit/EditorFooter";
import { RawJsonTab } from "./edit/RawJsonTab";

type Json = Record<string, unknown>;

const UNEDITABLE_TYPES = new Set(["music", "sfx"]);

export function DetailPane() {
  const { selection, worldPath, world, error } = useStore();
  const editMode = useStore((s) => s.editMode);
  const toggleEditMode = useStore((s) => s.toggleEditMode);
  const setEditMode = useStore((s) => s.setEditMode);
  const entityCache = useStore((s) => s.entityCache);
  const loadEntityIntoCache = useStore((s) => s.loadEntityIntoCache);
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);

  // For entity selections, the live payload is the draft in the entity cache —
  // re-render whenever an editor mutates it via setEntityDraft.
  const cachedDraft =
    selection.kind === "entity"
      ? entityCache[`${selection.typeId}:${selection.id}`]?.draft
      : undefined;
  const entityDirty =
    selection.kind === "entity"
      ? !!entityCache[`${selection.typeId}:${selection.id}`]?.dirty
      : false;

  useEffect(() => {
    setPayload(null);
    setLocalErr(null);
    setRawJsonError(null);
    setActiveTab(selection.kind === "entity" && selection.tab ? selection.tab : "overview");
    if (!worldPath || selection.kind === "none") return;
    setLoading(true);
    (async () => {
      try {
        if (selection.kind === "bible") {
          setPayload(await api.getWorldBible(worldPath));
        } else if (selection.kind === "type") {
          setPayload(await api.listEntityRows(worldPath, selection.typeId));
        } else if (selection.kind === "entity") {
          setPayload(await loadEntityIntoCache(selection.typeId, selection.id));
        }
      } catch (e) {
        setLocalErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [selection, worldPath, loadEntityIntoCache]);

  // Editors mutate the cache directly; reflect those changes in the rendered payload.
  useEffect(() => {
    if (selection.kind !== "entity") return;
    if (cachedDraft === undefined) return;
    setPayload(cachedDraft);
  }, [cachedDraft, selection]);

  // Cmd/Ctrl+E toggles edit mode for the focused entity. Audio types stay read-only.
  useEffect(() => {
    if (selection.kind !== "entity") return;
    if (UNEDITABLE_TYPES.has(selection.typeId)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      e.preventDefault();
      toggleEditMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, toggleEditMode]);

  const entityTabs = useMemo(() => {
    if (selection.kind !== "entity" || !payload) return null;
    const data = payload as Json;
    const overviewContent =
      selection.typeId === "quests" ? (
        <QuestDetail
          data={data as Parameters<typeof QuestDetail>[0]["data"]}
          entityId={selection.id}
        />
      ) : (
        <EntityOverview
          data={data}
          typeId={selection.typeId}
          entityId={selection.id}
          editMode={editMode}
        />
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
          content: (
            <DialogueTab
              npc={asNpc}
              editMode={editMode}
              typeId={selection.typeId}
              entityId={selection.id}
            />
          ),
        });
      }
    }
    if (selection.typeId === "events" && hasTreeView(data as PuzzleEvent)) {
      const label = (data as PuzzleEvent).type === "puzzle" ? "Puzzle" : "Choices";
      tabs.push({
        id: "puzzle",
        label,
        content: (
          <PuzzleTab
            event={data as PuzzleEvent}
            editMode={editMode}
            typeId={selection.typeId}
            entityId={selection.id}
          />
        ),
      });
    }
    tabs.push({
      id: "raw",
      label: "Raw JSON",
      content: (
        <RawJsonTab
          typeId={selection.typeId}
          entityId={selection.id}
          data={data}
          editMode={editMode && !UNEDITABLE_TYPES.has(selection.typeId)}
          onParseError={setRawJsonError}
        />
      ),
    });
    return tabs;
  }, [selection, payload, editMode]);

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

  // When the focused entity changes, the Raw JSON parse error is stale.
  useEffect(() => {
    setRawJsonError(null);
  }, [selection]);

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
    const audioOnly = UNEDITABLE_TYPES.has(selection.typeId);
    const showFooter = !audioOnly && (editMode || entityDirty);
    const editToggle = audioOnly ? null : (
      <button
        type="button"
        className={`pane-edit-toggle ${editMode ? "is-on" : ""}`}
        onClick={() => setEditMode(!editMode)}
        title="Toggle edit mode (⌘E)"
      >
        {editMode ? "Done" : "Edit"}
      </button>
    );
    // Parse errors only block Save while the Raw JSON tab is active; the cached
    // draft is whatever was last successfully parsed, so other tabs are fine.
    const saveDisabledReason =
      activeTab === "raw" && rawJsonError ? `Invalid JSON: ${rawJsonError}` : null;
    return (
      <main className="detail">
        <Tabs tabs={entityTabs} active={activeTab} onChange={setActiveTab} trailing={editToggle} />
        {showFooter && (
          <EditorFooter
            typeId={selection.typeId}
            entityId={selection.id}
            saveDisabledReason={saveDisabledReason}
          />
        )}
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
