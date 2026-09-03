import { useEffect } from "react";
import { useStore } from "../../store";
import type { JobProgress } from "../../lib/invoke";
import { usePackTemplates } from "../../lib/packTemplates";
import { CreateProgress } from "../start/CreateProgress";
import {
  openCreated,
  settleCreate,
  stopCreate,
  useStartCreate,
  isPaidSelection,
} from "./startCreate";
import {
  CREATE_STEP,
  OPEN_STEP,
  creatingConversation,
  markPlanStep,
  settleTurn,
} from "./startConversation";

/** How many steps never began. The worker's cancel payload names what it
 *  KEPT (its step log's finished nodes) and nothing else, so the other half of
 *  A4.5's report is counted here from the job's own progress: `total` is what
 *  `run_start` announced, and `phases` holds every node that has started. A
 *  run stopped before `run_start` knows no total and says so plainly, rather
 *  than naming a number it does not have (doctrine 5). */
function neverStarted(progress?: JobProgress): string {
  const total = progress?.total ?? 0;
  const started = progress?.phases.length ?? 0;
  const left = total - started;
  return left > 0
    ? `Never started: the remaining ${left} of ${total} steps.`
    : "The remaining steps never started.";
}

/** The panel's run card for a create started from the start-page conversation
 *  (row P1-A9; agent-panel README §4 + §11).
 *
 *  It is `CreateProgress` — the same component the wizard's modal shows, fed
 *  by the same JobQueue job — inside the panel's card chrome, so the run reads
 *  identically wherever it was launched from and the phase labels come from
 *  the template's own map (§3.0-E). Its `⏹` is A4.5's job cancel, and what a
 *  stopped run reports is what the worker said it kept, never a guess.
 *
 *  Doctrine 5: elapsed + counts, never an ETA. The bar is `CreateProgress`'s,
 *  which is driven by finished step counts and goes indeterminate when the
 *  step total is not yet known.
 */
export function CreateRunCard() {
  const create = useStartCreate();
  const job = useStore((s) =>
    create.jobId ? s.jobs.find((j) => j.id === create.jobId) : undefined,
  );
  const { templates } = usePackTemplates();

  // The run outlives the call that started it, so the terminal fold is driven
  // by the job's status. `settleCreate` is idempotent per job id.
  useEffect(() => {
    if (job) void settleCreate(job);
  }, [job, job?.status, job?.error]);

  // …and the plan card that approved it hears the same outcome, so its step
  // ticks off (or fails) instead of sitting at "0 of 2" forever.
  useEffect(() => {
    const conv = creatingConversation();
    if (!conv) return;
    if (create.status === "done") markPlanStep(conv, CREATE_STEP, "done");
    else if (create.status === "failed")
      markPlanStep(conv, CREATE_STEP, "failed", { error: create.error ?? undefined });
    else if (create.status === "stopped")
      markPlanStep(conv, CREATE_STEP, "failed", {
        error: "stopped by you — the folder and everything already written are kept",
      });
    else return;
    // Whatever the outcome, the turn is over: nothing is running any more.
    settleTurn(conv);
  }, [create.status, create.error]);

  if (create.status === "idle") return null;
  const running = create.status === "creating";
  return (
    <div className="ag-card" data-testid="create-run-card" data-state={create.status}>
      <div className="ag-card-head">
        <span className="ag-badge write">create</span>
        <span className="title">{running ? `Creating ${create.name}` : create.name}</span>
      </div>
      <CreateProgress
        progress={job?.progress}
        startedAt={create.startedAt}
        paid={isPaidSelection(create.backends)}
        // A stop is a dead run too, so the clock stops and the headline says
        // where it stopped instead of ticking on as if the phase were still
        // going (doctrine 5: never a display that lies). The ledger of what
        // was kept is the block below.
        error={
          create.status === "failed"
            ? (create.error ?? "the create failed")
            : create.status === "stopped"
              ? "Stopped by you at the next item boundary."
              : null
        }
        templates={templates}
        onStop={running ? () => void stopCreate() : undefined}
      />
      {create.packDir && (
        <div className="ag-card-mono" data-testid="create-folder">
          {create.packDir}
        </div>
      )}
      {create.status === "stopped" && (
        <div className="ag-cancelled" data-testid="create-stopped">
          <div>Nothing new was started, and nothing was rolled back.</div>
          <div>
            {create.kept.length > 0
              ? `Kept: ${create.kept.join(", ")}.`
              : "Kept: the project folder and whatever had already been written."}
          </div>
          <div>{neverStarted(job?.progress)}</div>
          <div>The folder is still on disk — open it from disk, or delete it yourself.</div>
        </div>
      )}
      {create.status === "done" && (
        <div className="ag-card-actions">
          <button
            className="ag-btn primary"
            onClick={() => {
              const conv = creatingConversation();
              if (conv) markPlanStep(conv, OPEN_STEP, "done");
              void openCreated();
            }}
          >
            Open it now
          </button>
        </div>
      )}
      {create.status === "failed" && create.error && (
        <div className="ag-card-mono">{create.error}</div>
      )}
    </div>
  );
}
