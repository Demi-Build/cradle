import { describe, it, expect } from "vitest";
import { refFromField } from "./refs";

describe("refFromField", () => {
  it("returns null for unknown fields", () => {
    expect(refFromField("not_a_ref_field", "room_1")).toBeNull();
  });

  it("returns null for null or undefined values", () => {
    expect(refFromField("room_id", null)).toBeNull();
    expect(refFromField("room_id", undefined)).toBeNull();
  });

  it("resolves a single string id", () => {
    expect(refFromField("quest_id", "quest_001")).toEqual({
      kind: "one",
      typeId: "quests",
      id: "quest_001",
    });
  });

  it("normalizes numeric room ids to room_<n>", () => {
    expect(refFromField("room_id", 3)).toEqual({
      kind: "one",
      typeId: "rooms",
      id: "room_3",
    });
    expect(refFromField("destination_room", "7")).toEqual({
      kind: "one",
      typeId: "rooms",
      id: "room_7",
    });
  });

  it("leaves already-prefixed room ids untouched", () => {
    expect(refFromField("room_id", "room_42")).toEqual({
      kind: "one",
      typeId: "rooms",
      id: "room_42",
    });
  });

  it("resolves array values as a many-ref", () => {
    expect(refFromField("monster_ids", ["goblin", "orc"])).toEqual({
      kind: "many",
      typeId: "monsters",
      ids: ["goblin", "orc"],
    });
  });

  it("drops non-string/number elements from arrays", () => {
    expect(refFromField("monster_ids", ["goblin", null, { bad: 1 }, "orc"])).toEqual({
      kind: "many",
      typeId: "monsters",
      ids: ["goblin", "orc"],
    });
  });

  it("returns null when an array has no valid ids", () => {
    expect(refFromField("monster_ids", [null, { bad: 1 }])).toBeNull();
    expect(refFromField("monster_ids", [])).toBeNull();
  });

  it("returns null for non-scalar, non-array values", () => {
    expect(refFromField("room_id", { foo: "bar" })).toBeNull();
    expect(refFromField("room_id", true)).toBeNull();
  });
});
