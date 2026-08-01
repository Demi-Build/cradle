import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnimateModal } from "./AnimateModal";

const animateAsset = vi.fn(() => Promise.resolve({ queued: true, job_id: "j1" }));
const estimateAnimate = vi.fn(() =>
  Promise.resolve({
    result: "estimate",
    estimate: {
      scope: "animate",
      backends: {},
      llm: { by_task: {}, calls: 0, usd: { best: 0, worst: 0 } },
      assets: {
        images: { count: 4, usd: 0.16 },
        music: { count: 0, usd: 0 },
        sfx: { count: 0, usd: 0 },
        vlm: { usd: { best: 0.008, worst: 0.008 } },
        usd: { best: 0.168, worst: 0.168 },
      },
      total_usd: { best: 0.168, worst: 0.168 },
      warnings: ["animate prices 4 edit(s) (4 state(s) x 1 facing(s))."],
    },
  }),
);

vi.mock("../lib/invoke", () => ({
  api: {
    animateAsset: (...a: unknown[]) => animateAsset(...(a as [])),
    estimateAnimate: (...a: unknown[]) => estimateAnimate(...(a as [])),
    previewPrompt: () =>
      Promise.resolve({ kind: "animate", label: "plat:animate", mode: "vlm", prompt: "P" }),
  },
}));
// The job tray + provider-key pre-flight are exercised elsewhere; here they
// stand in so the test can assert exactly what reaches `api.animateAsset`.
vi.mock("../lib/jobs", () => ({
  missingKeysFor: () => Promise.resolve(null),
  enqueueJob: (_meta: unknown, fire: (id: string) => Promise<unknown>) => fire("job-1"),
}));

function renderModal() {
  return render(
    <AnimateModal
      worldPath="/w"
      target="enemy:slime"
      actorId="slime"
      typeId="enemies"
      onClose={() => {}}
      onQueued={() => {}}
    />,
  );
}

describe("AnimateModal", () => {
  beforeEach(() => {
    animateAsset.mockClear();
    estimateAnimate.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("offers ONLY the backends that implement img2img edit() as the animator", () => {
    renderModal();
    const options = [
      ...(screen.getByLabelText(/Animator \(img2img\)/) as HTMLSelectElement).options,
    ].map((o) => o.value);
    // "" = canon's default (animate on the sprite backend). pixellab/retro/local
    // are absent: they draw sprites but have no edit().
    expect(options).toEqual(["", "fal", "fake"]);
  });

  it("blocks a sprite backend that cannot animate, and names why", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.selectOptions(screen.getByLabelText("Sprite backend"), "pixellab");
    // The animator defaults to the sprite backend, and pixellab has no edit():
    // the run would bill the VLM and leave the sprite static.
    expect(screen.getByRole("button", { name: /Animate/ })).toBeDisabled();
    expect(screen.getByText(/has no img2img/)).toBeInTheDocument();

    // ...but pairing it with fal is exactly what canon's --image-edit-backend
    // is for, so that combination must go through.
    await user.selectOptions(screen.getByLabelText(/Animator \(img2img\)/), "fal");
    expect(screen.getByRole("button", { name: /Animate/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Animate/ }));
    await waitFor(() => expect(animateAsset).toHaveBeenCalled());
    const opts = (
      animateAsset.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    )[2];
    expect(opts.imageBackend).toBe("pixellab");
    expect(opts.imageEditBackend).toBe("fal");
  });

  it("sends every model knob canon takes, and omits the blank ones", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Sheet model"), "fal-ai/other/edit");
    await user.type(screen.getByLabelText("VLM model"), "claude-opus-4-6");
    await user.click(screen.getByRole("button", { name: /Animate/ }));

    await waitFor(() => expect(animateAsset).toHaveBeenCalled());
    const [path, target, opts] = animateAsset.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect([path, target]).toEqual(["/w", "enemy:slime"]);
    expect(opts.imageEditModel).toBe("fal-ai/other/edit");
    expect(opts.vlmModel).toBe("claude-opus-4-6");
    // Untouched free-text fields mean "canon's default", never an empty string.
    expect(opts.imageModel).toBeNull();
    expect(opts.imageEditBackend).toBeNull(); // unset = canon's own default
    expect(opts.imageBackend).toBe("fal");
    expect(opts.vlmBackend).toBe("anthropic");
    expect(opts.reuseSpec).toBe(false);
  });

  it("reuse-spec drops the VLM from the run and the recorded backends", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(estimateAnimate).toHaveBeenCalledWith(
        "/w",
        "enemy:slime",
        "fal",
        "anthropic",
        expect.objectContaining({ reuseSpec: true }),
      ),
    );
    await user.click(screen.getByRole("button", { name: /Animate/ }));
    await waitFor(() => expect(animateAsset).toHaveBeenCalled());
    const opts = (
      animateAsset.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    )[2];
    expect(opts.reuseSpec).toBe(true);
  });

  it("refuses to author with no VLM instead of queueing a run canon rejects", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.selectOptions(screen.getByLabelText(/Motion author/), "none");
    expect(screen.getByRole("button", { name: /Animate/ })).toBeDisabled();
    expect(screen.getByText(/Authoring needs a VLM/)).toBeInTheDocument();
    expect(animateAsset).not.toHaveBeenCalled();
  });

  it("shows the priced edit count and canon's own caveats", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByText(/4 img2img edits \+ 1 VLM call/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/4 state\(s\) x 1 facing\(s\)/)).toBeInTheDocument();
  });
});
