import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NewProjectModal } from "./NewProjectModal";
import { resetProviderRows } from "../../lib/providerKeys";
import { resetPackTemplates, type PackTemplate } from "../../lib/packTemplates";
import { useStore } from "../../store";

/** The create wizard (row P0-10, design board 06). What these tests are for:
 *  the cards and every count field are TEMPLATE DATA now — a hardcoded array
 *  would pass a snapshot test and fail the row — plus the three things the
 *  design doesn't draw and the row insists on: the provider-key precheck's
 *  disabled-with-a-reason, the live estimate (including the $0 case, which
 *  must NOT raise a spend card), and the auto-uniquified project store. */

const PLATFORMER: PackTemplate = {
  id: "platformer",
  label: "Platformer",
  description: "Side-scrolling stages of levels, wired into a world map.",
  vocab: ["stages", "levels", "paths"],
  defaults: { stages: 1, levels: 2, enemies: 4, items: 4 },
  ranges: { stages: [1, 8], levels: [1, 12], enemies: [0, 24], items: [0, 24] },
  advanced: [],
  engine: ["godot"],
  dimension: "2D",
  distribution: ["computer", "web", "mobile"],
  beta: false,
  phase_labels: { "plat:world": "World premise" },
  generators: ["llm", "image", "music", "sfx", "vlm"],
  count_scope: {},
};

const DUNGEON: PackTemplate = {
  id: "dungeon",
  label: "Dungeon crawler",
  description: "Rooms of encounters, NPCs and loot tables.",
  vocab: ["rooms", "encounters", "loot"],
  defaults: { rooms: 3, npc: 2, item: 3, monster: 2, event: 4, quest: 2, class: 4 },
  ranges: {
    rooms: [1, 24],
    npc: [0, 8],
    monster: [0, 8],
    item: [0, 8],
    event: [0, 8],
    quest: [0, 8],
    class: [1, 4],
  },
  advanced: ["event", "quest", "class"],
  engine: ["pygame"],
  dimension: "2D",
  distribution: [],
  beta: false,
  phase_labels: { "db:npc": "NPCs" },
  generators: ["llm", "image", "music", "sfx"],
  count_scope: {
    npc: "per_room",
    monster: "per_room",
    item: "per_room",
    event: "per_room",
    quest: "per_room",
    class: "total",
  },
};

const packTemplates = vi.fn();
const estimateWorld = vi.fn();
const newProject = vi.fn();
const projectStore = vi.fn();
const providerKeys = vi.fn();
const providerRows = vi.fn();
const confirmSpend = vi.fn();

vi.mock("../../lib/invoke", () => ({
  api: {
    packTemplates: (...a: unknown[]) => packTemplates(...a),
    estimateWorld: (...a: unknown[]) => estimateWorld(...a),
    newProject: (...a: unknown[]) => newProject(...a),
    projectStore: (...a: unknown[]) => projectStore(...a),
    providerKeys: (...a: unknown[]) => providerKeys(...a),
    providerRows: (...a: unknown[]) => providerRows(...a),
    readWorldJson: () => Promise.resolve({}),
  },
}));
vi.mock("../agent/confirmGateState", () => ({
  confirmSpend: (...a: unknown[]) => confirmSpend(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve("/picked") }));
vi.mock("../../lib/cost", () => ({
  fmtRange: (u?: { best: number; worst: number }) =>
    u ? `$${u.best.toFixed(2)}–$${u.worst.toFixed(2)}` : "…",
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
  recordJob: () => Promise.resolve(),
  recordSpend: () => Promise.resolve(),
}));
vi.mock("../../lib/agentActions", () => ({ cancelJob: () => Promise.resolve() }));

const loadWorldByPath = vi.fn(() => Promise.resolve());

const enqueued: Array<{ meta: Record<string, unknown>; jobId: string }> = [];
vi.mock("../../lib/jobs", () => ({
  enqueueJob: async (meta: Record<string, unknown>, fire: (id: string) => Promise<unknown>) => {
    const jobId = `job-${enqueued.length + 1}`;
    enqueued.push({ meta, jobId });
    await fire(jobId);
    return jobId;
  },
}));

const estimate = (best: number, worst: number) => ({
  scope: "world",
  backends: {},
  llm: { by_task: {}, calls: 1, usd: { best, worst } },
  assets: {
    images: { count: 12, usd: 0 },
    music: { count: 0, usd: 0 },
    sfx: { count: 0, usd: 0 },
    vlm: {},
    usd: { best: 0, worst: 0 },
  },
  total_usd: { best, worst },
  warnings: [],
});

/** Row P0-12: the backend→var map is canon DATA now, so the precheck reads
 *  `canon providers list` instead of a cradle literal. The mock carries only
 *  the rows this suite exercises — and, deliberately, no key value. */
const ROWS = {
  result: "providers",
  providers: [
    {
      id: "anthropic",
      label: "Anthropic",
      env_var: "ANTHROPIC_API_KEY",
      aliases: [],
      unlocks: "LLM generation.",
      backends: { llm: ["anthropic"], vlm: ["anthropic"] },
      docs: "https://example.invalid",
      note: "",
      test: null,
    },
    {
      id: "fal",
      label: "fal.ai",
      env_var: "FAL_KEY",
      aliases: [],
      unlocks: "Images.",
      backends: { image: ["fal"] },
      docs: "https://example.invalid",
      note: "",
      test: null,
    },
  ],
  backend_key_vars: {
    llm: { anthropic: "ANTHROPIC_API_KEY" },
    vlm: { anthropic: "ANTHROPIC_API_KEY" },
    image: { fal: "FAL_KEY" },
  },
};

beforeEach(() => {
  resetPackTemplates();
  resetProviderRows();
  providerRows.mockResolvedValue(ROWS);
  enqueued.length = 0;
  packTemplates.mockResolvedValue({ result: "templates", templates: [PLATFORMER, DUNGEON] });
  estimateWorld.mockResolvedValue({ result: "estimate", estimate: estimate(0, 0) });
  newProject.mockResolvedValue({ job_id: "job-1", status: "queued", pack_dir: "/store/my_world" });
  projectStore.mockResolvedValue({ root: "/store", exists: true });
  providerKeys.mockResolvedValue({ env_file: "/repo/.env", keys: [] });
  confirmSpend.mockResolvedValue(true);
  // The real store, with the one action the modal calls on landing stubbed.
  useStore.setState({ jobs: [], loadWorldByPath } as never);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Render, let the template fetch land, and (optionally) walk to step 2 on a
 *  chosen card. */
async function open(templateId?: string) {
  const onClose = vi.fn();
  render(<NewProjectModal onClose={onClose} />);
  await screen.findByText("Platformer");
  if (templateId) {
    fireEvent.click(document.querySelector(`[data-template="${templateId}"]`)!);
    fireEvent.click(screen.getByText("Continue"));
    // The debounced estimate.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
  }
  return onClose;
}

const count = (field: string) =>
  document.querySelector<HTMLInputElement>(`input[data-count="${field}"]`);

describe("step 1 — the cards are template data", () => {
  it("renders every installed template, with no hardcoded array behind it", async () => {
    await open();
    expect(packTemplates).toHaveBeenCalled();
    const cards = document.querySelectorAll(".tpl-card");
    expect(cards.length).toBe(2);
    expect(screen.getByText("Dungeon crawler")).toBeTruthy();
    // The vocabulary line is the template's, joined — not a TS literal.
    expect(screen.getByText("rooms · encounters · loot")).toBeTruthy();
    // W2.1.4: the dungeon card ships un-badged, because editing is day 1.
    expect(document.querySelector(".tpl-beta")).toBeNull();
  });

  it("says so when canon cannot be asked, instead of falling back to a list", async () => {
    packTemplates.mockRejectedValue(new Error("canon not found"));
    render(<NewProjectModal onClose={() => {}} />);
    expect(await screen.findByTestId("templates-error")).toBeTruthy();
    expect(document.querySelectorAll(".tpl-card").length).toBe(0);
  });
});

describe("step 2 — honest to the generator", () => {
  it("renders the DUNGEON's own count fields, with no Floors anywhere", async () => {
    await open("dungeon");
    // W2.1.1: Rooms + NPCs/Monsters/Items primary…
    expect(count("rooms")!.value).toBe("3");
    expect(count("npc")!.value).toBe("2");
    expect(count("monster")!.value).toBe("2");
    expect(count("item")!.value).toBe("3");
    // …events/quests/classes under Advanced (rendered, inside <details>).
    expect(document.querySelector("details.np-adv")!.contains(count("quest")!)).toBe(true);
    expect(document.querySelector("details.np-adv")!.contains(count("rooms")!)).toBe(false);
    // The UI never promises structure the manifest doesn't have.
    expect(document.body.textContent).not.toContain("Floors");
    expect(document.body.textContent).not.toContain("floor");
  });

  it("renders the PLATFORMER's fields from its own defaults and bands", async () => {
    await open("platformer");
    expect(count("stages")!.value).toBe("1");
    expect(count("levels")!.value).toBe("2");
    expect(count("stages")!.min).toBe("1");
    expect(count("stages")!.max).toBe("8");
    expect(count("rooms")).toBeNull();
  });

  it("sends the counts to the estimator BY CANON'S NAMES, with the template", async () => {
    await open("dungeon");
    fireEvent.change(count("rooms")!, { target: { value: "5" } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    const calls = estimateWorld.mock.calls;
    const last = calls[calls.length - 1][0] as {
      template: string;
      counts: Record<string, number>;
    };
    expect(last.template).toBe("dungeon");
    expect(last.counts.rooms).toBe(5);
    expect(last.counts.npc).toBe(2);
  });

  it("clamps a count to the template's band", async () => {
    await open("dungeon");
    fireEvent.change(count("class")!, { target: { value: "99" } });
    expect(count("class")!.value).toBe("4");
  });
});

describe("the live estimate", () => {
  it("shows $0 for an all-free selection and never raises a spend card", async () => {
    const onClose = await open("platformer");
    await waitFor(() => expect(screen.getByTestId("estimate").textContent).toBe("$0"));
    expect(document.body.textContent).toContain("free preview");
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(newProject).toHaveBeenCalled());
    // Doctrine 3: free NEVER spend-confirms.
    expect(confirmSpend).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the low–high RANGE and confirms the spend once a paid backend is on", async () => {
    estimateWorld.mockResolvedValue({ result: "estimate", estimate: estimate(1.5, 4.25) });
    providerKeys.mockResolvedValue({ env_file: "/repo/.env", keys: ["ANTHROPIC_API_KEY"] });
    await open("platformer");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "anthropic" } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => expect(screen.getByTestId("estimate").textContent).toBe("$1.50–$4.25"));
    await waitFor(() =>
      expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(confirmSpend).toHaveBeenCalled());
  });
});

describe("the provider-key precheck", () => {
  it("disables Create WITH the reason, and deep-links to the offending KEY ROW", async () => {
    await open("platformer");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "anthropic" } });
    const gate = await screen.findByTestId("key-gate");
    expect(gate.textContent).toContain("ANTHROPIC_API_KEY");
    expect(gate.textContent).toContain("/repo/.env");
    const create = screen.getByText("Create") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toContain("ANTHROPIC_API_KEY");

    // Row P0-12's gate clause — "the P0-10 wizard precheck deep-link resolves
    // (closes the inversion)". The link is LIVE now, and it carries the
    // variable so Settings opens focused on that row, not merely open.
    const link = await screen.findByTestId("key-gate-link");
    expect(link).not.toBeDisabled();
    await waitFor(() => expect(link.getAttribute("data-focus-var")).toBe("ANTHROPIC_API_KEY"));
    fireEvent.click(link);
    expect(useStore.getState().settings).toEqual({
      open: true,
      pane: "keys",
      focusVar: "ANTHROPIC_API_KEY",
    });
  });

  it("lets a keyed paid selection through", async () => {
    providerKeys.mockResolvedValue({ env_file: "/repo/.env", keys: ["ANTHROPIC_API_KEY"] });
    await open("platformer");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "anthropic" } });
    await waitFor(() => expect(screen.queryByTestId("key-gate")).toBeNull());
    expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(false);
  });

  it("never gates a free selection", async () => {
    await open("dungeon");
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("key-gate")).toBeNull();
  });
});

describe("create", () => {
  it("goes through the job queue with the template, counts, seed and model", async () => {
    await open("dungeon");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Shadow Keep" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "pin-me" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-x" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(newProject).toHaveBeenCalled());
    // The long-running verb rides the JobQueue — never the UI thread.
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].meta.op).toBe("world");
    const [parent, name, opts] = newProject.mock.calls[0] as [
      string | null,
      string,
      Record<string, unknown>,
    ];
    // null parent = the project store (`~/CradleProjects/`, §8.4).
    expect(parent).toBeNull();
    expect(name).toBe("Shadow Keep");
    expect(opts.template).toBe("dungeon");
    expect(opts.seed).toBe("pin-me");
    expect(opts.model).toBe("claude-x");
    expect((opts.counts as Record<string, number>).rooms).toBe(3);
  });

  it("sends the Advanced location override when one is chosen", async () => {
    await open("platformer");
    fireEvent.click(screen.getByText("Choose…"));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(newProject).toHaveBeenCalled());
    expect(newProject.mock.calls[0][0]).toBe("/picked");
  });

  it("shows the UNIQUIFIED directory the backend chose, not the name it asked for", async () => {
    // Name collisions auto-uniquify instead of hard-erroring (the W2 papercut);
    // only the backend knows the directory it settled on, so the modal reads it
    // off the ack.
    newProject.mockResolvedValue({
      job_id: "job-1",
      status: "queued",
      pack_dir: "/store/my_world_2",
    });
    await open("platformer");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My World" } });
    fireEvent.click(screen.getByText("Create"));
    expect(await screen.findByText("/store/my_world_2")).toBeTruthy();
  });

  it("reports a failed enqueue instead of hanging on 'Starting…'", async () => {
    newProject.mockRejectedValue(new Error("canon not found"));
    await open("platformer");
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(document.querySelector(".np-err")).toBeTruthy());
    expect(document.querySelector(".np-err")!.textContent).toContain("canon not found");
  });
});

describe("⏹ Stop on a create", () => {
  /** Drive the run this modal is watching to a terminal status, the way the
   *  Rust worker's `job-updated` does. */
  const land = async (status: string, result?: Record<string, unknown>) => {
    await act(async () => {
      useStore.setState({
        jobs: [
          {
            id: "job-1",
            op: "world",
            label: "Stopped",
            target: "Stopped",
            targetType: "",
            scope: "world",
            status,
            ts: Date.now(),
            endedAt: Date.now(),
            result,
          } as never,
        ],
      });
    });
  };

  it("a stopped run says what it kept and can be CLOSED", async () => {
    // Before this, a Stop left the modal with no `cancelled` branch: Close
    // stayed disabled on "Working…" and the scrim click was gated off, so the
    // one button the row added stranded the user in an undismissable modal.
    const onClose = await open("platformer");
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(newProject).toHaveBeenCalled());
    await land("cancelled", { kept: ["phase:plat:world", "phase:plat:stage"] });

    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(document.body.textContent).toContain("2 steps kept");
    const close = screen.getByText("Close") as HTMLButtonElement;
    expect(close.disabled).toBe(false);
    // …and ⏹ is gone, because there is nothing left to stop.
    expect(screen.queryByLabelText("Stop this run")).toBeNull();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });

  it("offers the partial tree instead of opening it behind the user", async () => {
    await open("platformer");
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(newProject).toHaveBeenCalled());
    await land("cancelled", { kept: ["phase:plat:world"] });
    expect(loadWorldByPath).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("open-anyway"));
    await waitFor(() => expect(loadWorldByPath).toHaveBeenCalledWith("/store/my_world"));
  });
});

describe("a generator lane the template does not have", () => {
  it("is disabled WITH the reason, and cannot key-gate or spend-confirm", async () => {
    // The dungeon declares no `vlm` lane, so canon answers `--vlm-backend
    // 'anthropic' ignored: dungeon has no vlm generator` and prices the run at
    // $0. A live control there gated Create behind a key the run never uses
    // (doctrine 4) and raised the accent spend card on $0 (doctrine 3).
    providerKeys.mockResolvedValue({ env_file: "/repo/.env", keys: [] });
    await open("dungeon");
    const anim = screen.getByLabelText("Animation") as HTMLSelectElement;
    expect(anim.disabled).toBe(true);
    expect(anim.title).toContain("no animation generator");
    expect(screen.getByTestId("lane-off-vlm")).toBeTruthy();
    // The platformer has the lane, so the same control is live there.
    const other = await open("platformer");
    expect(other).toBeTruthy();
    expect((screen.getAllByLabelText("Animation")[0] as HTMLSelectElement).disabled).toBe(false);
  });

  it("is sent to canon as `none`, never as the stale paid choice", async () => {
    await open("platformer");
    fireEvent.change(screen.getByLabelText("Animation"), { target: { value: "anthropic" } });
    // …then switch to the template with no animation lane.
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(document.querySelector('[data-template="dungeon"]')!);
    fireEvent.click(screen.getByText("Continue"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId("estimate").textContent).toBe("$0");
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(newProject).toHaveBeenCalled());
    expect(confirmSpend).not.toHaveBeenCalled();
    expect((newProject.mock.calls[0][2] as Record<string, unknown>).vlmBackend).toBe("none");
  });
});

describe("count labels are honest about scope", () => {
  it("says PER ROOM where canon multiplies by the room count", async () => {
    await open("dungeon");
    expect(screen.getByLabelText("NPCs per room")).toBeTruthy();
    expect(screen.getByLabelText("Rooms")).toBeTruthy(); // rooms are not per room
  });
});
