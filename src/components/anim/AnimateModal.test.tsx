import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnimateModal } from "./AnimateModal";
import { api } from "../../lib/invoke";

/** The animate gate. These tests pin the two things that are easy to
 *  regress: the target string handed to canon, and the fal/fake-only rule. */

const ESTIMATE = {
  scope: "animate",
  backends: {},
  llm: { by_task: {}, calls: 0, usd: { best: 0, worst: 0 } },
  assets: {
    images: { count: 5, usd: 0.2 },
    music: { count: 0, usd: 0 },
    sfx: { count: 0, usd: 0 },
    vlm: { usd: { best: 0.0081, worst: 0.0081 } },
    usd: { best: 0.2081, worst: 0.2081 },
  },
  total_usd: { best: 0.2081, worst: 0.2081 },
  warnings: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "estimateAsset").mockResolvedValue({
    estimate: ESTIMATE,
  } as unknown as { estimate: typeof ESTIMATE });
  // The prompt expander must fetch NOTHING until it is opened.
  vi.spyOn(api, "previewPrompt").mockResolvedValue({
    kind: "animate",
    label: "plat:sprite_animation",
    mode: "vlm",
    prompt: "default",
  });
  // The modal now shows what the run works FROM, so it reads the actor.
  vi.spyOn(api, "animInspect").mockResolvedValue({
    animation: {
      target: "player",
      label: "player",
      sprite_dir: "sprite/player",
      has_atlas: true,
      atlas_path_abs: null,
      states: [],
      flush_states: [],
      independently_sized: false,
      base_sprite: "sprite/player/base.png",
      base_sprite_abs: "/__mockassets__/sprite/player/base.png",
      planned_states: ["idle", "walk", "jump"],
      briefs: { idle: "at rest", walk: "moving along", jump: "the RISING launch" },
      spec: {},
    },
  } as unknown as { animation: never });
});

describe("AnimateModal", () => {
  it("submits the bare 'player' target, never 'player:player'", async () => {
    // "player:player" PARSES canon-side and then journals a second artifact
    // id, forking the player's lineage — so the bare string is load-bearing.
    const onSubmit = vi.fn();
    render(
      <AnimateModal
        worldPath="/w"
        target="player"
        name="player"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    await waitFor(() => expect(api.estimateAsset).toHaveBeenCalled());
    expect(vi.mocked(api.estimateAsset).mock.calls[0][1]).toBe("player");

    await userEvent.click(screen.getByRole("button", { name: /^Generate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].backends).toEqual({
      image: "fal",
      vlm: "anthropic",
    });
  });

  it("offers only the backends that can actually animate", async () => {
    // fal + fake are the only ImageEditBackends; the rest would bill the VLM
    // for a run that animates nothing.
    render(<AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: /Image edit backend/i });
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["fal", "fake"]);
    expect(values).not.toContain("pixellab");
    expect(values).not.toContain("retro");
  });

  it("blank model fields are omitted, so canon's defaults apply", async () => {
    const onSubmit = vi.fn();
    render(<AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /^Generate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const o = onSubmit.mock.calls[0][0];
    expect(o.imageModel).toBeUndefined();
    expect(o.imageEditModel).toBeUndefined();
    expect(o.vlmModel).toBeUndefined();
    expect(o.promptOverride).toBeNull();
  });

  it("a typed model reaches the caller", async () => {
    const onSubmit = vi.fn();
    render(<AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(
      screen.getByPlaceholderText("fal-ai/nano-banana/edit"),
      "fal-ai/some-other/edit",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Generate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].imageEditModel).toBe("fal-ai/some-other/edit");
  });

  it("reuse-spec drops the vision call from the quote and the submit", async () => {
    const onSubmit = vi.fn();
    render(<AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => {
      const calls = vi.mocked(api.estimateAsset).mock.calls;
      expect(calls[calls.length - 1][2]).toMatchObject({
        reuseSpec: true,
        vlmBackend: "none",
      });
    });
    await userEvent.click(screen.getByRole("button", { name: /^Generate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const o = onSubmit.mock.calls[0][0];
    expect(o.reuseSpec).toBe(true);
    expect(o.vlmBackend).toBeUndefined();
    expect(o.backends).toEqual({ image: "fal" });
  });

  it("refuses the combination canon itself rejects", async () => {
    // No stored spec to replay AND no vision backend to author one.
    render(<AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={vi.fn()} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Vision backend/i }),
      "none",
    );
    expect(screen.getByRole("button", { name: /^Generate ·/ })).toBeDisabled();
    expect(screen.getByText(/Pick a vision backend/)).toBeInTheDocument();
  });

  it("shows what the run works from — the base sprite and each state's brief", async () => {
    // The dialog used to be backend dropdowns and a bare prompt box: it never
    // showed the sprite being edited or what a state was supposed to mean.
    render(<AnimateModal worldPath="/w" target="player" onClose={() => {}} onSubmit={vi.fn()} />);
    const img = await screen.findByAltText(/base sprite/i);
    expect(img).toHaveAttribute("src", "/__mockassets__/sprite/player/base.png");
    for (const state of ["idle", "walk", "jump"]) {
      expect(await screen.findByText(state)).toBeInTheDocument();
    }
    expect(screen.getByText(/the RISING launch/)).toBeInTheDocument();
  });

  it("prefers a stored motion spec over the generic brief", async () => {
    // The stored spec describes how THIS drawing moves, so it is truer than
    // the generic per-state brief the vocabulary ships.
    vi.mocked(api.animInspect).mockResolvedValue({
      animation: {
        target: "enemy:eel",
        label: "eel",
        sprite_dir: "sprite/enemy/eel",
        has_atlas: true,
        atlas_path_abs: null,
        states: [],
        flush_states: [],
        independently_sized: false,
        base_sprite: "sprite/enemy/eel/base.png",
        base_sprite_abs: "/__mockassets__/sprite/enemy/eel/base.png",
        planned_states: ["walk"],
        briefs: { walk: "actively moving along its path" },
        spec: { walk: { frames: 4, motion: "sinuous S-curve ripples head to tail" } },
      },
    } as unknown as { animation: never });
    render(
      <AnimateModal worldPath="/w" target="enemy:eel" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    expect(await screen.findByText(/sinuous S-curve/)).toBeInTheDocument();
    expect(screen.queryByText(/actively moving along its path/)).toBeNull();
    expect(screen.getByText("walk·4")).toBeInTheDocument();
  });
});
