import { useStore } from "../../store";
import { usePackTemplates, phaseLabel } from "../../lib/packTemplates";
import { useStartCreate } from "../agent/startCreate";
import { openCreated } from "../agent/startCreate";

/** The recents rail's LIVE card while a project is being created (row P1-A9;
 *  agent-panel README §11 board 05: *"the recents rail shows a live project
 *  card with the same step counter, and the status bar mirrors it"*).
 *
 *  It is a `recent-tile` like every other card in the rail — the project is
 *  already real, and a card that looked different would say otherwise. What it
 *  carries instead of a thumbnail is the SAME step counter the panel's run
 *  card shows, because both read the one JobQueue job (doctrine 5: counts and
 *  the current phase, never an ETA or a bar that lies).
 *
 *  Renders nothing when no create is in flight, so the rail is untouched the
 *  rest of the time.
 */
export function LiveProjectCard() {
  const create = useStartCreate();
  const job = useStore((s) =>
    create.jobId ? s.jobs.find((j) => j.id === create.jobId) : undefined,
  );
  const { templates } = usePackTemplates();
  if (create.status === "idle") return null;

  const phases = job?.progress?.phases ?? [];
  const done = phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const total = job?.progress?.total ?? 0;
  const current = phases.find((p) => p.status === "running") ?? phases[phases.length - 1];
  const step = total > 0 ? `step ${Math.min(done + 1, total)} of ${total}` : "starting…";
  const where = current ? phaseLabel(current.node, templates) : "";

  const state =
    create.status === "creating"
      ? "being created…"
      : create.status === "done"
        ? "ready"
        : create.status === "stopped"
          ? "stopped — kept what exists"
          : "failed";

  return (
    <button
      className="recent-tile live"
      data-testid="live-project-card"
      data-state={create.status}
      disabled={create.status !== "done"}
      onClick={() => void openCreated()}
      title={create.packDir || create.name}
    >
      <div className="add-stack">
        <span className="live-name">{create.name || "New project"}</span>
        <span className="live-state">{state}</span>
        {create.status === "creating" && (
          <span className="live-step">
            {step}
            {where ? ` · ${where.toLowerCase()}` : ""}
          </span>
        )}
        {create.status === "done" && <span className="live-step">open it</span>}
      </div>
    </button>
  );
}
