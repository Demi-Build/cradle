import { useStore } from "../store";
import { Icon, IconSymbols } from "./start/Icons";

export function TopBar() {
  const world = useStore((s) => s.world);
  const worldStoryTitle = useStore((s) => s.worldStoryTitle);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setDrawerOpen = useStore((s) => s.setDrawerOpen);
  const closeWorld = useStore((s) => s.closeWorld);
  const setNewProjectOpen = useStore((s) => s.setNewProjectOpen);
  const setDashboardOpen = useStore((s) => s.setDashboardOpen);

  return (
    <header className="titlebar">
      <IconSymbols />
      <div className="crumbs">
        <button className="crumb-link" onClick={closeWorld}>
          cradle
        </button>
        <span className="sep">/</span>
        <span className="cur">{worldStoryTitle ?? world?.name ?? "world"}</span>
      </div>
      <div className="spacer" />
      <div className="right">
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
        <button
          className={`icon-btn ${drawerOpen ? "on" : ""}`}
          onClick={() => setDrawerOpen(!drawerOpen)}
          title="Notes & docs"
        >
          <Icon id="g-panel" size={14} />
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
