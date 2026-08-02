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
    kind: "animate", label: "plat:sprite_animation", mode: "vlm", prompt: "default",
  });
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

    await userEvent.click(screen.getByRole("button", { name: /^Animate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].backends).toEqual({
      image: "fal",
      vlm: "anthropic",
    });
  });

  it("offers only the backends that can actually animate", async () => {
    // fal + fake are the only ImageEditBackends; the rest would bill the VLM
    // for a run that animates nothing.
    render(
      <AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    const select = screen.getByRole("combobox", { name: /Image edit backend/i });
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["fal", "fake"]);
    expect(values).not.toContain("pixellab");
    expect(values).not.toContain("retro");
  });

  it("blank model fields are omitted, so canon's defaults apply", async () => {
    const onSubmit = vi.fn();
    render(
      <AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Animate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const o = onSubmit.mock.calls[0][0];
    expect(o.imageModel).toBeUndefined();
    expect(o.imageEditModel).toBeUndefined();
    expect(o.vlmModel).toBeUndefined();
    expect(o.promptOverride).toBeNull();
  });

  it("a typed model reaches the caller", async () => {
    const onSubmit = vi.fn();
    render(
      <AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={onSubmit} />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("fal-ai/nano-banana/edit"),
      "fal-ai/some-other/edit",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Animate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].imageEditModel).toBe("fal-ai/some-other/edit");
  });

  it("reuse-spec drops the vision call from the quote and the submit", async () => {
    const onSubmit = vi.fn();
    render(
      <AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => {
      const calls = vi.mocked(api.estimateAsset).mock.calls;
      expect(calls[calls.length - 1][2]).toMatchObject({
        reuseSpec: true,
        vlmBackend: "none",
      });
    });
    await userEvent.click(screen.getByRole("button", { name: /^Animate ·/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const o = onSubmit.mock.calls[0][0];
    expect(o.reuseSpec).toBe(true);
    expect(o.vlmBackend).toBeUndefined();
    expect(o.backends).toEqual({ image: "fal" });
  });

  it("refuses the combination canon itself rejects", async () => {
    // No stored spec to replay AND no vision backend to author one.
    render(
      <AnimateModal worldPath="/w" target="enemy:x" onClose={() => {}} onSubmit={vi.fn()} />,
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /Vision backend/i }),
      "none",
    );
    expect(screen.getByRole("button", { name: /^Animate ·/ })).toBeDisabled();
    expect(screen.getByText(/Pick a vision backend/)).toBeInTheDocument();
  });
});
