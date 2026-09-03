// Step 12: scenes. `SceneTab`, `SceneScript`, `SceneActors`, `SceneSettings`,
// the scene-only `actor:` namespace, `canon scene *` wired, and the presence
// toggles in the tester dock.
//
// The claims:
//   • `actor:` is legal in a SCENE and refused in a TREE **with the reason** —
//     never silently ignored, and never silently accepted.
//   • A scene is an EVENT of type `scene`, and the type comes from the pack's
//     own `dialogue.scene.event_type`.
//   • The scene ops mirror canon's `SCENE_OPS`, and removing a line RETARGETS
//     the branch options that pointed at it rather than leaving a dangler.
//   • The tester's presence toggles NAME the skip (`line 05 will be skipped —
//     … is absent`) rather than silently vanishing the line.
//   • Every write goes through `canon scene update`; nothing writes a file.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

import { SceneTab } from "./SceneTab";
import { isSceneRow, nextLineNumber, sceneReport, toSceneDoc, toSceneRow } from "../dialogue/scene";
import { applyOps, SCENE_OPS, type EditOp } from "../dialogue/ops";
import { DEFAULT_VOCAB, legalIn, parseToken, isParseError } from "../dialogue/grammar";
import { useStore } from "../../store";

const ROW = {
  id: "evt_3120",
  type: "scene",
  name: "The Bonefield Confession",
  description: "",
  title: "The Bonefield Confession",
  actors: [
    { character_id: "1023", required: true },
    { character_id: "1041", required: false },
  ],
  settings: ["quest:q_whisper_signal:active", "room:room_2"],
  trigger: "enter_room",
  once: true,
  on_finish: ["set_flag:heard_confession"],
  lines: [
    {
      k: "line",
      n: 1,
      speaker: "1023",
      text: "The Prophet's frequency is a translation.",
      conditions: [],
    },
    { k: "line", n: 2, speaker: "1041", text: "Third gantry sang all night.", conditions: [] },
    {
      k: "choice",
      n: 3,
      options: [
        { text: "I heard it too.", to: 2, conditions: [] },
        { text: "Say nothing.", to: null, conditions: ["time:night"] },
      ],
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

/** `canon scene test`'s answer with Rust-Kell absent — the SKIP IS NAMED. */
const WALK = {
  scene: "evt_3120",
  title: "The Bonefield Confession",
  plays: true,
  settings: { pass: true, conditions: [], failing_reason: null },
  blocked_by: null,
  absent_required_actors: [],
  gates: { pass: 0, fail: 0, unevaluable: 2, error: 0 },
  transcript: [
    {
      n: 1,
      k: "line",
      speaker: "1023",
      text: "The Prophet's frequency is a translation.",
      played: true,
    },
    {
      n: 2,
      k: "line",
      speaker: "1041",
      text: "Third gantry sang all night.",
      played: false,
      skipped_because: "line 02 will be skipped — 1041 is absent",
    },
  ],
  on_finish: [],
  state: {},
  post_effect_state: {},
};

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "scene_validate") {
      return Promise.resolve({ scene: "evt_3120", lines: 3, errors: [], warnings: [] });
    }
    if (cmd === "scene_test") return Promise.resolve(WALK);
    if (cmd === "scene_update") {
      return Promise.resolve({
        scene: "evt_3120",
        created: false,
        ops: [],
        row: ROW,
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

describe("the scene-only `actor:` namespace", () => {
  it("is LEGAL in a scene", () => {
    expect(legalIn("actor", "scene", DEFAULT_VOCAB)).toBeNull();
    const parsed = parseToken("actor:1041:present", "scene", DEFAULT_VOCAB);
    expect(isParseError(parsed)).toBe(false);
  });

  it("is REFUSED in a tree, WITH THE REASON — never silently ignored", () => {
    const why = legalIn("actor", "tree", DEFAULT_VOCAB);
    expect(why).toContain("legal only in scene scope");
    expect(why).toContain("a tree has no actor roster");
    const parsed = parseToken("actor:1041:present", "tree", DEFAULT_VOCAB);
    expect(isParseError(parsed)).toBe(true);
    expect(isParseError(parsed) && parsed.error).toContain("legal only in scene scope");
  });

  it("is refused at SELECTOR scope too, with the same named reason", () => {
    expect(legalIn("actor", "selector", DEFAULT_VOCAB)).toContain("legal only in scene scope");
  });
});

describe("the scene document", () => {
  it("recognises a scene by the PACK's event type, not the literal", () => {
    expect(isSceneRow(ROW, DEFAULT_VOCAB)).toBe(true);
    expect(isSceneRow({ ...ROW, type: "puzzle" }, DEFAULT_VOCAB)).toBe(false);
    const renamed = { ...DEFAULT_VOCAB, scene: { ...DEFAULT_VOCAB.scene, event_type: "tableau" } };
    expect(isSceneRow(ROW, renamed)).toBe(false);
    expect(isSceneRow({ ...ROW, type: "tableau" }, renamed)).toBe(true);
  });

  it("normalises every key and keeps the engine-required name/description", () => {
    const doc = toSceneDoc(ROW, "evt_3120");
    expect(doc.kind).toBe("scene");
    expect(doc.name).toBe("The Bonefield Confession");
    expect(doc.lines).toHaveLength(3);
    expect(nextLineNumber(doc)).toBe(4);
    // The wire payload drops cradle's buffer discriminator and nothing else.
    expect(toSceneRow(doc)).not.toHaveProperty("kind");
    expect(toSceneRow(doc)).toHaveProperty("name");
  });

  it("errors only on a branch target that names no line", () => {
    const doc = toSceneDoc(ROW, "evt_3120");
    expect(sceneReport(doc).errors).toEqual([]);
    const broken = toSceneDoc(
      { ...ROW, lines: [{ k: "choice", n: 1, options: [{ text: "x", to: 99, conditions: [] }] }] },
      "evt_3120",
    );
    expect(sceneReport(broken).errors[0]).toContain("branches to line 99");
  });
});

describe("the scene half of the op union", () => {
  const doc = toSceneDoc(ROW, "evt_3120");

  it("mirrors canon's SCENE_OPS, kind for kind", () => {
    expect([...SCENE_OPS]).toEqual([
      "scene.line.add",
      "scene.line.remove",
      "scene.line.text",
      "scene.line.speaker",
      "scene.line.conditions",
      "scene.actor.add",
      "scene.actor.remove",
      "scene.actor.required",
      "scene.settings",
      "scene.trigger",
      "scene.once",
      "scene.on_finish",
    ]);
  });

  // canon RENUMBERS 1..N after every structural line op and remaps every
  // choice option's `to` with them (`canon.dialogue.ops._renumber`). Branch
  // targets ARE line numbers, so anything else makes the unsaved preview show a
  // different script than the one that gets written.
  it("removing a line RENUMBERS the rest and remaps the branch targets", () => {
    const next = applyOps(doc, [{ k: "scene.line.remove", scene: "evt_3120", n: 2 }]);
    expect(next.lines.map((l) => l.n)).toEqual([1, 2]);
    const choice = next.lines.find((l) => l.k === "choice");
    // The option pointed at line 2, which is gone; line 2 is now the choice
    // block itself, exactly as canon resolves it.
    expect(choice?.k === "choice" && choice.options[0].to).toBe(2);
  });

  it("adding a line treats `n` as an insert POSITION and clamps it, like canon", () => {
    const next = applyOps(doc, [
      { k: "scene.line.add", scene: "evt_3120", n: 1, value: { k: "line", text: "first" } },
    ]);
    expect(next.lines.map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(next.lines[0].k === "line" && next.lines[0].text).toBe("first");
    // A duplicate number is an insert, never an error.
    const far = applyOps(doc, [
      { k: "scene.line.add", scene: "evt_3120", n: 99, value: { k: "line", text: "last" } },
    ]);
    expect(far.lines.map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(far.lines[3].k === "line" && far.lines[3].text).toBe("last");
  });

  // The payload key is what canon READS. `canon.dialogue.ops._apply_scene_op`
  // takes `op.get("value")` for all four of these; sending the tree half's
  // `tokens` / `line` spelling had `scene update` refusing the batch
  // fail-closed, and the dev mock could not catch it because it applies this
  // same TS `applyOps`.
  it("spells every scene payload `value`, the key canon reads", () => {
    const emitted = [
      { k: "scene.line.add", scene: "evt_3120", n: 1, value: { k: "line", text: "x" } },
      { k: "scene.line.conditions", scene: "evt_3120", n: 1, value: ["actor:1023:present"] },
      { k: "scene.settings", scene: "evt_3120", value: ["room:room_2"] },
      { k: "scene.on_finish", scene: "evt_3120", value: ["set_flag:x"] },
    ] satisfies EditOp[];
    for (const op of emitted) {
      expect(Object.keys(op)).toContain("value");
      expect(Object.keys(op)).not.toContain("tokens");
      expect(Object.keys(op)).not.toContain("line");
    }
    // And each is accepted by the buffer under that spelling.
    expect(() => applyOps(doc, emitted)).not.toThrow();
  });

  it("removing an actor KEEPS their lines — prose is never silently deleted", () => {
    const next = applyOps(doc, [
      { k: "scene.actor.remove", scene: "evt_3120", character_id: "1041" },
    ]);
    expect(next.actors).toHaveLength(1);
    expect(next.lines.some((l) => l.k === "line" && l.speaker === "1041")).toBe(true);
    expect(sceneReport(next).warnings.join(" ")).toContain("who is not an actor");
  });

  it("refuses a TREE op against a scene buffer, by name", () => {
    expect(() =>
      applyOps(doc, [{ k: "node.prompt", tree: "t", node_id: "start", value: "x" }]),
    ).toThrow(/is a tree op, but this buffer holds a scene/);
  });

  it("refuses a SCENE op against a character buffer, by name", () => {
    expect(() =>
      applyOps({ character_id: "1023", trees: [], chrome: {} }, [
        { k: "scene.once", scene: "evt_3120", value: false },
      ]),
    ).toThrow(/is a scene op, but this buffer holds a character's trees/);
  });
});

describe("the scene surface", () => {
  it("renders the numbered script with a choice block and the gate ribbons", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    const script = await screen.findByTestId("scene-script");
    expect(script.textContent).toContain("01");
    expect(script.textContent).toContain("choice point · 2 options");
    expect(script.textContent).toContain("→ ends the scene");
  });

  it("marks an OPTIONAL actor's line `skipped if absent`", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    const line = await screen.findByTestId("scene-line-2");
    expect(line.textContent).toContain("skipped if absent");
    expect(line.getAttribute("data-conditional")).toBe("1");
  });

  it("lists actors with their line counts and required/optional select", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    const actors = await screen.findByTestId("scene-actors");
    expect(actors.textContent).toContain("speaks 1");
    expect(actors.textContent).toContain("Removing a");
    expect((screen.getByLabelText("1041 required") as HTMLSelectElement).value).toBe("optional");
  });

  it("previews the consequence before removing a REQUIRED actor", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    fireEvent.click(await screen.findByLabelText("Remove 1023"));
    const sheet = await screen.findByLabelText("Remove a required actor");
    expect(sheet.textContent).toContain("absence cancels the scene");
    // Nothing is dirty until it is confirmed.
    expect(useStore.getState().dialogue.buffers["scene:evt_3120"]?.cursor ?? 0).toBe(0);
  });

  it("edits a line as an op in the unsaved buffer — nothing writes yet", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    fireEvent.change(await screen.findByLabelText("line 1 text"), {
      target: { value: "Someone chose the words." },
    });
    await waitFor(() =>
      expect(useStore.getState().dialogue.buffers["scene:evt_3120"]?.cursor).toBe(1),
    );
    expect(useStore.getState().dialogue.buffers["scene:evt_3120"].ops[0].k).toBe("scene.line.text");
    expect(calls.some((c) => c.cmd === "scene_update")).toBe(false);
  });

  it("⌘S sends ONE `canon scene update` carrying the op list", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    fireEvent.change(await screen.findByLabelText("line 1 text"), {
      target: { value: "Someone chose the words." },
    });
    await waitFor(() =>
      expect(useStore.getState().dialogue.buffers["scene:evt_3120"]?.cursor).toBe(1),
    );
    fireEvent.click(screen.getByTitle(/Save the unsaved buffer/));
    fireEvent.click(await screen.findByRole("button", { name: /Save all/ }));
    await waitFor(() => expect(calls.filter((c) => c.cmd === "scene_update")).toHaveLength(1));
    const args = calls.find((c) => c.cmd === "scene_update")!.args;
    expect(args.scene).toBe("evt_3120");
    expect((args.ops as { k: string }[])[0].k).toBe("scene.line.text");
  });

  it("engine-lag reaches the scene settings too", async () => {
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    const settings = await screen.findByTestId("scene-settings");
    const note = settings.querySelector('[data-testid="dialogue-lag-tray"]');
    expect(note?.textContent).toContain("not enforced");
    expect(note?.textContent).toContain("nothing at scene scope yet");
  });
});

describe("the tester's presence toggles", () => {
  it("walks the UNSAVED buffer through `canon scene test`", async () => {
    useStore.setState({
      dialogue: { mode: "test", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    });
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "scene_test")).toBe(true));
    const payload = calls.find((c) => c.cmd === "scene_test")!.args.scene as { id: string };
    expect(payload.id).toBe("evt_3120");
  });

  it("NAMES the skip rather than silently vanishing the line", async () => {
    useStore.setState({
      dialogue: { mode: "test", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    });
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    const dock = await screen.findByTestId("scene-dock");
    await waitFor(() =>
      expect(dock.textContent).toContain("line 02 will be skipped — 1041 is absent"),
    );
  });

  it("toggling presence re-runs the walk with the new actor state", async () => {
    useStore.setState({
      dialogue: { mode: "test", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    });
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "scene_test")).toBe(true));
    const before = calls.filter((c) => c.cmd === "scene_test").length;
    fireEvent.click(await screen.findByText(/1041 ✓/));
    await waitFor(() =>
      expect(calls.filter((c) => c.cmd === "scene_test").length).toBeGreaterThan(before),
    );
    const last = calls.filter((c) => c.cmd === "scene_test").pop()!;
    expect((last.args.state as { actors: Record<string, string> }).actors["1041"]).toBe("absent");
  });

  it("says the simulated presence is never written to the pack", async () => {
    useStore.setState({
      dialogue: { mode: "test", scope: "npc", buffers: {}, activeTree: {}, activeKey: null },
    });
    render(<SceneTab event={ROW} sceneId="evt_3120" />);
    const presence = await screen.findByTestId("scene-presence");
    expect(presence.textContent).toContain("never written to the pack");
  });
});
