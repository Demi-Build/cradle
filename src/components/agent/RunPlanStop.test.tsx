import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());

import { AgentPanel } from "./AgentPanel";
import { JobTray } from "../JobTray";
import { LeftNav } from "../LeftNav";
import { AgentChangedPill } from "./AgentChangedPill";
import { CreateProgress } from "../start/CreateProgress";
import { useStore } from "../../store";
import { sendMessage, stopConversation } from "../../lib/agentActions";
import { scriptedAgent } from "../../lib/agentMock";
import type { PlanItem, RunItem } from "../../lib/agentState";
import { activeConversation, expandRuns, openTab, setupAgent, until } from "./testUtils";

const runs = () => (activeConversation()?.items.filter((i) => i.kind === "run") ?? []) as RunItem[];
const plan = () =>
  activeConversation()?.items.find((i) => i.kind === "plan") as PlanItem | undefined;

/** Steps 7–9 (README §4, §7, §8, §10): run cards + routing, plan mode's four
 *  states + the batch undo + the change feed + the editor sightings, and
 *  Stop in its three places with the job tray's attribution column. */
describe("run cards", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("nests specialist runs with the routing shown, a per-card ⏹, and collapses a finished run to one line with its cost", async () => {
    const id = openTab("allow");
    render(<AgentPanel />);
    void sendMessage(
      id,
      "Add a second enemy tier to 2-3 and 2-4, and make the tileset read colder",
    );
    await until(() => runs().length === 2);
    const cards = screen.getAllByTestId("run-card");
    expect(cards.length).toBe(2);
    expect(cards.map((c) => c.textContent).join(" ")).toMatch(/Artist/);
    expect(cards.map((c) => c.textContent).join(" ")).toMatch(/Level designer/);
    expect(screen.getByText("routed to the artist — palette work")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Stop /).length).toBeGreaterThan(0);
    // Accept the chips as they come (three across the two runs), each once.
    const decided = new Set<string>();
    for (let guard = 0; guard < 12 && activeConversation()?.status !== "idle"; guard++) {
      await waitFor(
        () => {
          if (activeConversation()?.status === "idle") return;
          const fresh = screen
            .queryAllByTestId("perm-chip")
            .filter((c) => !decided.has(c.getAttribute("data-request") ?? ""));
          expect(fresh.length).toBeGreaterThan(0);
        },
        { timeout: 4000 },
      );
      const chip = screen
        .queryAllByTestId("perm-chip")
        .find((c) => !decided.has(c.getAttribute("data-request") ?? ""));
      if (chip) {
        decided.add(chip.getAttribute("data-request") ?? "");
        fireEvent.click(within(chip).getByText("Accept"));
      }
    }
    await until(() => activeConversation()?.status === "idle");
    const artist = runs().find((r) => r.specialist === "artist")!;
    expect(artist.status).toBe("ok");
    expect(artist.collapsed).toBe(true);
    const collapsed = screen
      .getAllByTestId("run-card")
      .find((c) => c.getAttribute("data-run") === artist.runId)!;
    expect(collapsed.textContent).toContain("✓ Artist");
    expect(collapsed.textContent).toContain("re-tinted east columns");
    expect(collapsed.textContent).toContain("$0.31");
    // The write\'s spatial diff drew before/after canvases in the designer\'s card.
    await waitFor(() => {
      expandRuns();
      expect(screen.getAllByTestId("diff-after").length).toBeGreaterThan(0);
    });
    // "Agent changed this": the LeftNav dot + the pill.
    render(
      <>
        <LeftNav />
        <AgentChangedPill />
      </>,
    );
    // The nav lists a type\'s rows once it is expanded — open Levels first.
    fireEvent.click(screen.getAllByText("▶")[0]);
    expect(screen.getAllByTestId("nav-agent-dot").length).toBeGreaterThan(0);
    expect(screen.getByTestId("agent-pill").textContent).toMatch(/changed/);
  });

  it("the per-run ⏹ stops that run only and offers a resume; the conversation continues", async () => {
    const id = openTab();
    render(<AgentPanel />);
    scriptedAgent.speed = 1;
    const p = sendMessage(id, "Check every level for unreachable exits");
    await until(() => runs().length === 1);
    fireEvent.click(screen.getByLabelText("Stop Playtester"));
    scriptedAgent.speed = 0;
    await p;
    const run = runs()[0];
    expect(run.status).toBe("cancelled");
    const card = screen.getByTestId("run-card");
    const head = within(card).getByRole("button", { name: /Playtester/ });
    if (head.getAttribute("aria-expanded") === "false") fireEvent.click(head);
    expect(screen.getByTestId("run-card").textContent).toContain("not simulated");
    expect(screen.getByText("Resume from where it stopped")).toBeInTheDocument();
    // The conversation itself finished normally.
    expect(activeConversation()!.status).toBe("idle");
    expect(
      activeConversation()!.items.some(
        (i) => i.kind === "assistant" && i.text.includes("Every exit"),
      ),
    ).toBe(true);
  });
});

describe("plan mode", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("proposed → one approval → steps check off → change feed with deep-links and the batch undo", async () => {
    const id = openTab("plan");
    render(<AgentPanel />);
    void sendMessage(id, "Make the ember grove harder east of the stair");
    await until(() => plan()?.status === "proposed");
    const card = screen.getByTestId("plan-card");
    expect(card.getAttribute("data-state")).toBe("proposed");
    const steps = within(card).getAllByTestId("plan-step");
    expect(steps).toHaveLength(5);
    expect(steps[3].textContent).toContain("paid");
    expect(steps[3].textContent).toContain("Artist");
    expect(steps[3].textContent).toContain("$0.48 – $0.64");
    expect(within(card).getByText("Run plan · up to $0.64")).toBeInTheDocument();
    expect(within(card).getByText("Edit steps")).toBeInTheDocument();
    expect(within(card).getByText("Discard")).toBeInTheDocument();
    expect(card.textContent).toContain(
      "Step 4 spends money and will still ask when it gets there.",
    );
    fireEvent.click(within(card).getByText("Run plan · up to $0.64"));
    await until(() => plan()?.status === "running");
    expect(screen.getByTestId("plan-card").getAttribute("data-state")).toBe("running");
    // The paid step still asks when reached.
    await until(() => activeConversation()?.status === "awaiting_approval");
    fireEvent.click(
      within(await screen.findByTestId("paid-card")).getByText("Accept · spend up to $0.64"),
    );
    await until(() => plan()?.status === "complete");
    const feed = await screen.findByTestId("change-feed");
    const rows = within(feed).getAllByTestId("feed-row");
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("l3"),
        expect.stringContaining("l4"),
        expect.stringContaining("ember_grove"),
      ]),
    );
    expect(within(feed).getByText("▶ Play l3")).toBeInTheDocument();
    expect(within(feed).getByText("Undo the batch")).toBeInTheDocument();
    expect(within(feed).getByText("Open in History")).toBeInTheDocument();
    expect(feed.textContent).toMatch(
      /Journaled as agent:conv_[0-9a-f]+\/artist · agent:conv_[0-9a-f]+\/level_designer|Journaled as agent:conv_[0-9a-f]+\/level_designer · agent:conv_[0-9a-f]+\/artist/,
    );
    // Every write under the plan carries batchId = plan id.
    const p = plan()!;
    const writes = runs()
      .flatMap((r) => r.items)
      .filter((i) => i.kind === "tool" && i.tier === "write");
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(writes.every((w) => w.kind === "tool" && w.batchId === p.planId)).toBe(true);
    // A row's ↗ opens + selects + pulses the target.
    fireEvent.click(within(rows[0]).getByRole("button"));
    expect(useStore.getState().selection).toMatchObject({
      kind: "entity",
      typeId: "levels",
      id: "l3",
    });
    expect(useStore.getState().agent.pulse).toBeTruthy();
    // Undo the batch — one History entry, reverse order, via the service.
    const spy = vi.spyOn(scriptedAgent, "undoPlan");
    fireEvent.click(within(feed).getByText("Undo the batch"));
    await until(() => plan()?.undone === true);
    expect(spy).toHaveBeenCalledWith(expect.any(String), p.planId);
    expect(screen.getByText("Batch undone")).toBeDisabled();
  });

  it("Edit steps opens the editor locally; only Re-propose POSTs `edit` WITH the steps", async () => {
    const id = openTab("plan");
    render(<AgentPanel />);
    void sendMessage(id, "Make the grove harder");
    await until(() => plan()?.status === "proposed");
    const spy = vi.spyOn(scriptedAgent, "decidePlan");
    fireEvent.click(screen.getByText("Edit steps"));
    // Nothing was posted: the service refuses `edit` without the steps.
    expect(spy).not.toHaveBeenCalled();
    await until(() => plan()?.status === "editing");
    expect(screen.getByTestId("plan-card").getAttribute("data-state")).toBe("editing");
    fireEvent.click(screen.getByText("Re-propose"));
    await until(() => spy.mock.calls.length > 0);
    const [, , body] = spy.mock.calls[0];
    expect(body.decision).toBe("edit");
    expect(Array.isArray(body.steps) && body.steps.length).toBe(5);
  });

  it("Discard rejects the plan", async () => {
    const id = openTab("plan");
    render(<AgentPanel />);
    void sendMessage(id, "Make the grove harder");
    await until(() => plan()?.status === "proposed");
    fireEvent.click(screen.getByText("Discard"));
    await until(() => plan()?.status === "rejected");
    expect(screen.getByTestId("plan-card").textContent).toContain("discarded");
  });

  it("a mid-plan failure halts with the ledger — what ran, what did not, and the four ways out", async () => {
    const id = openTab("plan");
    render(<AgentPanel />);
    void sendMessage(id, "halt: make the grove harder");
    await until(() => plan()?.status === "proposed");
    fireEvent.click(screen.getByText("Run plan · up to $0.64"));
    await until(() => plan()?.status === "halted");
    const card = screen.getByTestId("plan-card");
    expect(card.getAttribute("data-state")).toBe("halted");
    expect(card.textContent).toContain("plan · halted");
    expect(card.textContent).toContain("at step 4");
    expect(
      within(card)
        .getAllByTestId("plan-step")
        .filter((s) => s.getAttribute("data-status") === "done"),
    ).toHaveLength(3);
    expect(card.textContent).toContain("fal returned 429");
    expect(card.textContent).toContain("billed $0.12");
    expect(card.textContent).toContain("not started");
    for (const opt of ["Continue from step 4", "Skip to step 5", "Undo steps 1–3", "Stop here"]) {
      expect(within(card).getByText(opt)).toBeInTheDocument();
    }
    expect(card.textContent).toContain("cannot refund the $0.12");
    // The way out is the RESUME endpoint with an action token — never the
    // decision endpoint (a halted plan is not `proposed`), and never the
    // button's copy.
    const spy = vi.spyOn(scriptedAgent, "resumePlan");
    fireEvent.click(within(card).getByText("Skip to step 5"));
    await until(() => activeConversation()?.status === "idle");
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      plan()!.planId,
      expect.objectContaining({ action: "skip" }),
    );
    expect(plan()!.steps[3].status).toBe("skipped");
    expect(plan()!.steps[4].status).toBe("done");
  });
});

describe("Stop — one verb, three places", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("the header ⏹ stops a streaming reply mid-stream: no further deltas, the transcript says what landed", async () => {
    const id = openTab();
    render(<AgentPanel />);
    scriptedAgent.speed = 1;
    const p = sendMessage(id, "Why does 2-3 feel empty compared to 2-2?");
    await until(
      () => !!activeConversation()?.items.some((i) => i.kind === "assistant" && i.text.length > 0),
      6000,
    );
    const before = activeConversation()!.items.find((i) => i.kind === "assistant")?.text ?? "";
    fireEvent.click(within(screen.getByTestId("panel-header")).getByText("⏹ Stop"));
    await p;
    scriptedAgent.speed = 0;
    const conv = activeConversation()!;
    expect(conv.status).toBe("idle");
    expect(conv.items.some((i) => i.kind === "cancelled")).toBe(true);
    expect(screen.getByTestId("cancelled").textContent).toContain(
      "Stopped by you. Nothing new was started.",
    );
    // Nothing streamed after the stop: the text is the text at the stop (+ at most one in-flight word).
    const after = conv.items.find((i) => i.kind === "assistant")?.text ?? "";
    expect(after.length).toBeLessThanOrEqual(before.length + 40);
    expect(conv.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });

  it("Esc from the composer stops the reply", async () => {
    const id = openTab();
    render(<AgentPanel />);
    const spy = vi.spyOn(scriptedAgent, "stopConversation");
    scriptedAgent.speed = 1;
    const p = sendMessage(id, "Why does 2-3 feel empty?");
    await until(
      () =>
        activeConversation()?.status === "streaming" &&
        !activeConversation()!.id.startsWith("local_"),
    );
    fireEvent.keyDown(screen.getByLabelText("Message the agent"), { key: "Escape" });
    await p;
    scriptedAgent.speed = 0;
    expect(spy).toHaveBeenCalled();
    expect(activeConversation()!.items.some((i) => i.kind === "cancelled")).toBe(true);
  });

  it("stopping a paid run mid-generation keeps what landed and bills what ran", async () => {
    const id = openTab();
    render(<AgentPanel />);
    void sendMessage(id, "generate a cold variant of the hopper sprite");
    await until(() => activeConversation()?.status === "awaiting_approval");
    scriptedAgent.speed = 1;
    fireEvent.click(
      within(screen.getByTestId("paid-card")).getByText("Accept · spend up to $0.64"),
    );
    await waitFor(
      () => expect(screen.getByTestId("paid-card").getAttribute("data-state")).toBe("running"),
      { timeout: 4000 },
    );
    await until(
      () =>
        !!(
          activeConversation()?.items.find((i) => i.kind === "run") as RunItem | undefined
        )?.items.some(
          (t) => t.kind === "tool" && t.paid?.state === "running" && t.paid.done.length >= 1,
        ),
      6000,
    );
    fireEvent.click(within(screen.getByTestId("paid-card")).getByText("⏹ Stop"));
    scriptedAgent.speed = 0;
    await until(() => activeConversation()?.status === "idle", 6000);
    await waitFor(() => {
      expandRuns();
      expect(screen.getByTestId("paid-card").getAttribute("data-state")).toBe("stopped");
    });
    const card = screen.getByTestId("paid-card");
    expect(card.textContent).toContain("Stopped by you at");
    expect(card.textContent).toContain("✓ kept");
    expect(card.textContent).toContain("not started");
    expect(card.textContent).toContain("Nothing was rolled back");
    expect(useStore.getState().jobs[0].status).toBe("cancelled");
  });

  it("the job tray shares one list with an attribution column and per-row ⏹ calling cancel_job", async () => {
    useStore.getState().addJob({
      id: "j-editor",
      op: "layout",
      label: "Regenerate layout · 2-5",
      target: "l5",
      targetType: "levels",
      status: "running",
      ts: Date.now(),
    });
    useStore.getState().addJob({
      id: "j-agent",
      op: "sprite",
      label: "Generate sprites ×4",
      target: "ember_hopper",
      targetType: "enemies",
      status: "queued",
      ts: Date.now(),
      actor: "agent:conv_1/artist",
    });
    useStore.getState().setJobsOpen(true);
    render(<JobTray />);
    const attrs = screen.getAllByTestId("job-attr").map((a) => a.textContent);
    expect(attrs).toContain("you · editor buttons");
    expect(attrs.some((a) => a?.startsWith("agent:conv_1/artist"))).toBe(true);
    const stops = screen.getAllByTestId("job-stop");
    expect(stops).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Stop Generate sprites ×4"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("cancel_job", { jobId: "j-agent" }),
    );
    await waitFor(() =>
      expect(useStore.getState().jobs.find((j) => j.id === "j-agent")?.status).toBe("cancelled"),
    );
    fireEvent.click(screen.getByText(/Completed/));
    expect(screen.getByTestId("job-row").textContent).toContain("stopped");
    expect(within(screen.getByTestId("job-row")).getByText("Show me")).toBeInTheDocument();
  });

  it("CreateProgress gains Stop", () => {
    const onStop = vi.fn();
    render(<CreateProgress startedAt={Date.now()} paid onStop={onStop} />);
    fireEvent.click(screen.getByLabelText("Stop this run"));
    expect(onStop).toHaveBeenCalled();
  });

  it("stopConversation is a no-op for a tab that never reached the service", async () => {
    const id = openTab();
    const spy = vi.spyOn(scriptedAgent, "stopConversation");
    await stopConversation(id);
    expect(spy).not.toHaveBeenCalled();
    act(() => {});
  });
});
