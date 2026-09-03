import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { LeftNav } from "./components/LeftNav";
import { DetailPane } from "./components/DetailPane";
import { ValidationBar } from "./components/ValidationBar";
import { Lightbox } from "./components/Lightbox";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RuntimeFailure } from "./components/RuntimeGate";
import { useRuntimeProbe } from "./lib/useRuntimeProbe";
import { StartScreen } from "./components/start/StartScreen";
import { RecentProjectsPage } from "./components/recents/RecentProjectsPage";
import { NotesDrawer } from "./components/start/NotesDrawer";
import { NewProjectModal } from "./components/start/NewProjectModal";
import { CostDashboard } from "./components/CostDashboard";
import { JobTray } from "./components/JobTray";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { CommandPalette } from "./components/CommandPalette";
import { AgentPanel } from "./components/agent/AgentPanel";
import { AgentChangedPill } from "./components/agent/AgentChangedPill";
import { ConfirmGateHost } from "./components/agent/ConfirmGate";
import { useStore } from "./store";
import { api } from "./lib/invoke";
import { handleJobEvent, handleJobProgress, type JobEventPayload } from "./lib/jobs";
import type { JobProgressEvent } from "./lib/invoke";
import { inTextField, isShortcut, kbd } from "./lib/keys";
import { pickAndOpenWorld } from "./lib/openWorld";
import {
  autoCollapse,
  ensureService,
  newConversationTab,
  setPanel,
  stopConversation,
  stopService,
  togglePanel,
} from "./lib/agentActions";
import { inFlight } from "./lib/agentState";
import { layoutRule } from "./lib/agentLayout";
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
  const settingsOpen = useStore((s) => s.settings.open);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const setNewProjectOpen = useStore((s) => s.setNewProjectOpen);
  const agentUi = useStore((s) => s.agentUi);

  // Row P0-11: probe the resolved canon once at launch (W3.6).
  const runtime = useRuntimeProbe();

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  // "Show me" / a change-feed deep link opens the artifact, selects the
  // affected thing and PULSES it once (README §8). The pulse lands on the
  // opened artifact's pane: the per-element ring inside the canvases waits
  // for the selection-owning views (LevelCanvas / WorldMapView) to read
  // `agent.pulse` themselves — declared, so the state and its `.ag-pulsing`
  // keyframes are consumed rather than written and ignored.
  const pulseTs = useStore((s) => s.agent.pulse?.ts ?? 0);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!pulseTs) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 900);
    return () => clearTimeout(t);
  }, [pulseTs]);

  // The agent sidecar's lifecycle (row P1-A5, README §1/§10). It lives HERE,
  // not in `AgentPanel`: hiding the panel — the TopBar toggle, ⌘⇧A, focus
  // mode — unmounts that component, and a hide must never abort a turn in
  // flight. Opening the panel with a pack open starts the service; only a
  // pack change (this effect's cleanup) or app quit stops it. Stop stays the
  // one explicit verb (§10, master §3.0-D).
  useEffect(() => {
    if (!worldPath || !agentUi.open) return;
    void ensureService(worldPath);
  }, [worldPath, agentUi.open]);
  useEffect(() => {
    if (!worldPath) return;
    return () => {
      void stopService();
    };
  }, [worldPath]);

  // Background-job lifecycle: one global listener for the whole app (mounted
  // once). The browser dev-mock has no native event bus, so it drives the store
  // directly (the try/catch below just no-ops there).
  useEffect(() => {
    let dead = false;
    const off: Array<() => void> = [];
    // `listen` resolves asynchronously, so a subscription can land AFTER
    // unmount — keep it only while the effect is alive, else drop it at once.
    const keep = (fn: () => void) => (dead ? fn() : off.push(fn));
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        keep(
          await listen<JobEventPayload>("job-updated", (e) => {
            void handleJobEvent(e.payload);
          }),
        );
        // Where a long job is INSIDE its run (canon's step log, relayed by the
        // worker). Separate from the lifecycle stream above so a job that
        // reports no progress behaves exactly as it did before.
        keep(
          await listen<JobProgressEvent>("job-progress", (e) => {
            handleJobProgress(e.payload);
          }),
        );
      } catch {
        /* browser mock — no native events */
      }
    })();
    return () => {
      dead = true;
      off.forEach((fn) => fn());
    };
  }, []);

  // Global shortcuts. Separate from the arrow-key navigation below, which
  // deliberately IGNORES modified keys — these are the modified ones.
  // `isShortcut` picks ⌘ on macOS and Ctrl elsewhere, so the Windows path
  // works and the .kbd hints render the key the reader actually presses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, "k")) {
        e.preventDefault();
        // Toggle: ⌘K with the palette open closes it.
        useStore.getState().setPaletteOpen(!useStore.getState().paletteOpen);
        return;
      }
      // The agent panel (README §1): ⌘⇧A toggles; ⌘⇧N is a new conversation
      // while the panel is open. Checked before the unshifted ⌘N below.
      if (isShortcut(e, "a") && e.shiftKey && useStore.getState().world) {
        e.preventDefault();
        togglePanel();
        return;
      }
      if (
        isShortcut(e, "n") &&
        e.shiftKey &&
        useStore.getState().agentUi.open &&
        useStore.getState().world
      ) {
        e.preventDefault();
        setPanel({ collapsed: false });
        newConversationTab();
        return;
      }
      // Esc: notes close first (NotesDrawer owns that), then the agent stops
      // (README §1, §10) — never from inside a text field the composer owns.
      if (e.key === "Escape" && !inTextField(e)) {
        const st = useStore.getState();
        if (st.drawerOpen || st.paletteOpen || st.lightbox) return;
        const active = st.agent.activeId ? st.agent.conversations[st.agent.activeId] : null;
        if (active && inFlight(active) && st.agentUi.open && !st.agentUi.collapsed) {
          e.preventDefault();
          void stopConversation(active.id);
        }
        return;
      }
      // These two were ADVERTISED with .kbd hints on the start screen and had
      // no handler at all until now.
      if (isShortcut(e, "o") && !inTextField(e)) {
        e.preventDefault();
        void pickAndOpenWorld();
        return;
      }
      if (isShortcut(e, "n") && !inTextField(e)) {
        e.preventDefault();
        useStore.getState().setNewProjectOpen(true);
        return;
      }
      // mod+. toggles focus mode (mod+F is the browser's find).
      if (isShortcut(e, ".") && !inTextField(e)) {
        e.preventDefault();
        const st = useStore.getState();
        st.setLayout({ focusMode: !st.layout.focusMode });
        return;
      }
      // The two side panels. mod+B is the sidebar convention; mod+I pairs with
      // it for the inspector on the other edge.
      if (isShortcut(e, "b") && !inTextField(e)) {
        e.preventDefault();
        const st = useStore.getState();
        st.setLayout({ navCollapsed: !st.layout.navCollapsed });
        return;
      }
      if (isShortcut(e, "i") && !inTextField(e)) {
        e.preventDefault();
        const st = useStore.getState();
        st.setLayout({ inspectorCollapsed: !st.layout.inspectorCollapsed });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The column's responsive rules (README §1): below 900px of remaining main
  // width the editor's floating panels reflow inward (`data-narrow`); below
  // 720px the panel auto-collapses to the rail with a one-time toast. The
  // collapse fires on window RESIZE only, so it never fights an explicit
  // re-expand at a narrow width.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const measure = (fromResize: boolean) => {
      const st = useStore.getState();
      const rule = layoutRule({
        windowWidth: window.innerWidth,
        navCollapsed: st.layout.navCollapsed,
        agentOpen: st.agentUi.open && !!st.world,
        agentCollapsed: st.agentUi.collapsed,
        agentWidth: st.agentUi.width,
        focusMode: st.layout.focusMode,
      });
      setNarrow(rule.narrow);
      if (fromResize && rule.shouldAutoCollapse) autoCollapse();
    };
    measure(false);
    const onResize = () => measure(true);
    window.addEventListener("resize", onResize);
    const unsub = useStore.subscribe((s, prev) => {
      if (s.agentUi !== prev.agentUi || s.layout !== prev.layout || s.world !== prev.world)
        measure(false);
    });
    return () => {
      window.removeEventListener("resize", onResize);
      unsub();
    };
  }, []);

  // App-wide palette commands. Surfaces register their own on mount (the level
  // editor adds Validate / Layout / Improve / Music); these are the ones that
  // are always available.
  const registerCommands = useStore((s) => s.registerCommands);
  const setDashboardOpen = useStore((s) => s.setDashboardOpen);
  const setJobsOpen = useStore((s) => s.setJobsOpen);
  const openSettings = useStore((s) => s.openSettings);
  const setTheme = useStore((s) => s.setTheme);
  const closeWorld = useStore((s) => s.closeWorld);
  useEffect(() => {
    registerCommands("app", [
      {
        id: "app.new",
        label: "New platformer project…",
        group: "Project",
        hint: kbd("N"),
        run: () => setNewProjectOpen(true),
      },
      {
        id: "app.open",
        label: "Open a project from disk…",
        group: "Project",
        hint: kbd("O"),
        keywords: "load world folder",
        run: () => void pickAndOpenWorld(),
      },
      {
        id: "app.close",
        label: "Close this project",
        group: "Project",
        enabled: !!world,
        disabledReason: "no project open",
        run: () => closeWorld(),
      },
      {
        id: "app.agent",
        label: "Ask agent…",
        group: "Agent",
        hint: kbd("⇧A"),
        keywords: "chat wick assistant panel conversation",
        enabled: !!world,
        disabledReason: "no project open",
        run: () => {
          setPanel({ open: true, collapsed: false });
        },
      },
      {
        id: "app.jobs",
        label: "Show background jobs",
        group: "View",
        keywords: "queue tray generation running",
        run: () => setJobsOpen(true),
      },
      {
        id: "app.cost",
        label: "Show cost dashboard",
        group: "View",
        keywords: "spend money usd ledger",
        run: () => setDashboardOpen(true),
      },
      {
        // Row P0-12: the Settings screen exists now, so ⌘K opens it on the
        // pane the user asked for instead of A6's stand-in overlay.
        id: "app.settings",
        label: "Settings",
        group: "View",
        keywords: "api keys keychain provider environment canon godot blender project store",
        run: () => openSettings("keys"),
      },
      {
        id: "app.permissions",
        label: "Settings → Permissions",
        group: "View",
        keywords: "grants always allow revoke agent tools",
        enabled: !!world,
        disabledReason: "no project open — grants are per project",
        run: () => openSettings("permissions"),
      },
      {
        id: "app.focus",
        label: layout.focusMode ? "Exit focus mode" : "Focus mode — hide the chrome",
        group: "View",
        hint: kbd("."),
        keywords: "fullscreen zen distraction nav sidebar bigger map",
        run: () => setLayout({ focusMode: !layout.focusMode }),
      },
      {
        id: "app.nav",
        label: layout.navCollapsed ? "Show the sidebar" : "Hide the sidebar",
        group: "View",
        hint: kbd("B"),
        keywords: "left nav panel collapse levels list",
        run: () => setLayout({ navCollapsed: !layout.navCollapsed }),
      },
      {
        id: "app.inspector",
        label: layout.inspectorCollapsed ? "Show the inspector" : "Hide the inspector",
        group: "View",
        hint: kbd("I"),
        keywords: "right panel properties tray collapse",
        run: () => setLayout({ inspectorCollapsed: !layout.inspectorCollapsed }),
      },
      {
        id: "app.theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        group: "View",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
    ]);
  }, [
    registerCommands,
    setNewProjectOpen,
    setDashboardOpen,
    setJobsOpen,
    openSettings,
    setTheme,
    closeWorld,
    theme,
    world,
    layout,
    setLayout,
  ]);

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

  // Row P0-11 (W3.6): the startup probe. It runs alongside the first render —
  // only a FAILED probe takes the window, and it takes it before any surface
  // can die at a raw "No such file or directory". Below every hook, above
  // every return, so the rules of hooks hold.
  if (runtime.blocked && runtime.status) {
    return (
      <RuntimeFailure status={runtime.status} checking={runtime.checking} onRetry={runtime.retry} />
    );
  }

  const newProjectModal = newProjectOpen ? (
    <NewProjectModal onClose={() => setNewProjectOpen(false)} />
  ) : null;

  if (world === null) {
    return (
      <>
        {route === "recents" ? <RecentProjectsPage /> : <StartScreen />}
        {newProjectModal}
        {/* The palette is available with no world loaded too — Open and New
            project are exactly the actions you want on the start screen. */}
        <CommandPalette />
        <ConfirmGateHost />
      </>
    );
  }

  const boundaryKey =
    selection.kind === "entity"
      ? `entity-${selection.typeId}-${selection.id}`
      : selection.kind === "type"
        ? `type-${selection.typeId}`
        : selection.kind;

  // The panel column (README §1): open / collapsed rail / off. Focus mode
  // hides it entirely; the rail comes back on exit (the pref is untouched).
  const agentState =
    layout.focusMode || !agentUi.open ? "off" : agentUi.collapsed ? "rail" : "open";

  return (
    <div
      className="app"
      data-focus={layout.focusMode ? "1" : "0"}
      data-nav={layout.navCollapsed ? "0" : "1"}
      data-agent={agentState}
      data-narrow={narrow ? "1" : "0"}
      style={{ ["--agent-w" as string]: `${agentUi.width}px` } as React.CSSProperties}
    >
      <TopBar />
      <div className="app-body">
        <LeftNav />
        <main className={`app-main${pulsing ? " ag-pulsing" : ""}`}>
          <ErrorBoundary key={boundaryKey}>
            <DetailPane />
          </ErrorBoundary>
          <AgentChangedPill />
        </main>
        {agentState !== "off" && <AgentPanel />}
      </div>
      <ValidationBar />
      <Lightbox />
      <NotesDrawer />
      {newProjectModal}
      {dashboardOpen && <CostDashboard />}
      {jobsOpen && <JobTray />}
      {settingsOpen && <SettingsScreen />}
      <CommandPalette />
      <ConfirmGateHost />
    </div>
  );
}
