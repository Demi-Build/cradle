import { describe, it, expect, beforeEach, vi } from "vitest";

/** The capability gate that keeps a spend card off the screen for a run canon
 *  would refuse. It asks canon, never a list of kinds — so these cases are all
 *  about what canon's answer WAS, and no kind name decides anything. */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import {
  CAPABILITY_PROBE_ID,
  completionBlocked,
  completionUnavailable,
  isNotYetRefusal,
  rememberBlocked,
  resetCompletionGate,
} from "./completionGate";

/** The CLI's structured refusal, exactly as it reaches the frontend: the
 *  message wrapped around the JSON payload the verb emitted. */
const CLI_NOT_YET =
  'canon db failed: {"canon_version":"0.1.0","error":"db complete is not yet available ' +
  "for 'sfx': the kind binds no per-row completion body — Phase 0 §6 registry wiring " +
  '(unassigned in the master) brings it","not_yet":true,"row":"Phase 0 §6 registry wiring"}';

beforeEach(() => {
  resetCompletionGate();
  invokeMock.mockReset();
});

describe("isNotYetRefusal", () => {
  it("dispatches on the CLI's structured payload, not on its prose", () => {
    expect(isNotYetRefusal(new Error(CLI_NOT_YET))).toBe(true);
  });

  it("accepts the agent tools' shape too", () => {
    expect(isNotYetRefusal(new Error('{"error":"not_yet","message":"…","tool":"x"}'))).toBe(true);
  });

  it("is not fooled by an ordinary failure", () => {
    expect(isNotYetRefusal(new Error("sfx 'whistle' not found"))).toBe(false);
    expect(isNotYetRefusal(new Error("canon not on PATH"))).toBe(false);
    expect(isNotYetRefusal(undefined)).toBe(false);
  });
});

describe("completionUnavailable", () => {
  it("says what is missing and what works, in the product's own words", () => {
    const copy = completionUnavailable("Sound effects", "Edit the row by hand.");
    expect(copy).toMatch(/Sound effects/);
    expect(copy).toMatch(/nothing to spend/);
    expect(copy).toMatch(/Edit the row by hand\./);
  });

  it("never cites a planning document", () => {
    const copy = completionUnavailable("Sound effects", "Edit the row by hand.");
    expect(copy).not.toMatch(/Phase|§|row P0|master|PRD/i);
  });
});

describe("completionBlocked", () => {
  it("asks with a backend that cannot spend, and an id no pack allocates", async () => {
    invokeMock.mockResolvedValue({ id: "x", row: {} });
    await completionBlocked("/w", "sfx");
    expect(invokeMock).toHaveBeenCalledWith("db_complete", {
      path: "/w",
      entityType: "sfx",
      id: CAPABILITY_PROBE_ID,
      locked: [],
      llmBackend: "none",
      systemOverride: null,
    });
  });

  it("is blocked when canon answers the structured not-yet", async () => {
    invokeMock.mockRejectedValue(new Error(CLI_NOT_YET));
    expect(await completionBlocked("/w", "sfx")).toBe(true);
  });

  it("is available when the probe gets as far as the row lookup", async () => {
    invokeMock.mockRejectedValue(new Error("enemy '__x__' not found"));
    expect(await completionBlocked("/w", "enemy")).toBe(false);
  });

  it("fails OPEN — a probe that cannot run never greys a working control", async () => {
    invokeMock.mockRejectedValue(new Error("failed to run 'canon': No such file"));
    expect(await completionBlocked("/w", "enemy")).toBe(false);
  });

  it("asks canon once per world+kind", async () => {
    invokeMock.mockRejectedValue(new Error(CLI_NOT_YET));
    await Promise.all([
      completionBlocked("/w", "sfx"),
      completionBlocked("/w", "sfx"),
      completionBlocked("/w", "sfx"),
    ]);
    expect(invokeMock.mock.calls.filter((c) => c[0] === "db_complete")).toHaveLength(1);
    // A different world is a different pack registry, so it asks again.
    await completionBlocked("/other", "sfx");
    expect(invokeMock.mock.calls.filter((c) => c[0] === "db_complete")).toHaveLength(2);
  });

  it("answers without asking when there is no world or kind yet", async () => {
    expect(await completionBlocked("", "sfx")).toBe(false);
    expect(await completionBlocked("/w", "")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("remembers a refusal that arrived from the real run", async () => {
    rememberBlocked("/w", "sfx");
    expect(await completionBlocked("/w", "sfx")).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
