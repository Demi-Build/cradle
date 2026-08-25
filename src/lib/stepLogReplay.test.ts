import { describe, it, expect, beforeEach } from "vitest";
// `?raw` rather than node:fs — this project has no @types/node, and Vite
// already inlines the file for us.
import logText from "../test/fixtures/canon-step-log.jsonl?raw";
import { handleJobProgress } from "./jobs";
import { phaseLabel } from "../components/start/CreateProgress";
import { useStore } from "../store";
import type { Job, JobProgressEvent } from "./invoke";

/** Contract test between the two repos.
 *
 *  `canon-step-log.jsonl` is a REAL `.canon/log.jsonl`, copied verbatim from a
 *  `canon world new` run — the same bytes the Rust worker relays line by line.
 *  Replaying it here is what catches canon renaming an event or a field: the
 *  unit tests use hand-written payloads, which agree with whatever this side
 *  believes, and would happily keep passing while the display went blank.
 *
 *  Regenerate with:
 *    canon world new /tmp/fx --stages 1 --levels 2 --enemies 3 --items 2 \
 *      --image-backend fake --music-backend fake --sfx-backend fake
 *    cp /tmp/fx/.canon/log.jsonl src/test/fixtures/canon-step-log.jsonl
 */

const JOB = "job-replay";

const events: JobProgressEvent[] = logText
  .split("\n")
  .filter(Boolean)
  .map((line: string) => ({ id: JOB, ...JSON.parse(line) }) as JobProgressEvent);

const progress = () => useStore.getState().jobs.find((j) => j.id === JOB)?.progress;

beforeEach(() => {
  const job: Job = {
    id: JOB,
    op: "world",
    label: "Fixture",
    target: "Fixture",
    targetType: "",
    status: "running",
    ts: 0,
  };
  useStore.setState({ jobs: [job] });
});

describe("replaying a real canon step log", () => {
  it("is a log worth testing against — phases AND sub-phase items", () => {
    // Guards the fixture itself: a regenerated log that lost its `node_item`
    // records would make every assertion below pass for the wrong reason.
    const names = new Set(events.map((e) => e.event));
    expect(names.has("run_start")).toBe(true);
    expect(names.has("node_item")).toBe(true);
    expect(names.has("run_end")).toBe(true);
  });

  it("folds into a complete run: every phase done, none left running", () => {
    events.forEach(handleJobProgress);
    const p = progress();
    expect(p?.total).toBe(21);
    expect(p?.phases).toHaveLength(21);
    expect(p?.phases.every((x) => x.status === "done")).toBe(true);
    expect(p?.ok).toBe(true);
    expect(p?.endedAt).toBeGreaterThanOrEqual(p?.startedAt ?? 0);
  });

  it("has a human name for every phase canon actually ran", () => {
    // The fallback keeps an unknown id readable, but a phase in the DEFAULT
    // pipeline having no name is a gap worth failing on.
    events.forEach(handleJobProgress);
    const unnamed = (progress()?.phases ?? [])
      .map((x) => x.node)
      .filter((node) => phaseLabel(node) === phaseLabel(`${node}-unknown-suffix`));
    expect(unnamed).toEqual([]);
  });

  it("shows the phase and its item at any point mid-run", () => {
    // Stop at the first sprite-art item — this is the frame a user stares at
    // during a paid run.
    const upto = events.findIndex(
      (e) => e.event === "node_item" && e.node === "phase:plat:sprite_art",
    );
    expect(upto).toBeGreaterThan(0);
    events.slice(0, upto + 1).forEach(handleJobProgress);
    const running = progress()?.phases.filter((x) => x.status === "running") ?? [];
    expect(running).toHaveLength(1);
    expect(phaseLabel(running[0].node)).toBe("Sprite art");
    expect(running[0].item).toBeTruthy();
    expect(running[0].index).toBe(1);
    expect(running[0].itemTotal).toBeGreaterThan(1);
  });

  it("never counts more done than canon promised", () => {
    // The bar's denominator is `run_start.phases`; a fold that opened extra
    // rows would push it past 100% and read as broken.
    for (const e of events) {
      handleJobProgress(e);
      const p = progress();
      if (!p?.total) continue;
      expect(p.phases.length).toBeLessThanOrEqual(p.total);
    }
  });
});
