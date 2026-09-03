// Step 7: the grammar, the entity picker and the condition builder.
//
// The load-bearing claims:
//   • VOCABULARY IS DATA. Every namespace, operand list, scope and effect comes
//     from `pack info`'s dialogue block; a pack that renames or adds one moves
//     the whole surface with it and nothing here is a hardcoded list.
//   • ARITY IS DERIVED from the descriptor's own keys, never from a switch.
//   • NO COMPONENT BUILDS A TOKEN BY CONCATENATION — every row goes through
//     `formatToken`.
//   • The picker's two rules: `exclude` DISABLES rather than filters, and
//     `consequence` is named on the row BEFORE the pick.
//   • Engine support REPORTS, never blocks (doctrine 10).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve({}),
  convertFileSrc: (p: string) => p,
}));

import {
  DEFAULT_VOCAB,
  effectShape,
  engineCapabilityRows,
  engineSupports,
  engineReasonFor,
  formatToken,
  isParseError,
  legalIn,
  namespaceShape,
  parseEffect,
  parseToken,
  vocabOf,
  type DialogueVocab,
} from "./grammar";
import { ConditionRow, EffectRow, TokenPaste } from "./ConditionRow";
import { EntityPicker } from "./EntityPicker";
import { useStore } from "../../store";
import type { PackInfo } from "../../lib/invoke";

beforeEach(() => {
  useStore.setState({
    entities: {
      items: [
        { type_id: "items", id: "item_resonance_shard", name: "resonance shard" },
        { type_id: "items", id: "item_ration_cube", name: "ration cube" },
      ],
      npcs: [
        { type_id: "npcs", id: "1023", name: "Whisper-Tam" },
        { type_id: "npcs", id: "1024", name: "Rust-Kell" },
      ],
    },
  });
});

describe("vocabulary is pack data", () => {
  it("reads the block `pack info` ships and falls back to the core seed", () => {
    expect(vocabOf(null)).toEqual(DEFAULT_VOCAB);
    const custom = vocabOf({
      pack_type: "x",
      dialogue: { condition_namespaces: ["mood", "weather"] },
    } as unknown as PackInfo);
    expect(custom.condition_namespaces).toEqual(["mood", "weather"]);
    // Unnamed sections keep the seed rather than emptying out.
    expect(custom.effects).toEqual(DEFAULT_VOCAB.effects);
  });

  it("derives arity from the descriptor's keys, not from a switch", () => {
    expect(namespaceShape("player", DEFAULT_VOCAB).map((s) => s.name)).toEqual([
      "field",
      "op",
      "value",
    ]);
    expect(namespaceShape("time", DEFAULT_VOCAB).map((s) => s.name)).toEqual(["window"]);
    expect(namespaceShape("has_item", DEFAULT_VOCAB).map((s) => s.name)).toEqual(["entity_id"]);
    expect(namespaceShape("quest", DEFAULT_VOCAB).map((s) => s.name)).toEqual([
      "entity_id",
      "state",
    ]);
    expect(namespaceShape("flag", DEFAULT_VOCAB).map((s) => s.name)).toEqual(["key", "value"]);
    expect(namespaceShape("segment", DEFAULT_VOCAB).map((s) => s.name)).toEqual(["value"]);
  });

  it("gives a namespace the pack invents a working single-operand row", () => {
    const vocab: DialogueVocab = {
      ...DEFAULT_VOCAB,
      condition_namespaces: [...DEFAULT_VOCAB.condition_namespaces, "mood"],
      operands: { ...DEFAULT_VOCAB.operands, mood: { values: ["calm", "furious"] } },
    };
    expect(namespaceShape("mood", vocab)).toEqual([
      { name: "value", required: true, choices: ["calm", "furious"] },
    ]);
    expect(isParseError(parseToken("mood:calm", "tree", vocab))).toBe(false);
  });

  it("never narrows on an empty vocabulary list", () => {
    // `segment` seeds an EMPTY values list: legal namespace, no vocabulary yet.
    expect(namespaceShape("segment", DEFAULT_VOCAB)[0].choices).toBeUndefined();
    expect(isParseError(parseToken("segment:act_3", "tree", DEFAULT_VOCAB))).toBe(false);
  });
});

describe("scope legality names its reason", () => {
  it("rejects a scene-only namespace in a tree, with the reason", () => {
    const why = legalIn("actor", "tree", DEFAULT_VOCAB);
    expect(why).toContain("legal only in scene scope");
    expect(legalIn("actor", "scene", DEFAULT_VOCAB)).toBeNull();
  });

  it("lists the legal set for an unknown namespace", () => {
    expect(legalIn("mood", "tree", DEFAULT_VOCAB)).toContain("has_item");
  });

  it("names an unknown scope", () => {
    expect(legalIn("quest", "nowhere", DEFAULT_VOCAB)).toContain("this pack declares");
  });
});

describe("parse", () => {
  it("names the arity when the operand count is wrong", () => {
    const bad = parseToken("quest:q1", "tree", DEFAULT_VOCAB);
    expect(isParseError(bad)).toBe(true);
    expect((bad as { error: string }).error).toContain("quest takes 2 operand(s)");
  });

  it("names the pack's vocabulary when a value is outside it", () => {
    const bad = parseToken("time:midnight", "tree", DEFAULT_VOCAB);
    expect((bad as { error: string }).error).toContain("dawn, day, dusk, night");
  });

  it("joins an effect to the condition namespace whose vocabulary it writes", () => {
    expect(effectShape("gives_item", DEFAULT_VOCAB).map((s) => s.entity)).toEqual(["item"]);
    // `advance_quest`'s trailing state is OPTIONAL.
    expect(effectShape("advance_quest", DEFAULT_VOCAB).map((s) => s.required)).toEqual([
      true,
      false,
    ]);
    expect(isParseError(parseEffect("advance_quest:q1", DEFAULT_VOCAB))).toBe(false);
    expect(isParseError(parseEffect("advance_quest:q1:completed", DEFAULT_VOCAB))).toBe(false);
  });

  it("names an effect the pack does not declare", () => {
    const bad = parseEffect("explode:everything", DEFAULT_VOCAB);
    expect((bad as { error: string }).error).toContain("unknown effect 'explode'");
  });
});

describe("engine support reports and never blocks", () => {
  const packInfo = {
    pack_type: "dungeon",
    engine_evaluable_namespaces: {
      tree: { has_item: true, quest: { states: ["completed", "failed"] } },
      effects: { gives_item: true },
    },
  } as unknown as PackInfo;

  it("greens what the engine evaluates and ambers what it does not, with a reason", () => {
    expect(engineSupports("has_item:x", "condition", packInfo)).toBe(true);
    expect(engineSupports("time:night", "condition", packInfo)).toBe(false);
    expect(engineReasonFor("time:night", "condition", packInfo)).toContain(
      "shows unconditionally in game",
    );
  });

  it("ambers an operand the engine narrows away", () => {
    expect(engineSupports("quest:q1:completed", "condition", packInfo)).toBe(true);
    expect(engineSupports("quest:q1:active", "condition", packInfo)).toBe(false);
    expect(engineReasonFor("quest:q1:active", "condition", packInfo)).toContain(
      "completed, failed",
    );
  });

  // canon's `engine_evaluable` narrows PER NAMED SLOT (`states` → `state`,
  // `fields` → `field`). Testing the LAST operand against every list agreed
  // only while every narrowed slot happened to be final.
  it("narrows the named slot, not whichever operand came last", () => {
    const narrowsFirstSlot = {
      pack_type: "dungeon",
      engine_evaluable_namespaces: { tree: { player: { fields: ["level"] } } },
    } as unknown as PackInfo;
    // `player:level:>=:5` — the narrowed slot is `field`, the last operand is
    // the VALUE. A last-operand check would paint this amber against "level".
    expect(engineSupports("player:level:>=:5", "condition", narrowsFirstSlot)).toBe(true);
    expect(engineSupports("player:hp:>=:5", "condition", narrowsFirstSlot)).toBe(false);
    expect(engineReasonFor("player:hp:>=:5", "condition", narrowsFirstSlot)).toContain("field");
  });

  it("says the effect never fires, not that the gate is ignored", () => {
    expect(engineReasonFor("set_flag:x", "effect", packInfo)).toContain("never fires in game");
  });

  it("skips the layer entirely when the manifest carries no block", () => {
    // The PLAN: treat everything as supported and skip the engine-lag layer
    // rather than warn falsely.
    expect(engineSupports("time:night", "condition", null)).toBe(true);
    expect(engineReasonFor("time:night", "condition", null)).toBeNull();
  });

  it("builds the capability list from the pack registry, not a constant", () => {
    const rows = engineCapabilityRows(DEFAULT_VOCAB, packInfo);
    expect(rows).toContainEqual({ namespace: "has_item", evaluated: true });
    expect(rows).toContainEqual({ namespace: "time", evaluated: false });
    expect(rows).toHaveLength(DEFAULT_VOCAB.condition_namespaces.length);
  });
});

describe("the entity picker's two rules", () => {
  it("DISABLES an already-used row with its reason instead of filtering it out", () => {
    render(
      <EntityPicker
        title="voices[3] · condition"
        namespace="actor"
        slot={{
          types: ["npcs"],
          exclude: ["1024"],
          excludeReason: () => "already an actor",
          onPick: () => {},
        }}
        onClose={() => {}}
      />,
    );
    // Still visible — searching for someone you added must not look like they
    // do not exist in the world.
    const row = screen.getByRole("button", { name: /Rust-Kell/ });
    expect(row).toBeInTheDocument();
    expect(row).toBeDisabled();
    expect(row.textContent).toContain("already an actor");
  });

  it("names the consequence on the row, BEFORE the pick", () => {
    const picked: string[] = [];
    render(
      <EntityPicker
        title="＋ Actor"
        namespace="actor"
        slot={{
          types: ["npcs"],
          consequence: (id) =>
            id === "1024" ? "room_2 — adds a room: gate to reach this scene" : null,
          onPick: (id) => picked.push(id),
        }}
        onClose={() => {}}
      />,
    );
    const row = screen.getByRole("button", { name: /Rust-Kell/ });
    expect(row.textContent).toContain("adds a room: gate");
    expect(picked).toEqual([]);
    fireEvent.click(row);
    expect(picked).toEqual(["1024"]);
  });

  // The footer advertises `↑↓ navigate · ↵ insert`, so both have to work — the
  // same class of defect `lib/keys.ts` records for the `⌘O` hint that had no
  // handler anywhere.
  it("↑↓ moves the highlighted row and ↵ inserts it, skipping disabled rows", () => {
    const picked: string[] = [];
    const { container } = render(
      <EntityPicker
        title="＋ Actor"
        namespace="actor"
        slot={{
          types: ["npcs"],
          exclude: ["1024"],
          excludeReason: () => "already an actor",
          onPick: (id) => picked.push(id),
        }}
        onClose={() => {}}
      />,
    );
    const search = screen.getByLabelText("Search the world");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const active = container.querySelector(".dlg-picker-row.on")!;
    expect(active).toBeTruthy();
    // The disabled row is never the active one.
    expect(active.textContent).not.toContain("already an actor");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(picked).toHaveLength(1);
    expect(picked[0]).not.toBe("1024");
  });

  it("previews the token in the footer before it is committed", () => {
    const { container } = render(
      <EntityPicker
        title="has_item"
        namespace="has_item"
        slot={{ types: ["items"], onPick: () => {} }}
        engineEvaluable={() => false}
        onClose={() => {}}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: /resonance shard/ }));
    expect(container.querySelector(".dlg-picker-foot")?.textContent).toContain(
      "has_item:item_resonance_shard",
    );
    expect(
      container.querySelector(".dlg-picker-foot .dlg-ribbon-dot")?.getAttribute("data-engine"),
    ).toBe("lag");
  });

  it("says the list IS the pack's rows when nothing matches", () => {
    render(
      <EntityPicker
        title="has_item"
        slot={{ types: ["items"], onPick: () => {} }}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search the world"), { target: { value: "zzz" } });
    expect(screen.getByText(/does not exist in this world/)).toBeInTheDocument();
  });
});

describe("the condition builder", () => {
  it("renders controls whose SHAPE follows the namespace, and assembles the token", () => {
    const emitted: string[] = [];
    const { rerender } = render(
      <ConditionRow
        token="player:health:<:10"
        scope="tree"
        vocab={DEFAULT_VOCAB}
        packInfo={null}
        engineEvaluable
        engineReason={null}
        onChange={(t) => emitted.push(t)}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByLabelText("field")).toHaveValue("health");
    expect(screen.getByLabelText("op")).toHaveValue("<");
    fireEvent.change(screen.getByLabelText("op"), { target: { value: ">=" } });
    expect(emitted).toEqual(["player:health:>=:10"]);

    rerender(
      <ConditionRow
        token="time:night"
        scope="tree"
        vocab={DEFAULT_VOCAB}
        packInfo={null}
        engineEvaluable
        engineReason={null}
        onChange={(t) => emitted.push(t)}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByLabelText("window")).toHaveValue("night");
  });

  it("renders the raw token under the row, so the dropdown is verifiable", () => {
    const { container } = render(
      <ConditionRow
        token="has_item:item_resonance_shard"
        scope="tree"
        vocab={DEFAULT_VOCAB}
        packInfo={null}
        engineEvaluable
        engineReason={null}
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector(".dlg-row-token")?.textContent).toBe(
      "has_item:item_resonance_shard",
    );
  });

  it("shows the engine-lag reason on the row without refusing the token", () => {
    const { container } = render(
      <ConditionRow
        token="time:night"
        scope="tree"
        vocab={DEFAULT_VOCAB}
        packInfo={null}
        engineEvaluable={false}
        engineReason="the engine does not evaluate 'time' at tree scope"
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector(".dlg-row-lag")?.textContent).toContain("does not evaluate");
    expect(container.querySelector(".dlg-row.bad")).toBeNull();
  });

  it("names an illegal token in place rather than dropping it", () => {
    const { container } = render(
      <ConditionRow
        token="actor:1024:present"
        scope="tree"
        vocab={DEFAULT_VOCAB}
        packInfo={null}
        engineEvaluable={false}
        engineReason={null}
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector(".dlg-row-error")?.textContent).toContain(
      "legal only in scene scope",
    );
  });

  it("assembles an effect token through formatToken too", () => {
    const emitted: string[] = [];
    render(
      <EffectRow
        token="set_flag:heard"
        vocab={DEFAULT_VOCAB}
        packInfo={null}
        engineEvaluable
        engineReason={null}
        onChange={(t) => emitted.push(t)}
        onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("effect"), { target: { value: "gives_quest" } });
    expect(emitted).toEqual([formatToken("gives_quest")]);
  });
});

describe("the token paste escape hatch", () => {
  it("validates per line and refuses to commit while any line is bad", () => {
    const committed: string[][] = [];
    render(
      <TokenPaste
        tokens={["has_item:x"]}
        scope="tree"
        vocab={DEFAULT_VOCAB}
        kind="condition"
        onCommit={(t) => committed.push(t)}
        onCancel={() => {}}
      />,
    );
    const area = screen.getByLabelText("paste condition tokens");
    fireEvent.change(area, { target: { value: "has_item:x\ntime:midnight" } });
    expect(screen.getByText(/line 2:/)).toBeInTheDocument();
    const commit = screen.getByRole("button", { name: "Use these tokens" });
    expect(commit).toBeDisabled();
    fireEvent.change(area, { target: { value: "has_item:x\ntime:night" } });
    fireEvent.click(commit);
    expect(committed).toEqual([["has_item:x", "time:night"]]);
  });
});
