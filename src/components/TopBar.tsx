import { useState } from "react";
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
      setWorld(summary);
    } catch (e) {
      setError(String(e));
      setWorld(null);
    } finally {
      setLoading(false);
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
    </header>
  );
}
