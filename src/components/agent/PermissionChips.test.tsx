import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());

import { AgentPanel } from "./AgentPanel";
import { PermissionChips, GrantedLine } from "./PermissionChips";
import { sendMessage } from "../../lib/agentActions";
import { scriptedAgent } from "../../lib/agentMock";
import { useStore } from "../../store";
import { activeConversation, expandRuns, openTab, setupAgent, until } from "./testUtils";

/** Step 5 (README §6): chip copy and buttons, the footnote naming tool +
 *  project, disabled-with-a-reason in Ask mode, paid without the middle
 *  button, the granted quiet line, the rejected collapse, and decisions
 *  reaching the service. */
describe("permission chips", () => {
  beforeEach(() => setupAgent(invokeMock));

  const perm = {
    requestId: "perm_1",
    tool: "import_level_grids",
    specialist: "level_designer",
    target: "import grids into 2-4",
    tier: "ask",
    mode: "allow",
    alwaysAllowed: true,
    alwaysReason: null,
    pack: "/w",
  };

  it("copy is ‹Specialist› wants to ‹verb› ‹target›, with the three buttons and the scoped footnote", () => {
    const onDecide = vi.fn();
    render(<PermissionChips perm={perm} onDecide={onDecide} />);
    const chip = screen.getByTestId("perm-chip");
    expect(
      within(chip).getByText("Level designer wants to import grids into 2-4."),
    ).toBeInTheDocument();
    expect(within(chip).getByText("Accept")).toBeInTheDocument();
    expect(within(chip).getByText("Always allow in this project")).toBeInTheDocument();
    expect(within(chip).getByText("Reject")).toBeInTheDocument();
    expect(chip.textContent).toContain(
      "“Always allow” covers import_level_grids for The Wandering Wick only. Revoke in Settings → Permissions.",
    );
    fireEvent.click(within(chip).getByText("Always allow in this project"));
    expect(onDecide).toHaveBeenCalledWith("always");
  });

  it("in Ask mode the middle button is disabled with the reason underneath — never hidden", () => {
    render(
      <PermissionChips
        perm={{
          ...perm,
          mode: "ask",
          alwaysAllowed: false,
          alwaysReason: "grants are made in Allow mode",
        }}
        onDecide={() => {}}
      />,
    );
    const btn = screen.getByText("Always allow in this project");
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("perm-reason").textContent).toBe(
      "Disabled in Ask mode — standing grants are only offered in Allow mode.",
    );
  });

  it("paid never shows the middle button", () => {
    render(
      <PermissionChips
        perm={{ ...perm, tier: "paid", alwaysAllowed: false, alwaysReason: "paid" }}
        onDecide={() => {}}
      />,
    );
    expect(screen.queryByText("Always allow in this project")).toBeNull();
    expect(
      screen.getByText("Paid work is never covered by “always allow”. Every spend asks."),
    ).toBeInTheDocument();
  });

  it("already granted is a quiet mono line, no chip", () => {
    render(<GrantedLine specialist="level_designer" what="imported 1 grid into 2-4" />);
    expect(screen.getByTestId("perm-granted").textContent).toBe(
      "✓ Level designer imported 1 grid into 2-4 · allowed in this project",
    );
  });

  it("rejected collapses to what did not happen, with Allow after all / Tell it why", () => {
    render(
      <PermissionChips
        perm={{ ...perm, decision: "reject", insteadNote: "Skipped the checkpoint pass." }}
        onDecide={() => {}}
        onAllowAfterAll={() => {}}
        onTellWhy={() => {}}
      />,
    );
    const card = screen.getByTestId("perm-rejected");
    expect(card.textContent).toContain("Rejected. Level designer did not import grids into 2-4.");
    expect(card.textContent).toContain("Skipped the checkpoint pass.");
    expect(within(card).getByText("Allow after all")).toBeInTheDocument();
    expect(within(card).getByText("Tell it why")).toBeInTheDocument();
  });

  it("decisions POST to the service: accept runs the write; always writes a grant; the next run under the grant is the quiet line", async () => {
    const spy = vi.spyOn(scriptedAgent, "decidePermission");
    const id = openTab("allow");
    render(<AgentPanel />);
    void sendMessage(id, "rewrite the refusal line on whisper-tam");
    await until(() => activeConversation()?.status === "awaiting_approval");
    const chip = await screen.findByTestId("perm-chip");
    expect(chip.textContent).toContain("Writer wants to rewrite 3 dialogue nodes on whisper-tam.");
    fireEvent.click(within(chip).getByText("Always allow in this project"));
    await until(() => activeConversation()?.status === "idle");
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ decision: "always" }),
    );
    expect(useStore.getState().agent.grants.map((g) => g.tool)).toContain("update_row");
    await waitFor(() => {
      expandRuns();
      expect(screen.getByTestId("perm-granted-now")).toBeInTheDocument();
    });
    // The same write again: no chip, the quiet ✓ line.
    await sendMessage(activeConversation()!.id, "rewrite the refusal line on whisper-tam");
    await waitFor(() => {
      expandRuns();
      expect(screen.getAllByTestId("perm-granted").length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("perm-chip")).toBeNull();
  });

  it("reject makes the tool fail and the card says what the agent did instead", async () => {
    const id = openTab();
    render(<AgentPanel />);
    void sendMessage(id, "rewrite the refusal line on whisper-tam");
    await until(() => activeConversation()?.status === "awaiting_approval");
    fireEvent.click(within(await screen.findByTestId("perm-chip")).getByText("Reject"));
    await until(() => activeConversation()?.status === "idle");
    await waitFor(() => {
      expandRuns();
      expect(screen.getByTestId("perm-rejected")).toBeInTheDocument();
    });
    const card = screen.getByTestId("perm-rejected");
    expect(card.textContent).toContain("Writer did not rewrite 3 dialogue nodes on whisper-tam.");
    expect(card.textContent).toContain("Left the nodes as they were");
  });
});
