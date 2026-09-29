import type { JobProgress } from "../../lib/invoke";
import { usePackTemplates } from "../../lib/packTemplates";
import { CreateProgress } from "../start/CreateProgress";
import { openCreated, stopCreate, useStartCreate, isPaidSelection } from "./startCreate";
import { OPEN_STEP, creatingConversation, markPlanStep } from "./startConversation";

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
 *
 *  **A pure view.** It reads the create and renders it; it settles nothing.
 *  The terminal fold and the plan-step mirror both live at the top of
 *  `handleJobEvent`, because this card mounts only on the start page and a
 *  create the user walks away from still has to record what it spent. For the
 *  same reason the progress it renders is the create's OWN copy, not a lookup
 *  in the job tray: `closeWorld` empties the tray (jobs are per pack) while
 *  the run carries on, and a card fed by the tray reverted to "Starting
 *  canon…" with a clock ticking for a run that had already finished.
 */
export function CreateRunCard() {
  const create = useStartCreate();
  const { templates } = usePackTemplates();

  if (create.status === "idle") return null;
  const running = create.status === "creating";
  return (
    <div className="ag-card" data-testid="create-run-card" data-state={create.status}>
      <div className="ag-card-head">
        <span className="ag-badge write">create</span>
        <span className="title">{running ? `Creating ${create.name}` : create.name}</span>
      </div>
      <CreateProgress
        progress={create.progress ?? undefined}
        startedAt={create.startedAt}
        // The run is over. Says so even when no `run_end` arrived (a create
        // that ends between segments, or one whose last events were missed):
        // without it the clock ticks on under a card that already reads
        // "done", which is exactly the display doctrine 5 forbids.
        ended={!running}
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
        // Where the run wrote: once it is over, the card reads the tree's
        // generation_stats for the post-create asset line, so a create that
        // lost assets never reads as a clean "Finished" here either.
        packDir={create.packDir || undefined}
      />
      {create.packDir && (
        <div className="ag-card-mono" data-testid="create-folder">
          {create.packDir}
        </div>
      )}
      {create.warnings.length > 0 && (
        // What the ledgers could not measure. A run with no stats file has an
        // UNKNOWN cost — not a $0, and not a failure — so this reads as a note
        // beside the outcome, never as an alarm over it. It is the same line
        // the wizard's tracker shows for the same run.
        <div className="ag-note" data-testid="create-warnings">
          {create.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
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
          <div>{neverStarted(create.progress ?? undefined)}</div>
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
