import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());

import { AgentPanel } from "./AgentPanel";
import { ValidationBar } from "../ValidationBar";
import { useStore } from "../../store";
import { newConversationTab, sendMessage, setMode } from "../../lib/agentActions";
import { activeConversation, openTab, setupAgent, until } from "./testUtils";

/** Step 2 (README §2, §9): tabs + dots + sort rules, +, ⏱ history, the
 *  header's segmented control, the priced model picker with the
 *  disabled-with-reason entry, session cost, ⏹ while in flight, the status
 *  bar's specialist + N. */
describe("tabs, header, model picker", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("renders a tab per conversation with the status dot, and + opens a new one", async () => {
    openTab();
    render(<AgentPanel />);
    expect(screen.getAllByTestId("tab")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("New conversation"));
    expect(screen.getAllByTestId("tab")).toHaveLength(2);
    // A waiting tab shows amber and sorts ahead of idle ones.
    const id = activeConversation()!.id;
    void sendMessage(id, "Give the lantern-keeper a refusal line"); // chip in Ask mode
    await until(() => activeConversation()?.status === "awaiting_approval");
    await waitFor(() =>
      expect(screen.getAllByTestId("tab")[0].getAttribute("data-dot")).toBe("waiting"),
    );
    expect(screen.getAllByTestId("tab")[0].getAttribute("data-active")).toBe("1");
  });

  it("folds the tabs that do not fit into a +N button with a menu (README §2)", () => {
    // jsdom lays nothing out, so give the strip and the tabs a width: 160px
    // per tab in a 340px strip fits two, and the rest fold.
    const strip = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    const tab = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("ag-tabs-scroll") ? 340 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-tab-id") ? 160 : 0;
      },
    });
    try {
      openTab();
      newConversationTab();
      newConversationTab();
      newConversationTab();
      render(<AgentPanel />);
      const more = screen.getByTestId("tab-overflow");
      expect(more.textContent).toBe("+2");
      fireEvent.click(more);
      const menu = screen.getByTestId("tab-overflow-menu");
      expect(within(menu).getAllByRole("button")).toHaveLength(2);
      // Picking a folded conversation activates it.
      const pick = within(menu).getAllByRole("button")[0];
      const label = pick.textContent;
      fireEvent.click(pick);
      expect(activeConversation()!.title).toBe(label);
    } finally {
      if (strip) Object.defineProperty(HTMLElement.prototype, "clientWidth", strip);
      if (tab) Object.defineProperty(HTMLElement.prototype, "offsetWidth", tab);
    }
  });

  it("middle-click closes; a live run asks first", async () => {
    openTab();
    render(<AgentPanel />);
    const id = activeConversation()!.id;
    void sendMessage(id, "Give the lantern-keeper a refusal line");
    await until(() => activeConversation()?.status === "awaiting_approval");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent(
      screen.getAllByTestId("tab")[0],
      new MouseEvent("auxclick", { button: 1, bubbles: true }),
    );
    expect(confirm).toHaveBeenCalled();
    expect(screen.getAllByTestId("tab")).toHaveLength(1);
    confirm.mockReturnValue(true);
    fireEvent(
      screen.getAllByTestId("tab")[0],
      new MouseEvent("auxclick", { button: 1, bubbles: true }),
    );
    await waitFor(() => expect(screen.queryAllByTestId("tab")).toHaveLength(1)); // AgentPanel re-seeds one empty tab
    confirm.mockRestore();
  });

  it("the header shows Ask · Plan · Allow, the model with its price list, and ⏹ only while in flight", async () => {
    openTab();
    render(<AgentPanel />);
    const header = screen.getByTestId("panel-header");
    expect(within(header).getByRole("radio", { name: "Ask" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(within(header).getByRole("radio", { name: "Plan" }));
    expect(activeConversation()!.mode).toBe("plan");
    expect(within(header).queryByText("⏹ Stop")).toBeNull();
    // The picker: grouped by provider, per-1M on every entry, the kimi row
    // disabled at 50% with the reason naming the real key sources + Add key.
    await waitFor(() => expect(useStore.getState().agent.models.length).toBeGreaterThan(0));
    fireEvent.click(within(header).getByRole("button", { name: /claude-sonnet-4.6/ }));
    const menu = screen.getByTestId("model-menu");
    expect(within(menu).getByText("Anthropic")).toBeInTheDocument();
    expect(within(menu).getByText("OpenAI")).toBeInTheDocument();
    expect(within(menu).getByText("$3.00 / $15.00")).toBeInTheDocument();
    const kimi = within(menu).getByRole("menuitem", { name: /kimi-k2.6/ });
    expect(kimi).toBeDisabled();
    expect(kimi.getAttribute("data-unavailable")).toBe("1");
    expect(within(menu).getByTestId("model-reason").textContent).toContain("MOONSHOT_API_KEY");
    expect(within(menu).getByTestId("model-reason").textContent).toContain("CANON_ENV_FILE");
    // Row P0-12: `Add key` deep-links to that provider's row in Settings →
    // API keys, carrying the very env var the reason just named.
    const addKey = within(menu).getByTestId("model-add-key");
    expect(addKey.textContent).toBe("Add key");
    expect(addKey.getAttribute("data-focus-var")).toBe("MOONSHOT_API_KEY");
    fireEvent.click(addKey);
    expect(useStore.getState().settings).toEqual({
      open: true,
      pane: "keys",
      focusVar: "MOONSHOT_API_KEY",
    });
    useStore.getState().closeSettings();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /gpt-5.1/ }));
    expect(activeConversation()!.model).toBe("gpt-5.1");
    // Sending shows ⏹ Stop in the header while the reply streams.
    setMode(activeConversation()!.id, "ask");
    void sendMessage(activeConversation()!.id, "Give the lantern-keeper a refusal line");
    await until(() => activeConversation()?.status === "awaiting_approval");
    expect(within(screen.getByTestId("panel-header")).getByText("⏹ Stop")).toBeInTheDocument();
  });

  it("⏱ lists past conversations for this project", async () => {
    openTab();
    render(<AgentPanel />);
    const id = activeConversation()!.id;
    await sendMessage(id, "Why does 2-3 feel empty?");
    fireEvent.click(screen.getByLabelText("History"));
    const menu = await screen.findByTestId("history-menu");
    await waitFor(() => expect(within(menu).getAllByRole("button").length).toBeGreaterThan(0));
    expect(within(menu).getByText("history · this project")).toBeInTheDocument();
  });

  it("the status bar names the active conversation's specialist and +N for the others", async () => {
    const a = openTab();
    render(
      <>
        <AgentPanel />
        <ValidationBar />
      </>,
    );
    void sendMessage(a, "Add a second enemy tier to 2-3 and 2-4");
    await until(() => activeConversation()?.status === "awaiting_approval");
    expect(screen.getByTestId("status-agent").textContent).toMatch(/level designer|artist/);
    act(() => {
      newConversationTab();
    });
    expect(screen.getByTestId("status-agent").textContent).toContain("+1");
  });
});
