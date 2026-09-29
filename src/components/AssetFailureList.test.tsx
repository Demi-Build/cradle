import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetFailureList } from "./AssetFailureList";
import {
  assetFamilyCell,
  assetSummaryLine,
  summarizeAssets,
  type AssetStats,
} from "./assetFailureSummary";

/** A `generation_stats.json` the shape canon writes after a paid run that
 *  lost assets: the counters it has always carried plus the `failures` list
 *  its executor records — one per asset that stayed missing after retries. */
const PAID_RUN: AssetStats = {
  images_succeeded: 43,
  music_succeeded: 0,
  sfx_succeeded: 4,
  failures: [
    {
      kind: "music",
      target: "music:combat",
      path: "music/combat.mp3",
      provider: "lyria",
      error: "APIError",
      message: "PERMISSION_DENIED: billing is not enabled",
      status: 403,
      retryable: false,
      attempts: 1,
      hint: "lyria refused the credential or the billing account: check the lyria key and plan, then repair with `asset generate --target missing`.",
    },
    {
      kind: "sfx",
      target: "sfx:door_open",
      path: "sfx/door_open.mp3",
      provider: "elevenlabs",
      error: "ApiError",
      message: "too many concurrent requests",
      status: 429,
      retryable: true,
      attempts: 4,
      hint: "transient elevenlabs failure after 4 attempt(s); repair with `asset generate --target missing` — it regenerates only what is absent.",
    },
    {
      kind: "image",
      target: "npc:1003",
      path: "portraits/npcs/npc_1003.png",
      provider: "fal",
      error: "FalClientHTTPError",
      message: "502 bad gateway",
      status: 502,
      retryable: true,
      attempts: 4,
      hint: "transient fal failure after 4 attempt(s); repair with `asset generate --target missing` — it regenerates only what is absent.",
    },
  ],
};

describe("summarizeAssets", () => {
  it("tallies landed + failed per family from the stats file's own fields", () => {
    expect(summarizeAssets(PAID_RUN)).toEqual([
      { kind: "image", label: "images", landed: 43, failed: 1, planned: 44, listed: true },
      { kind: "music", label: "music", landed: 0, failed: 1, planned: 1, listed: true },
      { kind: "sfx", label: "sfx", landed: 4, failed: 1, planned: 5, listed: true },
    ]);
  });

  it("tallies a kind it has never heard of under its own name", () => {
    const stats: AssetStats = { failures: [{ kind: "mesh", target: "mesh:crate" }] };
    expect(summarizeAssets(stats)).toEqual([
      { kind: "mesh", label: "mesh", landed: 0, failed: 1, planned: 1, listed: true },
    ]);
  });

  it("is empty for a run that counted nothing", () => {
    expect(summarizeAssets({})).toEqual([]);
    expect(summarizeAssets(null)).toEqual([]);
  });

  it("falls back to attempts vs landed for a file that carries NO failure list", () => {
    // The first paid run's own file: no `failures` key, and 26 assets short.
    // The absence of a list is not the absence of failures.
    const legacy: AssetStats = {
      images_attempted: 50,
      images_succeeded: 43,
      music_attempted: 8,
      music_succeeded: 0,
      sfx_attempted: 15,
      sfx_succeeded: 4,
    };
    expect(summarizeAssets(legacy)).toEqual([
      { kind: "image", label: "images", landed: 43, failed: 7, planned: 50, listed: false },
      { kind: "music", label: "music", landed: 0, failed: 8, planned: 8, listed: false },
      { kind: "sfx", label: "sfx", landed: 4, failed: 11, planned: 15, listed: false },
    ]);
    // landed without an attempt count still tallies, as its own floor
    expect(summarizeAssets({ images_succeeded: 3 })).toEqual([
      { kind: "image", label: "images", landed: 3, failed: 0, planned: 3, listed: false },
    ]);
  });
});

describe("assetFamilyCell", () => {
  it("reads landed / planned with the failed count when a list backs it", () => {
    const [images, , sfx] = summarizeAssets(PAID_RUN);
    expect(assetFamilyCell(images)).toBe("43 / 44 · 1 failed");
    expect(assetFamilyCell({ ...sfx, failed: 0, planned: 4 })).toBe("4 / 4");
  });

  it("claims only attempts vs landed for a file with no list", () => {
    const [images] = summarizeAssets({ images_attempted: 50, images_succeeded: 43 });
    expect(assetFamilyCell(images)).toBe("43 / 50 attempted");
  });
});

describe("assetSummaryLine", () => {
  it("reads as `N images · M landed · K failed — see list`", () => {
    expect(assetSummaryLine({ images_succeeded: 43, failures: PAID_RUN.failures!.slice(2) })).toBe(
      "44 images · 43 landed · 1 failed — see list",
    );
  });

  it("says all landed when nothing failed, and nothing when nothing ran", () => {
    expect(assetSummaryLine({ images_succeeded: 50, sfx_succeeded: 15, failures: [] })).toBe(
      "50 images · all landed / 15 sfx · all landed",
    );
    expect(assetSummaryLine({})).toBe("");
  });

  it("never says all landed for a file that carries no failure list", () => {
    // The real paid pack's stats shape: the line reads what the file knows
    // (attempts vs landed), names no list it does not have, and the 0/8
    // music lane is shown, not skipped.
    expect(
      assetSummaryLine({
        images_attempted: 50,
        images_succeeded: 43,
        music_attempted: 8,
        music_succeeded: 0,
        sfx_attempted: 15,
        sfx_succeeded: 4,
      }),
    ).toBe(
      "43 images landed of 50 attempted / 0 music landed of 8 attempted / 4 sfx landed of 15 attempted",
    );
    expect(assetSummaryLine({ images_attempted: 50, images_succeeded: 50 })).toBe(
      "50 images landed of 50 attempted",
    );
  });
});

describe("AssetFailureList", () => {
  it("renders which assets, why, and what to do, from the stats fixture", () => {
    render(<AssetFailureList failures={PAID_RUN.failures} />);
    const rows = screen.getAllByTestId("asset-failure-row");
    expect(rows).toHaveLength(3);
    // which
    expect(screen.getByText("music:combat")).toBeInTheDocument();
    expect(screen.getByText("sfx:door_open")).toBeInTheDocument();
    expect(screen.getByText("npc:1003")).toBeInTheDocument();
    // why — the provider's own words, the provider and status as data
    expect(screen.getByText("PERMISSION_DENIED: billing is not enabled")).toBeInTheDocument();
    expect(screen.getByText("lyria 403")).toBeInTheDocument();
    expect(screen.getByText("elevenlabs 429")).toBeInTheDocument();
    expect(screen.getByText("1 attempt")).toBeInTheDocument();
    expect(screen.getAllByText("4 attempts")).toHaveLength(2);
    // what to do — canon's hint, verbatim
    expect(screen.getByText(/check the lyria key and plan/)).toBeInTheDocument();
    expect(screen.getByText(/3 assets did not land/)).toBeInTheDocument();
    // the intro never hardcodes a verb: the repair is each record's own hint
    expect(screen.getByText(/each row names the command/)).toBeInTheDocument();
  });

  it("renders nothing for an empty or absent list", () => {
    const { container } = render(<AssetFailureList failures={[]} />);
    expect(container.querySelector("[data-testid=asset-failures]")).toBeNull();
    const none = render(<AssetFailureList failures={undefined} />);
    expect(none.container.querySelector("[data-testid=asset-failures]")).toBeNull();
  });

  it("drops the intro when compact (inside a progress card)", () => {
    render(<AssetFailureList failures={PAID_RUN.failures} compact />);
    expect(screen.queryByText(/did not land/)).toBeNull();
    expect(screen.getAllByTestId("asset-failure-row")).toHaveLength(3);
  });
});
