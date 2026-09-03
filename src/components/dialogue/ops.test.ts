// `ops.ts` is the whole write surface, so it is tested like `level/gridOps` —
// pure, exhaustive, and against the real fixture rather than a toy doc.
//
// Every assertion here is also an assertion about canon: the two
// implementations of one union must agree op for op, because the list this
// module builds is the JSON `canon dialogue update --ops` receives.

import { beforeEach, describe, expect, it } from "vitest";
import { applyOps, npcKey, OpError, opBucket, opLabel, opTarget, type EditOp } from "./ops";
import { orderedTrees, toAuthorDoc, type AuthorDoc } from "./model";
import { FOUR_VARIANT_NPC, WHISPER_TAM } from "../../test/fixtures/mazeworldNpcs";
import {
  canRedo,
  canUndo,
  commitSave,
  dirtyChipText,
  dirtyGroups,
  dirtyOps,
  dirtySummary,
  crossBufferChipText,
  emptyBuffer,
  pushOps,
  redo,
  revertAt,
  undo,
  bufferDoc,
} from "./useDialogueEditor";

let doc: AuthorDoc;
let treeId: string;

beforeEach(() => {
  doc = toAuthorDoc(WHISPER_TAM);
  treeId = doc.trees[0].tree_id;
});

describe("applyOps is pure and fail-closed", () => {
  it("never mutates the input document", () => {
    const before = JSON.stringify(doc);
    applyOps(doc, [{ k: "node.prompt", tree: treeId, node_id: "start", value: "changed" }]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("throws OpError naming the index and kind, and lands nothing", () => {
    const ops: EditOp[] = [
      { k: "node.prompt", tree: treeId, node_id: "start", value: "ok" },
      { k: "node.prompt", tree: treeId, node_id: "nope", value: "bad" },
    ];
    expect(() => applyOps(doc, ops)).toThrow(OpError);
    try {
      applyOps(doc, ops);
    } catch (e) {
      expect((e as OpError).opIndex).toBe(1);
      expect((e as OpError).op).toBe("node.prompt");
      expect((e as Error).message).toContain("has no node 'nope'");
    }
  });

  it("refuses an unknown op kind and lists the legal set", () => {
    expect(() => applyOps(doc, [{ k: "node.rename" } as unknown as EditOp])).toThrow(
      /unknown op — the dialogue op kinds are/,
    );
  });

  it("refuses a null prompt with the repair named", () => {
    expect(() =>
      applyOps(doc, [{ k: "node.prompt", tree: treeId, node_id: "start", value: null }]),
    ).toThrow(/cannot be null \(use an empty string\)/);
  });
});

describe("node ops", () => {
  it("edits a prompt", () => {
    const out = applyOps(doc, [
      { k: "node.prompt", tree: treeId, node_id: "start", value: "new line" },
    ]);
    expect(out.trees[0].nodes.start.prompt).toBe("new line");
  });

  it("adds a node with defaults filled the way canon fills them", () => {
    const out = applyOps(doc, [
      { k: "node.add", tree: treeId, node_id: "vigil", node: { prompt: "hm" } },
    ]);
    expect(out.trees[0].nodes.vigil).toEqual({
      node_id: "vigil",
      speaker: null,
      prompt: "hm",
      choices: [],
      tags: [],
    });
  });

  it("refuses a duplicate node id", () => {
    expect(() => applyOps(doc, [{ k: "node.add", tree: treeId, node_id: "start" }])).toThrow(
      /already exists/,
    );
  });

  it("node.remove retargets every inbound choice to end-of-conversation", () => {
    const tree = doc.trees[0];
    const target = tree.nodes.start.choices[0].next_node_id!;
    const inbound = Object.values(tree.nodes)
      .flatMap((n) => n.choices.map((c, i) => ({ node: n.node_id, i, to: c.next_node_id })))
      .filter((c) => c.to === target);
    expect(inbound.length).toBeGreaterThan(0);
    const out = applyOps(doc, [{ k: "node.remove", tree: treeId, node_id: target }]);
    expect(out.trees[0].nodes[target]).toBeUndefined();
    for (const ref of inbound) {
      expect(out.trees[0].nodes[ref.node].choices[ref.i].next_node_id).toBeNull();
    }
  });

  it("sets and clears a speaker", () => {
    const out = applyOps(doc, [
      { k: "node.speaker", tree: treeId, node_id: "start", value: "1024" },
      { k: "node.speaker", tree: treeId, node_id: "start", value: null },
    ]);
    expect(out.trees[0].nodes.start.speaker).toBeNull();
  });
});

describe("choice ops", () => {
  it("adds at the end by default and at an index when given one", () => {
    const before = doc.trees[0].nodes.start.choices.length;
    const out = applyOps(doc, [
      { k: "choice.add", tree: treeId, node_id: "start", index: 0, choice: { text: "first" } },
    ]);
    expect(out.trees[0].nodes.start.choices).toHaveLength(before + 1);
    expect(out.trees[0].nodes.start.choices[0].text).toBe("first");
    expect(out.trees[0].nodes.start.choices[0].conditions).toEqual([]);
  });

  it("refuses an out-of-range index with the range named", () => {
    expect(() =>
      applyOps(doc, [{ k: "choice.remove", tree: treeId, node_id: "start", index: 99 }]),
    ).toThrow(/index 99 is out of range/);
  });

  it("re-points a choice to end-of-conversation", () => {
    const out = applyOps(doc, [
      { k: "choice.target", tree: treeId, node_id: "start", index: 0, value: null },
    ]);
    expect(out.trees[0].nodes.start.choices[0].next_node_id).toBeNull();
  });

  it("sets conditions and effects as whole lists", () => {
    const out = applyOps(doc, [
      {
        k: "choice.conditions",
        tree: treeId,
        node_id: "start",
        index: 0,
        tokens: ["has_item:2000", "time:night"],
      },
      { k: "choice.effects", tree: treeId, node_id: "start", index: 0, tokens: ["set_flag:seen"] },
    ]);
    expect(out.trees[0].nodes.start.choices[0].conditions).toEqual(["has_item:2000", "time:night"]);
    expect(out.trees[0].nodes.start.choices[0].effects).toEqual(["set_flag:seen"]);
  });
});

describe("tree ops", () => {
  it("adds a tree at the next rank", () => {
    const out = applyOps(doc, [
      { k: "tree.add", tree: "1023:night", label: "night vigil", axis: "time" },
    ]);
    const added = out.trees.find((t) => t.tree_id === "1023:night")!;
    expect(added.rank).toBe(1000);
    expect(added.label).toBe("night vigil");
    expect(added.selector).toBeNull();
    expect(added.entry_node_id).toBe("start");
  });

  it("duplicates a tree UNGATED — the copy never inherits the selector", () => {
    const quest = toAuthorDoc(FOUR_VARIANT_NPC);
    const source = quest.trees.find((t) => t.selector !== null)!;
    const out = applyOps(quest, [{ k: "tree.duplicate", tree: "1001:copy", from: source.tree_id }]);
    const copy = out.trees.find((t) => t.tree_id === "1001:copy")!;
    expect(copy.selector).toBeNull();
    expect(copy.label).toContain("copy");
    expect(Object.keys(copy.nodes)).toEqual(Object.keys(source.nodes));
  });

  it("tree.rank re-ranks 0..n-1 and keeps unnamed trees after the named ones", () => {
    const quest = toAuthorDoc(FOUR_VARIANT_NPC);
    const order = ["1001:failed", "1001:complete"];
    const out = applyOps(quest, [{ k: "tree.rank", order }]);
    const ranked = orderedTrees(out).map((t) => t.tree_id);
    expect(ranked.slice(0, 2)).toEqual(order);
    expect(out.trees.map((t) => t.rank)).toEqual([0, 1, 2, 3]);
    // The two unnamed trees keep their relative order.
    expect(ranked.slice(2)).toEqual(["1001:incomplete", "1001:default"]);
  });

  it("tree.rank refuses an unknown id", () => {
    expect(() => applyOps(doc, [{ k: "tree.rank", order: ["nope"] }])).toThrow(
      /order names unknown tree\(s\) nope/,
    );
  });

  it("tree.selector sets rows, clears to fallback and can move the axis with it", () => {
    let out = applyOps(doc, [
      { k: "tree.selector", tree: treeId, selector: { rows: ["time:night"] }, axis: "time" },
    ]);
    expect(out.trees[0].selector).toEqual({ rows: ["time:night"] });
    expect(out.trees[0].axis).toBe("time");
    out = applyOps(out, [{ k: "tree.selector", tree: treeId, selector: null, axis: null }]);
    expect(out.trees[0].selector).toBeNull();
    expect(out.trees[0].axis).toBeNull();
  });

  it("tree.entry refuses a node the tree does not have", () => {
    expect(() => applyOps(doc, [{ k: "tree.entry", tree: treeId, node_id: "nope" }])).toThrow(
      /has no node 'nope' to make the entry/,
    );
  });
});

describe("op metadata drives the unsaved list", () => {
  it("targets group a node's edits together and a choice's separately", () => {
    expect(opTarget({ k: "node.prompt", tree: "t", node_id: "n", value: "x" })).toBe(
      "tree:t/node:n",
    );
    expect(opTarget({ k: "choice.text", tree: "t", node_id: "n", index: 2, value: "x" })).toBe(
      "tree:t/node:n/choice:2",
    );
    expect(opTarget({ k: "tree.rank", order: ["a"] })).toBe("selector");
  });

  it("labels every op kind in English", () => {
    expect(
      opLabel({ k: "choice.target", tree: "t", node_id: "n", index: 0, value: null }),
    ).toContain("end of conversation");
    expect(opLabel({ k: "tree.selector", tree: "t", selector: null })).toContain("fallback");
  });

  it("buckets ops for the chip counts", () => {
    expect(opBucket({ k: "node.prompt", tree: "t", node_id: "n", value: "" })).toBe("nodes");
    expect(opBucket({ k: "choice.text", tree: "t", node_id: "n", index: 0, value: "" })).toBe(
      "choices",
    );
    expect(opBucket({ k: "tree.add", tree: "t" })).toBe("trees");
    expect(opBucket({ k: "tree.rank", order: [] })).toBe("selectors");
  });
});

describe("the edit buffer: undo, redo, dirty grouping", () => {
  const edit = (n: number): EditOp => ({
    k: "node.prompt",
    tree: "1023:default",
    node_id: "start",
    value: `v${n}`,
  });

  it("undo and redo are cursor movement, and the doc follows", () => {
    let b = emptyBuffer(doc);
    b = pushOps(b, [edit(1)]);
    b = pushOps(b, [edit(2)]);
    expect(bufferDoc(b).trees[0].nodes.start.prompt).toBe("v2");
    b = undo(b);
    expect(bufferDoc(b).trees[0].nodes.start.prompt).toBe("v1");
    expect(canRedo(b)).toBe(true);
    b = undo(b);
    expect(bufferDoc(b).trees[0].nodes.start.prompt).toBe(doc.trees[0].nodes.start.prompt);
    expect(canUndo(b)).toBe(false);
    b = redo(b);
    expect(bufferDoc(b).trees[0].nodes.start.prompt).toBe("v1");
  });

  it("a new edit after an undo forks the history and drops the redo tail", () => {
    let b = emptyBuffer(doc);
    b = pushOps(b, [edit(1)]);
    b = pushOps(b, [edit(2)]);
    b = undo(b);
    b = pushOps(b, [edit(3)]);
    expect(canRedo(b)).toBe(false);
    expect(dirtyOps(b).map((o) => (o as { value: string }).value)).toEqual(["v1", "v3"]);
  });

  it("refuses an illegal op at the gesture, not at the render", () => {
    const b = emptyBuffer(doc);
    expect(() =>
      pushOps(b, [{ k: "node.prompt", tree: "nope", node_id: "start", value: "x" }]),
    ).toThrow(OpError);
  });

  it("groups the dirty list by target and counts it for the chip", () => {
    let b = emptyBuffer(doc);
    b = pushOps(b, [edit(1)]);
    b = pushOps(b, [
      { k: "choice.text", tree: treeId, node_id: "start", index: 0, value: "hi" },
      { k: "choice.target", tree: treeId, node_id: "start", index: 0, value: null },
    ]);
    const groups = dirtyGroups(b);
    expect(groups.map((g) => g.target)).toEqual([
      "tree:1023:default/node:start",
      "tree:1023:default/node:start/choice:0",
    ]);
    expect(groups[1].rows).toHaveLength(2);
    const summary = dirtySummary(b);
    // Step 12 widened the buckets with the scene half of the union; the tree
    // half's counts are unchanged.
    expect(summary).toEqual({
      count: 3,
      nodes: 1,
      choices: 2,
      trees: 0,
      selectors: 0,
      lines: 0,
      actors: 0,
      scene: 0,
    });
    expect(dirtyChipText(summary)).toBe("3 unsaved · 1 node 2 choices");
  });

  it("reverts one row out of the middle when the replay stays legal", () => {
    let b = emptyBuffer(doc);
    b = pushOps(b, [edit(1)]);
    b = pushOps(b, [{ k: "node.speaker", tree: treeId, node_id: "start", value: "1024" }]);
    b = pushOps(b, [edit(3)]);
    const result = revertAt(b, 1);
    expect(result.error).toBeNull();
    expect(dirtyOps(result.buffer)).toHaveLength(2);
    expect(bufferDoc(result.buffer).trees[0].nodes.start.speaker).toBeNull();
    expect(bufferDoc(result.buffer).trees[0].nodes.start.prompt).toBe("v3");
  });

  it("names the reason and changes nothing when a revert would break a later edit", () => {
    let b = emptyBuffer(doc);
    b = pushOps(b, [{ k: "node.add", tree: treeId, node_id: "vigil", node: { prompt: "a" } }]);
    b = pushOps(b, [{ k: "node.prompt", tree: treeId, node_id: "vigil", value: "b" }]);
    const result = revertAt(b, 0);
    expect(result.error).toContain("would break a later edit");
    expect(result.error).toContain("Undo back to it instead");
    expect(dirtyOps(result.buffer)).toHaveLength(2);
  });

  it("a save replaces the base and empties the stack", () => {
    let b = emptyBuffer(doc);
    b = pushOps(b, [edit(1)]);
    const saved = bufferDoc(b);
    b = commitSave(b, saved);
    expect(dirtyOps(b)).toEqual([]);
    expect(canUndo(b)).toBe(false);
    expect(b.base.trees[0].nodes.start.prompt).toBe("v1");
  });

  it("counts unsaved work across buffers for quest scope", () => {
    const one = pushOps(emptyBuffer(doc), [edit(1)]);
    const two = pushOps(emptyBuffer(doc), [edit(2)]);
    expect(
      crossBufferChipText([
        { key: npcKey(1023), summary: dirtySummary(one) },
        { key: npcKey(1001), summary: dirtySummary(two) },
      ]),
    ).toBe("2 unsaved across 2 NPCs");
    expect(
      crossBufferChipText([
        { key: npcKey(1023), summary: dirtySummary(one) },
        { key: npcKey(1001), summary: dirtySummary(emptyBuffer(doc)) },
      ]),
    ).toBe("1 unsaved · 1 node");
  });
});
