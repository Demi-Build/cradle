import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { LeftNav } from "./components/LeftNav";
import { DetailPane } from "./components/DetailPane";
import { ValidationBar } from "./components/ValidationBar";
import { Lightbox } from "./components/Lightbox";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StartScreen } from "./components/start/StartScreen";
import { RecentProjectsPage } from "./components/recents/RecentProjectsPage";
import { NotesDrawer } from "./components/start/NotesDrawer";
import { NewProjectModal } from "./components/start/NewProjectModal";
import { CostDashboard } from "./components/CostDashboard";
import { JobTray } from "./components/JobTray";
import { useStore } from "./store";
import { api } from "./lib/invoke";
import { handleJobEvent, type JobEventPayload } from "./lib/jobs";
import "./App.css";

export default function App() {
  const world = useStore((s) => s.world);
  const route = useStore((s) => s.route);
  const selection = useStore((s) => s.selection);
  const theme = useStore((s) => s.theme);
  const entities = useStore((s) => s.entities);
  const worldPath = useStore((s) => s.worldPath);
  const setEntities = useStore((s) => s.setEntities);
  const select = useStore((s) => s.select);
  const newProjectOpen = useStore((s) => s.newProjectOpen);
  const dashboardOpen = useStore((s) => s.dashboardOpen);
  const jobsOpen = useStore((s) => s.jobsOpen);
  const setNewProjectOpen = useStore((s) => s.setNewProjectOpen);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  // Background-job lifecycle: one global listener for the whole app (mounted
  // once). The browser dev-mock has no native event bus, so it drives the store
  // directly (the try/catch below just no-ops there).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<JobEventPayload>("job-updated", (e) => {
          void handleJobEvent(e.payload);
        });
      } catch {
        /* browser mock — no native events */
      }
    })();
    return () => unlisten?.();
  }, []);

  // Keyboard navigation (tier 1):
  //   ↑ / ↓              cycle within current type; spill to adjacent type at boundary
  //   ⌥↑ / ⌥↓            jump to prev/next type's first entity (skip the rest of current list)
  //   ←                  entity → type view
  //   →                  type view → first entity
  // Inputs skip, modifier keys guarded, types list drives order.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight"
      )
        return;

      const types = (world?.entity_counts ?? []).map((c) => c.type_id);
      if (!types.length) return;

      const loadList = async (t: string) => {
        if (entities[t]) return entities[t];
        if (!worldPath) return undefined;
        try {
          const refs = await api.listEntities(worldPath, t);
          setEntities(t, refs);
          return refs;
        } catch {
          return undefined;
        }
      };

      // ⌥↑ / ⌥↓ — jump to prev/next type, land on its first entity
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        let currentTypeIdx = -1;
        if (selection.kind === "entity" || selection.kind === "type") {
          currentTypeIdx = types.indexOf(selection.typeId);
        }
        if (currentTypeIdx < 0) return;
        const delta = e.key === "ArrowUp" ? -1 : 1;
        const nextIdx = currentTypeIdx + delta;
        if (nextIdx < 0 || nextIdx >= types.length) return;
        e.preventDefault();
        const nextType = types[nextIdx];
        const nextList = await loadList(nextType);
        if (nextList && nextList.length > 0) {
          select({ kind: "entity", typeId: nextType, id: nextList[0].id });
        } else {
          select({ kind: "type", typeId: nextType });
        }
        return;
      }

      // ↑ / ↓ — cycle within type, spill at boundary
      if (
        !e.altKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown") &&
        selection.kind === "entity"
      ) {
        const typeIdx = types.indexOf(selection.typeId);
        if (typeIdx < 0) return;
        const list = await loadList(selection.typeId);
        if (!list) return;
        const entityIdx = list.findIndex((r) => r.id === selection.id);
        if (entityIdx < 0) return;
        const delta = e.key === "ArrowUp" ? -1 : 1;
        const nextIdx = entityIdx + delta;
        if (nextIdx >= 0 && nextIdx < list.length) {
          e.preventDefault();
          select({ kind: "entity", typeId: selection.typeId, id: list[nextIdx].id });
          return;
        }
        // Spillover to adjacent type
        const nextTypeIdx = typeIdx + delta;
        if (nextTypeIdx < 0 || nextTypeIdx >= types.length) return;
        e.preventDefault();
        const nextType = types[nextTypeIdx];
        const nextList = await loadList(nextType);
        if (nextList && nextList.length > 0) {
          const targetId = delta === -1 ? nextList[nextList.length - 1].id : nextList[0].id;
          select({ kind: "entity", typeId: nextType, id: targetId });
        } else {
          select({ kind: "type", typeId: nextType });
        }
        return;
      }

      // ← — entity → type view
      if (!e.altKey && e.key === "ArrowLeft" && selection.kind === "entity") {
        e.preventDefault();
        select({ kind: "type", typeId: selection.typeId });
        return;
      }

      // → — type view → first entity
      if (!e.altKey && e.key === "ArrowRight" && selection.kind === "type") {
        const list = await loadList(selection.typeId);
        if (list && list.length > 0) {
          e.preventDefault();
          select({ kind: "entity", typeId: selection.typeId, id: list[0].id });
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, entities, worldPath, setEntities, select, world]);

  const newProjectModal = newProjectOpen ? (
    <NewProjectModal onClose={() => setNewProjectOpen(false)} />
  ) : null;

  if (world === null) {
    return (
      <>
        {route === "recents" ? <RecentProjectsPage /> : <StartScreen />}
        {newProjectModal}
      </>
    );
  }

  const boundaryKey =
    selection.kind === "entity"
      ? `entity-${selection.typeId}-${selection.id}`
      : selection.kind === "type"
        ? `type-${selection.typeId}`
        : selection.kind;

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <LeftNav />
        <ErrorBoundary key={boundaryKey}>
          <DetailPane />
        </ErrorBoundary>
      </div>
      <ValidationBar />
      <Lightbox />
      <NotesDrawer />
      {newProjectModal}
      {dashboardOpen && <CostDashboard />}
      {jobsOpen && <JobTray />}
    </div>
  );
}
