import { describe, it, expect, beforeEach, vi } from "vitest";
import { installDevMock } from "./devMock";

/** The browser mock (`VITE_CRADLE_MOCK=1`) is how the UI is driven without the
 *  native app, so a command it does NOT handle silently resolves to undefined
 *  and the surface just... shows nothing. These cover the two animate-path
 *  commands, which have no native fallback to hide behind in that mode. */
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function mockInvoke(): Invoke {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } };
  delete w.__TAURI_INTERNALS__;
  // ensureData() fetches the mock pack; these commands are pure functions of
  // their args, so an empty payload is enough to reach them.
  vi.stubGlobal("fetch", () => Promise.resolve({ json: () => Promise.resolve({}) }));
  installDevMock();
  return w.__TAURI_INTERNALS__!.invoke!;
}

describe("devMock animate commands", () => {
  let invoke: Invoke;
  beforeEach(() => {
    invoke = mockInvoke();
  });

  it("prices animate BY STATE, and drops the VLM under reuse-spec", async () => {
    const enemy = (await invoke("estimate_animate", {
      target: "enemy:slime",
      imageBackend: "fal",
      vlmBackend: "anthropic",
      reuseSpec: false,
    })) as { estimate: Record<string, never> };
    const est = enemy.estimate as unknown as {
      assets: { images: { count: number; usd: number }; vlm: Record<string, unknown> };
      total_usd: { best: number };
      warnings: string[];
    };
    expect(est.assets.images.count).toBe(4); // idle/walk/hurt/death
    expect(est.assets.images.usd).toBeCloseTo(0.16);
    expect(est.assets.vlm.animation_authoring).toBe(1);
    expect(est.warnings[0]).toMatch(/4 state\(s\)/);

    // The player's own six states — the count tracks the actor, not a constant.
    const player = (await invoke("estimate_animate", {
      target: "player",
      imageBackend: "fal",
      vlmBackend: "anthropic",
    })) as { estimate: { assets: { images: { count: number } } } };
    expect(player.estimate.assets.images.count).toBe(6);

    const reused = (await invoke("estimate_animate", {
      target: "enemy:slime",
      imageBackend: "fake",
      vlmBackend: "anthropic",
      reuseSpec: true,
    })) as { estimate: { assets: { vlm: Record<string, unknown> }; total_usd: { best: number } } };
    expect(reused.estimate.assets.vlm).toEqual({}); // no authoring call
    expect(reused.estimate.total_usd.best).toBe(0); // fake animator = $0
  });

  it("previews the animate authoring prompt as a single vlm-mode string", async () => {
    const p = (await invoke("preview_prompt", {
      kind: "animate",
      target: "enemy:slime",
    })) as { kind: string; label: string; mode: string; prompt: string };
    expect(p.label).toBe("plat:animate");
    // Not "llm": PromptOverride renders `system` for llm kinds and `prompt`
    // for everything else, so the mode decides whether the box has any text.
    expect(p.mode).toBe("vlm");
    expect(p.prompt).toContain("enemy:slime");
    expect(p.prompt).toContain("plat_animate");
  });
});
