import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** Row P1-A6 — the JobTray's DURABLE history (the C11 adjacent fix).
 *
 *  `jobs_list` / `jobs_record` existed only in the browser dev-mock, so on the
 *  real app the Completed tab lost every run at quit and agent-launched runs
 *  never joined button-launched ones. Both are native now, and this holds the
 *  read side: the tray merges this session's jobs with the ledger, keeps a past
 *  session's attribution from the ledger's `identity` lane field, and renders
 *  `cancelled` — a STATUS VALUE the ledger gained, not a new schema. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { JobTray } from "./JobTray";
import type { JobEntry } from "../lib/invoke";
import { agentActor } from "../lib/actor";
import { useStore } from "../store";

const LEDGER: JobEntry[] = [
  {
    schema: "cradle-jobs/v1",
    ts: "2026-09-12T10:00:00Z",
    job_id: "past-agent",
    op: "sprite",
    target: "ember_hopper",
    target_type: "enemies",
    status: "ok",
    changed: true,
    actual_usd: 0.04,
    // The lane fields row A6 added — this is what keeps attribution alive
    // across an app restart.
    identity: agentActor("wick", "artist"),
    session: "wick",
  },
  {
    schema: "cradle-jobs/v1",
    ts: "2026-09-12T09:00:00Z",
    job_id: "past-you",
    op: "improve",
    target: "l1",
    target_type: "levels",
    status: "cancelled",
    changed: false,
    identity: "user",
  },
];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "jobs_list") {
      return Promise.resolve({
        result: "jobs_list",
        jobs: { count: LEDGER.length, by_op: {}, by_status: {}, entries: LEDGER },
      });
    }
    return Promise.resolve(null);
  });
  useStore.setState({ worldPath: "/w", jobs: [], jobsOpen: true });
});

describe("JobTray durable history", () => {
  it("reads the native ledger and shows past runs in Completed", async () => {
    render(<JobTray />);
    // Completed counts the ledger rows even with nothing enqueued this session.
    const tab = await screen.findByText(/Completed \(2\)/);
    tab.click();
    expect(await screen.findByText(/ember_hopper/)).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("jobs_list", { path: "/w" });
  });

  it("keeps a past session's attribution from the ledger's identity field", async () => {
    render(<JobTray />);
    (await screen.findByText(/Completed \(2\)/)).click();
    const rows = await screen.findAllByTestId("job-row");
    const text = rows.map((r) => r.textContent ?? "").join("\n");
    expect(text).toContain("Artist"); // agent:wick/artist → the specialist label
    expect(text).toContain("you"); // the editor door
  });

  it("renders a cancelled run — a status VALUE, not a schema change", async () => {
    render(<JobTray />);
    (await screen.findByText(/Completed \(2\)/)).click();
    const rows = await screen.findAllByTestId("job-row");
    expect(rows.map((r) => r.textContent ?? "").join("\n")).toContain("stopped");
  });

  it("a ledger read failure leaves the tray usable rather than blank-crashing", async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error("no canon")));
    render(<JobTray />);
    expect(await screen.findByText(/Completed/)).toBeTruthy();
    expect(screen.getByText(/No jobs running/)).toBeTruthy();
  });
});
