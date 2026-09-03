// Step 11: quest scope. `QuestDialogueTab`, `QuestLanes`, `QuestCoverage`, and
// the multi-NPC batch save.
//
// The claim the batch test defends, and the reason the buffer is a keyed map:
// ONE `⌘S` here writes several characters, as one `canon dialogue update` per
// touched NPC, all carrying ONE SHARED SESSION ID — so the journal reads as one
// undo entry even though the pack stores it per character.
//
// The rest defend the two readings the quest scope adds that the NPC scope
// structurally cannot: a beat's column comes from its OWN gates (a projection,
// never a stored coordinate), and an empty cell is a DROP TARGET rather than a
// gap you have to notice.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { QuestDialogueTab } from "./QuestDialogueTab";
import { beatState, beatsFor, impliedQuestToken } from "./questBeats";
import { useStore } from "../../store";
import { toAuthorDoc, type AuthorDoc, type NpcRow } from "../dialogue/model";
import { bufferDoc } from "../dialogue/useDialogueEditor";

const QUEST_ID = "q_whisper_signal";

const TAM: NpcRow = {
  id: "1023",
  name: "Whisper-Tam",
  quest_id: QUEST_ID,
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
          prompt: "Bring me the shard.",
          choices: [
            {
              text: "I will.",
              next_node_id: null,
              conditions: [`quest:${QUEST_ID}:not_started`],
              effects: [`gives_quest:${QUEST_ID}`],
            },
          ],
        },
        turn_in: {
          node_id: "turn_in",
          prompt: "It sings home.",
          choices: [
            {
              text: "Here.",
              next_node_id: null,
              conditions: [`quest:${QUEST_ID}:active`, "has_item:item_resonance_shard"],
              effects: [`advance_quest:${QUEST_ID}:completed`],
            },
          ],
        },
      },
    },
  ],
};

const KELL: NpcRow = {
  id: "1041",
  name: "Rust-Kell",
  dialogue_trees: [
    {
      tree_id: "1041:default",
      character_id: "1041",
      label: "default",
      axis: null,
      selector: null,
      rank: 999,
      entry_node_id: "start",
      nodes: {
        start: {
          node_id: "start",
          prompt: "Third gantry sings.",
          choices: [
            {
              text: "Show me.",
              next_node_id: null,
              conditions: [`quest:${QUEST_ID}:active`],
              effects: ["gives_item:item_resonance_shard"],
            },
          ],
        },
      },
    },
  ],
};

/** An NPC with no stake in this quest at all — must not get a lane. */
const STRANGER: NpcRow = {
  id: "1002",
  name: "Kess Ironwhisper",
  dialogue_trees: [
    {
      tree_id: "1002:default",
      character_id: "1002",
      label: "default",
      axis: null,
      selector: null,
      rank: 999,
      entry_node_id: "start",
      nodes: { start: { node_id: "start", prompt: "Forty scrip.", choices: [] } },
    },
  ],
};

const PACK = {
  pack_type: "dungeon",
  capabilities: ["dialogue"],
  engines: [{ id: "pygame", primary: true }],
  engine_evaluable_namespaces: { tree: {}, selector: {}, scene: {}, effects: {} },
};

const calls: { cmd: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "list_entity_rows") {
      return Promise.resolve([
        { id: "1023", data: TAM },
        { id: "1041", data: KELL },
        { id: "1002", data: STRANGER },
      ]);
    }
    if (cmd === "dialogue_show") {
      return Promise.resolve({
        npc: String(args.npc),
        source: "dialogue_trees",
        storage_field: "dialogue_trees",
        legacy_fields: [],
        legacy_written: [],
        engine: { id: "pygame", evaluable_namespaces: null },
        selector_axes: [],
        trees: [],
        scenes:
          args.npc === "1023"
            ? [
                {
                  id: "evt_3120",
                  title: "The Bonefield Confession",
                  actors: ["1023", "1041"],
                  required: ["1023"],
                  lines: 2,
                  trigger: "enter_room",
                },
              ]
            : [],
        warnings: [],
      });
    }
    if (cmd === "dialogue_update") {
      const npc = String(args.npc);
      return Promise.resolve({
        npc,
        source: "dialogue_trees",
        ops: [],
        trees: (npc === "1023" ? TAM : KELL).dialogue_trees,
        legacy_written: [],
        changed: true,
        no_change: false,
        warnings: [],
      });
    }
    return Promise.resolve({});
  });
  useStore.setState({
    dialogue: { mode: "edit", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: PACK },
    entities: {},
    commands: {},
  });
});

const updates = () => calls.filter((c) => c.cmd === "dialogue_update");

describe("the lane grid is a projection, not a stored coordinate", () => {
  it("reads a beat's column from its OWN quest gate", () => {
    const doc = toAuthorDoc(TAM, { npcId: "1023" });
    const tree = doc.trees[0];
    expect(beatState(tree.nodes.start, tree, QUEST_ID)).toBe("not_started");
    expect(beatState(tree.nodes.turn_in, tree, QUEST_ID)).toBe("active");
  });

  it("counts the gates and names the handoff effects on each beat", () => {
    const beats = beatsFor(toAuthorDoc(TAM, { npcId: "1023" }), "1023", "Whisper-Tam", QUEST_ID);
    const turn = beats.find((b) => b.nodeId === "turn_in")!;
    expect(turn.gates).toBe(2);
    expect(turn.handoffs).toEqual([`advance_quest:${QUEST_ID}:completed`]);
  });

  it("implies the quest id — that is what makes quest scope faster", () => {
    expect(impliedQuestToken(QUEST_ID, "active")).toBe(`quest:${QUEST_ID}:active`);
  });
});

describe("participation is read from the data", () => {
  it("lanes the two NPCs with a stake and leaves the stranger out", async () => {
    render(<QuestDialogueTab quest={{ id: QUEST_ID, title: "Signal" }} questId={QUEST_ID} />);
    const lanes = await screen.findByTestId("quest-lanes");
    expect(lanes.textContent).toContain("Whisper-Tam");
    expect(lanes.textContent).toContain("Rust-Kell");
    expect(lanes.textContent).not.toContain("Kess Ironwhisper");
  });

  it("renders an empty cell as a DROP TARGET, never as a gap", async () => {
    render(<QuestDialogueTab quest={{ id: QUEST_ID, title: "Signal" }} questId={QUEST_ID} />);
    const lanes = await screen.findByTestId("quest-lanes");
    const adds = [...lanes.querySelectorAll(".dlg-lanes-add")];
    expect(adds.length).toBeGreaterThan(0);
    expect(adds[0].textContent).toContain("＋ beat for");
  });

  it("shows a group scene as a block spanning its lanes", async () => {
    render(<QuestDialogueTab quest={{ id: QUEST_ID, title: "Signal" }} questId={QUEST_ID} />);
    const lanes = await screen.findByTestId("quest-lanes");
    await waitFor(() => expect(lanes.textContent).toContain("The Bonefield Confession"));
    expect(lanes.textContent).toContain("2 actors");
  });

  it("counts coverage per quest state and marks the empty ones amber", async () => {
    render(<QuestDialogueTab quest={{ id: QUEST_ID, title: "Signal" }} questId={QUEST_ID} />);
    const coverage = await screen.findByTestId("quest-coverage");
    expect(coverage.textContent).toContain("no beats");
    expect(coverage.querySelector('[data-empty="1"]')).toBeTruthy();
    expect(coverage.textContent).toContain("warning, not an error");
  });
});

describe("the multi-NPC batch save", () => {
  async function dirtyTwo() {
    render(<QuestDialogueTab quest={{ id: QUEST_ID, title: "Signal" }} questId={QUEST_ID} />);
    const lanes = await screen.findByTestId("quest-lanes");
    await waitFor(() => expect(lanes.textContent).toContain("Rust-Kell"));
    // One `＋ beat` per NPC — two characters touched by two gestures.
    const adds = [...lanes.querySelectorAll(".dlg-lanes-add")] as HTMLButtonElement[];
    const tam = adds.find((b) => b.textContent?.includes("Whisper-Tam") && !b.disabled)!;
    fireEvent.click(tam);
    const kell = [...lanes.querySelectorAll(".dlg-lanes-add")].find(
      (b) => b.textContent?.includes("Rust-Kell") && !(b as HTMLButtonElement).disabled,
    ) as HTMLButtonElement;
    fireEvent.click(kell);
    await waitFor(() => {
      const buffers = useStore.getState().dialogue.buffers;
      expect(buffers["npc:1023"]?.cursor).toBeGreaterThan(0);
      expect(buffers["npc:1041"]?.cursor).toBeGreaterThan(0);
    });
  }

  it("says how many NPCs are unsaved, in the chip", async () => {
    await dirtyTwo();
    expect(screen.getByText("4 unsaved across 2 NPCs")).toBeInTheDocument();
  });

  it("sends ONE `canon dialogue update` per touched NPC", async () => {
    await dirtyTwo();
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    fireEvent.click(await screen.findByRole("button", { name: /Save all/ }));
    await waitFor(() => expect(updates().length).toBe(2));
    expect(
      updates()
        .map((c) => c.args.npc)
        .sort(),
    ).toEqual(["1023", "1041"]);
  });

  it("carries ONE SHARED SESSION across them — one undo entry in the journal", async () => {
    await dirtyTwo();
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    fireEvent.click(await screen.findByRole("button", { name: /Save all/ }));
    await waitFor(() => expect(updates().length).toBe(2));
    const sessions = updates().map((c) => c.args.session);
    expect(sessions[0]).toBeTruthy();
    expect(new Set(sessions).size).toBe(1);
    expect(String(sessions[0])).toContain(QUEST_ID);
  });

  it("empties every buffer it wrote, so ⌘Z no longer reaches those edits", async () => {
    await dirtyTwo();
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    fireEvent.click(await screen.findByRole("button", { name: /Save all/ }));
    await waitFor(() => {
      const buffers = useStore.getState().dialogue.buffers;
      expect(buffers["npc:1023"].cursor).toBe(0);
      expect(buffers["npc:1041"].cursor).toBe(0);
    });
  });

  // The sheet's pre-flight has to cover the same set the batch WRITES: doSave
  // goes NPC by NPC, so an error in the second one would land after the first
  // was already committed. It used to validate only the selected beat's NPC.
  it("pre-flights every dirty buffer, naming the NPC each line belongs to", async () => {
    await dirtyTwo();
    // Break the second NPC's buffer: a choice pointing at a node that is gone.
    act(() => {
      const doc = bufferDoc(useStore.getState().dialogue.buffers["npc:1041"]) as AuthorDoc;
      const tree = doc.trees[0];
      const nodeId = Object.keys(tree.nodes).find((id) => tree.nodes[id].choices.length > 0)!;
      useStore.getState().pushDialogueOps("npc:1041", [
        {
          k: "choice.target",
          tree: tree.tree_id,
          node_id: nodeId,
          index: 0,
          value: "no_such_node",
        },
      ]);
    });
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    const sheet = await screen.findByLabelText("Save dialogue");
    await waitFor(() => expect(sheet.textContent).toContain("1041:"));
  });

  it("names the per-NPC shape in the sheet, so the batch is never a surprise", async () => {
    await dirtyTwo();
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    const sheet = await screen.findByLabelText("Save dialogue");
    expect(sheet.textContent?.replace(/\s+/g, " ")).toContain("One canon dialogue update per NPC");
    expect(sheet.textContent).toContain("1023, 1041");
  });
});

describe("the SCOPE statusbar slot", () => {
  it("says QUEST while the quest scope is mounted", async () => {
    render(<QuestDialogueTab quest={{ id: QUEST_ID, title: "Signal" }} questId={QUEST_ID} />);
    await screen.findByTestId("quest-lanes");
    expect(useStore.getState().dialogue.scope).toBe("quest");
  });
});
