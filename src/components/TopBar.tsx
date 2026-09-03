import { useStore } from "../store";
import { kbd } from "../lib/keys";
import { togglePanel } from "../lib/agentActions";
import { Icon, IconSymbols } from "./start/Icons";
import { EngineChip } from "./EngineChip";

export function TopBar() {
  const world = useStore((s) => s.world);
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const worldStoryTitle = useStore((s) => s.worldStoryTitle);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setDrawerOpen = useStore((s) => s.setDrawerOpen);
  const closeWorld = useStore((s) => s.closeWorld);
  const setNewProjectOpen = useStore((s) => s.setNewProjectOpen);
  const setDashboardOpen = useStore((s) => s.setDashboardOpen);
  const setJobsOpen = useStore((s) => s.setJobsOpen);
  const openSettings = useStore((s) => s.openSettings);
  const agentOpen = useStore((s) => s.agentUi.open && !s.agentUi.collapsed);
  const activeJobs = useStore(
    (s) => s.jobs.filter((j) => j.status === "queued" || j.status === "running").length,
  );

  return (
    <header className="titlebar">
      <IconSymbols />
      {world && (
        <button
          className={`icon-btn ${layout.navCollapsed ? "on" : ""}`}
          onClick={() => setLayout({ navCollapsed: !layout.navCollapsed })}
          aria-label={layout.navCollapsed ? "Show the sidebar" : "Hide the sidebar"}
          aria-pressed={layout.navCollapsed}
          title={`${layout.navCollapsed ? "Show" : "Hide"} the sidebar · ${kbd("B")}`}
          style={{ marginRight: 2 }}
        >
          <Icon id={layout.navCollapsed ? "g-chev-r" : "g-chev-l"} size={14} />
        </button>
      )}
      <div className="crumbs">
        <button className="crumb-link" onClick={closeWorld}>
          cradle
        </button>
        <span className="sep">/</span>
        <span className="cur">{worldStoryTitle ?? world?.name ?? "world"}</span>
      </div>
      <div className="spacer" />
      <div className="right">
        {world && <EngineChip />}
        {world && (
          <button
            className="crumb-link"
            onClick={() => setJobsOpen(true)}
            title="Background generation jobs — watch them run, jump to results"
            style={{ marginRight: 4 }}
          >
            ⚙ Jobs
            {activeJobs > 0 && (
              <span
                style={{
                  marginLeft: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                }}
              >
                {activeJobs}
              </span>
            )}
          </button>
        )}
        {world && (
          <button
            className="crumb-link"
            onClick={() => setDashboardOpen(true)}
            title="Project cost — what this project has spent"
            style={{ marginRight: 4 }}
          >
            💰 Cost
          </button>
        )}
        <button
          className="crumb-link"
          onClick={() => setNewProjectOpen(true)}
          title="Create a new platformer project"
          style={{ marginRight: 4 }}
        >
          ＋ New project
        </button>
        {/* The agent panel toggle (README §1, PLAN "TopBar"): left of the
            theme toggle, accent while the panel is open. */}
        {world && (
          <button
            className={`icon-btn ${agentOpen ? "on" : ""}`}
            onClick={togglePanel}
            aria-label={agentOpen ? "Hide the agent panel" : "Show the agent panel"}
            aria-pressed={agentOpen}
            title={`${agentOpen ? "Hide" : "Show"} the agent panel · ${kbd("⇧A")}`}
            style={agentOpen ? { color: "var(--accent)" } : undefined}
            data-testid="agent-toggle"
          >
            ◧
          </button>
        )}
        <button
          className={`icon-btn ${drawerOpen ? "on" : ""}`}
          onClick={() => setDrawerOpen(!drawerOpen)}
          title="Notes & docs"
        >
          <Icon id="g-panel" size={14} />
        </button>
        {/* Row P0-12 / W3.5: the gear. Always available — a machine with no
            project open is exactly the machine that needs to add a key or see
            why canon will not start. Theme stays to its right, unmoved. */}
        <button
          className="icon-btn"
          onClick={() => openSettings("keys")}
          title="Settings — API keys, environment, permissions"
          aria-label="Settings"
          data-testid="topbar-settings"
        >
          ⚙
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          <Icon id={theme === "dark" ? "g-moon" : "g-sun"} size={14} />
        </button>
      </div>
    </header>
  );
}
