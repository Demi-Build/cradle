import { useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { LeftNav } from "./components/LeftNav";
import { DetailPane } from "./components/DetailPane";
import { ValidationBar } from "./components/ValidationBar";
import { Lightbox } from "./components/Lightbox";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { StartScreen } from "./components/start/StartScreen";
import { RecentProjectsPage } from "./components/recents/RecentProjectsPage";
import { useStore } from "./store";
import "./App.css";

export default function App() {
  const world = useStore((s) => s.world);
  const route = useStore((s) => s.route);
  const selection = useStore((s) => s.selection);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  if (world === null) {
    return route === "recents" ? <RecentProjectsPage /> : <StartScreen />;
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
    </div>
  );
}
