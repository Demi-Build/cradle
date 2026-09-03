import { useStore } from "../../store";
import { usePackTemplates, phaseLabel } from "../../lib/packTemplates";
import { useStartCreate } from "../agent/startCreate";

export function StartStatusBar({ note }: { note: string }) {
  // What the last action actually did, when there was one — the design uses
  // the statusbar to confirm that removing a card is not a delete.
  const startNote = useStore((s) => s.startNote);
  // Row A9: while a project is being created, the status bar MIRRORS the live
  // project card (agent-panel README §11) — the same job, the same counter,
  // so the two never disagree. Outside a create it is exactly as before.
  const create = useStartCreate();
  const job = useStore((s) =>
    create.jobId ? s.jobs.find((j) => j.id === create.jobId) : undefined,
  );
  const { templates } = usePackTemplates();
  const phases = job?.progress?.phases ?? [];
  const done = phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const total = job?.progress?.total ?? 0;
  const current = phases.find((p) => p.status === "running") ?? phases[phases.length - 1];
  const creating = create.status === "creating";
  const mirror = creating
    ? `creating ${create.name.toLowerCase()}` +
      (total > 0 ? ` — step ${Math.min(done + 1, total)} of ${total}` : " — starting") +
      (current ? ` · ${phaseLabel(current.node, templates).toLowerCase()}` : "")
    : create.status === "stopped"
      ? `stopped ${create.name.toLowerCase()} — the folder is kept`
      : create.status === "done"
        ? `${create.name.toLowerCase()} is ready`
        : null;
  return (
    <footer className="statusbar">
      <span>
        <span className={creating ? "run-dot" : "ok-dot"} />
        {creating ? "creating" : "idle"}
      </span>
      <span data-testid="start-status-note">{mirror ?? startNote ?? note}</span>
      <div className="spacer" />
      <span>cradle v0.1</span>
      <span>canon 0.4</span>
      <span>tauri 2.0</span>
    </footer>
  );
}
