import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/invoke";
import { useStore } from "../store";

export function TopBar() {
  const { worldPath, world, setWorldPath, setWorld, setError } = useStore();
  const [input, setInput] = useState(worldPath);
  const [loading, setLoading] = useState(false);

  async function load(path: string) {
    setLoading(true);
    setError(null);
    try {
      const summary = await api.loadWorld(path);
      setWorldPath(path);
      setInput(path);
      setWorld(summary);
    } catch (e) {
      setError(String(e));
      setWorld(null);
    } finally {
      setLoading(false);
    }
  }

  async function browse() {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select a world directory" });
      if (typeof selected === "string") await load(selected);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-title">
        Cradle{world ? ` — ${world.name}` : ""}
      </div>
      <form
        className="topbar-path"
        onSubmit={(e) => {
          e.preventDefault();
          if (input) load(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="/path/to/world (or bibles/mazeworld_5_room_demo)"
          spellCheck={false}
        />
        <button type="submit" disabled={loading || !input}>
          {loading ? "Loading…" : world ? "Reload" : "Load"}
        </button>
      </form>
      <div className="topbar-actions">
        <button className="topbar-btn-secondary" onClick={browse} disabled={loading}>
          Browse…
        </button>
      </div>
    </header>
  );
}
