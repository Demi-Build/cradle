import { specialistLabel } from "../../lib/agentState";
import { dismissPill } from "../../lib/agentActions";
import { showMe } from "../../lib/agentShowMe";
import { useStore } from "../../store";

/** The editor sighting of "agent changed this" (README §8): a dismissible
 *  accent pill over the canvas — *Level designer changed this level · 6
 *  placements · Review*. Rendered by App over the main column; shows when
 *  the pill's artifact is the one on screen. */
export function AgentChangedPill() {
  const pill = useStore((s) => s.agent.pill);
  const selection = useStore((s) => s.selection);
  if (!pill) return null;
  const onScreen =
    selection.kind === "entity" && selection.typeId === pill.typeId && selection.id === pill.id;
  const who = specialistLabel(pill.actor);
  const noun =
    pill.typeId === "levels"
      ? "this level"
      : pill.typeId === "tilesets"
        ? "this tileset"
        : `this ${pill.typeId.replace(/s$/, "")}`;
  return (
    <div className="ag-pill" role="status" data-testid="agent-pill">
      <span>
        {who} changed {onScreen ? noun : pill.id} · {pill.what}
      </span>
      <button
        className="btn-link"
        onClick={() => showMe({ kind: "entity", typeId: pill.typeId, id: pill.id })}
      >
        Review
      </button>
      <button className="x" onClick={dismissPill} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
