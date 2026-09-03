import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());
vi.mock("../DetailPane", () => ({ DetailPane: () => <div data-testid="detail" /> }));

import App from "../../App";
import { useStore } from "../../store";
import { AGENT_W_DEFAULT, COLLAPSE_TOAST } from "../../lib/agentLayout";
import { setPanel } from "../../lib/agentActions";
import { IS_MAC } from "../../lib/keys";
import { setupAgent } from "./testUtils";

/** Step 1 (README §1): the column, the rail, resize + persistence, the
 *  responsive rules, NotesDrawer stacking, focus mode. */
describe("the agent column", () => {
  beforeEach(() => {
    setupAgent(invokeMock);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  });

  it("mounts as the third shell column at the persisted width, and the TopBar toggle collapses it to the rail", () => {
    render(<App />);
    const app = document.querySelector(".app")!;
    expect(app.getAttribute("data-agent")).toBe("open");
    expect((app as HTMLElement).style.getPropertyValue("--agent-w")).toBe("412px");
    expect(screen.getByTestId("agent-panel")).toBeInTheDocument();
    // README §1: "Collapsed is a 40px rail, NOT a hidden panel"; the top bar
    // icon cycles expanded ⇄ rail. Focus mode is what hides the column.
    fireEvent.click(screen.getByTestId("agent-toggle"));
    expect(app.getAttribute("data-agent")).toBe("rail");
    fireEvent.click(screen.getByTestId("agent-toggle"));
    expect(app.getAttribute("data-agent")).toBe("open");
    act(() => setPanel({ collapsed: true }));
    expect(app.getAttribute("data-agent")).toBe("rail");
    expect(screen.getByTestId("agent-rail")).toBeInTheDocument();
    expect(screen.getByTestId("rail-cost").textContent).toContain("session");
    // The rail's expand button brings the panel back.
    fireEvent.click(screen.getByLabelText("Expand the agent panel"));
    expect(app.getAttribute("data-agent")).toBe("open");
  });

  it("⌘⇧A toggles and the pref persists per device", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "A", metaKey: IS_MAC, ctrlKey: !IS_MAC, shiftKey: true });
    expect(useStore.getState().agentUi.collapsed).toBe(true);
    expect(useStore.getState().agentUi.open).toBe(true);
    expect(JSON.parse(localStorage.getItem("cradle.agent.ui.v1")!).collapsed).toBe(true);
    fireEvent.keyDown(window, { key: "A", metaKey: IS_MAC, ctrlKey: !IS_MAC, shiftKey: true });
    expect(useStore.getState().agentUi.collapsed).toBe(false);
  });

  it("drags the handle within 340–720 and double-click resets to 412", () => {
    render(<App />);
    const handle = screen.getByTestId("agent-handle");
    fireEvent.mouseDown(handle, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 900 }); // 100px wider
    expect(useStore.getState().agentUi.width).toBe(512);
    expect(screen.getByText("512 px")).toBeInTheDocument(); // the mono readout
    fireEvent.mouseMove(window, { clientX: 0 }); // way past max
    expect(useStore.getState().agentUi.width).toBe(720);
    fireEvent.mouseUp(window);
    fireEvent.doubleClick(handle);
    expect(useStore.getState().agentUi.width).toBe(AGENT_W_DEFAULT);
  });

  it("auto-collapses to the rail with a one-time toast on a narrow resize, and never fights an explicit re-expand", () => {
    render(<App />);
    const app = document.querySelector(".app")!;
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1300 }); // 676 remaining
      window.dispatchEvent(new Event("resize"));
    });
    expect(app.getAttribute("data-agent")).toBe("rail");
    expect(screen.getByTestId("agent-toast").textContent).toBe(COLLAPSE_TOAST);
    // Re-expanding at the same narrow width is allowed and remembered — and
    // below 900 remaining the editor's floating panels reflow (data-narrow).
    fireEvent.click(screen.getByLabelText("Expand the agent panel"));
    expect(app.getAttribute("data-agent")).toBe("open");
    expect(app.getAttribute("data-narrow")).toBe("1");
    // Only another RESIZE re-fires the rule — and the toast is once per window session.
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(app.getAttribute("data-agent")).toBe("rail");
    expect(useStore.getState().agent.collapseToastShown).toBe(true);
    // The rail costs 40px, so main is wide again.
    expect(app.getAttribute("data-narrow")).toBe("0");
  });

  it("dims and blocks the panel while notes are open; focus mode hides it and the rail returns on exit", () => {
    render(<App />);
    act(() => useStore.getState().setDrawerOpen(true));
    expect(screen.getByTestId("agent-panel").getAttribute("data-dimmed")).toBe("1");
    expect(screen.getByTestId("agent-panel").getAttribute("aria-hidden")).toBe("true");
    act(() => useStore.getState().setDrawerOpen(false));
    expect(screen.getByTestId("agent-panel").getAttribute("data-dimmed")).toBe("0");
    act(() => setPanel({ collapsed: true }));
    act(() => useStore.getState().setLayout({ focusMode: true }));
    expect(document.querySelector(".app")!.getAttribute("data-agent")).toBe("off");
    expect(screen.queryByTestId("agent-rail")).toBeNull();
    act(() => useStore.getState().setLayout({ focusMode: false }));
    expect(screen.getByTestId("agent-rail")).toBeInTheDocument();
  });

  it("the command palette offers Ask agent…", () => {
    render(<App />);
    const cmds = Object.values(useStore.getState().commands).flat();
    expect(cmds.find((c) => c.id === "app.agent")?.label).toBe("Ask agent…");
  });
});
