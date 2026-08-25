import { describe, it, expect, beforeEach } from "vitest";
import { handleJobProgress } from "./jobs";
import { useStore } from "../store";
import type { Job, JobProgressEvent } from "./invoke";

/** The step-log reducer. A generation run reports through canon's
 *  `.canon/log.jsonl`, relayed verbatim by the Rust worker — so this fold is
 *  the only thing standing between a raw event stream and the display that
 *  tells a user their paid run is alive. It has to survive events canon adds
 *  later and events that arrive out of the ideal order. */

const JOB = "job-1";

function seed(): void {
  const job: Job = {
    id: JOB,
    op: "world",
    label: "My Platformer",
    target: "My Platformer",
    targetType: "",
    status: "queued",
    ts: 0,
  };
  useStore.setState({ jobs: [job] });
}

const fire = (e: Omit<JobProgressEvent, "id">) => handleJobProgress({ id: JOB, ...e });
const progress = () => useStore.getState().jobs.find((j) => j.id === JOB)?.progress;

describe("handleJobProgress", () => {
  beforeEach(seed);

  it("takes the phase count from run_start, so the bar has a denominator", () => {
    fire({ event: "run_start", phases: 21 });
    expect(progress()?.total).toBe(21);
  });

  it("tracks a phase from start to done, in canon's order", () => {
    fire({ event: "node_start", node: "phase:plat:world" });
    fire({ event: "node_done", node: "phase:plat:world" });
    fire({ event: "node_start", node: "phase:plat:stage" });
    expect(progress()?.phases.map((p) => [p.node, p.status])).toEqual([
      ["phase:plat:world", "done"],
      ["phase:plat:stage", "running"],
    ]);
  });

  it("carries the sub-phase item and its count — the paid run's heartbeat", () => {
    fire({ event: "node_start", node: "phase:plat:sprite_art" });
    fire({
      event: "node_item",
      node: "phase:plat:sprite_art",
      item: "Cinder Beetle",
      index: 3,
      total: 15,
    });
    expect(progress()?.phases[0]).toMatchObject({
      status: "running",
      item: "Cinder Beetle",
      index: 3,
      itemTotal: 15,
    });
  });

  it("drops the item when the phase finishes", () => {
    // A done phase must read as the phase, not as whichever sprite was last.
    fire({ event: "node_start", node: "phase:plat:sprite_art" });
    fire({ event: "node_item", node: "phase:plat:sprite_art", item: "Ash Wraith", index: 1 });
    fire({ event: "node_done", node: "phase:plat:sprite_art" });
    expect(progress()?.phases[0]).toMatchObject({ status: "done" });
    expect(progress()?.phases[0].item).toBeUndefined();
  });

  it("opens a row for a node it never saw start", () => {
    // A resumed run, or a read that missed a line: dropping the event would
    // hide the only phase actually running.
    fire({ event: "node_item", node: "phase:plat:audio", item: "stage_1 · music" });
    expect(progress()?.phases).toHaveLength(1);
    expect(progress()?.phases[0]).toMatchObject({
      node: "phase:plat:audio",
      status: "running",
      item: "stage_1 · music",
    });
  });

  it("records a failed phase without losing the phases before it", () => {
    fire({ event: "node_done", node: "phase:plat:world" });
    fire({ event: "node_failed", node: "phase:plat:sprite_art" });
    expect(progress()?.phases.map((p) => p.status)).toEqual(["done", "failed"]);
  });

  it("keeps a skip visible, with its reason", () => {
    fire({ event: "node_skipped", node: "phase:plat:audio", reason: "unchanged" });
    expect(progress()?.phases[0]).toMatchObject({ status: "skipped", item: "unchanged" });
  });

  it("closes the run on run_end", () => {
    fire({ event: "run_start", phases: 2, ts: "2026-08-03T21:55:29.000+00:00" });
    fire({ event: "run_end", ok: true, ts: "2026-08-03T21:55:39.000+00:00" });
    const p = progress();
    expect(p?.ok).toBe(true);
    expect((p?.endedAt ?? 0) - (p?.startedAt ?? 0)).toBe(10_000);
  });

  it("ignores an event for a job this session never enqueued", () => {
    handleJobProgress({ id: "someone-elses-job", event: "run_start", phases: 21 });
    expect(progress()).toBeUndefined();
  });

  it("ignores an event name it doesn't model, leaving state untouched", () => {
    // Canon owns the event vocabulary and may grow it; an unknown name must
    // not blank the display.
    fire({ event: "node_start", node: "phase:plat:world" });
    fire({ event: "some_future_event", node: "phase:plat:world" });
    expect(progress()?.phases).toEqual([{ node: "phase:plat:world", status: "running" }]);
  });
});
