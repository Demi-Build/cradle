import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MonsterStatBlock } from "./MonsterStatBlock";
import type { Monster } from "./types";
import { useStore } from "../../store";

// The schema-driven stat block declares 3 stat slots (HP, AC, Damage) and 5
// chip slots (damage_type, physical_type, affinity, weakness, time_availability)
// that ALWAYS render, regardless of which fields are populated. These tests
// pin that invariant — display and edit modes must produce identical DOM
// shape so toggling between them can't shift content.

function statSlotCount(container: HTMLElement): number {
  return container.querySelectorAll(".stat-block-row > .stat-slot").length;
}
function chipCount(container: HTMLElement): number {
  return container.querySelectorAll(".stat-block-chips > *").length;
}
function emDashCount(container: HTMLElement): number {
  return container.querySelectorAll(".slot-em").length;
}

describe("MonsterStatBlock — schema invariant", () => {
  beforeEach(() => {
    useStore.setState({ entityCache: {}, worldPath: "/w" });
  });

  it("display mode with empty data renders 3 stat slots and 5 chips", () => {
    const { container } = render(<MonsterStatBlock data={{} as Monster} />);
    expect(statSlotCount(container)).toBe(3);
    expect(chipCount(container)).toBe(5);
  });

  it("display mode marks empty slots/chips with .slot-em and .is-empty", () => {
    const { container } = render(<MonsterStatBlock data={{} as Monster} />);
    // HP, AC, Damage stat slots all show em-dash + every chip shows em-dash
    expect(emDashCount(container)).toBe(3 + 5);
    // All 5 chips carry the is-empty class
    expect(container.querySelectorAll(".stat-block-chips > .is-empty").length).toBe(5);
  });

  it("display mode with populated values renders verbatim and drops .is-empty", () => {
    const data: Monster = {
      hp_range: [10, 20],
      ac_range: [12, 14],
      damage_type: "fire",
      physical_type: "magic",
      elemental_affinity: "shadow",
      weakness: "light",
      time_availability: "night",
      attack_dice: "1d6",
    };
    const { container } = render(<MonsterStatBlock data={data} />);
    // Still 3 stat slots + 5 chips — invariant holds.
    expect(statSlotCount(container)).toBe(3);
    expect(chipCount(container)).toBe(5);
    // No em-dashes when every slot is populated.
    expect(emDashCount(container)).toBe(0);
    // No chip should carry the is-empty placeholder class.
    expect(container.querySelectorAll(".stat-block-chips > .is-empty").length).toBe(0);
    expect(container.textContent).toContain("10–20");
    expect(container.textContent).toContain("12–14");
    expect(container.textContent).toContain("1d6");
  });

  it("edit mode with empty data preserves the slot/chip count and swaps em-dashes for inputs", () => {
    useStore.setState({
      entityCache: { "monsters:1": { pristine: {}, draft: {}, dirty: false } },
    });
    const { container } = render(
      <MonsterStatBlock data={{} as Monster} editMode={true} typeId="monsters" entityId="1" />,
    );
    // Same structural shape as display mode.
    expect(statSlotCount(container)).toBe(3);
    expect(chipCount(container)).toBe(5);
    // Em-dashes are replaced by editable inputs; chips switch to is-editable.
    expect(emDashCount(container)).toBe(0);
    expect(container.querySelectorAll(".stat-block-chips > .is-editable").length).toBe(5);
    // 2 inputs per range (HP, AC) + 1 for Damage + 5 chip inputs = 10
    expect(container.querySelectorAll("input").length).toBe(10);
  });

  it("editing the HP max input updates hp_range[1] and preserves hp_range[0]", () => {
    useStore.setState({
      entityCache: {
        "monsters:1": {
          pristine: { hp_range: [10, 20] },
          draft: { hp_range: [10, 20] },
          dirty: false,
        },
      },
    });
    const { container } = render(
      <MonsterStatBlock
        data={{ hp_range: [10, 20] } as Monster}
        editMode={true}
        typeId="monsters"
        entityId="1"
      />,
    );
    // First .stat-slot is HP; its two number inputs are min and max.
    const hpSlot = container.querySelector(".stat-block-row > .stat-slot");
    const inputs = hpSlot!.querySelectorAll("input");
    expect(inputs.length).toBe(2);
    fireEvent.change(inputs[1], { target: { value: "30" } });
    const draft = useStore.getState().entityCache["monsters:1"].draft as Monster;
    expect(draft.hp_range).toEqual([10, 30]);
  });
});
