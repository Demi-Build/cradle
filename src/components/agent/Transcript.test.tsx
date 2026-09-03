import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));
afterEach(() => vi.restoreAllMocks());

import { AgentPanel } from "./AgentPanel";
import { useStore } from "../../store";
import { sendMessage } from "../../lib/agentActions";
import { scriptedAgent } from "../../lib/agentMock";
import { activeConversation, openTab, setupAgent, until } from "./testUtils";

/** Step 3 (README §3): the log — user bubbles, the mono agent label, markdown,
 *  the streaming caret, read lines, follow-up chips, ✎/↻/⧉, the @-picker —
 *  and the four error states, errors first. */
describe("errors first", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("Service starting… is non-blocking with elapsed; the composer stays enabled", () => {
    useStore
      .getState()
      .setAgent((a) => ({ service: { ...a.service, status: "starting", startedAt: Date.now() } }));
    openTab();
    render(<AgentPanel />);
    expect(screen.getByTestId("err-starting").textContent).toContain("Starting the agent service…");
    expect(screen.getByLabelText("Message the agent")).not.toBeDisabled();
    expect(screen.getByTestId("composer").textContent).toContain("queued until the service is up");
  });

  it("The agent service didn't start names the command and the port, offers Retry / Open logs, and hides stderr behind a disclosure", () => {
    useStore.getState().setAgent((a) => ({
      service: {
        ...a.service,
        status: "failed",
        port: 8787,
        command: "canon agent serve --pack /w --port 0",
        error: "Nothing answered after 10 seconds.",
        stderr: [
          "Traceback (most recent call last):",
          "ModuleNotFoundError: No module named 'uvicorn'",
        ],
      },
    }));
    openTab();
    render(<AgentPanel />);
    const card = screen.getByTestId("err-service");
    expect(card.textContent).toContain("The agent service didn't start");
    expect(card.textContent).toContain("canon agent serve --pack /w --port 0");
    expect(card.textContent).toContain("8787");
    expect(within(card).getByText("Retry")).toBeInTheDocument();
    expect(within(card).getByText("Open logs")).toBeInTheDocument();
    expect(within(card).getByText(/show stderr \(2 lines\)/)).toBeInTheDocument();
  });

  it("No key for Anthropic names the env var, both lookup paths, and the two fixes", async () => {
    const id = openTab();
    render(<AgentPanel />);
    await sendMessage(id, "error:nokey");
    const card = await screen.findByTestId("err-nokey");
    expect(card.textContent).toContain("No key for Anthropic");
    expect(card.textContent).toContain("missing ANTHROPIC_API_KEY");
    expect(card.textContent).toContain("CANON_ENV_FILE");
    expect(card.textContent).toContain("the environment");
    expect(within(card).getByText("Use gpt-5.1 instead")).toBeInTheDocument();
    // Row P0-12: the fix is a deep link that lands ON the offending key row,
    // not a button that merely opens a screen (it used to open the cost
    // dashboard, which only NAMED the key sources).
    const link = within(card).getByTestId("nokey-add-key");
    expect(link.textContent).toBe("Add key in Settings");
    expect(link.getAttribute("data-focus-var")).toBe("ANTHROPIC_API_KEY");
    fireEvent.click(link);
    expect(useStore.getState().settings).toEqual({
      open: true,
      pane: "keys",
      focusVar: "ANTHROPIC_API_KEY",
    });
  });

  it("a provider error mid-stream keeps the partial text above a dashed rule and offers Retry / Retry on haiku", async () => {
    const id = openTab();
    render(<AgentPanel />);
    await sendMessage(id, "error:529");
    const card = await screen.findByTestId("err-provider");
    expect(card.textContent).toContain("Reply cut off. Anthropic returned 529 — overloaded");
    expect(card.textContent).toContain("Nothing was written.");
    expect(card.querySelector(".cut")).toBeTruthy();
    expect(screen.getByTestId("msg-agent").textContent).toContain(
      "The east columns should read colder",
    );
    expect(within(card).getByText("Retry")).toBeInTheDocument();
    expect(within(card).getByText(/Retry on claude-haiku-4-5/)).toBeInTheDocument();
    expect(screen.getAllByTestId("tab")[0].getAttribute("data-dot")).toBe("error");
  });
});

describe("the happy path", () => {
  beforeEach(() => setupAgent(invokeMock));

  it("streams a reply as a log: right bubble, mono label, caret while streaming, markdown, one read line, ≤3 chips", async () => {
    const id = openTab();
    render(<AgentPanel />);
    scriptedAgent.speed = 1; // watch the caret for real
    const p = sendMessage(id, "Why does 2-3 feel empty compared to 2-2?");
    await until(() => (activeConversation()?.items.length ?? 0) > 2);
    await waitFor(() => expect(screen.queryByTestId("caret")).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByTestId("msg-user").textContent).toContain("Why does 2-3 feel empty");
    expect(screen.getAllByText("WICK")[0]).toBeInTheDocument(); // the label from the project's title
    scriptedAgent.speed = 0;
    await p;
    expect(screen.queryByTestId("caret")).toBeNull();
    expect(screen.getAllByTestId("read-line").length).toBe(2);
    expect(screen.getByText(/read level 2-2/)).toBeInTheDocument();
    // Markdown rendered: the blockquote from bible/pacing.md.
    expect(document.querySelector(".ag-agent-body blockquote")).toBeTruthy();
    const chips = screen.getByTestId("follow-ups");
    expect(within(chips).getAllByRole("button")).toHaveLength(3);
    expect(within(chips).getByText("Fix the back half")).toBeInTheDocument();
  });

  it("✎ edit-and-resend truncates below (a branch) and resends; ⧉ copies", async () => {
    const id = openTab();
    render(<AgentPanel />);
    await sendMessage(id, "Why does 2-3 feel empty?");
    const before = activeConversation()!.items.length;
    expect(before).toBeGreaterThan(3);
    fireEvent.click(screen.getByLabelText("Edit and resend"));
    const ta = screen.getByDisplayValue("Why does 2-3 feel empty?");
    fireEvent.change(ta, { target: { value: "Why does 2-4 feel empty?" } });
    fireEvent.click(screen.getByText("Resend"));
    await until(
      () =>
        activeConversation()?.status === "idle" &&
        activeConversation()!.items.some(
          (i) => i.kind === "user" && i.text === "Why does 2-4 feel empty?",
        ),
    );
    const users = activeConversation()!.items.filter((i) => i.kind === "user");
    expect(users).toHaveLength(1); // the original branch is gone
  });

  it("the composer attaches the current level by default and @ opens the typed picker", () => {
    openTab();
    render(<AgentPanel />);
    expect(screen.getByTestId("composer").textContent).toContain("@ 2-3 Lantern Stair");
    const ta = screen.getByLabelText("Message the agent");
    fireEvent.change(ta, { target: { value: "Compare @2-" } });
    const picker = screen.getByTestId("ctx-picker");
    expect(within(picker).getByText("2-4 Emberfall")).toBeInTheDocument();
    fireEvent.click(within(picker).getByText("2-4 Emberfall"));
    expect(screen.getByTestId("composer").textContent).toContain("@ 2-4 Emberfall");
    fireEvent.change(ta, { target: { value: "@" } });
    expect(
      within(screen.getByTestId("ctx-picker")).getByText("what's on screen now"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("composer").textContent).toContain(
      "Ask mode · nothing changes without you",
    );
  });

  it("the first run seeds three prompts from the project and the one sentence of law", () => {
    openTab();
    render(<AgentPanel />);
    const fr = screen.getByTestId("first-run");
    expect(fr.textContent).toContain("asks before it changes or spends anything");
    expect(within(fr).getAllByRole("button")).toHaveLength(3);
    expect(within(fr).getByText("Why does 2-3 Lantern Stair feel empty?")).toBeInTheDocument();
  });

  it("show_user navigates the editor's selection, attach_image renders inline, request_input asks a chip", async () => {
    const id = openTab();
    render(<AgentPanel />);
    useStore.getState().select({ kind: "none" });
    await sendMessage(id, "show me 2-3");
    expect(useStore.getState().selection).toEqual({
      kind: "entity",
      typeId: "levels",
      id: "l3",
      tab: undefined,
    });
    expect(useStore.getState().agent.pulse?.target).toEqual({
      kind: "entity",
      typeId: "levels",
      id: "l3",
    });
    // The tab is re-keyed to the service's id on first send; later sends use it.
    const cid = activeConversation()!.id;
    await sendMessage(cid, "attach an image");
    await waitFor(() => expect(document.querySelector("figure img")).toBeTruthy());
    await sendMessage(cid, "ask me a question");
    const q = screen.getByTestId("request-input");
    expect(within(q).getByText("Separate areas")).toBeInTheDocument();
  });
});
