import { useSyncExternalStore } from "react";
import { useStore } from "../../store";
import { api } from "../../lib/invoke";
import { enqueueJob } from "../../lib/jobs";
import { cancelJob } from "../../lib/agentActions";
import { isFreeSelection } from "./confirmGateState";
import { recordJob, recordSpend } from "../../lib/cost";
import type { PackTemplate } from "../../lib/packTemplates";

/** The one create a start-page conversation has in flight (row P1-A9;
 *  agent-panel README §11 "While creating, the recents rail shows a live
 *  project card and the status bar mirrors it").
 *
 *  **One create pipeline, not a second.** `begin` does exactly what
 *  `NewProjectModal.create` does — `enqueueJob` → the Rust `new_project`
 *  command → `canon world new` on the JobQueue worker, with the StepLog
 *  relayed back as `job-progress` and folded by `handleJobProgress` into the
 *  job's `progress`, which `CreateProgress` renders. The panel, the recents
 *  rail and the status bar all read THIS module, and the progress they show is
 *  the job's own. Nothing here creates anything itself.
 *
 *  It lives beside the panel rather than in the store because it is a
 *  start-page-only, single-slot fact with three readers, and an external store
 *  keeps the Zustand slices (owned by other rows) untouched. `useStartCreate`
 *  is the subscription; `packDirOf` is what the recents rail keys on.
 */
export type StartCreateStatus = "idle" | "creating" | "done" | "stopped" | "failed";

export type StartCreate = {
  status: StartCreateStatus;
  /** The JobQueue job — the id every ⏹ and every progress event uses. */
  jobId: string | null;
  /** The project's display name, and where it is being written. */
  name: string;
  template: string;
  packDir: string;
  startedAt: number;
  backends: Record<string, string>;
  /** The confirmed estimate in USD, or null for a $0 selection. */
  estimateUsd: { best: number; worst: number } | null;
  error: string | null;
  /** A stopped run's honest ledger (A4.5's cancel contract, as the worker
   *  reported it): what landed. The worker's cancel payload is
   *  `{cancelled, kept, exit_code, clean, error}` (`src-tauri/src/lib.rs`), so
   *  what never STARTED is not in it — `CreateRunCard` counts that from the
   *  job's own progress rather than from a key nothing sends. */
  kept: string[];
};

const IDLE: StartCreate = {
  status: "idle",
  jobId: null,
  name: "",
  template: "",
  packDir: "",
  startedAt: 0,
  backends: {},
  estimateUsd: null,
  error: null,
  kept: [],
};

let state: StartCreate = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<StartCreate>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): StartCreate {
  return state;
}

/** The live create, or the idle record. Re-renders on every change. */
export function useStartCreate(): StartCreate {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Read it outside React (the conversation driver). */
export function currentCreate(): StartCreate {
  return state;
}

/** Tests and "start over" — never called by the UI mid-run. */
export function resetStartCreate(): void {
  state = IDLE;
  settled = null;
  for (const fn of listeners) fn();
}

export type CreateParams = {
  name: string;
  template: PackTemplate;
  counts: Record<string, number>;
  backends: { llm: string; image: string; music: string; sfx: string; vlm: string };
  seed?: string;
  model?: string;
  estimateUsd?: { best: number; worst: number } | null;
};

/** Is this selection paid at all? Asked of the editor's OWN $0 vocabulary
 *  (`confirmGateState.isFreeSelection` — the set every paid button already
 *  shares), which is why the start page's $0 path never raises the spend card
 *  and a paid one always does (doctrine 3 / master §8 A-5). */
export function isPaidSelection(b: Record<string, string>): boolean {
  return !isFreeSelection(b);
}

/** Start the create on the JobQueue and return its job id.
 *
 *  The folder is written to disk before anything is spent — that is canon's
 *  doing, not ours: `canon world new` resolves and creates the output
 *  directory before the runner starts, which is what makes the start page's
 *  footnote ("you can stop at any step and keep what exists") true.
 */
export async function beginCreate(params: CreateParams): Promise<string> {
  const { name, template, counts, backends } = params;
  set({
    ...IDLE,
    status: "creating",
    name,
    template: template.id,
    startedAt: Date.now(),
    backends,
    estimateUsd: params.estimateUsd ?? null,
  });
  let dir = "";
  const jobId = await enqueueJob(
    {
      op: "world",
      label: name,
      target: name,
      // No `targetType`: this job is not about an entity in the OPEN world, so
      // `handleJobEvent` deliberately sits out its ledgers — they belong to
      // the pack this run creates, and `settle` below writes them there.
      targetType: "",
      scope: "world",
      backends,
      estimate: params.estimateUsd ?? undefined,
    },
    async (id) => {
      const ack = await api.newProject(null, name, {
        template: template.id,
        counts,
        seed: params.seed?.trim() || undefined,
        model: params.model?.trim() || undefined,
        llmBackend: backends.llm,
        imageBackend: backends.image,
        musicBackend: backends.music,
        sfxBackend: backends.sfx,
        vlmBackend: backends.vlm,
        jobId: id,
      });
      // Auto-uniquify happens Rust-side, so the ack is the only place that
      // knows where the run is actually writing.
      dir = ack.pack_dir;
      return ack;
    },
  );
  set({ jobId, packDir: dir });
  return jobId;
}

/** ⏹ — A4.5's cancel contract, unchanged: start nothing new, keep what
 *  landed, say what it cost. The worker answers with `job-updated
 *  {status:"cancelled", result:{kept}}` (read from the run's own step log),
 *  which `settle` folds in; nothing about what was kept is inferred here. */
export async function stopCreate(): Promise<void> {
  if (!state.jobId) return;
  await cancelJob(state.jobId);
}

/** Fold the job's terminal status in, write the created pack's own ledgers,
 *  and — on success — OPEN the world (the day-1-editing rule: P0-6/8/9 landed,
 *  so a fresh project opens editable).
 *
 *  Driven by the job's status rather than an await, because the run outlives
 *  the call that started it. Idempotent: the ledgers are appends, so a second
 *  invocation for the same job is refused rather than billed twice.
 */
let settled: string | null = null;

export async function settleCreate(job: {
  id: string;
  status: string;
  error?: string;
  result?: Record<string, unknown>;
  ts?: number;
  endedAt?: number;
  label?: string;
}): Promise<void> {
  if (state.jobId !== job.id) return;
  if (job.status === "failed") {
    set({ status: "failed", error: job.error ?? "the create failed" });
    return;
  }
  if (job.status === "cancelled") {
    set({
      status: "stopped",
      kept: Array.isArray(job.result?.kept) ? (job.result!.kept as string[]).map(String) : [],
    });
    return;
  }
  if (job.status !== "ok" && job.status !== "no_change") return;
  const dir = state.packDir || String(job.result?.pack_dir ?? "");
  if (!dir) {
    set({ status: "failed", error: "the create finished but reported no project folder" });
    return;
  }
  if (settled === job.id) return;
  settled = job.id;

  // The actual cost comes from the tree the run wrote, exactly as the modal
  // reads it; both ledgers land in the pack the run CREATED.
  let actual = 0;
  try {
    const mf = (await api.readWorldJson(dir, "manifest.json")) as {
      generation_stats?: { total_cost_usd?: number };
    };
    actual = mf.generation_stats?.total_cost_usd ?? 0;
  } catch {
    /* stats optional */
  }
  await recordSpend(dir, {
    op: "world",
    scope: "world",
    backends: state.backends,
    estimate: state.estimateUsd ?? undefined,
    actual_usd: actual,
  });
  await recordJob(dir, {
    job_id: job.id,
    op: "world",
    scope: "world",
    target: job.label ?? state.name,
    status: job.status,
    backends: state.backends,
    estimate: state.estimateUsd ?? undefined,
    actual_usd: actual,
    duration_ms: job.endedAt && job.ts ? job.endedAt - job.ts : undefined,
    changed: true,
  });
  set({ status: "done", packDir: dir });
}

/** Open the finished project. Separate from `settleCreate` so the card can
 *  offer "Open it now" (board 05) rather than yanking the window away. */
export async function openCreated(): Promise<void> {
  const dir = state.packDir;
  if (!dir) return;
  try {
    await useStore.getState().loadWorldByPath(dir);
  } catch (e) {
    set({ status: "failed", error: `created at ${dir}, but opening it failed: ${String(e)}` });
  }
}
