// Step 8: the tester dock. Collapsed first (`StateChips` + `useDialogueTest`
// over `canon dialogue test`), then expanded with `StatePanel`, checkpoints and
// unreachable reporting.
//
// The claim every assertion defends: THE UI NEVER EVALUATES A GATE. Each
// verdict on screen is canon's answer rendered — the tests assert the round
// trip happened and that the UNSAVED buffer was what travelled.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { DialogueSurface } from "./DialogueSurface";
import { useStore } from "../../store";
import type { NpcRow } from "./model";

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
          prompt: "The voices sing.",
          choices: [
            { text: "Ask.", next_node_id: "voices", conditions: [], effects: [] },
            {
              text: "I brought the shard.",
              next_node_id: "reward",
              conditions: ["has_item:item_resonance_shard", "quest:q1:active"],
              effects: ["takes_item:item_resonance_shard"],
            },
            {
              text: "Wait for the transmission.",
              next_node_id: null,
              conditions: ["time:night"],
              effects: [],
            },
          ],
        },
        voices: { node_id: "voices", prompt: "Harmony.", choices: [] },
        reward: { node_id: "reward", prompt: "It sings home.", choices: [] },
      },
    },
  ],
};

type Call = { cmd: string; args: Record<string, unknown> };
const calls: Call[] = [];

const WALK = {
  tree_id: "1023:default",
  entry_node_id: "start",
  node: { node_id: "start", speaker: "1023", prompt: "The voices sing.", terminal: false },
  choices: [
    {
      index: 0,
      text: "Ask.",
      next_node_id: "voices",
      dangling: false,
      effects: [],
      pass: true,
      conditions: [],
      failing_condition: null,
      failing_reason: null,
      unevaluable: [],
    },
    {
      index: 1,
      text: "I brought the shard.",
      next_node_id: "reward",
      dangling: false,
      effects: [],
      pass: false,
      conditions: [
        {
          token: "has_item:item_resonance_shard",
          namespace: "has_item",
          pass: true,
          reason: "in inventory",
          verdict: "pass",
          engine_evaluable: true,
          engine_reason: null,
        },
        {
          token: "quest:q1:active",
          namespace: "quest",
          pass: false,
          reason: "quest is offered, not active",
          verdict: "fail",
          engine_evaluable: true,
          engine_reason: null,
        },
      ],
      failing_condition: "quest:q1:active",
      failing_reason: "quest:q1:active — quest is offered, not active",
      unevaluable: [],
    },
    {
      index: 2,
      text: "Wait for the transmission.",
      next_node_id: null,
      dangling: false,
      effects: [],
      pass: true,
      conditions: [
        {
          token: "time:night",
          namespace: "time",
          pass: true,
          reason: "clock is night",
          verdict: "unevaluable",
          engine_evaluable: false,
          engine_reason: "the engine does not evaluate 'time' at tree scope",
        },
      ],
      failing_condition: null,
      failing_reason: null,
      unevaluable: ["time:night"],
    },
  ],
  gates: { pass: 1, fail: 1, unevaluable: 1, error: 0 },
  state: {},
  post_effect_state: {},
  fired: [],
  chose: null,
  next_node_id: null,
};

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "dialogue_test") {
      if (args.choose === 0) {
        return Promise.resolve({
          ...WALK,
          chose: 0,
          next_node_id: "voices",
          fired: [
            {
              token: "set_flag:heard",
              namespace: "set_flag",
              applied: true,
              detail: "flag heard set",
              engine_evaluable: true,
              engine_reason: null,
            },
          ],
          post_effect_state: { flags: { heard: true }, inventory: {}, quests: {} },
        });
      }
      return Promise.resolve(WALK);
    }
    if (cmd === "dialogue_select") {
      return Promise.resolve({
        npc: "1023",
        source: "dialogue_trees",
        selected: "1023:default",
        selected_label: "default",
        trees: [{ tree_id: "1023:default", status: "selected", why_not: null }],
        engine: {
          id: "godot",
          selected: "1023:default",
          legacy_slot: null,
          diverges: false,
          reason: null,
        },
        state: {},
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
    dialogue: { mode: "test", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: null },
    entities: {},
    commands: {},
  });
});

const testCalls = () => calls.filter((c) => c.cmd === "dialogue_test");

describe("the collapsed dock", () => {
  it("walks the UNSAVED buffer — the tree travels as a payload, never a pack lookup", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await waitFor(() => expect(testCalls().length).toBeGreaterThan(0));
    const payload = testCalls()[0].args.tree as { tree_id: string };
    expect(payload.tree_id).toBe("1023:default");
    expect(testCalls()[0].args).not.toHaveProperty("npc");
  });

  it("renders canon's verdicts, not its own — pass, fail and unevaluable", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    await waitFor(() => expect(dock.querySelectorAll(".dlg-verdict").length).toBe(3));
    const verdicts = [...dock.querySelectorAll(".dlg-verdict")].map((n) =>
      n.getAttribute("data-verdict"),
    );
    expect(verdicts).toEqual(["pass", "fail", "unevaluable"]);
  });

  it("names the failing condition and leaves the passing one reading as passing", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    await waitFor(() => expect(dock.textContent).toContain("quest is offered, not active"));
    expect(dock.textContent).toContain("has_item:item_resonance_shard ✓ in inventory");
    expect(dock.textContent).toContain("Blocked by 1 of 2 conditions");
    expect(dock.textContent).toContain("Set the quest active");
  });

  it("keeps a FAILING choice unclickable and an UNEVALUABLE one clickable", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    await waitFor(() => expect(dock.querySelectorAll(".dlg-verdict").length).toBe(3));
    const takes = [...dock.querySelectorAll(".dlg-verdict-take")] as HTMLButtonElement[];
    expect(takes[1].disabled).toBe(true);
    expect(takes[2].disabled).toBe(false);
  });

  it("states the split verdict on an unevaluable gate", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    await waitFor(() =>
      expect(dock.textContent).toContain("the engine does not evaluate 'time' at tree scope"),
    );
  });

  it("aggregates the gate tally in the dock header", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    await waitFor(() =>
      expect(dock.textContent).toContain("gates 1 pass · 1 fail · 1 unevaluable"),
    );
  });

  it("says it is testing the unsaved buffer when the buffer is dirty", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    act(() => {
      useStore
        .getState()
        .pushDialogueOps("npc:1023", [
          { k: "node.prompt", tree: "1023:default", node_id: "start", value: "changed" },
        ]);
    });
    const dock = await screen.findByTestId("dialogue-dock");
    expect(dock.textContent).toContain("testing the unsaved buffer");
  });

  it("shows the compact state chips and re-asks canon when one changes", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const chips = await screen.findByTestId("dialogue-state-chips");
    expect(chips.textContent).toContain("simulated · never written to the pack");
    const before = testCalls().length;
    fireEvent.change(screen.getByLabelText("clock window"), { target: { value: "night" } });
    await waitFor(() => expect(testCalls().length).toBeGreaterThan(before));
    const state = testCalls()[testCalls().length - 1].args.state as { clock: { window: string } };
    expect(state.clock.window).toBe("night");
  });

  it("1–9 takes a choice: canon fires the effects and the ledger shows them", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-dock");
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() =>
      expect(screen.getByTestId("dialogue-dock").textContent).toContain("1 effect fired"),
    );
    expect(screen.getByTestId("dialogue-dock").textContent).toContain("flag heard set");
    expect(testCalls().some((c) => c.args.choose === 0)).toBe(true);
  });

  it("asks canon which tree the state selects, for the rail's grouping", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "dialogue_select")).toBe(true));
    // Step 9 regroups the rail from that answer, so "would play now" is both a
    // group heading and the row's own status — assert the ROW, which is the
    // verdict canon returned.
    await waitFor(() =>
      expect(document.querySelector('.dlg-rail-status[data-status="selected"]')?.textContent).toBe(
        "would play now",
      ),
    );
  });
});

describe("the expanded dock", () => {
  it("⌃↑ promotes the state panel into the 300px slot and ⌃↓ collapses it", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    expect(dock.className).toContain("expanded");
    expect(screen.getByTestId("dialogue-state-panel")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true });
    expect(dock.className).not.toContain("expanded");
  });

  it("lays the state panel out as the selector axes plus inventory", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-dock");
    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    const panel = screen.getByTestId("dialogue-state-panel");
    for (const section of [
      "Checkpoint",
      "Inventory",
      "Quests",
      "Segment",
      "Clock & place",
      "Player",
      "Flags",
      "Scenes seen",
    ]) {
      expect(panel.textContent).toContain(section);
    }
  });

  it("snapshots a checkpoint and says it is never written to the pack", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-dock");
    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    const panel = screen.getByTestId("dialogue-state-panel");
    expect(panel.textContent).toContain("Checkpoints are session-local");
    fireEvent.change(screen.getByLabelText("checkpoint name"), { target: { value: "mid-quest" } });
    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }));
    expect(screen.getByRole("button", { name: "Reset to it" })).toBeInTheDocument();
    expect(panel.textContent).toContain("mid-quest");
  });

  it("reports what is unreachable in THIS state", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const dock = await screen.findByTestId("dialogue-dock");
    // `reward` is only reachable through the blocked choice, so this state
    // cannot reach it — named, not silently absent.
    await waitFor(() => expect(dock.textContent).toContain("unreachable in this state"));
    expect(dock.querySelector(".dlg-dock-unreachable")?.textContent).toContain("reward");
  });

  it("R restarts the walk and ⌫ steps back one exchange", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-dock");
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() =>
      expect(screen.getByTestId("dialogue-dock").textContent).toContain("exchange 2"),
    );
    fireEvent.keyDown(window, { key: "Backspace" });
    await waitFor(() =>
      expect(screen.getByTestId("dialogue-dock").textContent).toContain("exchange 1"),
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByTestId("dialogue-dock").textContent).toContain("exchange 1");
  });

  it("surfaces canon's refusal when a blocked choice is forced", async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === "dialogue_test" && args.choose === 1) {
        return Promise.resolve({
          ...WALK,
          chose: 1,
          refused: "choice 1 is blocked: quest:q1:active",
        });
      }
      if (cmd === "dialogue_test") return Promise.resolve(WALK);
      return Promise.resolve({ trees: [], errors: [], warnings: [] });
    });
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-dock");
    fireEvent.keyDown(window, { key: "2" });
    expect(await screen.findByText(/choice 1 is blocked/)).toBeInTheDocument();
  });
});

// `unreachableHere` is a claim about the WHOLE tree in this state, so it needs
// the whole tree walked. A one-hop check named every node two or more hops down
// a passing chain as unreachable — on the shipped 1023 row it accused `end`,
// which every path reaches.
describe("the unreachable report walks the whole tree, not one hop", () => {
  const DEEP: NpcRow = {
    id: "1099",
    name: "Deep",
    dialogue_trees: [
      {
        tree_id: "1099:default",
        character_id: "1099",
        label: "default",
        axis: null,
        selector: null,
        rank: 0,
        entry_node_id: "start",
        nodes: {
          start: {
            node_id: "start",
            prompt: "a",
            choices: [{ text: "on", next_node_id: "mid", conditions: [], effects: [] }],
          },
          mid: {
            node_id: "mid",
            prompt: "b",
            choices: [{ text: "on", next_node_id: "end", conditions: [], effects: [] }],
          },
          end: { node_id: "end", prompt: "c", choices: [] },
          orphan: { node_id: "orphan", prompt: "d", choices: [] },
        },
      },
    ],
  };

  const at = (node: string, next: string | null) => ({
    ...WALK,
    tree_id: "1099:default",
    entry_node_id: "start",
    node: { node_id: node, speaker: "1099", prompt: node, terminal: !next },
    choices: next
      ? [
          {
            index: 0,
            text: "on",
            next_node_id: next,
            dangling: false,
            effects: [],
            pass: true,
            conditions: [],
            failing_condition: null,
            failing_reason: null,
            unevaluable: [],
          },
        ]
      : [],
    next_node_id: null,
  });

  it("names only the node no passing chain reaches", async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "dialogue_test") {
        const node = String(args.node ?? "start");
        if (node === "start") return Promise.resolve(at("start", "mid"));
        if (node === "mid") return Promise.resolve(at("mid", "end"));
        return Promise.resolve(at(node, null));
      }
      return Promise.resolve({ trees: [], errors: [], warnings: [] });
    });
    render(<DialogueSurface npc={DEEP} npcId="1099" />);
    const dock = await screen.findByTestId("dialogue-dock");
    await waitFor(() =>
      expect(dock.querySelector(".dlg-dock-unreachable")?.textContent).toContain("orphan"),
    );
    // `end` is three hops down a chain of passing choices — reachable, and not
    // named.
    expect(dock.querySelector(".dlg-dock-unreachable")?.textContent).not.toContain("end");
  });
});

describe("the expanded dock folds the graph away, and G brings it back", () => {
  it("folds the columns while expanded and unfolds them on G", async () => {
    const { container } = render(<DialogueSurface npc={NPC} npcId="1023" />);
    await screen.findByTestId("dialogue-dock");
    const columns = container.querySelector(".dlg-columns")!;
    expect(columns.getAttribute("data-folded")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowUp", ctrlKey: true });
    expect(columns.getAttribute("data-folded")).toBe("1");
    fireEvent.keyDown(window, { key: "g" });
    expect(columns.getAttribute("data-folded")).toBeNull();
  });
});
