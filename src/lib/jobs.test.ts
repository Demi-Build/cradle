import { describe, it, expect, vi, afterEach } from "vitest";
import { missingKeysFor, BACKEND_KEYS } from "./jobs";
import { api } from "./invoke";

/** The pre-flight exists so a paid job fails BEFORE the confirm rather than
 *  deep inside a provider. That only holds if it mirrors canon's own key
 *  checks — too strict and it blocks a working setup, too loose and it hands
 *  the confusing provider error back. */
function keysPresent(keys: string[], env_file: string | null = "/w/.env") {
  vi.spyOn(api, "providerKeys").mockResolvedValue({ env_file, keys });
}

afterEach(() => vi.restoreAllMocks());

describe("missingKeysFor", () => {
  it("passes free backends without asking for anything", async () => {
    const spy = vi.spyOn(api, "providerKeys");
    expect(await missingKeysFor({ image: "fake", vlm: "none" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts EITHER spelling a backend supports", async () => {
    // canon's _build_backend takes FAL_KEY *or* the id/secret pair, and
    // PIXELLAB_SECRET *or* PIXELLAB_API_KEY. Rejecting the second spelling
    // would block a setup that runs fine.
    keysPresent(["FAL_KEY_ID", "FAL_KEY_SECRET"]);
    expect(await missingKeysFor({ image: "fal" })).toBeNull();
    keysPresent(["PIXELLAB_SECRET"]);
    expect(await missingKeysFor({ image: "pixellab" })).toBeNull();
  });

  it("rejects a partial key set", async () => {
    // FAL_KEY_ID alone satisfies neither alternative.
    keysPresent(["FAL_KEY_ID"]);
    expect(await missingKeysFor({ image: "fal" })).toMatch(/missing FAL_KEY/);
  });

  it("names every unsatisfied backend of a multi-backend job", async () => {
    // The animate path can pair a pixellab sprite with a fal animator, so one
    // job really can need three providers at once.
    keysPresent(["FAL_KEY"]);
    const msg = await missingKeysFor({ image: "fal", sprite: "pixellab", vlm: "anthropic" });
    expect(msg).toMatch(/PIXELLAB_SECRET/);
    expect(msg).toMatch(/ANTHROPIC_API_KEY/);
    expect(msg).not.toMatch(/FAL_KEY/); // satisfied — not reported
    expect(msg).toMatch(/\/w\/\.env/); // says WHERE cradle looked
  });

  it("lets the job try when it cannot tell (browser mock)", async () => {
    vi.spyOn(api, "providerKeys").mockRejectedValue(new Error("no native backend"));
    expect(await missingKeysFor({ image: "fal" })).toBeNull();
  });

  it("every mapped backend lists at least one non-empty key set", () => {
    for (const [backend, sets] of Object.entries(BACKEND_KEYS)) {
      expect(sets.length, backend).toBeGreaterThan(0);
      for (const set of sets) expect(set.length, backend).toBeGreaterThan(0);
    }
  });
});
