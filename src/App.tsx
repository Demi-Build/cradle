import { TopBar } from "./components/TopBar";
import { LeftNav } from "./components/LeftNav";
import { DetailPane } from "./components/DetailPane";
import { ValidationBar } from "./components/ValidationBar";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <LeftNav />
        <DetailPane />
      </div>
      <ValidationBar />
    </div>
  );
}
