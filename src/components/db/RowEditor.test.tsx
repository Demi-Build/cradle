import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** `RowEditor` across all nine dungeon types (row P0-8). The two literals it
 *  used to carry are gone: the cradle-typeId → canon-kind map is `pack info`'s
 *  entity list, and the `HIDDEN` set is `canon db types`' per-kind lists
 *  (P0 paper P.1) —
 *
 *    hidden      never rendered
 *    protected   rendered, not editable, with the reason
 *    routed      a LINK to the owning surface
 *    decorative  editable, marked "engine ignores this field"
 *    containers  add/remove through the `<c>[<i>]` / `[+]` grammar
 */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

// The spend gate's card is a separate host component; these tests exercise
// the form, so the gate answers yes (a $0 selection never asks anyway).
vi.mock("../agent/confirmGateState", () => ({
  confirmSpend: () => Promise.resolve(true),
  confirmAction: () => Promise.resolve(true),
}));

import { RowEditor } from "./RowEditor";
import { useStore } from "../../store";
import { dungeonWorld } from "../../test/fixtures/roomBundle";

/** `canon db types` for the dungeon npc kind — the P.1.1 entry's own lists. */
const NPC_TYPE = {
  label: "NPCs",
  id_field: "id",
  skeleton_fields: [
    {
      name: "behavior_type",
      mode: "choices" as const,
      choices: ["static", "wandering", "merchant", "aggressive"],
    },
  ],
  llm_fields: ["name", "job"],
  code_fields: ["id", "type", "x", "y", "color"],
  schema_source: "pack",
  user_fields: ["availability", "description"],
  hidden: ["selected", "quest_target_tile"],
  decorative: ["quest_type", "is_story_npc"],
  protected: ["id", "profile_image", "selected", "provenance_hash"],
  routed: { x: "grid", y: "grid", dialogue_tree: "dialogue" },
};

const NPC_ROW = {
  id: 1000,
  name: "Mira",
  job: "smith",
  availability: "day",
  quest_type: "fetch",
  selected: true,
  quest_target_tile: null,
  x: 4,
  y: 3,
  profile_image: "portraits/npcs/npc_1000.png",
  dialogue_tree: { nodes: { start: { prompt: "hi", choices: [] } } },
  shop_inventory: [{ item_id: 2000, price: 12, stock: 1 }],
};

beforeEach(() => {
  useStore.setState({ worldPath: "/w", world: dungeonWorld(), entities: {} });
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
    if (cmd === "db_update") return Promise.resolve({ row: NPC_ROW, changed: {}, warnings: [] });
    if (cmd === "get_entity") return Promise.resolve(NPC_ROW);
    return Promise.resolve(null);
  });
});

function editNpc() {
  return render(
    <RowEditor
      typeId="npcs"
      editRow={NPC_ROW}
      editId="1000"
      onClose={() => {}}
      onCreated={() => {}}
    />,
  );
}

describe("RowEditor on a dungeon kind", () => {
  it("resolves the canon kind from pack info, not a hardcoded map", async () => {
    editNpc();
    await waitFor(() => expect(screen.getByText(/Edit NPCs · 1000/)).toBeInTheDocument());
    // `npcs` → `npc` came from `pack info`'s entity list.
    expect(invokeMock.mock.calls.some((c) => c[0] === "db_types")).toBe(true);
  });

  it("renders the field lists the way the registry classifies them", async () => {
    const user = userEvent.setup();
    editNpc();
    await waitFor(() => expect(screen.getByText(/Edit NPCs/)).toBeInTheDocument());

    // hidden: absent entirely.
    expect(screen.queryByText("selected")).toBeNull();
    expect(screen.queryByText("quest_target_tile")).toBeNull();

    // decorative: editable, with the engine-ignores note.
    const decorative = screen.getByText("quest_type").closest("label")!;
    expect(within(decorative).getByText("engine ignores this field")).toBeInTheDocument();
    expect(within(decorative).getByRole("textbox")).toBeEnabled();

    // routed: a LINK to the owning surface, never an input.
    const routedPane = screen.getByTestId("routed-fields");
    // x and y are both routed to the grid; the dialogue tree to its own tab.
    expect(
      within(routedPane).getAllByText(/owned by the grid — edit it on the room canvas/),
    ).toHaveLength(2);
    expect(
      within(routedPane).getByText(/owned by dialogue — edit it on the Dialogue tab/),
    ).toBeInTheDocument();
    expect(within(routedPane).queryByRole("textbox")).toBeNull();

    // protected: present but not editable, and it says why.
    await user.click(screen.getByRole("button", { name: /Protected/ }));
    const protectedPane = screen.getByTestId("protected-fields");
    const input = within(protectedPane).getAllByDisplayValue(/npc_1000|1000/)[0];
    expect(input).toBeDisabled();
    expect(input.closest("label")).toHaveAttribute(
      "title",
      expect.stringContaining("identity / provenance"),
    );

    // user fields are just editable — the free wins.
    expect(screen.getByText("availability").closest("label")!.querySelector("input")).toBeEnabled();
  });

  it("only sends CHANGED editable fields on save", async () => {
    const user = userEvent.setup();
    editNpc();
    await waitFor(() => expect(screen.getByText(/Edit NPCs/)).toBeInTheDocument());
    const availability = screen.getByText("availability").closest("label")!.querySelector("input")!;
    await user.clear(availability);
    await user.type(availability, "night");
    await user.click(screen.getByRole("button", { name: /Save 1 change/ }));
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === "db_update")).toBe(true));
    const call = invokeMock.mock.calls.find((c) => c[0] === "db_update")!;
    expect(call[1]).toMatchObject({
      entityType: "npc",
      id: "1000",
      set: { availability: "night" },
    });
  });

  it("edits a list container through the grammar the write core accepts", async () => {
    const user = userEvent.setup();
    editNpc();
    await waitFor(() => expect(screen.getByTestId("list-containers")).toBeInTheDocument());
    const lists = screen.getByTestId("list-containers");
    expect(within(lists).getByText("shop_inventory")).toBeInTheDocument();
    expect(within(lists).getByText(/item_id=2000/)).toBeInTheDocument();

    await user.click(within(lists).getByRole("button", { name: "＋ add" }));
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === "db_update")).toBe(true));
    expect(invokeMock.mock.calls.find((c) => c[0] === "db_update")![1]).toMatchObject({
      set: { "shop_inventory[+]": { item_id: "", price: "", stock: "" } },
    });

    invokeMock.mockClear();
    await user.click(within(lists).getByRole("button", { name: "✕" }));
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === "db_update")).toBe(true));
    expect(invokeMock.mock.calls.find((c) => c[0] === "db_update")![1]).toMatchObject({
      set: { "shop_inventory[0]": null },
    });
  });

  it("create mode offers the id field and the two create buttons", async () => {
    render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByText("New NPCs")).toBeInTheDocument());
    expect(screen.getByText(/leave blank when canon allocates it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create \(roll only\)/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Create \+ LLM complete/ })).toBeEnabled();
  });

  it("a `not yet` from db complete disables the button with its reason, never crashes", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
      if (cmd === "db_new")
        return Promise.reject(
          new Error('{"error":"not_yet","message":"db complete is not yet available for npc"}'),
        );
      return Promise.resolve(null);
    });
    render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByText("New NPCs")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Create \+ LLM complete/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Create \+ LLM complete/ })).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: /Create \+ LLM complete/ }).getAttribute("title"),
    ).toMatch(/not_yet|not yet/);
  });

  it("an unknown kind says so instead of rendering an empty form", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "db_types" ? Promise.resolve({ types: {} }) : Promise.resolve(null),
    );
    render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/this pack declares no npc type/)).toBeInTheDocument(),
    );
  });
});
