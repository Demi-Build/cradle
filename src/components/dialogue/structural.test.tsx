// Step 6: structural editing — choice rows on the node, the tool rail,
// add/remove/rewire, the entry change, `DeletePreview` and `⇧1`.
//
// The rule every assertion here enforces: a gesture produces `EditOp`s and
// nothing else. No component mutates a document, calls a verb or writes a file.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { DialogueSurface } from "./DialogueSurface";
import { DeletePreview } from "./DeletePreview";
import { EditableNode } from "./EditableNode";
import { Inspector } from "./Inspector";
import { DEFAULT_VOCAB } from "./grammar";
import { toAuthorDoc, type NpcRow } from "./model";
import { useStore } from "../../store";

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
            { text: "What do they say?", next_node_id: "voices", conditions: [], effects: [] },
            { text: "Heresy.", next_node_id: "heresy", conditions: [], effects: [] },
          ],
        },
        voices: {
          node_id: "voices",
          prompt: "Harmony, not hierarchy.",
          choices: [
            {
              text: "I brought the shard.",
              next_node_id: "reward",
              conditions: ["has_item:item_resonance_shard", "time:night"],
              effects: ["takes_item:item_resonance_shard"],
            },
            { text: "Leave.", next_node_id: null, conditions: [], effects: [] },
          ],
        },
        heresy: { node_id: "heresy", prompt: "Static.", choices: [] },
        reward: { node_id: "reward", prompt: "It sings home.", choices: [] },
      },
    },
  ],
};

const doc = toAuthorDoc(NPC, { npcId: "1023" });
const tree = doc.trees[0];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    npc: "1023",
    source: "dialogue_trees",
    trees: 1,
    errors: [],
    warnings: [],
  });
  useStore.setState({
    dialogue: { mode: "edit", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: null },
    entities: {},
    commands: {},
  });
});

const ops = () => useStore.getState().dialogue.buffers["npc:1023"]?.ops ?? [];

describe("choice rows on the node", () => {
  it("renders one row per choice with its own destination", () => {
    const { container } = render(
      <EditableNode
        beat={{ id: "tree:voices", kind: "tree", label: "voices", prompt: "…" }}
        edit={{
          tree,
          selected: "voices",
          onSelect: () => {},
          onPromptCommit: () => {},
        }}
      />,
    );
    const rows = [...container.querySelectorAll(".dlg-choicerow")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("→ reward");
    // A null target reads as "ends the conversation", never as a vanished row.
    expect(rows[1].textContent).toContain("→ ⌀");
  });

  it("shows the gate ribbon with one dot per condition and an effect mark", () => {
    const { container } = render(
      <EditableNode
        beat={{ id: "tree:voices", kind: "tree", label: "voices", prompt: "…" }}
        edit={{
          tree,
          selected: null,
          onSelect: () => {},
          onPromptCommit: () => {},
          engineEvaluable: (t) => t.startsWith("has_item"),
          engineReason: (t) => (t.startsWith("has_item") ? null : "the engine ignores time:"),
        }}
      />,
    );
    expect(container.querySelector(".dlg-ribbon-badge")?.textContent).toBe("⊳2");
    const dots = [...container.querySelectorAll(".dlg-ribbon-dot")].map((d) =>
      d.getAttribute("data-engine"),
    );
    expect(dots).toEqual(["ok", "lag"]);
    expect(container.querySelector(".dlg-ribbon-effects")?.textContent).toBe("⚡1");
  });

  it("marks a choice pointing at a missing node as an orphan instead of hiding it", () => {
    const orphaned = structuredClone(tree);
    orphaned.nodes.start.choices[0].next_node_id = "gone";
    const { container } = render(
      <EditableNode
        beat={{ id: "tree:start", kind: "tree", label: "start", prompt: "…" }}
        edit={{ tree: orphaned, selected: null, onSelect: () => {}, onPromptCommit: () => {} }}
      />,
    );
    const row = container.querySelector(".dlg-choicerow.orphan")!;
    expect(row.getAttribute("title")).toContain("which this tree does not have");
  });
});

describe("the tool rail and its keys", () => {
  it("N adds a node and selects it", () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.keyDown(window, { key: "n" });
    expect(ops()).toEqual([
      {
        k: "node.add",
        tree: "1023:default",
        node_id: "node_5",
        node: { prompt: "" },
      },
    ]);
  });

  it("V and C switch the tool and the rail says which", () => {
    const { container } = render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.keyDown(window, { key: "c" });
    const connect = container.querySelector('[aria-label="Connect"]')!;
    expect(connect.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "v" });
    expect(container.querySelector('[aria-label="Select"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("disables rail delete WITH its reason until a node is selected", () => {
    const { container } = render(<DialogueSurface npc={NPC} npcId="1023" />);
    const del = container.querySelector('[aria-label="Delete the selected node"]')!;
    expect(del).toBeDisabled();
    expect(del.getAttribute("title")).toBe("select a node first");
  });
});

describe("the inspector's structural edits", () => {
  const mountInspector = (
    nodeId: string | null,
    choice = null as null | { nodeId: string; index: number },
  ) => {
    const emitted: unknown[] = [];
    render(
      <Inspector
        doc={{ character_id: "1023", trees: [tree], chrome: {} }}
        tree={tree}
        nodeId={nodeId}
        choice={choice}
        packInfo={null}
        vocab={DEFAULT_VOCAB}
        worldPath="/w"
        onOps={(o) => emitted.push(...o)}
        onDeleteTree={() => {}}
        onSelectNode={() => {}}
      />,
    );
    return emitted;
  };

  it("adds a choice as one choice.add op at the end", () => {
    const emitted = mountInspector("start");
    fireEvent.click(screen.getByRole("button", { name: "＋ choice" }));
    expect(emitted).toEqual([
      {
        k: "choice.add",
        tree: "1023:default",
        node_id: "start",
        index: 2,
        choice: { text: "" },
      },
    ]);
  });

  it("removes a choice as one choice.remove op", () => {
    const emitted = mountInspector("start");
    fireEvent.click(screen.getByRole("button", { name: "Remove choice 1" }));
    expect(emitted).toEqual([
      { k: "choice.remove", tree: "1023:default", node_id: "start", index: 0 },
    ]);
  });

  it("rewires a choice to end-of-conversation as choice.target null", () => {
    const emitted = mountInspector("start");
    fireEvent.change(screen.getByLabelText("choice 1 target"), { target: { value: "" } });
    expect(emitted).toEqual([
      { k: "choice.target", tree: "1023:default", node_id: "start", index: 0, value: null },
    ]);
  });

  it("changes the entry node as one tree.entry op", () => {
    const emitted = mountInspector("start");
    fireEvent.change(screen.getByLabelText("entry node"), { target: { value: "voices" } });
    expect(emitted).toEqual([{ k: "tree.entry", tree: "1023:default", node_id: "voices" }]);
  });

  it("duplicates a tree, and says the copy is ungated on purpose", () => {
    const emitted = mountInspector(null);
    const dup = screen.getByRole("button", { name: "Duplicate" });
    expect(dup.getAttribute("title")).toContain("UNGATED until you give it a selector");
    fireEvent.click(dup);
    expect(emitted).toEqual([
      { k: "tree.duplicate", tree: "1023:default-copy", from: "1023:default" },
    ]);
  });
});

describe("the delete preview is PAINTED ON THE CANVAS behind the sheet", () => {
  const tree = toAuthorDoc(NPC).trees[0];
  const preview = {
    doomed: "reward",
    inbound: new Set(["voices[0]"]),
    newlyUnreachable: new Set(["heresy"]),
  };

  it("draws the target dashed-red with its prompt struck through", () => {
    const { container } = render(
      <EditableNode
        beat={{ id: "tree:reward", kind: "tree", label: "reward", prompt: "It sings home." }}
        edit={{ tree, selected: null, onSelect: () => {}, onPromptCommit: () => {}, preview }}
      />,
    );
    expect(container.querySelector('[data-preview="delete"]')).toBeTruthy();
    expect(container.textContent).toContain("deleting");
  });

  it("retargets each inbound choice row to → ⌀ before the confirm", () => {
    const { container } = render(
      <EditableNode
        beat={{ id: "tree:voices", kind: "tree", label: "voices", prompt: "…" }}
        edit={{ tree, selected: null, onSelect: () => {}, onPromptCommit: () => {}, preview }}
      />,
    );
    const rows = [...container.querySelectorAll(".dlg-choicerow")];
    expect(rows[0].getAttribute("data-preview")).toBe("retarget");
    expect(rows[0].textContent).toContain("→ ⌀ ends the conversation");
    expect(rows[1].getAttribute("data-preview")).toBeNull();
  });

  it("badges each newly-unreachable node with the reason", () => {
    const { container } = render(
      <EditableNode
        beat={{ id: "tree:heresy", kind: "tree", label: "heresy", prompt: "Static." }}
        edit={{ tree, selected: null, onSelect: () => {}, onPromptCommit: () => {}, preview }}
      />,
    );
    expect(container.querySelector('[data-preview="unreachable"]')).toBeTruthy();
    expect(container.textContent).toContain("no path reaches this once reward is gone");
  });
});

describe("the delete preview", () => {
  it("names every consequence before anything is removed", () => {
    render(
      <DeletePreview
        consequences={{
          kind: "node",
          id: "voices",
          inbound: ["start[0]"],
          newlyUnreachable: ["reward"],
          gatesLost: 2,
          entryMoves: false,
        }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const sheet = screen.getByRole("dialog", { name: "Delete node" });
    expect(sheet.textContent).toContain("start[0]");
    expect(sheet.textContent).toContain("end of conversation");
    expect(sheet.textContent).toContain("reward");
    expect(sheet.textContent).toContain("a warning, never an error");
    expect(sheet.textContent).toContain("2 conditions go with it");
    expect(sheet.textContent).toContain("⌘Z undoes it, ⌘S writes it");
  });

  it("computes the real consequences from the surface and lands ONE node.remove", () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    // Selecting through the graph is a React Flow gesture; drive the same path
    // the ⌫ key takes, which is what a keyboard user does.
    fireEvent.keyDown(window, { key: "n" }); // adds and selects node_5
    fireEvent.keyDown(window, { key: "Backspace" });
    const sheet = screen.getByRole("dialog", { name: "Delete node" });
    expect(sheet.textContent).toContain("node_5");
    expect(sheet.textContent).toContain("Nothing points at it");
    fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    expect(ops()[ops().length - 1]).toEqual({
      k: "node.remove",
      tree: "1023:default",
      node_id: "node_5",
    });
  });

  it("Esc cancels the sheet without touching the buffer", () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "Backspace" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Delete node" })).toBeNull();
    expect(ops()).toHaveLength(1);
  });
});

describe("scale affordances", () => {
  it("⇧1 fits the graph without touching the document", () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.keyDown(window, { key: "!", shiftKey: true });
    expect(ops()).toEqual([]);
  });

  it("/ opens node search and Esc closes it before the mode drops", () => {
    const { container } = render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.keyDown(window, { key: "/" });
    expect(container.querySelector(".dlg-search-input")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".dlg-search-input")).toBeNull();
    expect(container.querySelector(".dlg-surface")?.getAttribute("data-mode")).toBe("edit");
  });

  // The RANK is explicit and lands the tree AHEAD of the fallback. canon's
  // default (`nextRank` = max + 1) would put it at 1000 behind this row's
  // rank-999 fallback, which matches every state — `validate_trees`' own "it
  // can never be selected".
  it("＋ New tree lands an UNGATED tree ranked ahead of the fallback, and opens it", () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    fireEvent.click(screen.getByRole("button", { name: /New tree — pick a selector axis/ }));
    const timeRow = [...document.querySelectorAll(".dlg-axis-row")].find(
      (n) => n.querySelector(".dlg-axis-label")?.textContent === "Time of day",
    )!;
    fireEvent.click(timeRow);
    expect(ops()).toEqual([
      {
        k: "tree.add",
        tree: "1023:tree_2",
        label: "new time tree",
        axis: "time",
        rank: 0,
        nodes: { start: { node_id: "start", prompt: "" } },
      },
    ]);
    const doc = toAuthorDoc(NPC);
    expect(0).toBeLessThan(doc.trees.find((t) => t.selector === null)!.rank);
    expect(useStore.getState().dialogue.activeTree["npc:1023"]).toBe("1023:tree_2");
  });
});
