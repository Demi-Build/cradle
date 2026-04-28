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
