// Step 9: selectors. `SelectorNode`, the `tree.selector` / `tree.rank` ops,
// `canon dialogue select` wired in, the rail's would-play / blocked grouping,
// and `dialogue_trees` storage surfaced.
//
// The claims these defend:
//   • SELECTOR PRECEDENCE IS DATA. A reorder is a `tree.rank` op that lands in
//     the unsaved buffer and names its consequence first — never a view
//     preference.
//   • The last row is ALWAYS `otherwise → default`.
//   • The rail's grouping is `canon dialogue select`'s answer, restructured —
//     the UI never decides which tree a state selects.
//   • The storage line says whether this NPC is on `dialogue_trees` or still on
//     the legacy four.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { DialogueSurface } from "./DialogueSurface";
import { rankConsequences } from "./model";
import { applyOps } from "./ops";
import { useStore } from "../../store";
import type { AuthorDoc, NpcRow } from "./model";

const NPC: NpcRow = {
  id: "1023",
  name: "Whisper-Tam",
  dialogue_trees: [
    {
      tree_id: "1023:night",
      character_id: "1023",
      label: "night vigil",
      axis: "time",
      selector: { rows: ["time:night"] },
      rank: 0,
      entry_node_id: "start",
      nodes: { start: { node_id: "start", prompt: "Quiet.", choices: [] } },
    },
    {
      tree_id: "1023:after",
      character_id: "1023",
      label: "after the transmission",
      axis: "flag",
      selector: { rows: ["flag:heard_signal"] },
      rank: 1,
      entry_node_id: "start",
      nodes: { start: { node_id: "start", prompt: "You heard it.", choices: [] } },
    },
    {
      tree_id: "1023:default",
      character_id: "1023",
      label: "default",
      axis: null,
      selector: null,
      rank: 999,
      entry_node_id: "start",
      nodes: { start: { node_id: "start", prompt: "The voices sing.", choices: [] } },
    },
  ],
};

const DOC: AuthorDoc = {
  character_id: "1023",
  chrome: {},
  trees: [
    {
      tree_id: "1023:night",
      character_id: "1023",
      label: "night vigil",
      axis: "time",
      selector: { rows: ["time:night"] },
      rank: 0,
      entry_node_id: "start",
      nodes: {},
    },
    {
      tree_id: "1023:after",
      character_id: "1023",
      label: "after the transmission",
      axis: "flag",
      selector: { rows: ["flag:heard_signal"] },
      rank: 1,
      entry_node_id: "start",
      nodes: {},
    },
  ],
};

const SELECT = {
  npc: "1023",
  source: "dialogue_trees",
  selected: "1023:night",
  selected_label: "night vigil",
  trees: [
    { tree_id: "1023:night", status: "selected", would_play: true, why_not: null },
    {
      tree_id: "1023:after",
      status: "blocked",
      would_play: false,
      why_not: "blocked by flag:heard_signal — flag is false",
    },
    {
      tree_id: "1023:default",
      status: "shadowed",
      would_play: false,
      why_not: "a higher-ranked tree (1023:night) matched first",
    },
  ],
  engine: {
    id: "pygame",
    selected: "1023:default",
    legacy_slot: "dialogue_tree",
    diverges: true,
    reason:
      "the engine cannot evaluate every selector row above '1023:night', so it falls through to '1023:default'",
  },
  state: {},
  warnings: [],
};

const SHOW = {
  npc: "1023",
  source: "dialogue_trees",
  storage_field: "dialogue_trees",
  legacy_fields: ["dialogue_tree"],
  legacy_written: ["dialogue_tree"],
  engine: { id: "pygame", evaluable_namespaces: null },
  selector_axes: [],
  trees: [],
  scenes: [],
  warnings: [],
};

const calls: { cmd: string; args: Record<string, unknown> }[] = [];

function seed(mode: "view" | "edit" | "test") {
  calls.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "dialogue_select") return Promise.resolve(SELECT);
    if (cmd === "dialogue_show") return Promise.resolve(SHOW);
    if (cmd === "dialogue_test") {
      return Promise.resolve({
        tree_id: "1023:night",
        entry_node_id: "start",
        node: { node_id: "start", speaker: null, prompt: "Quiet.", terminal: true },
        choices: [],
        gates: {},
        state: {},
        post_effect_state: {},
        fired: [],
        chose: null,
        next_node_id: null,
      });
    }
    return Promise.resolve({
      npc: "1023",
      source: "dialogue_trees",
      trees: 3,
      errors: [],
      warnings: [],
    });
  });
  useStore.setState({
    dialogue: { mode, scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: null },
    entities: {},
    commands: {},
  });
}

beforeEach(() => seed("edit"));

describe("the selector node", () => {
  it("lists the gated trees in rank order and ALWAYS ends with otherwise → default", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const node = await screen.findByTestId("dialogue-selector-node");
    const rows = [...node.querySelectorAll(".dlg-selector-rows > li")];
    expect(rows[0].textContent).toContain("time:night");
    expect(rows[1].textContent).toContain("flag:heard_signal");
    const fallback = screen.getByTestId("dialogue-selector-fallback");
    expect(rows[rows.length - 1]).toBe(fallback);
    expect(fallback.textContent).toContain("otherwise");
    expect(fallback.textContent).toContain("default");
  });

  it("names the states that change tree BEFORE the reorder commits", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const node = await screen.findByTestId("dialogue-selector-node");
    fireEvent.click(within(node).getByLabelText("Move after the transmission earlier"));
    const sheet = await screen.findByLabelText("Reorder selector rows");
    expect(sheet.textContent).toContain("reordering is a semantic edit");
    expect(sheet.textContent).toContain("night vigil");
    // Nothing is dirty until the sheet is confirmed.
    expect(useStore.getState().dialogue.buffers["npc:1023"]?.cursor ?? 0).toBe(0);
  });

  it("a confirmed reorder is a tree.rank OP in the unsaved buffer, not a view state", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const node = await screen.findByTestId("dialogue-selector-node");
    fireEvent.click(within(node).getByLabelText("Move after the transmission earlier"));
    fireEvent.click(await screen.findByText("Reorder"));
    await waitFor(() => {
      const buffer = useStore.getState().dialogue.buffers["npc:1023"];
      expect(buffer?.ops[0]?.k).toBe("tree.rank");
    });
    const op = useStore.getState().dialogue.buffers["npc:1023"].ops[0];
    expect(op).toMatchObject({ order: ["1023:after", "1023:night", "1023:default"] });
    // …and the chip counts it as a selector edit, so it is visible before save.
    expect(screen.getByText(/1 unsaved · 1 selector/)).toBeInTheDocument();
  });

  it("renders the selector-level engine-lag divergence canon reported", async () => {
    seed("test");
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const lagline = await screen.findByTestId("dialogue-selector-lag");
    expect(lagline.textContent).toContain("falls through to '1023:default'");
  });
});

// `canon dialogue select` reads the SAVED pack — the verb takes no tree payload
// the way `dialogue test --tree` does. So an unsaved edit to the selector shape
// makes its answer describe an order that is no longer on screen, and the rail's
// grouping and the router's pills would be last save's verdicts drawn over the
// edited list. Doctrine 4: they go away WITH the reason.
describe("the selector answer is marked stale while the buffer changes it", () => {
  it("drops the would-play grouping and the pills, and says why, after a tree.rank", async () => {
    seed("test");
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const rail = await screen.findByTestId("dialogue-rail");
    await waitFor(() => expect(rail.textContent).toContain("would play now"));
    // The reorder gesture itself is Edit-only; what matters here is that ANY
    // buffered rank edit invalidates the answer, so push the op the sheet emits.
    await act(async () => {
      useStore
        .getState()
        .pushDialogueOps("npc:1023", [
          { k: "tree.rank", order: ["1023:after", "1023:night", "1023:default"] },
        ]);
    });
    const stale = await screen.findByTestId("dialogue-select-stale");
    expect(stale.textContent).toContain("saved pack");
    expect(stale.textContent).toContain("tree.rank");
    expect(rail.textContent).not.toContain("would play now");
    expect(rail.querySelector('[data-status="selected"]')).toBeNull();
  });
});

describe("a fallback that is not last is named, not drawn as if it were", () => {
  it("warns that every tree ranked behind the fallback is dead", async () => {
    seed("edit");
    // The fallback ranked FIRST — reachable from the Inspector's own
    // "Make it the fallback", which sets `selector: null` and leaves `rank`.
    const trees = NPC.dialogue_trees as { rank: number; selector: unknown }[];
    const misordered = {
      ...NPC,
      dialogue_trees: trees.map((t) => (t.selector === null ? { ...t, rank: -1 } : t)),
    } as NpcRow;
    render(<DialogueSurface npc={misordered} npcId="1023" />);
    const warn = await screen.findByTestId("dialogue-selector-fallback-order");
    expect(warn.textContent).toContain("can never be selected");
    expect(warn.textContent).toContain("1023:night");
  });
});

describe("tree.rank as an op", () => {
  it("re-ranks 0..n-1 and keeps unnamed trees after the named ones", () => {
    const next = applyOps(DOC, [{ k: "tree.rank", order: ["1023:after"] }]);
    expect(next.trees.map((t) => [t.tree_id, t.rank])).toEqual([
      ["1023:after", 0],
      ["1023:night", 1],
    ]);
  });

  it("refuses an order naming a tree that is not there, by name", () => {
    expect(() => applyOps(DOC, [{ k: "tree.rank", order: ["nope"] }])).toThrow(
      /order names unknown tree\(s\) nope/,
    );
  });

  it("rankConsequences names what overtakes what", () => {
    const c = rankConsequences(DOC, ["1023:after", "1023:night"], "1023:after");
    expect(c.changes.join(" ")).toMatch(/after the transmission|night vigil/);
  });
});

describe("the rail's would-play / blocked grouping", () => {
  it("regroups from `canon dialogue select` — the UI never decides it", async () => {
    seed("test");
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "dialogue_select")).toBe(true));
    const rail = await screen.findByTestId("dialogue-rail");
    await waitFor(() => expect(rail.textContent).toContain("would play now"));
    expect(rail.textContent).toContain("blocked by state");
    // The verdicts on the rows are canon's own words.
    expect(rail.querySelector('[data-status="selected"]')).toBeTruthy();
    expect(rail.querySelector('[data-status="blocked"]')).toBeTruthy();
  });
});

describe("⌘P carries the other two scopes", () => {
  it("lists this character's scenes as cross-surface rows", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "dialogue_select") return Promise.resolve(SELECT);
      if (cmd === "dialogue_show") {
        return Promise.resolve({
          ...SHOW,
          scenes: [
            {
              id: "evt_3120",
              title: "The Bonefield Confession",
              actors: ["1023", "1041"],
              required: ["1023"],
              lines: 11,
              trigger: "enter_room",
            },
          ],
        });
      }
      return Promise.resolve({
        npc: "1023",
        source: "dialogue_trees",
        trees: 3,
        errors: [],
        warnings: [],
      });
    });
    render(<DialogueSurface npc={NPC} npcId="1023" onOpenScene={() => {}} />);
    await screen.findByTestId("dialogue-rail-storage");
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByPlaceholderText("Go to a tree or scene…");
    fireEvent.change(input, { target: { value: "bonefield" } });
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll(".dlg-switcher-row")].find((n) =>
        n.textContent?.includes("Bonefield"),
      );
      expect(found).toBeTruthy();
      return found!;
    });
    expect(row.getAttribute("data-elsewhere")).toBe("1");
    expect(row.textContent).toContain("2 actors");
  });
});

describe("dialogue_trees storage, surfaced", () => {
  it("says which field the trees live in and which legacy key the engine reads", async () => {
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const line = await screen.findByTestId("dialogue-rail-storage");
    expect(line.textContent).toContain("dialogue_trees");
    expect(line.textContent).toContain("dialogue_tree");
  });

  it("says so LOUDLY when the NPC is still on the legacy four", async () => {
    seed("edit");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "dialogue_show") return Promise.resolve({ ...SHOW, source: "legacy" });
      if (cmd === "dialogue_select") return Promise.resolve(SELECT);
      return Promise.resolve({ npc: "1023", source: "legacy", trees: 3, errors: [], warnings: [] });
    });
    render(<DialogueSurface npc={NPC} npcId="1023" />);
    const line = await screen.findByTestId("dialogue-rail-storage");
    expect(line.textContent).toContain("legacy");
    expect(line.textContent).toContain("The first save writes both");
  });
});
