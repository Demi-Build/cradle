import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());

import { PaidCard } from "./ToolCall/PaidCard";
import { AgentPanel } from "./AgentPanel";
import { ConfirmGateHost } from "./ConfirmGate";
import {
  confirmAction,
  confirmSpend,
  gateIsOpen,
  isFreeSelection,
  paidFromEstimate,
} from "./confirmGateState";
import { sendMessage } from "../../lib/agentActions";
import { useStore } from "../../store";
import { activeConversation, expandRuns, openTab, setupAgent, until } from "./testUtils";

/** Step 6 (README §5 "paid"): the four states, the $0 rule (doctrine 3),
 *  and the gate that replaced `window.confirm` on the editor's own buttons. */
describe("the paid card's four states", () => {
  it("estimate: range in accent, backend AND model, unit of work, today's spend, price in the Accept button, footnote", () => {
    const onAccept = vi.fn();
    render(
      <PaidCard
        paid={{
          state: "estimate",
          lowCents: 48,
          highCents: 64,
          backend: "fal",
          model: "flux-pixel-v2",
          unitCount: 4,
          unitLabel: "4 sprites × 2 passes",
          todaySpendCents: 186,
        }}
        title="generate 4 sprites"
        specialist="artist"
        onAccept={onAccept}
        onReject={() => {}}
      />,
    );
    const card = screen.getByTestId("paid-card");
    expect(card.getAttribute("data-state")).toBe("estimate");
    expect(card.textContent).toContain("Artist wants to generate 4 sprites");
    expect(card.textContent).toContain("$0.48 – $0.64");
    expect(card.textContent).toContain("fal · flux-pixel-v2");
    expect(card.textContent).toContain("4 sprites × 2 passes");
    expect(card.textContent).toContain("$1.86 spent today");
    fireEvent.click(within(card).getByText("Accept · spend up to $0.64"));
    expect(onAccept).toHaveBeenCalled();
    expect(within(card).queryByText("Always allow in this project")).toBeNull();
    expect(card.textContent).toContain(
      "Paid work is never covered by “always allow”. Every spend asks.",
    );
  });

  it("running: phase + item + i/N, elapsed, spent so far $A of $B, ⏹", () => {
    render(
      <PaidCard
        paid={{
          state: "running",
          phase: "upscaling",
          item: "ember_hopper_hurt",
          index: 3,
          total: 4,
          spentCents: 36,
          budgetCents: 64,
          startedAt: Date.now() - 47_000,
          done: ["base", "hurt", "jump"],
        }}
        title="Generating sprites"
        onStop={() => {}}
      />,
    );
    const card = screen.getByTestId("paid-card");
    expect(card.textContent).toContain("upscaling · ember_hopper_hurt");
    expect(card.textContent).toContain("3 / 4");
    expect(card.textContent).toMatch(/0:4[67] elapsed/);
    expect(card.textContent).toContain("spent so far $0.36 of $0.64");
    expect(within(card).getByText("⏹ Stop")).toBeInTheDocument();
  });

  it("result: actual cost, thumbnails, duration and backend, Show me", () => {
    render(
      <PaidCard
        paid={{
          state: "result",
          label: "4 sprites generated",
          actualCents: 51,
          thumbnails: ["data:,a", "data:,b"],
          durationMs: 72_000,
          backend: "fal",
          model: "flux-pixel-v2",
          showMe: { kind: "library" },
        }}
        title="x"
      />,
    );
    const card = screen.getByTestId("paid-card");
    expect(card.textContent).toContain("4 sprites generated");
    expect(card.textContent).toContain("$0.51");
    expect(card.querySelectorAll("img")).toHaveLength(2);
    expect(card.textContent).toContain("1:12 · fal/flux-pixel-v2");
    expect(within(card).getByText("Show me in Library")).toBeInTheDocument();
  });

  it("stopped: stopped by you at 0:52, billed, kept vs never started, nothing rolled back, Finish the last one / Undo all", () => {
    render(
      <PaidCard
        paid={{
          state: "stopped",
          stoppedAtMs: 52_000,
          billedCents: 36,
          estimateCents: 64,
          kept: ["base", "hurt", "jump"],
          notStarted: ["fall"],
          finishLastCents: 16,
        }}
        title="x"
        onFinishLast={() => {}}
        onUndoAll={() => {}}
      />,
    );
    const card = screen.getByTestId("paid-card");
    expect(card.textContent).toContain("Stopped by you at 0:52");
    expect(card.textContent).toContain("✓ kept 3 — base, hurt, jump");
    expect(card.textContent).toContain("— not started: fall");
    expect(card.textContent).toContain(
      "Billed $0.36 of the $0.64 estimate. Nothing was rolled back.",
    );
    expect(within(card).getByText("Finish the last one · ~$0.16")).toBeInTheDocument();
    expect(within(card).getByText("Undo all 3")).toBeInTheDocument();
  });
});

describe("the paid card as the editor's confirm gate", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("a $0 (fake/none) selection never sees the spend card — it runs as today", async () => {
    expect(isFreeSelection({ llm: "fake" })).toBe(true);
    expect(isFreeSelection({ music: "none", sfx: "none" })).toBe(true);
    expect(isFreeSelection({ llm: "fake", image: "fal" })).toBe(false);
    render(<ConfirmGateHost />);
    await expect(confirmSpend({ title: "generate", backends: { llm: "fake" } })).resolves.toBe(
      true,
    );
    expect(gateIsOpen()).toBe(false);
    expect(screen.queryByTestId("confirm-gate")).toBeNull();
  });

  it("a paid selection with NO usable estimate still gates — unknown price, never free", async () => {
    render(<ConfirmGateHost />);
    let settled: boolean | null = null;
    void confirmSpend({ title: "improve the layout", backends: { llm: "anthropic" } }).then(
      (ok) => (settled = ok),
    );
    await waitFor(() => expect(screen.getByTestId("confirm-gate")).toBeInTheDocument());
    expect(settled).toBeNull();
    const card = screen.getByTestId("paid-card");
    expect(card.getAttribute("data-state")).toBe("estimate");
    expect(card.textContent).toContain("— not estimated");
    expect(within(card).getByText("Accept · spend on anthropic")).toBeInTheDocument();
    fireEvent.click(within(card).getByText("Reject"));
    await waitFor(() => expect(settled).toBe(false));
  });

  it("reads P0-7's low/high/backend/model/unitCount from the estimate JSON, falling back to best/worst", () => {
    const base = {
      scope: "layout",
      backends: { llm: "anthropic" },
      llm: { by_task: {}, calls: 6, usd: { best: 0.07, worst: 0.3 } },
      assets: {
        images: { count: 0, usd: 0 },
        music: { count: 0, usd: 0 },
        sfx: { count: 0, usd: 0 },
        vlm: {},
        usd: { best: 0, worst: 0 },
      },
      total_usd: { best: 0.07, worst: 0.3 },
      warnings: [],
    };
    const fallback = paidFromEstimate({
      title: "t",
      backends: { llm: "anthropic" },
      estimate: base,
    });
    expect(fallback).toMatchObject({
      lowCents: 7,
      highCents: 30,
      backend: "anthropic",
      unitCount: 6,
    });
    const p07 = paidFromEstimate({
      title: "t",
      backends: { llm: "anthropic" },
      estimate: {
        ...base,
        low: 0.1,
        high: 0.4,
        backend: "anthropic",
        model: "claude-sonnet-5",
        unitCount: 9,
      },
    });
    expect(p07).toMatchObject({
      lowCents: 10,
      highCents: 40,
      model: "claude-sonnet-5",
      unitCount: 9,
    });
  });

  it("a paid selection renders the estimate card; Accept resolves true, Reject false; two gates never coexist", async () => {
    render(<ConfirmGateHost />);
    const p1 = confirmSpend({
      title: "regenerate 2-3's layout",
      backends: { llm: "anthropic" },
      estimate: {
        scope: "layout",
        backends: {},
        llm: { by_task: {}, calls: 1, usd: { best: 0.06, worst: 0.26 } },
        assets: {
          images: { count: 0, usd: 0 },
          music: { count: 0, usd: 0 },
          sfx: { count: 0, usd: 0 },
          vlm: {},
          usd: { best: 0, worst: 0 },
        },
        total_usd: { best: 0.06, worst: 0.26 },
        warnings: [],
      },
    });
    const gate = await screen.findByTestId("confirm-gate");
    expect(within(gate).getByTestId("paid-card").getAttribute("data-state")).toBe("estimate");
    expect(within(gate).getByText("Accept · spend up to $0.26")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("spend_list", { path: "/w" }); // today's spend, for context
    // A second gate supersedes the first (it resolves false).
    const p2 = confirmAction({
      title: "Hand 2 levels back to the generator?",
      confirmLabel: "Hand back",
    });
    await expect(p1).resolves.toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId("confirm-gate").textContent).toContain("Hand 2 levels back"),
    );
    fireEvent.click(screen.getByText("Hand back"));
    await expect(p2).resolves.toBe(true);
    expect(screen.queryByTestId("confirm-gate")).toBeNull();
    const p3 = confirmSpend({
      title: "music",
      backends: { music: "lyria" },
      fixedUsd: 0.1,
      backend: "lyria",
      model: "lyria",
    });
    fireEvent.click(await screen.findByText("Reject"));
    await expect(p3).resolves.toBe(false);
  });

  it("in the transcript: a paid tool asks first, then runs on the one job tray with its attribution, and finishes with the result card", async () => {
    const id = openTab();
    render(<AgentPanel />);
    void sendMessage(id, "generate a cold variant of the hopper sprite");
    await until(() => activeConversation()?.status === "awaiting_approval");
    const est = await screen.findByTestId("paid-card");
    expect(est.getAttribute("data-state")).toBe("estimate");
    expect(est.textContent).toContain("Artist wants to generate 4 sprites for enemy:ember_hopper");
    act(() => {
      fireEvent.click(within(est).getByText("Accept · spend up to $0.64"));
    });
    await until(() => useStore.getState().jobs.some((j) => j.actor?.startsWith("agent:")));
    expect(useStore.getState().jobs[0].actor).toMatch(/^agent:conv_[0-9a-f]+\/artist$/);
    await until(() => activeConversation()?.status === "idle");
    await waitFor(() => {
      expandRuns();
      expect(screen.getByTestId("paid-card").getAttribute("data-state")).toBe("result");
    });
    expect(screen.getByTestId("paid-card").textContent).toContain("4 sprites generated");
    expect(useStore.getState().jobs[0].status).toBe("ok");
  });
});
