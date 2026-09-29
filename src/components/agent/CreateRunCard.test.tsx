import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (s: string) => s,
}));
vi.mock("../../lib/packTemplates", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/packTemplates")>()),
  usePackTemplates: () => ({ templates: [], loading: false, error: null }),
}));

const PACK_DIR = "/projects/wounded";
/** The create as the card reads it: a finished dungeon run. One object the
 *  tests vary per case — hoisted, because the mock factory below runs before
 *  this file's body does. */
const { create } = vi.hoisted(() => ({
  create: {
    status: "done",
    jobId: "job-1",
    name: "Wounded",
    template: "dungeon",
    packDir: "/projects/wounded",
    startedAt: Date.now() - 60_000,
    backends: { image: "fal", music: "lyria", sfx: "elevenlabs" },
    estimateUsd: { best: 2, worst: 4 },
    error: null as string | null,
    kept: [] as string[],
    warnings: [] as string[],
    progress: {
      phases: [{ node: "phase:assets", status: "done" }],
      total: 1,
      endedAt: Date.now(),
      ok: true,
    },
  },
}));
vi.mock("./startCreate", () => ({
  useStartCreate: () => create,
  stopCreate: vi.fn(),
  openCreated: vi.fn(),
  isPaidSelection: () => true,
}));

import { CreateRunCard } from "./CreateRunCard";

/** The panel's create card is the one place a start-page create is still on
 *  screen once it is over — so it is where a run that lost assets has to say
 *  so. The card passes the create's folder to `CreateProgress`, which reads
 *  that tree's generation_stats for the post-create line; without the folder
 *  the line was dead in both places that render the card. */
describe("CreateRunCard · post-create asset summary", () => {
  it("hands the create's folder to the progress card, which reads its stats and names what did not land", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "read_world_json" && args?.name === "generation_stats") {
        return Promise.resolve({
          images_succeeded: 43,
          sfx_succeeded: 4,
          failures: [
            {
              kind: "image",
              target: "npc:1003",
              provider: "fal",
              message: "502 bad gateway",
              status: 502,
              retryable: true,
              attempts: 4,
              hint: "transient fal failure; repair with `asset generate --target missing`.",
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    render(<CreateRunCard />);
    const summary = await screen.findByTestId("cp-asset-summary");
    expect(summary.textContent).toContain("44 images · 43 landed · 1 failed");
    expect(screen.getByText("npc:1003")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("read_world_json", {
      path: PACK_DIR,
      name: "generation_stats",
    });
  });
});

/** A run that never reached its manifest phase has no stats file, so its
 *  cost is UNKNOWN — the ledgers omit `actual_usd` and the create keeps the
 *  reason in `warnings`. That reason used to live only in state: the card
 *  showed a clean outcome over a spend nobody measured. */
describe("CreateRunCard · the unmeasured-spend note", () => {
  afterEach(() => {
    create.warnings = [];
  });

  it("renders the create's warnings as a note — cost unknown is not an error", () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.reject(new Error("no such file")));
    create.warnings = [
      "no generation_stats.json under /projects/wounded: the run's cost is unmeasured (not $0), so no actual_usd is reported",
    ];
    render(<CreateRunCard />);
    const note = screen.getByTestId("create-warnings");
    expect(note.textContent).toContain("unmeasured");
    expect(note.textContent).toContain("generation_stats.json");
    // Calm: the note's chrome is the panel's plain note, and the card is
    // still a finished one — the state and headline say nothing failed.
    expect(note.className).toBe("ag-note");
    expect(screen.getByTestId("create-run-card").getAttribute("data-state")).toBe("done");
    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("renders no note when there is nothing unmeasured", () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.reject(new Error("no such file")));
    render(<CreateRunCard />);
    expect(screen.queryByTestId("create-warnings")).toBeNull();
  });
});
