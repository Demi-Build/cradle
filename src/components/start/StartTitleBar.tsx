import { useStore } from "../../store";
import { Icon } from "./Icons";

export function StartTitleBar({ here = "start" }: { here?: string }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setDrawerOpen = useStore((s) => s.setDrawerOpen);
  const setRoute = useStore((s) => s.setRoute);
  const openSettings = useStore((s) => s.openSettings);

  return (
    <header className="titlebar">
      <div className="crumbs">
        <button className="crumb-link" onClick={() => setRoute("start")}>
          cradle
        </button>
        <span className="sep">/</span>
        <span className="cur">{here}</span>
      </div>
      <div className="spacer" />
      <div className="right">
        <button
          className={`icon-btn ${drawerOpen ? "on" : ""}`}
          onClick={() => setDrawerOpen(!drawerOpen)}
          title="Notes & docs"
        >
          <Icon id="g-panel" size={14} />
        </button>
        {/* Row P0-12 / W3.5: the gear, in the same slot the editor's `TopBar`
            puts it — left of the theme toggle. A machine with no project open
            is the one that needs to add a key, and this bar is the only chrome
            the start and recents routes have. */}
        <button
          className="icon-btn"
          onClick={() => openSettings("keys")}
          title="Settings — API keys, environment, permissions"
          aria-label="Settings"
          data-testid="start-settings"
        >
          <Icon id="g-cog" size={14} />
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
