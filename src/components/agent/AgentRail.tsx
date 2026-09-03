import { fmtCents, sortTabs, tabDot } from "../../lib/agentState";
import { setActive, setPanel } from "../../lib/agentActions";
import { useStore } from "../../store";

/** Collapsed (README §1): a 40px rail, not a hidden panel — expand button
 *  on top, one initial-glyph button per open conversation with its tab's
 *  status dot, the session cost rotated at the bottom. Clicking a glyph
 *  expands the panel to that conversation. */
export function AgentRail() {
  const conversations = useStore((s) => s.agent.conversations);
  const tabs = sortTabs(Object.values(conversations));
  const total = tabs.reduce((n, c) => n + (c.costCents ?? 0), 0);
  return (
    <aside className="agent-rail" data-testid="agent-rail" aria-label="Agent (collapsed)">
      <button
        className="icon-btn"
        onClick={() => setPanel({ collapsed: false })}
        title="Expand the agent panel · ⌘⇧A"
        aria-label="Expand the agent panel"
      >
        ◧
      </button>
      {tabs.map((c) => {
        const dot = tabDot(c);
        return (
          <button
            key={c.id}
            className="agent-rail-glyph"
            title={c.title}
            aria-label={c.title}
            onClick={() => {
              setActive(c.id);
              setPanel({ collapsed: false });
            }}
          >
            {c.title.charAt(0).toUpperCase()}
            {dot && <span className="ag-dot" data-dot={dot} />}
          </button>
        );
      })}
      <div className="agent-rail-cost" data-testid="rail-cost">
        {fmtCents(total)} · session
      </div>
    </aside>
  );
}
