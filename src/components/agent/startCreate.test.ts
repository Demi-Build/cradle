import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { useStore } from "../../store";
import type { PackTemplate } from "../../lib/packTemplates";
import {
  beginCreate,
  currentCreate,
  measuredCreateCost,
  resetStartCreate,
  settleCreate,
} from "./startCreate";

/** The money a start-page create records — the same contract as the wizard's
 *  modal, on the module that settles a create the user walked away from.
 *
 *  What is pinned here:
 *  - the actual comes from the create verb's own `actual_usd` first, then the
 *    tree's STANDALONE `generation_stats.json` (the only stats record a
 *    platformer writes — reading only the dungeon's embedded manifest block
 *    recorded $0 for a $2.60 run), then that embedded block as a fallback;
 *  - an unmeasured run OMITS `actual_usd` from both rows and says so, so it
 *    can never be mistaken for a measured $0;
 *  - a failed create — the outcome that used to record nothing — writes both
 *    rows with `status: failed`, and so does a stopped one.
 *
 *  Headless and $0: `new_project` is mocked; nothing runs. */

const PACK_DIR = "/Users/me/CradleProjects/harbour";
const PLATFORMER = {
  id: "platformer",
  label: "Platformer",
  description: "",
  vocab: [],
  defaults: { stages: 1, levels: 2, enemies: 4, items: 4 },
  ranges: null,
  advanced: [],
  engine: ["godot"],
  dimension: "2D",
  distribution: [],
  beta: false,
  phase_labels: {},
  generators: ["llm", "image", "music", "sfx", "vlm"],
  count_scope: {},
} as unknown as PackTemplate;
const BACKENDS = { llm: "anthropic", image: "fal", music: "none", sfx: "none", vlm: "none" };

type Disk = Record<string, unknown | Error>;

/** Answer `read_world_json` by NAME from a fake pack layout; a name that is
 *  not on disk rejects, exactly as the Rust command does. */
function onDisk(files: Disk) {
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "new_project":
        return Promise.resolve({ job_id: args?.jobId, status: "queued", pack_dir: PACK_DIR });
      case "read_world_json": {
        const hit = files[String(args?.name)];
        if (hit === undefined) return Promise.reject(new Error(`no ${String(args?.name)}.json`));
        return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit);
      }
      case "spend_record":
      case "jobs_record":
        return Promise.resolve({ result: "ok" });
      default:
        return Promise.resolve({});
    }
  });
}

const rows = (cmd: string) =>
  invokeMock.mock.calls
    .filter(([c]) => c === cmd)
    .map(([, args]) => args as { path: string; entry: Record<string, unknown> });

async function inFlight(): Promise<string> {
  return beginCreate({
    name: "Harbour",
    template: PLATFORMER,
    counts: { stages: 1, levels: 2, enemies: 4, items: 4 },
    backends: BACKENDS,
    estimateUsd: { best: 2.5, worst: 3.1 },
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  resetStartCreate();
  useStore.setState({ jobs: [] } as never);
});

describe("measuredCreateCost — the one reader every create settle shares", () => {
  it("takes the verb's figure first, even over a file that says otherwise", async () => {
    onDisk({ generation_stats: { total_cost_usd: 9.99 } });
    expect(await measuredCreateCost(PACK_DIR, { actual_usd: 1.25 })).toEqual({ actual_usd: 1.25 });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("then the standalone generation_stats.json, with no manifest block needed", async () => {
    onDisk({ generation_stats: { total_cost_usd: 2.6 }, manifest: { seed: "x" } });
    expect(await measuredCreateCost(PACK_DIR, { changed: true })).toEqual({ actual_usd: 2.6 });
    expect(invokeMock).toHaveBeenCalledWith("read_world_json", { path: PACK_DIR, name: "generation_stats" });
  });

  it("then a dungeon manifest's embedded copy, as the fallback only", async () => {
    onDisk({ manifest: { generation_stats: { total_cost_usd: 3.0 } } });
    expect(await measuredCreateCost(PACK_DIR)).toEqual({ actual_usd: 3.0 });
  });

  it("and with neither answers a warning, never a zero", async () => {
    onDisk({ manifest: { seed: "x" } });
    const money = await measuredCreateCost(PACK_DIR, { changed: true });
    expect(money.actual_usd).toBeUndefined();
    expect(money.warning).toContain("generation_stats.json");
    expect(money.warning).toContain("unmeasured");
  });
});

describe("settleCreate — both ledgers, in the created pack, for every ending", () => {
  it("records the verb's actual on a landed run", async () => {
    onDisk({ generation_stats: { total_cost_usd: 9.99 } });
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "ok", result: { changed: true, actual_usd: 1.25 }, ts: 1, endedAt: 5 });
    expect(currentCreate().status).toBe("done");
    expect(rows("spend_record")).toHaveLength(1);
    expect(rows("spend_record")[0].path).toBe(PACK_DIR);
    expect(rows("spend_record")[0].entry).toMatchObject({ op: "world", actual_usd: 1.25 });
    expect(rows("jobs_record")[0].entry).toMatchObject({ job_id: jobId, status: "ok", actual_usd: 1.25 });
    expect(currentCreate().warnings).toEqual([]);
  });

  it("reads a platformer's standalone stats file when the result carries none", async () => {
    onDisk({ generation_stats: { total_cost_usd: 2.6 }, manifest: { seed: "x" } });
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "ok", result: { changed: true } });
    expect(rows("spend_record")[0].entry.actual_usd).toBe(2.6);
    expect(rows("jobs_record")[0].entry.actual_usd).toBe(2.6);
  });

  it("omits actual_usd from both rows and warns when nothing measured the run", async () => {
    onDisk({ manifest: { seed: "x" } });
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "ok", result: { changed: true } });
    expect(currentCreate().status).toBe("done");
    expect("actual_usd" in rows("spend_record")[0].entry).toBe(false);
    expect("actual_usd" in rows("jobs_record")[0].entry).toBe(false);
    expect(currentCreate().warnings).toHaveLength(1);
    expect(currentCreate().warnings[0]).toMatch(/generation_stats\.json.*unmeasured/);
  });

  it("records a FAILED create in both ledgers, with what its stats file holds", async () => {
    onDisk({ generation_stats: { total_cost_usd: 1.7 } });
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "failed", error: "provider timed out", ts: 1, endedAt: 9 });
    expect(currentCreate().status).toBe("failed");
    expect(currentCreate().error).toBe("provider timed out");
    expect(rows("spend_record")[0].entry).toMatchObject({ op: "world", actual_usd: 1.7 });
    expect(rows("jobs_record")[0].entry).toMatchObject({
      status: "failed",
      actual_usd: 1.7,
      changed: false,
      error: "provider timed out",
      duration_ms: 8,
    });
  });

  it("records a failed create with no stats as unmeasured, never as $0", async () => {
    onDisk({});
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "failed", error: "boom" });
    expect(rows("jobs_record")[0].entry.status).toBe("failed");
    expect("actual_usd" in rows("jobs_record")[0].entry).toBe(false);
    expect("actual_usd" in rows("spend_record")[0].entry).toBe(false);
    expect(currentCreate().warnings[0]).toContain("unmeasured");
  });

  it("records a STOPPED create too — it billed what it billed", async () => {
    onDisk({});
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "cancelled", result: { cancelled: true, kept: ["phase:plat:world"] } });
    expect(currentCreate().status).toBe("stopped");
    expect(currentCreate().kept).toEqual(["phase:plat:world"]);
    expect(rows("jobs_record")[0].entry).toMatchObject({ status: "cancelled", changed: true });
    expect("actual_usd" in rows("spend_record")[0].entry).toBe(false);
  });

  it("never bills a run twice", async () => {
    onDisk({ generation_stats: { total_cost_usd: 2.6 } });
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "ok", result: { changed: true } });
    await settleCreate({ id: jobId, status: "ok", result: { changed: true } });
    expect(rows("spend_record")).toHaveLength(1);
    expect(rows("jobs_record")).toHaveLength(1);
  });

  it("has nowhere to record a run that never got a folder", async () => {
    onDisk({});
    resetStartCreate();
    // A create refused at enqueue: no pack dir was ever acknowledged.
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "new_project" ? Promise.reject(new Error("permission denied")) : Promise.resolve({}),
    );
    const jobId = await inFlight();
    await settleCreate({ id: jobId, status: "failed", error: "permission denied" });
    expect(currentCreate().status).toBe("failed");
    expect(rows("spend_record")).toHaveLength(0);
    expect(rows("jobs_record")).toHaveLength(0);
  });
});
