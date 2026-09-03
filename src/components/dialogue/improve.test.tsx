// Step 13: improve + polish.
//
// THE CLAIM: an LLM re-author is NEVER a write. `canon dialogue improve` is a
// proposal; accepting rows turns them into ordinary `node.prompt` /
// `choice.text` ops in the UNSAVED buffer, `⌘Z` undoes them and `⌘S` is still
// the only writer. Every test here that touches the modal asserts that no
// `dialogue_update` was sent.
//
// And doctrine 3, run one way: `fake` / `none` are $0 and NEVER raise the spend
// card; anything else always asks, estimate or no estimate. Nothing in this
// build calls a real provider — the paid path stops at the card.
//
// Plus the polish audit: ⌘K registration with disabled reasons, `/` search,
// `⌘I`, and the keyboard hints rendered through `kbd()`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { DialogueSurface } from "./DialogueSurface";
import { improveRowToOps } from "./ops";
import { peekGate, settleGate } from "../agent/confirmGateState";
import { useStore } from "../../store";
import { USER_ACTOR } from "../../lib/actor";
import { kbd } from "../../lib/keys";
import type { NpcRow } from "./model";
import type { ImproveRow } from "../../lib/invoke";

const NPC: NpcRow = {
  id: "1023",
  name: "Whisper-Tam",
  dialogue_trees: [
    {
      tree_id: "1023:default",
      character_id: "1023",
      label: "default",
      axis: null,
      selector: null,
      rank: 999,
      entry_node_id: "start",
      nodes: {
        start: {
          node_id: "start",
          prompt: "The voices sing  ",
          choices: [{ text: "Ask", next_node_id: "voices", conditions: [], effects: [] }],
        },
        voices: { node_id: "voices", prompt: "Harmony.", choices: [] },
      },
    },
  ],
};

const ROWS: ImproveRow[] = [
  {
    target: "tree:1023:default/node:start",
    tree: "1023:default",
    node_id: "start",
    choice: null,
    field: "prompt",
    before: "The voices sing  ",
    after: "The voices sing.",
    why: "trimmed stray whitespace and added the missing sentence-ending mark",
  },
  {
    target: "tree:1023:default/node:start/choice:0",
    tree: "1023:default",
    node_id: "start",
    choice: 0,
    field: "text",
    before: "Ask",
    after: "Ask.",
    why: "added the missing sentence-ending mark",
  },
];

const calls: { cmd: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    calls.push({ cmd, args: {} });
    if (cmd === "dialogue_improve") {
      return Promise.resolve({
        npc: "1023",
        requested_by: USER_ACTOR,
        backend_note: "no chat backend selected — this is the built-in deterministic copy pass",
        source: "dialogue_trees",
        scope: "tree",
        trees: ["1023:default"],
        instruction: "",
        keep_structure: true,
        backend: "fake",
        proposal: { rows: ROWS, count: ROWS.length },
        gen: { backend: "fake", model: null },
        cost: { usd: 0, paid: false },
        wrote: false,
        apply_with: "canon dialogue update --ops (node.prompt / choice.text)",
      });
    }
    if (cmd === "dialogue_show") {
      return Promise.resolve({
        npc: "1023",
        source: "dialogue_trees",
        storage_field: "dialogue_trees",
        legacy_fields: [],
        legacy_written: [],
        engine: { id: null, evaluable_namespaces: null },
        selector_axes: [],
        trees: [],
        scenes: [],
        warnings: [],
      });
    }
    return Promise.resolve({
      npc: "1023",
      source: "dialogue_trees",
      trees: 1,
      errors: [],
      warnings: [],
    });
  });
  useStore.setState({
    dialogue: { mode: "edit", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: null },
    entities: {},
    commands: {},
  });
});

const wrote = () => calls.some((c) => c.cmd === "dialogue_update" || c.cmd === "scene_update");

async function openImprove() {
  render(<DialogueSurface npc={NPC} npcId="1023" />);
  fireEvent.click(await screen.findByText("✨ Improve…"));
  return screen.findByTestId("dialogue-improve");
}

describe("improve writes nothing", () => {
  it("the proposal itself is a read — no update verb is sent", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    await screen.findAllByTestId("improve-row");
    expect(calls.some((c) => c.cmd === "dialogue_improve")).toBe(true);
    expect(wrote()).toBe(false);
  });

  it("accepting rows lands them in the UNSAVED BUFFER, still writing nothing", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    const rows = await screen.findAllByTestId("improve-row");
    fireEvent.click(rows[0].querySelector("button.pri")!);
    fireEvent.click(screen.getByText("Apply 1 accepted change"));
    await waitFor(() => expect(useStore.getState().dialogue.buffers["npc:1023"]?.cursor).toBe(1));
    expect(useStore.getState().dialogue.buffers["npc:1023"].ops[0]).toMatchObject({
      k: "node.prompt",
      node_id: "start",
      value: "The voices sing.",
    });
    expect(wrote()).toBe(false);
  });

  it("⌘Z still undoes an applied proposal — it is an ordinary edit", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    const rows = await screen.findAllByTestId("improve-row");
    fireEvent.click(rows[0].querySelector("button.pri")!);
    fireEvent.click(screen.getByText("Apply 1 accepted change"));
    await waitFor(() => expect(useStore.getState().dialogue.buffers["npc:1023"]?.cursor).toBe(1));
    // Both modifiers, one at a time: `isShortcut` is deliberately
    // platform-EXCLUSIVE, so the test presses whichever this runner is.
    act(() => {
      fireEvent.keyDown(window, { key: "z", metaKey: true, ctrlKey: false });
      fireEvent.keyDown(window, { key: "z", metaKey: false, ctrlKey: true });
    });
    await waitFor(() => expect(useStore.getState().dialogue.buffers["npc:1023"].cursor).toBe(0));
  });

  it("SKIPPED rows never leave the modal", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    const rows = await screen.findAllByTestId("improve-row");
    fireEvent.click(rows[0].querySelector("button.pri")!);
    fireEvent.click(rows[1].querySelector("button.pri")!);
    // Skip the second one back out again.
    fireEvent.click([...rows[1].querySelectorAll("button")].find((b) => b.textContent === "Skip")!);
    fireEvent.click(screen.getByText("Apply 1 accepted change"));
    await waitFor(() => expect(useStore.getState().dialogue.buffers["npc:1023"]?.cursor).toBe(1));
  });

  // `canon dialogue improve` resolves the row from DISK and is handed no
  // buffer, so a proposal can be a rewrite of prose the buffer already changed
  // — or of a node an unsaved delete removed, which `applyOps` refuses with an
  // OpError out of the click handler. Each row is reconciled first.
  it("disables a row whose text the buffer already changed, with the reason", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    const rows = await screen.findAllByTestId("improve-row");
    expect(rows[0].querySelector("button.pri")).not.toBeDisabled();
    // Edit the same prompt in the buffer, then look again.
    act(() => {
      useStore
        .getState()
        .pushDialogueOps("npc:1023", [
          { k: "node.prompt", tree: "1023:default", node_id: "start", value: "mine" },
        ]);
    });
    const after = await screen.findAllByTestId("improve-row");
    expect(after[0].querySelector("button.pri")).toBeDisabled();
    expect(after[0].textContent).toContain("after improve read the saved pack");
    expect(wrote()).toBe(false);
  });

  it("disables a row whose node an unsaved delete removed, instead of throwing", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    await screen.findAllByTestId("improve-row");
    act(() => {
      useStore
        .getState()
        .pushDialogueOps("npc:1023", [
          { k: "node.remove", tree: "1023:default", node_id: "start" },
        ]);
    });
    const rows = await screen.findAllByTestId("improve-row");
    for (const row of rows) {
      expect(row.querySelector("button.pri")).toBeDisabled();
      expect(row.textContent).toContain("was deleted in an unsaved edit");
    }
    expect(wrote()).toBe(false);
  });

  it("improveRowToOps maps the two structure-preserving fields and drops the rest", () => {
    expect(improveRowToOps(ROWS)).toEqual([
      { k: "node.prompt", tree: "1023:default", node_id: "start", value: "The voices sing." },
      { k: "choice.text", tree: "1023:default", node_id: "start", index: 0, value: "Ask." },
    ]);
    expect(improveRowToOps([{ ...ROWS[0], field: "next_node_id", after: "elsewhere" }])).toEqual(
      [],
    );
  });
});

describe("the paid signals (doctrine 3)", () => {
  it("a $0 backend never raises the spend card", async () => {
    await openImprove();
    fireEvent.click(screen.getByText("Propose — $0"));
    await screen.findAllByTestId("improve-row");
    expect(peekGate()).toBeNull();
  });

  it("a $0 backend reads as $0 in all three places", async () => {
    const modal = await openImprove();
    expect(modal.textContent).toContain("$0 · fake");
    expect(modal.textContent).toContain("free run");
    expect(modal.textContent).toContain("A $0 backend never raises the spend card");
    expect(screen.queryByTestId("improve-paid-chip")).toBeNull();
  });

  it("a PAID backend reads as paid three times and stops at the card", async () => {
    const modal = await openImprove();
    fireEvent.change(screen.getByLabelText("improve backend"), {
      target: { value: "anthropic" },
    });
    // 1. the header chip
    expect(screen.getByTestId("improve-paid-chip").textContent).toContain("paid · anthropic");
    // 2. the cost-box label
    expect(modal.textContent).toContain("paid run");
    // 3. the estimate figure, at 17px mono, plus where the key comes from
    expect(modal.querySelector(".dlg-improve-cost-figure")).toBeTruthy();
    expect(modal.textContent).toContain("CANON_ENV_FILE");
    fireEvent.click(screen.getByText("Propose — paid run"));
    await waitFor(() => expect(peekGate()).not.toBeNull());
    // The gate is open and NOTHING has been sent to a provider.
    expect(calls.some((c) => c.cmd === "dialogue_improve")).toBe(false);
    expect(peekGate()!.kind).toBe("spend");
    act(() => settleGate(peekGate()!, false));
  });

  it("carries the Edit-prompt disclosure DISABLED with its reason, not hidden", async () => {
    const modal = await openImprove();
    const toggle = [...modal.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Edit prompt (advanced)"),
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBe(true);
    expect(toggle.textContent).toContain("takes no override yet");
  });
});

describe("the polish audit", () => {
  it("registers the Dialogue commands with disabled REASONS, never hidden", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    const cmds = useStore.getState().commands.dialogue ?? [];
    const byId = Object.fromEntries(cmds.map((c) => [c.id, c]));
    expect(byId["dlg.improve"].enabled).toBe(true);
    // A tree with no selector siblings: the router command is disabled and says
    // why rather than disappearing.
    expect(byId["dlg.selector"].enabled).toBe(false);
    expect(byId["dlg.selector"].disabledReason).toContain("one tree");
    // No engine block on this pack, so the lag command is disabled with a reason.
    expect(byId["dlg.enginelag"].enabled).toBe(false);
    expect(byId["dlg.enginelag"].disabledReason).toContain("evaluates every gate");
    for (const cmd of cmds) {
      if (cmd.enabled === false) expect(cmd.disabledReason).toBeTruthy();
    }
  });

  it("renders every keyboard hint through kbd(), so ⌘ vs Ctrl is the reader's", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    const hints = [...document.querySelectorAll(".kbd")].map((n) => n.textContent ?? "");
    expect(hints).toContain(kbd("S"));
    expect(hints).toContain(kbd("P"));
    // The literal "⌘S" must never be baked in on a non-mac reader.
    const cmds = useStore.getState().commands.dialogue ?? [];
    const save = cmds.find((c) => c.id === "dlg.save")!;
    expect(save.hint).toBe(kbd("S"));
    expect(cmds.find((c) => c.id === "dlg.tray")!.hint).toBe(kbd("I"));
  });

  it("`/` opens node search and `⌘I` toggles the tray", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    act(() => {
      fireEvent.keyDown(window, { key: "/" });
    });
    expect(
      await screen.findByPlaceholderText("Search ids, prose and condition tokens…"),
    ).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByPlaceholderText("Search ids, prose and condition tokens…")).toBeNull();

    expect(screen.getByTestId("dialogue-inspector")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "i", metaKey: true, ctrlKey: false });
      fireEvent.keyDown(window, { key: "i", metaKey: false, ctrlKey: true });
    });
    await waitFor(() => expect(screen.queryByTestId("dialogue-inspector")).toBeNull());
  });
});
