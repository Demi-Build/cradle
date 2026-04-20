import { TopBar } from "./components/TopBar";
import { LeftNav } from "./components/LeftNav";
import { DetailPane } from "./components/DetailPane";
import { ValidationBar } from "./components/ValidationBar";
import { Lightbox } from "./components/Lightbox";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useStore } from "./store";
import "./App.css";

export default function App() {
  const selection = useStore((s) => s.selection);
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
