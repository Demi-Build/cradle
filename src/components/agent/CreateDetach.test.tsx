import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

import App from "../../App";
import { useStore, INITIAL_AGENT } from "../../store";
import { handleJobEvent, handleJobProgress } from "../../lib/jobs";
import { resetPackTemplates } from "../../lib/packTemplates";
import { currentCreate, resetStartCreate } from "./startCreate";
import { resetDrafts } from "./startConversation";
import { CreateProgress } from "../start/CreateProgress";

/** THE CREATE DETACH — a create started from the start-page conversation, and
 *  then walked away from.
 *
 *  The bug this file holds shut: `settleCreate` is the ONLY writer of such a
 *  create's spend and job ledgers, and it used to be driven by an effect in
 *  `CreateRunCard`. That card mounts only on the start surface. Opening the
 *  new project unmounts it; the "cradle" breadcrumb calls `closeWorld`, which
 *  empties the per-pack job tray AND resets the agent slice, so the card came
 *  back with no job to settle from. The run itself was never orphaned — it
 *  runs on the Rust JobQueue and its tree lands on disk — so a paid create the
 *  user navigated away from finished, spent real money, and recorded nothing.
 *
 *  What it asserts:
 *  1. the ledgers are written for a create that ends with the tray empty;
 *  2. the card is not stuck at "creating", and never reverts to "Starting
 *     canon…" under a clock that keeps ticking for a run that is over;
 *  3. the run's live position survives the detach, so a user who comes back
 *     mid-run sees where it actually is;
 *  4. ⏹ still cancels — it used to return without a word, because the cancel
 *     looked the job up in the tray that had just been emptied.
 *
 *  Headless and $0 throughout: `new_project` is mocked, so no create runs.
 */

const PLATFORMER = {
  id: "platformer",
  label: "Platformer",
  description: "Side-scrolling stages of levels, wired into a world map.",
  vocab: ["stages", "levels", "paths"],
  defaults: { stages: 1, levels: 2, enemies: 4, items: 4 },
  ranges: null,
  advanced: [],
  engine: ["godot"],
  dimension: "2D",
  distribution: ["desktop"],
  beta: false,
  phase_labels: { "plat:world": "World bible", "plat:sprite_art": "Sprites" },
  generators: ["llm", "image", "music", "sfx", "vlm"],
  count_scope: {},
};

const PACK_DIR = "/Users/me/CradleProjects/lighthouse_keeper";

function startInvoke(cmd: string, args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case "pack_templates":
      return { result: "templates", templates: [PLATFORMER] };
    case "estimate_world":
      return {
        result: "estimate",
        estimate: {
          scope: "world",
          backends: {},
          llm: { by_task: {}, calls: 0, usd: { best: 0, worst: 0 } },
          assets: {
            images: { count: 0, usd: 0 },
            music: { count: 0, usd: 0 },
            sfx: { count: 0, usd: 0 },
            vlm: {},
            usd: { best: 0, worst: 0 },
          },
          total_usd: { best: 0, worst: 0 },
          warnings: [],
        },
      };
    case "new_project":
      return { job_id: args?.jobId, queued: true, pack_dir: PACK_DIR };
    case "project_store":
      return { root: "/Users/me/CradleProjects", exists: true };
    case "read_world_json":
      return { generation_stats: { total_cost_usd: 0.42 } };
    case "cancel_job":
      return { job_id: args?.jobId, status: "cancelled" };
    case "load_world":
      return {
        path: PACK_DIR,
        name: "Lighthouse Keeper",
        world_kind: "platformer",
        entity_counts: [],
      };
    case "spend_record":
    case "jobs_record":
      return { result: "ok" };
    case "list_entities":
      return [];
    // The created project joins the recents rail once it has been opened, and
    // the rail's "World at a glance" reads the pack straight off disk.
    case "world_map":
      return {
        world: "lighthouse",
        nodes: [],
        edges: [],
        areas: [],
        locked: false,
        manual_count: 0,
      };
    default:
      return {};
  }
}

/** The start page = no world loaded. Everything else is the shipped default. */
function seedStart() {
  useStore.setState({
    worldPath: "",
    world: null,
    worldStoryTitle: null,
    entities: {},
    recents: [],
    jobs: [],
    error: null,
    newProjectOpen: false,
    startNote: null,
    route: "start",
    agentUi: { open: true, width: 412, collapsed: false },
    agent: { ...INITIAL_AGENT },
  });
}

/** Describe a game, answer both chips, approve the plan — the shipped route to
 *  a create in flight. Returns the JobQueue job id. */
async function createInFlight(): Promise<string> {
  render(<App />);
  await screen.findByTestId("start-agent");
  const box = screen.getByLabelText("Message the agent");
  fireEvent.change(box, { target: { value: "A frozen harbour climb" } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
  for (const card of await screen.findAllByTestId("request-input")) {
    await act(async () => {
      fireEvent.click(card.querySelector<HTMLButtonElement>(".ag-chip")!);
    });
  }
  await screen.findByTestId("plan-card");
  await act(async () => {
    fireEvent.click(screen.getByTestId("plan-approve"));
  });
  await screen.findByTestId("create-run-card");
  return useStore.getState().jobs[0].id;
}

/** Open the created project and then walk back out of it — the "cradle"
 *  breadcrumb, which is what the owner did. This is the state that used to
 *  silently detach the run: no job row, and no conversation. */
async function openThenLeave(): Promise<void> {
  await act(async () => {
    await useStore.getState().loadWorldByPath(PACK_DIR);
  });
  await act(async () => {
    useStore.getState().closeWorld();
  });
  // The tray is per pack, so leaving the pack empties it — that is the
  // precondition, not a failure. The create must survive it anyway.
  expect(useStore.getState().jobs).toHaveLength(0);
  await screen.findByTestId("create-run-card");
}

describe("a create the user navigates away from", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      Promise.resolve(startInvoke(cmd, args)),
    );
    resetPackTemplates();
    resetStartCreate();
    resetDrafts();
    seedStart();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  });

  it("still writes its spend and job ledgers into the pack it created", async () => {
    const jobId = await createInFlight();
    await act(async () => {
      await handleJobEvent({ id: jobId, status: "running" });
      handleJobProgress({ id: jobId, event: "run_start", phases: 6 });
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:world" });
    });
    await openThenLeave();

    // …and only NOW does the run end, with the tray empty and the
    // conversation gone. This is the paid-pass blocker.
    await act(async () => {
      await handleJobEvent({
        id: jobId,
        status: "done",
        result: { changed: true, pack_dir: PACK_DIR },
      });
    });

    const spend = invokeMock.mock.calls.find(([cmd]) => cmd === "spend_record");
    const job = invokeMock.mock.calls.find(([cmd]) => cmd === "jobs_record");
    expect(spend).toBeTruthy();
    expect(job).toBeTruthy();
    // Both land in the pack the run CREATED — never in whatever was open.
    expect((spend![1] as { path: string }).path).toBe(PACK_DIR);
    expect((job![1] as { path: string }).path).toBe(PACK_DIR);
    // The cost is the one the created tree reports, not a guess.
    expect((spend![1] as { entry: { actual_usd: number } }).entry.actual_usd).toBe(0.42);
    expect((job![1] as { entry: { job_id: string } }).entry.job_id).toBe(jobId);
    // A ledger row with no duration is the other half of the same loss.
    expect(
      (job![1] as { entry: { duration_ms?: number } }).entry.duration_ms,
    ).toBeGreaterThanOrEqual(0);
  });

  it("comes back finished, not stuck at 'creating'", async () => {
    const jobId = await createInFlight();
    await openThenLeave();
    await act(async () => {
      await handleJobEvent({
        id: jobId,
        status: "done",
        result: { changed: true, pack_dir: PACK_DIR },
      });
    });

    const card = await screen.findByTestId("create-run-card");
    await waitFor(() => expect(card.getAttribute("data-state")).toBe("done"));
    expect(currentCreate().status).toBe("done");
    expect(await screen.findByRole("button", { name: "Open it now" })).toBeInTheDocument();
    // The exact display the owner saw: a finished create whose progress had
    // reverted to the pre-first-event copy, under a ⏹ for a run that is over.
    expect(card.textContent).not.toMatch(/Starting canon/);
    expect(card.textContent).not.toMatch(/counting steps/);
    expect(screen.queryByLabelText("Stop this run")).toBeNull();
    expect(card.querySelector(".cp-spin")).toBeNull();
    // …and the folder it wrote is still named, so "Open it now" is honest.
    expect(screen.getByTestId("create-folder").textContent).toBe(PACK_DIR);
  });

  it("keeps its live position while detached, so coming back mid-run is honest", async () => {
    const jobId = await createInFlight();
    await act(async () => {
      await handleJobEvent({ id: jobId, status: "running" });
      handleJobProgress({ id: jobId, event: "run_start", phases: 6 });
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:world" });
      handleJobProgress({ id: jobId, event: "node_done", node: "phase:plat:world" });
    });
    await openThenLeave();

    // The run carries on with nothing mounted — the JobQueue does not care
    // which surface is on screen — and the create keeps folding its position.
    await act(async () => {
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:sprite_art" });
      handleJobProgress({
        id: jobId,
        event: "node_item",
        node: "phase:plat:sprite_art",
        item: "gull",
        index: 2,
        total: 5,
      });
    });

    const card = screen.getByTestId("create-run-card");
    expect(card.getAttribute("data-state")).toBe("creating");
    expect(card.textContent).toMatch(/Sprites/);
    expect(card.textContent).toMatch(/1 of 6 steps/);
    expect(card.textContent).toMatch(/gull/);
    expect(card.textContent).not.toMatch(/Starting canon/);
  });

  it("⏹ still cancels — the cancel is by job id, not by tray row", async () => {
    const jobId = await createInFlight();
    await act(async () => {
      await handleJobEvent({ id: jobId, status: "running" });
      handleJobProgress({ id: jobId, event: "run_start", phases: 6 });
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:world" });
    });
    await openThenLeave();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Stop this run"));
    });
    const cancel = invokeMock.mock.calls.find(([cmd]) => cmd === "cancel_job");
    expect(cancel).toBeTruthy();
    expect((cancel![1] as { jobId: string }).jobId).toBe(jobId);

    // The worker answers the way it does for any cancel, and A4.5's contract
    // is reported in full even with no tray row to read the totals from.
    await act(async () => {
      await handleJobEvent({
        id: jobId,
        status: "cancelled",
        result: { cancelled: true, kept: ["world bible"], exit_code: 130, clean: true },
      });
    });
    const stopped = await screen.findByTestId("create-stopped");
    expect(stopped.textContent).toMatch(/Kept: world bible/);
    expect(stopped.textContent).toMatch(/Never started: the remaining 5 of 6 steps/);
    expect(screen.getByTestId("create-run-card").textContent).toMatch(/Stopped/);
  });

  it("says so when the run never even enqueues, instead of creating forever", async () => {
    // Rust's `new_project` returns Err before anything is queued — an
    // unwritable project folder, a poisoned queue lock, a dead job worker. No
    // `job-updated` is ever emitted for a job the queue never accepted, so a
    // create settled ONLY by inbound events would sit at "creating" with a ⏹
    // for a run that does not exist.
    const boom = "cannot create the project folder /nope: permission denied";
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      cmd === "new_project" ? Promise.reject(boom) : Promise.resolve(startInvoke(cmd, args)),
    );
    await createInFlight();

    const card = await screen.findByTestId("create-run-card");
    await waitFor(() => expect(card.getAttribute("data-state")).toBe("failed"));
    expect(currentCreate().status).toBe("failed");
    expect(card.textContent).toMatch(/permission denied/);
    // Nothing that implies a run in flight: no ⏹ for a job the queue refused.
    expect(screen.queryByLabelText("Stop this run")).toBeNull();
    // …and the plan card hears it too, so the step stops claiming it is
    // running and the turn ends.
    await waitFor(() =>
      expect(screen.getAllByTestId("plan-step")[0].getAttribute("data-status")).toBe("failed"),
    );
    const conv = Object.values(useStore.getState().agent.conversations)[0];
    expect(conv.status).toBe("idle");
    // A failed create bills nothing and writes no spend row.
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "spend_record")).toBe(false);
  });

  it("catches an ending that beats the enqueue's own reply back to the webview", async () => {
    // The worker thread and the `invoke` reply are two channels: a run can
    // report itself finished before the ack carrying the pack folder arrives.
    // The create is recognised by `jobId` alone, so it has to be addressable
    // from the moment the id exists rather than from the moment the enqueue
    // resolves — otherwise this event lands on a create with `jobId: null` and
    // is dropped, permanently.
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "new_project") {
        await handleJobEvent({
          id: String(args!.jobId),
          status: "done",
          result: { changed: true, pack_dir: PACK_DIR },
        });
      }
      return startInvoke(cmd, args);
    });
    await createInFlight();

    expect(currentCreate().status).toBe("done");
    expect(currentCreate().packDir).toBe(PACK_DIR);
    await waitFor(() =>
      expect(screen.getByTestId("create-run-card").getAttribute("data-state")).toBe("done"),
    );
    // The ledgers are the point: an ending nobody folded is an unrecorded bill.
    const spend = invokeMock.mock.calls.find(([cmd]) => cmd === "spend_record");
    expect(spend).toBeTruthy();
    expect((spend![1] as { path: string }).path).toBe(PACK_DIR);
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "jobs_record")).toBe(true);
  });

  it("does not cancel or delete the run just because the project was closed", async () => {
    const jobId = await createInFlight();
    await openThenLeave();
    // Rule 6: nothing regenerates on its own, nothing is deleted without
    // asking. Leaving a project is not a Stop.
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "cancel_job")).toBe(false);
    expect(currentCreate().status).toBe("creating");
    expect(currentCreate().jobId).toBe(jobId);
    expect(screen.getByTestId("create-run-card").getAttribute("data-state")).toBe("creating");
  });
});

/** The display half, in isolation: `ended` is what tells `CreateProgress` the
 *  run is over when no `run_end` reached it. Without it, a finished create
 *  with no step log renders as one that has not started yet, under a clock
 *  that never stops — the state the owner actually saw. */
describe("CreateProgress with no step log", () => {
  it("says the run is over instead of that it is starting", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <CreateProgress startedAt={Date.now() - 5000} paid={false} onStop={onStop} />,
    );
    // The unfinished control: this copy is right only while the run is live.
    expect(screen.getByText("Starting canon…")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop this run")).toBeInTheDocument();

    rerender(<CreateProgress startedAt={Date.now() - 5000} paid={false} onStop={onStop} ended />);
    expect(screen.queryByText("Starting canon…")).toBeNull();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    // Nothing that implies a run in flight survives: no ⏹, no spinner, no
    // "don't close cradle", and no promise of a step count that is not coming.
    expect(screen.queryByLabelText("Stop this run")).toBeNull();
    expect(document.querySelector(".cp-spin")).toBeNull();
    expect(screen.queryByText(/don't close cradle/)).toBeNull();
    expect(screen.queryByText("counting steps…")).toBeNull();
  });

  it("freezes the clock once the run is over", () => {
    vi.useFakeTimers();
    try {
      const started = Date.now() - 5000;
      const { rerender, unmount } = render(
        <CreateProgress startedAt={started} paid={false} ended />,
      );
      const frozen = screen.getByLabelText("elapsed").textContent;
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByLabelText("elapsed").textContent).toBe(frozen);

      // …and the same clock DOES tick while the run is live, so the freeze is
      // the `ended` fact and not a broken timer.
      rerender(<CreateProgress startedAt={started} paid={false} />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByLabelText("elapsed").textContent).not.toBe(frozen);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
