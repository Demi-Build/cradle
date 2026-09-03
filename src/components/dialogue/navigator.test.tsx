// Step 5: the navigator rail and the ⌘P switcher — what makes a nine-tree NPC
// usable. Grouping by axis comes from the pack's `selector_axes`, empty trees
// stay visible, and the would-play grouping comes from `canon dialogue select`
// rather than from anything the rail decides.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { TreeRail } from "./TreeRail";
import { TreeSwitcher } from "./TreeSwitcher";
import { DialogueSurface } from "./DialogueSurface";
import { DEFAULT_VOCAB } from "./grammar";
import { groupTrees } from "./axes";
import { toAuthorDoc, type NpcRow } from "./model";
import { useStore } from "../../store";
import type { DialogueSelectResult } from "../../lib/invoke";

const NINE_TREE_NPC: NpcRow = {
  id: "1023",
  name: "Whisper-Tam",
  dialogue_trees: [
    tree("1023:complete", "complete", "quest", ["quest:q1:completed"], 0, 3),
    tree("1023:incomplete", "incomplete", "quest", ["quest:q1:active"], 1, 2),
    tree("1023:failed", "failed", "quest", ["quest:q1:failed"], 2, 0),
    tree("1023:act3", "after the transmission", "segment", ["segment:act_3"], 3, 4),
    tree("1023:night", "night vigil", "time", ["time:night"], 4, 2),
    tree("1023:default", "default", null, null, 999, 5),
  ],
};

function tree(
  id: string,
  label: string,
  axis: string | null,
  rows: string[] | null,
  rank: number,
  nodes: number,
) {
  const map: Record<string, unknown> = {};
  for (let i = 0; i < nodes; i += 1) {
    map[i === 0 ? "start" : `n${i}`] = {
      node_id: i === 0 ? "start" : `n${i}`,
      prompt: `line ${i}`,
      choices: [],
    };
  }
  return {
    tree_id: id,
    character_id: "1023",
    label,
    axis,
    selector: rows ? { rows } : null,
    rank,
    entry_node_id: "start",
    nodes: map,
  };
}

const doc = toAuthorDoc(NINE_TREE_NPC, { npcId: "1023" });

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    npc: "1023",
    source: "legacy",
    trees: 6,
    errors: [],
    warnings: [],
  });
  useStore.setState({
    dialogue: { mode: "view", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    worldPath: "/w",
    world: { path: "/w", name: "w", world_kind: "dungeon", entity_counts: [], pack_info: null },
    entities: {},
    commands: {},
  });
});

describe("the navigator rail", () => {
  it("groups trees by axis in the pack's own axis order, fallback last", () => {
    const groups = groupTrees(doc, DEFAULT_VOCAB);
    expect(groups.map((g) => g.id)).toEqual(["quest", "segment", "time", "default"]);
    expect(groups[0].trees.map((t) => t.tree_id)).toEqual([
      "1023:complete",
      "1023:incomplete",
      "1023:failed",
    ]);
  });

  it("keeps an empty tree visible with a count of 0 rather than collapsing it", () => {
    render(
      <TreeRail
        doc={doc}
        vocab={DEFAULT_VOCAB}
        activeTreeId="1023:default"
        onOpenTree={() => {}}
      />,
    );
    const failed = screen.getByRole("button", { name: /failed/ });
    expect(failed).toBeInTheDocument();
    expect(failed.className).toContain("empty");
    expect(failed.getAttribute("title")).toContain("opening it offers to author it");
  });

  it("renders the selector token in mono under a non-obvious row", () => {
    const { container } = render(
      <TreeRail doc={doc} vocab={DEFAULT_VOCAB} activeTreeId={null} onOpenTree={() => {}} />,
    );
    const tokens = [...container.querySelectorAll(".dlg-rail-token")].map((n) => n.textContent);
    expect(tokens).toContain("time:night");
    expect(tokens).toContain("segment:act_3");
  });

  it("filters by label, id AND selector token", () => {
    render(<TreeRail doc={doc} vocab={DEFAULT_VOCAB} activeTreeId={null} onOpenTree={() => {}} />);
    fireEvent.change(screen.getByLabelText("Filter trees"), { target: { value: "act_3" } });
    expect(screen.getByRole("button", { name: /after the transmission/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /night vigil/ })).toBeNull();
  });

  it("shows would-play / blocked ONLY from canon's select answer", () => {
    const select = {
      selected: "1023:night",
      trees: [
        { tree_id: "1023:night", status: "selected", why_not: null },
        {
          tree_id: "1023:default",
          status: "shadowed",
          why_not: "a higher-ranked tree matched first",
        },
        { tree_id: "1023:complete", status: "blocked", why_not: "blocked by quest:q1:completed" },
      ],
    } as unknown as DialogueSelectResult;
    render(
      <TreeRail
        doc={doc}
        vocab={DEFAULT_VOCAB}
        activeTreeId={null}
        onOpenTree={() => {}}
        select={select}
      />,
    );
    // Step 9 restructured the rail: with a select answer in hand the GROUPS
    // become would-play / blocked, and the per-row status still names canon's
    // verdict — so both now carry the same words, deliberately.
    const heads = [...document.querySelectorAll(".dlg-rail-group-head")].map(
      (n) => n.textContent ?? "",
    );
    expect(heads.some((h) => h.includes("would play now"))).toBe(true);
    expect(heads.some((h) => h.includes("blocked by state"))).toBe(true);
    expect(document.querySelector('.dlg-rail-status[data-status="selected"]')?.textContent).toBe(
      "would play now",
    );
    expect(document.querySelector('.dlg-rail-status[data-status="blocked"]')?.textContent).toBe(
      "blocked by state",
    );
    const completeRow = screen
      .getAllByRole("button")
      .find((b) => b.querySelector(".dlg-rail-label")?.textContent === "complete")!;
    expect(completeRow.getAttribute("title")).toContain("blocked by quest");
  });

  it("names the empty scene and quest sections in prose instead of hiding them", () => {
    render(<TreeRail doc={doc} vocab={DEFAULT_VOCAB} activeTreeId={null} onOpenTree={() => {}} />);
    expect(screen.getByText(/not an actor in any group scene/)).toBeInTheDocument();
    expect(
      screen.getByText(/no quest — this character's lines are unconditional/),
    ).toBeInTheDocument();
  });

  it("asks for the axis FIRST when adding a tree, from the pack's registry", () => {
    render(
      <TreeRail
        doc={doc}
        vocab={DEFAULT_VOCAB}
        activeTreeId={null}
        onOpenTree={() => {}}
        onNewTree={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New tree — pick a selector axis/ }));
    const offered = [...document.querySelectorAll(".dlg-axis-label")].map((n) => n.textContent);
    // One row per axis the PACK declares — never a hardcoded four.
    expect(offered).toHaveLength(DEFAULT_VOCAB.selector_axes.length);
    expect(offered).toEqual(
      expect.arrayContaining(["Quest state", "Time of day", "Segment", "Custom"]),
    );
  });
});

describe("the ⌘P switcher", () => {
  it("fuzzy-matches this NPC's trees", () => {
    const picked: string[] = [];
    render(
      <TreeSwitcher
        doc={doc}
        vocab={DEFAULT_VOCAB}
        onPick={(id) => picked.push(id)}
        onClose={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText("Go to a tree or scene…");
    fireEvent.change(input, { target: { value: "nv" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(picked).toEqual(["1023:night"]);
  });

  it("paints cross-surface rows as elsewhere", () => {
    const { container } = render(
      <TreeSwitcher
        doc={doc}
        vocab={DEFAULT_VOCAB}
        onPick={() => {}}
        onClose={() => {}}
        elsewhere={[
          {
            id: "other",
            label: "Rust-Kell · night gantry warning",
            detail: "time:21-05",
            pick: () => {},
          },
        ]}
      />,
    );
    const row = [...container.querySelectorAll(".dlg-switcher-row")].find((n) =>
      n.textContent?.includes("Rust-Kell"),
    );
    expect(row?.getAttribute("data-elsewhere")).toBe("1");
  });

  it("opens on ⌘P from the surface and switches the canvas tree", async () => {
    render(<DialogueSurface npc={NINE_TREE_NPC} npcId="1023" />);
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByPlaceholderText("Go to a tree or scene…");
    fireEvent.change(input, { target: { value: "night" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().dialogue.activeTree["npc:1023"]).toBe("1023:night");
  });
});
