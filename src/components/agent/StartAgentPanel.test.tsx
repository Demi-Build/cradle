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
import { resetStartCreate } from "./startCreate";
import {
  MAX_QUESTIONS,
  resetDrafts,
  ALLOW_DISABLED_REASON,
  PLAN_EDIT_DISABLED_REASON,
  draftFor,
} from "./startConversation";

/** Row P1-A9 — the start page, and create-by-conversation.
 *
 * The gate this file holds (agent-panel README §11 + board 05; Phase 1 §2.4):
 *
 * 1. the panel is the SAME column over the hero, with **Allow disabled and its
 *    reason** stated — Ask and Plan only (doctrine 4);
 * 2. create is a conversation: **at most two clarifying questions**, then a
 *    numbered plan whose button reads `Create · up to $X` beside `Edit steps`
 *    and `Start blank instead`, under the folder-before-spend footnote;
 * 3. a **$0 (free) selection never raises the spend card** (doctrine 3);
 * 4. the create runs on the **one create pipeline** — the JobQueue command the
 *    wizard uses — and the recents rail + status bar mirror the same job;
 * 5. **stopping mid-create keeps the folder** and says what was kept vs never
 *    started (A4.5's cancel contract);
 * 6. on completion the world **opens editable**.
 *
 * Everything is headless and $0: `new_project` is mocked, so no create runs.
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

/** The mock estimator's own "is this paid" — the backend ids are DATA, so it
 *  asks the same question the panel does rather than matching a template id. */
function isPaidArgs(args?: Record<string, unknown>): boolean {
  return Object.entries(args ?? {})
    .filter(([k]) => k.endsWith("Backend"))
    .some(([, v]) => v !== "fake" && v !== "none" && v !== "" && v != null);
}

function startInvoke(cmd: string, args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case "pack_templates":
      return { result: "templates", templates: [PLATFORMER] };
    case "estimate_world":
      return {
        result: "estimate",
        estimate: {
          scope: "world",
          backends: args?.llmBackend ? { llm: String(args.llmBackend) } : {},
          llm: { by_task: {}, calls: 0, usd: { best: 0, worst: 0 } },
          assets: {
            images: { count: 0, usd: 0 },
            music: { count: 0, usd: 0 },
            sfx: { count: 0, usd: 0 },
            vlm: {},
            usd: { best: 0, worst: 0 },
          },
          // A FREE selection: $0, which is what must never raise a spend card.
          // A paid one prices: the estimator answers in USD, exactly as canon
          // does, so the plan card's range and the button's total are real.
          total_usd: isPaidArgs(args) ? { best: 1.1, worst: 2.2 } : { best: 0, worst: 0 },
          warnings: [],
        },
      };
    case "new_project":
      return { job_id: args?.jobId, queued: true, pack_dir: PACK_DIR };
    case "project_store":
      return { root: "/Users/me/CradleProjects", exists: true };
    case "read_world_json":
      return { generation_stats: { total_cost_usd: 0 } };
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

/** Type into the composer and send. */
async function say(text: string) {
  const box = screen.getByLabelText("Message the agent");
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

/** Answer every chip on screen — the shortcut route. */
async function clickChips() {
  for (const card of await screen.findAllByTestId("request-input")) {
    await act(async () => {
      fireEvent.click(card.querySelector<HTMLButtonElement>(".ag-chip")!);
    });
  }
}

/** The header's ⏹ (the panel's own), never the run card's. */
function headerStop(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".ag-head .ag-stop");
}

describe("the start page's panel (row A9)", () => {
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

  it("is the same column over the hero, with Allow disabled and its reason", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    const shell = document.querySelector(".start-app")!;
    expect(shell.getAttribute("data-agent")).toBe("open");
    expect((shell as HTMLElement).style.getPropertyValue("--agent-w")).toBe("412px");
    // The SAME panel component, marked as the start surface.
    expect(screen.getByTestId("agent-panel").getAttribute("data-surface")).toBe("start");

    // Doctrine 4: disabled WITH the reason — never hidden. Ask and Plan stay.
    const allow = screen.getByRole("radio", { name: "Allow" }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
    expect(allow.title).toBe(ALLOW_DISABLED_REASON);
    expect(screen.getByRole("radio", { name: "Ask" })).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: "Plan" })).not.toBeDisabled();
    expect(screen.getByText(ALLOW_DISABLED_REASON)).toBeInTheDocument();
  });

  it("opens exactly one tab, in Ask mode — Allow cannot apply with no project", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    const convs = Object.values(useStore.getState().agent.conversations);
    expect(convs).toHaveLength(1);
    expect(convs[0].mode).toBe("ask");
  });

  it("seeds first run for 'no project open' and attaches nothing to the composer", async () => {
    render(<App />);
    await screen.findByTestId("first-run");
    // The seeds cannot be drawn from a project — there is none.
    expect(screen.getByText(/lighthouse keeper in a frozen harbour/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Message the agent")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("Describe a game"),
    );
    expect(document.querySelectorAll(".ag-ctx-chip")).toHaveLength(0);
  });

  it("asks at most two clarifying questions, then answers with a numbered plan", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("Make me a game about a lighthouse keeper in a frozen harbour, lots of climbing");

    const asked = await screen.findAllByTestId("request-input");
    expect(asked).toHaveLength(MAX_QUESTIONS);

    // Answer both chips — the same path a typed reply takes.
    for (const card of asked) {
      const chip = card.querySelector<HTMLButtonElement>(".ag-chip")!;
      await act(async () => {
        fireEvent.click(chip);
      });
    }
    const plan = await screen.findByTestId("plan-card");
    expect(plan.getAttribute("data-state")).toBe("proposed");
    // …and NOT a third round of questions.
    expect(screen.getAllByTestId("request-input")).toHaveLength(MAX_QUESTIONS);
    expect(screen.getAllByTestId("plan-step").length).toBeGreaterThanOrEqual(2);
    // The start page's buttons and its promise.
    expect(screen.getByTestId("plan-approve").textContent).toMatch(/^Create · /);
    expect(screen.getByTestId("plan-discard").textContent).toBe("Start blank instead");
    expect(screen.getByText(/folder is written to disk before anything is spent/i)).toBeVisible();
  });

  it("a $0 selection reads $0 and never raises the spend card", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
    for (const card of await screen.findAllByTestId("request-input")) {
      await act(async () => {
        fireEvent.click(card.querySelector<HTMLButtonElement>(".ag-chip")!);
      });
    }
    await screen.findByTestId("plan-card");
    expect(screen.getByTestId("plan-approve").textContent).toBe("Create · $0");

    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-approve"));
    });
    // Doctrine 3: the accent spend card is reserved for real money.
    expect(screen.queryByTestId("paid-card")).toBeNull();
    expect(screen.queryByTestId("confirm-gate")).toBeNull();
    // …and the create still went ahead.
    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "new_project")).toBe(true),
    );
  });

  it("runs the create on the ONE pipeline, and the rail + status bar mirror it", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
    for (const card of await screen.findAllByTestId("request-input")) {
      await act(async () => {
        fireEvent.click(card.querySelector<HTMLButtonElement>(".ag-chip")!);
      });
    }
    await screen.findByTestId("plan-card");
    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-approve"));
    });

    // The wizard's own command, with the template's counts BY NAME and the
    // free backends — cradle never branches on the template id.
    const call = await waitFor(() => {
      const c = invokeMock.mock.calls.find(([cmd]) => cmd === "new_project");
      if (!c) throw new Error("new_project was not invoked");
      return c;
    });
    const args = call[1] as Record<string, unknown>;
    expect(args.template).toBe("platformer");
    expect(args.counts).toEqual(PLATFORMER.defaults);
    expect(args.llmBackend).toBe("fake");
    expect(args.imageBackend).toBe("fake");
    expect(args.parentDir).toBeNull(); // the project store

    // The run card is the wizard's CreateProgress, on the wizard's own job.
    const runCard = await screen.findByTestId("create-run-card");
    expect(runCard).toBeInTheDocument();
    const jobId = useStore.getState().jobs[0].id;
    await act(async () => {
      await handleJobEvent({ id: jobId, status: "running" });
      handleJobProgress({ id: jobId, event: "run_start", phases: 6 });
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:world" });
      handleJobProgress({ id: jobId, event: "node_done", node: "phase:plat:world" });
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:sprite_art" });
    });

    // The live project card, and the status bar mirroring the same counter.
    const live = await screen.findByTestId("live-project-card");
    expect(live.textContent).toMatch(/being created/i);
    expect(live.textContent).toMatch(/step 2 of 6/);
    expect(screen.getByTestId("start-status-note").textContent).toMatch(/step 2 of 6/);
    expect(screen.getByTestId("start-status-note").textContent).toMatch(/sprites/i);
  });

  it("stopping mid-create keeps the folder and reports what was kept", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
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
    const jobId = useStore.getState().jobs[0].id;
    await act(async () => {
      await handleJobEvent({ id: jobId, status: "running" });
      handleJobProgress({ id: jobId, event: "run_start", phases: 6 });
      handleJobProgress({ id: jobId, event: "node_start", node: "phase:plat:world" });
    });

    // ⏹ — the same job cancel the tray uses.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Stop this run"));
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "cancel_job")).toBe(true);

    // The worker answers with exactly the payload `src-tauri` builds for a
    // cancelled job — `{cancelled, kept, exit_code, clean}`, no `not_started`.
    // What never began is COUNTED from the job's own progress.
    await act(async () => {
      await handleJobEvent({
        id: jobId,
        status: "cancelled",
        result: { cancelled: true, kept: ["world bible"], exit_code: 130, clean: true },
      });
    });
    const stopped = await screen.findByTestId("create-stopped");
    // The progress display goes dead too — the clock stops and the headline
    // says where it stopped, instead of ticking on as if it were still going.
    expect(screen.getByTestId("create-run-card").textContent).toMatch(/Stopped/);
    expect(stopped.textContent).toMatch(/Kept: world bible/);
    // 6 phases announced, 1 started → 5 never began.
    expect(stopped.textContent).toMatch(/Never started: the remaining 5 of 6 steps/);
    expect(stopped.textContent).toMatch(/nothing was rolled back/i);
    // The folder is on disk before anything is spent — so it is still there.
    expect(screen.getByTestId("create-folder").textContent).toBe(PACK_DIR);
    expect(screen.getByTestId("start-status-note").textContent).toMatch(/the folder is kept/i);
  });

  it("on completion the world opens editable", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
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
    const jobId = useStore.getState().jobs[0].id;
    await act(async () => {
      await handleJobEvent({
        id: jobId,
        status: "done",
        result: { changed: true, pack_dir: PACK_DIR },
      });
    });
    const open = await screen.findByRole("button", { name: "Open it now" });
    await act(async () => {
      fireEvent.click(open);
    });
    await waitFor(() => expect(useStore.getState().world?.path).toBe(PACK_DIR));
  });

  it("the plan's own steps are ones the run really performs, and the turn ends", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
    for (const card of await screen.findAllByTestId("request-input")) {
      await act(async () => {
        fireEvent.click(card.querySelector<HTMLButtonElement>(".ag-chip")!);
      });
    }
    await screen.findByTestId("plan-card");
    // Doctrine 5: the plan lists what approving it DOES — the create, then
    // opening it — not a copy of the runner's phases (the run card owns those).
    const steps = screen.getAllByTestId("plan-step");
    expect(steps).toHaveLength(2);
    expect(steps[0].textContent).toMatch(/Create the project from the Platformer template/);

    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-approve"));
    });
    await screen.findByTestId("create-run-card");
    const jobId = useStore.getState().jobs[0].id;
    // Running: the step the create IS shows running, and so does the tab.
    await waitFor(() =>
      expect(screen.getAllByTestId("plan-step")[0].getAttribute("data-status")).toBe("running"),
    );
    await act(async () => {
      await handleJobEvent({
        id: jobId,
        status: "done",
        result: { changed: true, pack_dir: PACK_DIR },
      });
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("plan-step")[0].getAttribute("data-status")).toBe("done"),
    );
    // …and the conversation stops claiming it is working (the status bar and
    // the header ⏹ both read this).
    const conv = Object.values(useStore.getState().agent.conversations)[0];
    expect(conv.status).toBe("idle");
    expect(screen.getAllByTestId("plan-step")[1].getAttribute("data-status")).toBe("pending");
  });

  it("a PAID selection reads its range and confirms with the spend card", async () => {
    // The free path is the start page's default; a paid one is still the same
    // plan card and the same gate — this asserts the two sides of doctrine 3
    // meet at one seam (`isPaidSelection`), rather than the free path being
    // the only one the surface knows how to render.
    const { planSteps } = await import("./startConversation");
    const { isPaidSelection } = await import("./startCreate");
    expect(isPaidSelection({ llm: "fake", image: "fake", music: "none" })).toBe(false);
    expect(isPaidSelection({ llm: "fake", image: "fal", music: "none" })).toBe(true);
    const paid = planSteps(PLATFORMER, PLATFORMER.defaults, true, { best: 1.1, worst: 2.2 });
    expect(paid[0].tier).toBe("paid");
    expect(paid[0].estimate).toEqual({ low: 1.1, high: 2.2 });
    const free = planSteps(PLATFORMER, PLATFORMER.defaults, false, null);
    expect(free[0].tier).toBe("write");
    expect(free[0].estimate).toBeUndefined();
    // Doctrine 3: the TIER is the selection's, not the estimate's — a paid
    // selection whose estimator failed is still paid, and must not render as
    // a free `write` step under a `Create · $0` button.
    const unpriced = planSteps(PLATFORMER, PLATFORMER.defaults, true, null);
    expect(unpriced[0].tier).toBe("paid");
    expect(unpriced[0].estimate).toBeUndefined();
  });

  it("'Start blank instead' hands the create back to the New project form", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
    for (const card of await screen.findAllByTestId("request-input")) {
      await act(async () => {
        fireEvent.click(card.querySelector<HTMLButtonElement>(".ag-chip")!);
      });
    }
    await screen.findByTestId("plan-card");
    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-discard"));
    });
    expect(useStore.getState().newProjectOpen).toBe(true);
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "new_project")).toBe(false);
  });
  it("one TYPED reply answers both questions — the plan follows, not silence", async () => {
    // Board 05's own script: both questions ride one turn, and the user answers
    // them in one sentence. Counting replies against questions left the
    // conversation waiting for a chip that had already been answered.
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("Make me a game about a lighthouse keeper in a frozen harbour, lots of climbing");
    expect(await screen.findAllByTestId("request-input")).toHaveLength(MAX_QUESTIONS);

    await say("Separate areas. Hazards only — ice, wind, dark.");

    const plan = await screen.findByTestId("plan-card");
    expect(plan.getAttribute("data-state")).toBe("proposed");
    // The chips on screen say they were answered, so they cannot be answered
    // a second time for a question the conversation has moved past.
    for (const card of screen.getAllByTestId("request-input")) {
      expect(card.textContent).toMatch(/answered: Separate areas/);
      expect(card.querySelector(".ag-chip")).toBeNull();
    }
    // …and still no third round.
    expect(screen.getAllByTestId("request-input")).toHaveLength(MAX_QUESTIONS);
  });

  it("the header ⏹ stops the CREATE, not just the conversation", async () => {
    // Three ⏹ can be on screen mid-create. The header's used to take
    // `stopConversation`, which on a local conversation wrote "Stopped by you.
    // Nothing new was started." and left the JobQueue create running — a Stop
    // that reports a stop and does not stop (A4.5's contract inverted).
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
    await clickChips();
    await screen.findByTestId("plan-card");
    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-approve"));
    });
    await screen.findByTestId("create-run-card");
    const jobId = useStore.getState().jobs[0].id;
    await act(async () => {
      await handleJobEvent({ id: jobId, status: "running" });
    });

    const stop = headerStop();
    expect(stop).not.toBeNull();
    await act(async () => {
      fireEvent.click(stop!);
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "cancel_job")).toBe(true);
    // …and it did NOT claim a stop the run never heard about.
    expect(screen.queryByTestId("cancelled")).toBeNull();
  });

  it("Edit steps is disabled with its reason, never a plan trapped in editing", async () => {
    // The edit decision is a POST the service re-plans from, and there is no
    // service with no project open. Doctrine 4: the button stays and says why.
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("A frozen harbour climb");
    await clickChips();
    await screen.findByTestId("plan-card");
    const edit = screen.getByTestId("plan-edit") as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe(PLAN_EDIT_DISABLED_REASON);
    await act(async () => {
      fireEvent.click(edit);
    });
    // Still approvable — the card never leaves `proposed`.
    expect(screen.getByTestId("plan-card").getAttribute("data-state")).toBe("proposed");
    expect(screen.getByTestId("plan-approve")).toBeInTheDocument();
  });

  it("the composer's mode line says no project open, with the live mode", async () => {
    render(<App />);
    await screen.findByTestId("start-agent");
    expect(screen.getByText("Ask mode · no project open")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Plan" }));
    });
    expect(screen.getByText("Plan mode · no project open")).toBeInTheDocument();
  });

  it("answers 'What can you build for me?' from the templates, not with a project", async () => {
    // It is one of this page's own seeds, and it is a question about the page.
    // It used to become a brief, and the plan proposed a project named "What".
    render(<App />);
    await screen.findByTestId("start-agent");
    await say("What can you build for me?");
    await screen.findByText(/Platformer — Side-scrolling stages/);
    expect(screen.queryAllByTestId("request-input")).toHaveLength(0);
    expect(screen.queryByTestId("plan-card")).toBeNull();
    // …and the next message is still taken as the brief.
    await say("A frozen harbour climb");
    expect(await screen.findAllByTestId("request-input")).toHaveLength(MAX_QUESTIONS);
  });

  it("a PAID selection reaches `Create · up to $X` with the estimator's range", async () => {
    // The selection used to be re-seeded FREE on every proposal, so the
    // estimate was fetched and then discarded and the button could only ever
    // say `Create · $0`. The draft's own selection is what prices the plan.
    render(<App />);
    await screen.findByTestId("start-agent");
    const convId = useStore.getState().agent.activeId!;
    draftFor(convId).backends = {
      llm: "fake",
      image: "fal",
      music: "none",
      sfx: "none",
      vlm: "none",
    };
    await say("A frozen harbour climb with real art");
    await clickChips();
    await screen.findByTestId("plan-card");

    expect(screen.getByTestId("plan-approve").textContent).toBe("Create · up to $2.20");
    const step = screen.getAllByTestId("plan-step")[0];
    expect(step.textContent).toMatch(/paid/);
    expect(step.textContent).toMatch(/\$1\.10/);
    // The image backend the draft chose is the one the estimator was asked
    // about — the plan is priced for the run it would actually start.
    const est = invokeMock.mock.calls.find(([cmd]) => cmd === "estimate_world")!;
    expect((est[1] as Record<string, unknown>).imageBackend).toBe("fal");
  });
});
