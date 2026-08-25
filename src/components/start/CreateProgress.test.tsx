import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreateProgress, phaseLabel, fmtElapsed } from "./CreateProgress";
import type { JobProgress } from "../../lib/invoke";

/** The display that answers "is this still alive?". A paid `world new` is
 *  minutes long, and before this existed the modal said nothing at all — so
 *  the states that matter most are the ones where canon is slow or dead, not
 *  the happy tick-through. */

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
    render(<CreateProgress progress={progress} startedAt={Date.now()} paid />);
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
    render(<CreateProgress progress={progress} startedAt={Date.now()} paid={false} />);
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

  it("renders a phase it has no name for instead of hiding it", () => {
    // Canon owns the node ids; an id added there must not vanish here.
    const progress: JobProgress = {
      total: 1,
      phases: [{ node: "phase:plat:brand_new_thing", status: "running" }],
    };
    render(<CreateProgress progress={progress} startedAt={Date.now()} paid={false} />);
    expect(now()).toBe("Brand new thing");
  });

  it("counts a skipped phase as accounted for, so the bar can reach the end", () => {
    const progress: JobProgress = {
      total: 2,
      phases: [
        { node: "phase:plat:world", status: "done" },
        { node: "phase:plat:audio", status: "skipped" },
      ],
    };
    render(<CreateProgress progress={progress} startedAt={Date.now()} paid={false} />);
    expect(text()).toContain("2 of 2 steps");
  });
});

describe("phaseLabel", () => {
  it("names the phases canon actually runs", () => {
    expect(phaseLabel("phase:plat:sprite_animation")).toBe("Animation");
    expect(phaseLabel("phase:plat:vlm_qa")).toBe("Quality pass");
  });

  it("degrades an unknown id to something readable", () => {
    expect(phaseLabel("phase:plat:some_new_phase")).toBe("Some new phase");
    expect(phaseLabel("mystery")).toBe("Mystery");
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
