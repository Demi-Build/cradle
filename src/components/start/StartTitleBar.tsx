import { useStore } from "../../store";
import { Icon } from "./Icons";

export function StartTitleBar({ here = "start" }: { here?: string }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setDrawerOpen = useStore((s) => s.setDrawerOpen);
  const setRoute = useStore((s) => s.setRoute);

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
