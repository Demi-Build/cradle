import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (s: string) => s,
}));

import { CreateProgress } from "./CreateProgress";
import { fmtElapsed, phaseLabel } from "./createProgressCopy";
import type { JobProgress } from "../../lib/invoke";
import type { PackTemplate } from "../../lib/packTemplates";

/** The display that answers "is this still alive?". A paid `world new` is
 *  minutes long, and before this existed the modal said nothing at all — so
 *  the states that matter most are the ones where canon is slow or dead, not
 *  the happy tick-through.
 *
 *  Row P0-10: the phase NAMES are template data now (master §3.0-E). Every
 *  render below passes the template whose run it is showing, exactly as
 *  NewProjectModal does — the fallback (no template knows the id) is its own
 *  test, because a phase canon adds must still render. */

const template = (id: string, phase_labels: Record<string, string>): PackTemplate => ({
  id,
  label: id,
  description: "",
  vocab: [],
  defaults: {},
  ranges: null,
  advanced: [],
  engine: [],
  dimension: "2D",
  distribution: [],
  beta: false,
  phase_labels,
  generators: [],
  count_scope: {},
});

const PLATFORMER = template("platformer", {
  "plat:world": "World premise",
  "plat:stage": "Stages",
  "plat:sprite_art": "Sprite art",
  "plat:sprite_animation": "Animation",
  "plat:vlm_qa": "Quality pass",
  "plat:audio": "Music & SFX",
});

const DUNGEON = template("dungeon", {
  "db:npc": "NPCs",
  maze_layout: "Room layouts",
  manifest: "Manifest",
});

const TEMPLATES = [PLATFORMER];

const text = () => document.querySelector(".cp")?.textContent ?? "";
/** The headline specifically — a phase name deliberately appears twice (there
 *  and in the checklist), so assertions have to say which one they mean. */
const now = () => document.querySelector(".cp-now")?.textContent ?? "";

describe("CreateProgress", () => {
  it("says canon is STARTING before the first event, rather than showing 0%", () => {
    render(<CreateProgress startedAt={Date.now()} paid={false} />);
    expect(screen.getByText("Starting canon…")).toBeTruthy();
    // No denominator yet — the bar sweeps instead of sitting at zero.
    expect(document.querySelector(".cp-bar-fill.idle")).toBeTruthy();
    expect(text()).toContain("counting steps…");
  });

  it("names the running phase and the item it is waiting on", () => {
    const progress: JobProgress = {
      total: 21,
      phases: [
        { node: "phase:plat:world", status: "done" },
        {
          node: "phase:plat:sprite_art",
          status: "running",
          item: "Cinder Beetle",
          index: 3,
          itemTotal: 15,
        },
      ],
    };
    render(
      <CreateProgress progress={progress} startedAt={Date.now()} paid templates={TEMPLATES} />,
    );
    expect(now()).toBe("Sprite art");
    expect(screen.getByText("Cinder Beetle")).toBeTruthy();
    expect(text()).toContain("3 / 15");
    expect(text()).toContain("1 of 21 steps");
    expect(text()).toContain("paid backends");
  });

  it("names the last finished phase between two phases, not 'Working…'", () => {
    // Nothing is `running` in the gap between node_done and the next
    // node_start; throwing the name away there is worse than keeping it.
    const progress: JobProgress = {
      total: 21,
      phases: [
        { node: "phase:plat:world", status: "done" },
        { node: "phase:plat:stage", status: "done" },
      ],
    };
    render(
      <CreateProgress
        progress={progress}
        startedAt={Date.now()}
        paid={false}
        templates={TEMPLATES}
      />,
    );
    expect(now()).toBe("Stages");
    expect(text()).not.toContain("Working…");
  });

  it("shows the failure and keeps the phases that DID run", () => {
    const progress: JobProgress = {
      total: 21,
      phases: [
        { node: "phase:plat:world", status: "done" },
        { node: "phase:plat:sprite_art", status: "failed" },
      ],
    };
    render(
      <CreateProgress
        progress={progress}
        startedAt={Date.now()}
        paid
        templates={TEMPLATES}
        error={"canon world new failed: fal: 401"}
      />,
    );
    // WHERE it stopped, not THAT it stopped — the modal heading says that.
    expect(now()).toBe("Stopped in Sprite art");
    expect(text()).toContain("canon world new failed: fal: 401");
    expect(screen.getByText("World premise")).toBeTruthy();
    // The paid nag is a live-run instruction — pointless once it stopped.
    expect(text()).not.toContain("don't close cradle");
    // And nothing may still look busy.
    expect(document.querySelector(".cp-spin")).toBeNull();
    expect(document.querySelector(".cp-bar-fill.idle")).toBeNull();
  });

  it("says where a run died even when it died before any phase started", () => {
    // The fal-key crash happens before canon emits a single event; "Stopped
    // before the first step" is the only true thing to say, and saying it
    // beats a spinner that implies work is still happening.
    render(
      <CreateProgress startedAt={Date.now()} paid error={"canon world new failed: no FAL_KEY"} />,
    );
    expect(now()).toBe("Stopped before the first step");
    expect(text()).toContain("no steps completed");
    expect(document.querySelector(".cp-spin")).toBeNull();
  });

  it("renders a phase no template names instead of hiding it", () => {
    // Canon owns the node ids; an id no installed template labels must not
    // vanish here — it renders de-prefixed and humanized.
    const progress: JobProgress = {
      total: 1,
      phases: [{ node: "phase:plat:brand_new_thing", status: "running" }],
    };
    render(
      <CreateProgress
        progress={progress}
        startedAt={Date.now()}
        paid={false}
        templates={TEMPLATES}
      />,
    );
    expect(now()).toBe("Brand new thing");
  });

  it("names a DUNGEON run's phases from the dungeon template's own map", () => {
    // §3.0-E, master S5: one component, one reader, no second hardcoded list —
    // the dungeon's ids carry no `plat:` prefix and still read as English.
    const progress: JobProgress = {
      total: 15,
      phases: [
        { node: "phase:maze_layout", status: "done" },
        { node: "phase:db:npc", status: "running", item: "room_0 · npc 1", index: 1, itemTotal: 4 },
      ],
    };
    render(
      <CreateProgress
        progress={progress}
        startedAt={Date.now()}
        paid={false}
        templates={[DUNGEON]}
      />,
    );
    expect(now()).toBe("NPCs");
    expect(screen.getByText("Room layouts")).toBeTruthy();
    expect(text()).toContain("1 / 4");
  });

  it("counts a skipped phase as accounted for, so the bar can reach the end", () => {
    const progress: JobProgress = {
      total: 2,
      phases: [
        { node: "phase:plat:world", status: "done" },
        { node: "phase:plat:audio", status: "skipped" },
      ],
    };
    render(
      <CreateProgress
        progress={progress}
        startedAt={Date.now()}
        paid={false}
        templates={TEMPLATES}
      />,
    );
    expect(text()).toContain("2 of 2 steps");
  });
});

describe("CreateProgress · post-create asset summary", () => {
  const finished: JobProgress = {
    phases: [{ node: "phase:assets", status: "done" }],
    total: 1,
    endedAt: Date.now(),
    ok: true,
  };
  const withFailures = {
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
  };

  it("reads the run's stats once it is over and says what did not land", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "read_world_json" && args?.name === "generation_stats") {
        return Promise.resolve(withFailures);
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    render(
      <CreateProgress progress={finished} startedAt={Date.now()} paid ended packDir="/p" />,
    );
    const summary = await screen.findByTestId("cp-asset-summary");
    expect(summary.textContent).toContain("44 images · 43 landed · 1 failed");
    expect(summary.textContent).toContain("4 sfx · all landed — see list");
    // the list is right there, one click away
    expect(screen.getByText("npc:1003")).toBeInTheDocument();
    expect(screen.getByText(/repair with/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("read_world_json", { path: "/p", name: "generation_stats" });
  });

  it("says every asset landed when the stats carry no failures", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ images_succeeded: 50, failures: [] });
    render(
      <CreateProgress progress={finished} startedAt={Date.now()} paid ended packDir="/p" />,
    );
    const summary = await screen.findByTestId("cp-asset-summary");
    expect(summary.textContent).toBe("50 images · all landed");
    expect(screen.queryByTestId("asset-failures")).toBeNull();
  });

  it("never says all landed for a stats file that carries no failure list", async () => {
    // The real paid pack's shape: no `failures` key, 26 assets short. The
    // line reads what the file knows and shows the 0/8 music lane.
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      images_attempted: 50,
      images_succeeded: 43,
      music_attempted: 8,
      music_succeeded: 0,
      sfx_attempted: 15,
      sfx_succeeded: 4,
    });
    render(
      <CreateProgress progress={finished} startedAt={Date.now()} paid ended packDir="/p" />,
    );
    const summary = await screen.findByTestId("cp-asset-summary");
    expect(summary.textContent).toBe(
      "43 images landed of 50 attempted / 0 music landed of 8 attempted / 4 sfx landed of 15 attempted",
    );
    expect(summary.textContent).not.toContain("all landed");
  });

  it("reads nothing while the run is still going, and nothing without a folder", () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(withFailures);
    const running: JobProgress = { phases: [{ node: "phase:assets", status: "running" }], total: 1 };
    render(<CreateProgress progress={running} startedAt={Date.now()} paid packDir="/p" />);
    render(<CreateProgress progress={finished} startedAt={Date.now()} paid ended />);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cp-asset-summary")).toBeNull();
  });

  it("stays silent about assets when the stats cannot be read", async () => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValue(new Error("no such file"));
    render(
      <CreateProgress progress={finished} startedAt={Date.now()} paid ended packDir="/p" />,
    );
    await screen.findByText("Finished");
    expect(screen.queryByTestId("cp-asset-summary")).toBeNull();
  });
});

describe("phaseLabel", () => {
  it("names phases from TEMPLATE DATA, for either template", () => {
    expect(phaseLabel("phase:plat:sprite_animation", TEMPLATES)).toBe("Animation");
    expect(phaseLabel("phase:plat:vlm_qa", TEMPLATES)).toBe("Quality pass");
    expect(phaseLabel("phase:db:npc", [DUNGEON])).toBe("NPCs");
    // A surface that doesn't know which template a job belongs to (the job
    // tray) passes every installed map; the one that knows the id wins.
    expect(phaseLabel("phase:maze_layout", [PLATFORMER, DUNGEON])).toBe("Room layouts");
  });

  it("names the orchestrator's per-artifact nodes from the same map", () => {
    // The create default emits 41 of these against 14 plain phases: a
    // `<family>:<leaf>` entry names the layer and the id's own context rides
    // along, and a bare `<family>` entry names the whole node. Ten entries
    // instead of one per level — and NOTHING template-specific in this build.
    const plat = template("platformer", {
      "level:terrain": "Terrain",
      review: "Review",
      "review:legend": "Legend review",
    });
    expect(phaseLabel("level:ashen_depths/l1/terrain", [plat])).toBe("Terrain · ashen_depths/l1");
    expect(phaseLabel("review:ashen_depths/l2", [plat])).toBe("Review · ashen_depths/l2");
    expect(phaseLabel("review:legend", [plat])).toBe("Legend review");
    // A layer the map doesn't name still degrades, it doesn't vanish.
    expect(phaseLabel("level:ashen_depths/l1/hazards", [plat])).toBe("Ashen depths/l1/hazards");
  });

  it("degrades an id no template names to something readable", () => {
    expect(phaseLabel("phase:plat:some_new_phase", TEMPLATES)).toBe("Some new phase");
    expect(phaseLabel("mystery", TEMPLATES)).toBe("Mystery");
    // And with no templates loaded at all, rather than rendering nothing.
    expect(phaseLabel("phase:plat:sprite_animation")).toBe("Sprite animation");
  });
});

describe("fmtElapsed", () => {
  it("reads as a clock, and grows an hours field only when needed", () => {
    expect(fmtElapsed(0)).toBe("0:00");
    expect(fmtElapsed(9_000)).toBe("0:09");
    expect(fmtElapsed(605_000)).toBe("10:05");
    expect(fmtElapsed(3_725_000)).toBe("1:02:05");
  });
});
