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

// ---------------------------------------------------------------------------
// The gate reads DISK, not the buffer.
//
// THE BUG: `canon dialogue improve` resolves its tree from the PACK and refuses
// an id that is not there — "npc 1001 has no tree '1001:tree_5'". The gate used
// to ask the unsaved buffer, so a tree that had only ever been authored in
// cradle passed it and canon refused AFTER the user had committed to a paid
// run. Improve is a disk read; its gate has to be one too.
// ---------------------------------------------------------------------------

/** An NPC with nothing on disk — every tree here can only come from the buffer. */
const BARE: NpcRow = { id: "1024", name: "Nobody", opening_greeting: "…" };

/** The op `＋ New tree` pushes: a tree that exists ONLY in the buffer. */
const addTree = (treeId: string) => ({
  k: "tree.add" as const,
  tree: treeId,
  label: "new tree",
  axis: null,
  rank: 1,
  nodes: { start: { node_id: "start", prompt: "" } },
});

/** The TOOLBAR's Improve. A treeless NPC's empty state carries a second,
 *  permanently disabled "Draft one with Improve", so a role query on the name
 *  alone is ambiguous there. */
const improveBtn = () => document.querySelector("button.dlg-improve") as HTMLButtonElement;

describe("improve is gated on what canon will see on disk", () => {
  it("a tree that exists only in the unsaved buffer does NOT unlock Improve", async () => {
    render(<DialogueSurface npc={BARE} npcId="1024" />);
    await screen.findByTestId("dialogue-surface");
    // Nothing anywhere: the reason says author one.
    expect(improveBtn()).toHaveAttribute("aria-disabled", "true");
    expect(improveBtn().getAttribute("title")).toContain("author a tree");

    act(() => {
      useStore.getState().pushDialogueOps("npc:1024", [addTree("1024:tree_1")]);
    });

    // The buffer now has a tree — and the gate still refuses, because the PACK
    // does not. This is the exact state that used to reach a paid call.
    await waitFor(() => expect(improveBtn().getAttribute("title")).toContain("save this tree"));
    expect(improveBtn()).toHaveAttribute("aria-disabled", "true");
    expect(improveBtn().getAttribute("title")).toContain(kbd("S"));
    // The reason is actionable and cites no plan document.
    expect(improveBtn().getAttribute("title")).not.toMatch(/row |phase |P0-|W2\./i);

    // ⌘K says the same thing, from the same computation.
    const cmd = (useStore.getState().commands.dialogue ?? []).find((c) => c.id === "dlg.improve")!;
    expect(cmd.enabled).toBe(false);
    expect(cmd.disabledReason).toContain("save this tree");

    // And clicking it opens nothing and calls nothing.
    fireEvent.click(improveBtn());
    expect(screen.queryByTestId("dialogue-improve")).toBeNull();
    expect(calls.some((c) => c.cmd === "dialogue_improve")).toBe(false);
  });

  it("the blocked Improve stays focusable and shows its reason on KEYBOARD FOCUS", async () => {
    render(<DialogueSurface npc={BARE} npcId="1024" />);
    await screen.findByTestId("dialogue-surface");
    const btn = improveBtn();
    // Greyed, but NOT `disabled` — a native disabled button leaves the tab
    // order and strands its reason on hover only.
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      btn.focus();
      fireEvent.focus(btn);
    });
    // And it is the app's ONE tooltip (`.tip`, portaled to <body>), not a
    // second implementation grown beside it.
    const tip = screen.getByRole("tooltip");
    expect(tip.className).toContain("tip");
    expect(tip.parentElement).toBe(document.body);
    expect(tip.textContent).toContain("author a tree");
    // Escape dismisses it without moving focus.
    act(() => {
      fireEvent.keyDown(btn, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(btn);

    act(() => {
      fireEvent.focus(btn);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      fireEvent.blur(btn);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on the scope that CAN run when the open tree is unsaved, and says why", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    act(() => {
      useStore.getState().pushDialogueOps("npc:1023", [addTree("1023:tree_2")]);
      useStore.getState().setActiveDialogueTree("npc:1023", "1023:tree_2");
    });
    // `1023:default` IS on disk, so Improve itself stays live…
    await waitFor(() => expect(improveBtn()).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(improveBtn());
    await screen.findByTestId("dialogue-improve");

    // …and the modal opens on the scope canon can serve, with the unsaved
    // tree's pill greyed and carrying the reason.
    const treePill = screen.getByTestId("improve-scope-tree");
    expect(treePill).toHaveAttribute("aria-disabled", "true");
    expect(treePill.getAttribute("title")).toContain("not in the saved pack yet");
    expect(screen.getByTestId("improve-scope-npc").className).toContain("active");
    // Nothing is BLOCKED — the run can go — but it is not the run the click
    // implied, and that is stated INLINE, not only in the greyed pill's tip.
    expect(screen.queryByTestId("improve-blocked")).toBeNull();
    const note = screen.getByTestId("improve-retargeted");
    expect(note.textContent).toContain("new tree is not in the saved pack yet");
    expect(note.textContent).toContain("Whisper-Tam's 1 saved tree");
    expect(note.textContent).toContain(kbd("S"));
    expect(note.textContent).not.toMatch(/row |phase |P0-|W2\./i);
    // The cost box says WHAT is being bought, not only how much.
    expect(screen.getByTestId("dialogue-improve").textContent).toContain(
      "Re-authors Whisper-Tam's 1 saved tree",
    );

    // The request that goes out names the SAVED scope — never the buffer tree.
    fireEvent.click(screen.getByTestId("improve-propose"));
    await screen.findAllByTestId("improve-row");
    const sent = invokeMock.mock.calls.find((c) => c[0] === "dialogue_improve")![1] as {
      scope: string;
      treeId: string | null;
    };
    expect(sent.scope).toBe("npc");
    expect(sent.treeId).toBeNull();
  });

  it("the PAID card names the trees the money re-authors, and the switch", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    act(() => {
      useStore.getState().pushDialogueOps("npc:1023", [addTree("1023:tree_2")]);
      useStore.getState().setActiveDialogueTree("npc:1023", "1023:tree_2");
    });
    await waitFor(() => expect(improveBtn()).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(improveBtn());
    await screen.findByTestId("dialogue-improve");
    fireEvent.change(screen.getByLabelText("improve backend"), { target: { value: "anthropic" } });
    fireEvent.click(screen.getByTestId("improve-propose"));
    await waitFor(() => expect(peekGate()).not.toBeNull());

    const opts = peekGate()!.opts as { title: string; body?: string };
    // Not "improve Whisper-Tam's dialogue" — the card has to say which trees,
    // because the tree on screen is NOT one of them.
    expect(opts.title).toContain("Whisper-Tam's 1 saved tree");
    expect(opts.body).toContain("Re-authors Whisper-Tam's 1 saved tree");
    expect(opts.body).toContain("new tree is not in the saved pack yet");
    // Still nothing sent to a provider.
    expect(calls.some((c) => c.cmd === "dialogue_improve")).toBe(false);
    act(() => settleGate(peekGate()!, false));
  });

  it("names the OPEN tree on the card when that tree is the one being bought", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-surface");
    fireEvent.click(await screen.findByText("✨ Improve…"));
    await screen.findByTestId("dialogue-improve");
    // `1023:default` is on disk, so the scope stays on the open tree and there
    // is no switch to warn about.
    expect(screen.getByTestId("improve-scope-tree").className).toContain("active");
    expect(screen.queryByTestId("improve-retargeted")).toBeNull();
    fireEvent.change(screen.getByLabelText("improve backend"), { target: { value: "anthropic" } });
    fireEvent.click(screen.getByTestId("improve-propose"));
    await waitFor(() => expect(peekGate()).not.toBeNull());
    const opts = peekGate()!.opts as { title: string; body?: string };
    expect(opts.title).toBe("improve Whisper-Tam's default tree");
    expect(opts.body).not.toContain("saved pack yet");
    act(() => settleGate(peekGate()!, false));
  });

  it("states the block inline on Propose — the screen's primary action — with the save that clears it", async () => {
    render(<DialogueSurface npc={BARE} npcId="1024" />);
    await screen.findByTestId("dialogue-surface");
    act(() => {
      useStore.getState().pushDialogueOps("npc:1024", [addTree("1024:tree_1")]);
    });
    // The toolbar refuses, so reach the modal the only other way there is: the
    // command's own `run`, which is what a stale palette entry would fire.
    const cmd = (useStore.getState().commands.dialogue ?? []).find((c) => c.id === "dlg.improve")!;
    act(() => cmd.run());
    await screen.findByTestId("dialogue-improve");

    expect(screen.getByTestId("improve-blocked").textContent).toContain("is saved yet");
    expect(screen.getByTestId("improve-blocked").textContent).toContain("then improve can read it");
    expect(screen.getByTestId("improve-propose")).toHaveAttribute("aria-disabled", "true");
    // Nothing paid can leave, even on a click.
    fireEvent.click(screen.getByTestId("improve-propose"));
    await waitFor(() => expect(peekGate()).toBeNull());
    expect(calls.some((c) => c.cmd === "dialogue_improve")).toBe(false);
    expect(wrote()).toBe(false);

    // The refusal carries the way out: save, from inside the refusal.
    fireEvent.click(screen.getByText("Save this dialogue"));
    expect(screen.queryByTestId("dialogue-improve")).toBeNull();
    expect(await screen.findByRole("dialog", { name: "Save dialogue" })).toBeInTheDocument();
  });
});
