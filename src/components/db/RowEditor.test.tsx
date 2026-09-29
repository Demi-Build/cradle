import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
// the form, so the gate answers yes (a $0 selection never asks anyway). It is
// a spy because "was the user asked to approve money at all?" is now itself
// under test.
const confirmSpendMock = vi.fn(() => Promise.resolve(true));
vi.mock("../agent/confirmGateState", () => ({
  confirmSpend: (...args: unknown[]) => confirmSpendMock(...(args as [])),
  confirmAction: () => Promise.resolve(true),
}));

import { RowEditor } from "./RowEditor";
import { useStore } from "../../store";
import { dungeonWorld } from "../../test/fixtures/roomBundle";
import { resetCompletionGate } from "./completionGate";

/** What `canon db complete` / `db new --complete` answer for a kind whose
 *  registry entry binds no per-row authoring body — the CLI's structured
 *  refusal, prose and all. The prose names a planning row; that is the half
 *  the UI must never repeat. */
const NOT_YET = new Error(
  'canon db failed: {"canon_version":"0.1.0","error":"db complete is not yet available ' +
    "for 'npc': the kind binds no per-row completion body (its prompts are generation-side " +
    "pool bodies) — Phase 0 §6 `canon generate / regenerate / reroll` registry wiring " +
    '(unassigned in the master) brings it","not_yet":true,"row":"Phase 0 §6 registry wiring",' +
    '"type":"npc"}',
);

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

/** Drain pending microtasks and the timer queue, so "has NOT been asked yet"
 *  is a claim about the ordering rather than a race this test happened to
 *  win. Without it, "not called" could just mean "not called by now". */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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
  resetCompletionGate();
  confirmSpendMock.mockClear();
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

  /** The bug: cradle asked the user to approve ~1¢ and THEN discovered canon
   *  refuses the kind outright. The refusal has to land first, and the
   *  control has to stay reachable with a reason a user can act on. */
  describe("a kind this pack cannot LLM-author", () => {
    /** Re-query rather than holding the node: going blocked re-parents the
     *  button under the tooltip, so the pre-flip node is detached. */
    const blockedButton = async () => {
      await screen.findByTestId("create-complete");
      await waitFor(() =>
        expect(screen.getByTestId("create-complete")).toHaveAttribute("aria-disabled", "true"),
      );
      return screen.getByTestId("create-complete");
    };

    function blockedMocks() {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
        if (cmd === "db_complete") return Promise.reject(NOT_YET);
        if (cmd === "db_new") return Promise.reject(NOT_YET);
        return Promise.resolve(null);
      });
    }

    it("never asks for money for a run that cannot happen", async () => {
      const user = userEvent.setup();
      blockedMocks();
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      // Greyed before the click, from the capability answer alone.
      await user.click(await blockedButton());
      expect(confirmSpendMock).not.toHaveBeenCalled();
      // …and nothing was created either.
      expect(invokeMock.mock.calls.some((c) => c[0] === "db_new")).toBe(false);
    });

    /** THE ORDER ITSELF, not the greyed button. The case above clicks a
     *  control the probe has already greyed, so it would still pass if the
     *  capability were settled AFTER `confirmSpend` — the early return on
     *  `completeOff` hides the inversion. Here the probe is deliberately still
     *  in flight at click time (the control is LIVE, exactly as it is for the
     *  first moments after the panel opens), so the click's own await is the
     *  only thing standing between the user and a money dialog for a run that
     *  cannot happen. Asserted on the INTERACTION: a spend card that was
     *  raised and then dismissed leaves the same screen behind. */
    it("never raises the money card on a click inside the probe window", async () => {
      const user = userEvent.setup();
      let refuse = () => {};
      const held = new Promise<never>((_resolve, reject) => {
        refuse = () => reject(NOT_YET);
      });
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
        if (cmd === "db_complete") return held; // canon has not answered yet
        if (cmd === "db_new") return Promise.reject(NOT_YET);
        return Promise.resolve(null);
      });
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      const button = await screen.findByTestId("create-complete");
      // Still live: nothing has greyed it, so the click is not short-circuited.
      expect(button).not.toHaveAttribute("aria-disabled");
      await user.click(button);
      await settle();
      // The click is parked on the capability, not on a spend dialog.
      expect(confirmSpendMock).not.toHaveBeenCalled();
      refuse();
      await waitFor(() =>
        expect(screen.getByTestId("create-complete")).toHaveAttribute("aria-disabled", "true"),
      );
      expect(confirmSpendMock).not.toHaveBeenCalled();
      expect(invokeMock.mock.calls.some((c) => c[0] === "db_new")).toBe(false);
      // And the click was answered on screen, in the product's own words.
      expect(screen.getByTestId("create-complete-reason")).toHaveTextContent(
        /no LLM authoring step/,
      );
    });
    it("asks the capability with a backend that cannot spend", async () => {
      blockedMocks();
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      await waitFor(() =>
        expect(invokeMock.mock.calls.some((c) => c[0] === "db_complete")).toBe(true),
      );
      expect(invokeMock.mock.calls.find((c) => c[0] === "db_complete")![1]).toMatchObject({
        entityType: "npc",
        llmBackend: "none",
      });
    });

    it("stays rendered and focusable, with the reason reachable by keyboard", async () => {
      blockedMocks();
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      const button = await blockedButton();
      // NOT hidden, and NOT natively disabled — a native `disabled` drops it
      // from the tab order and strands the reason on hover.
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
      button.focus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(/no LLM authoring step/);
    });

    it("says what works instead, and never repeats canon's planning-row prose", async () => {
      blockedMocks();
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      const reason = await screen.findByTestId("create-complete-reason");
      expect(reason).toHaveTextContent(/Create the row/);
      expect(reason).toHaveTextContent(/edit them by hand/);
      const shown = document.body.textContent ?? "";
      expect(shown).not.toMatch(/Phase 0/);
      expect(shown).not.toMatch(/master/);
      expect(shown).not.toMatch(/not_yet/);
    });

    it("greys the control from a late refusal too, when the probe could not answer", async () => {
      const user = userEvent.setup();
      // The probe fails for an unrelated reason (fail-open: the button stays
      // live), and the real run is the one that brings the refusal back.
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
        if (cmd === "db_complete") return Promise.reject(new Error("canon not on PATH"));
        if (cmd === "db_new") return Promise.reject(NOT_YET);
        return Promise.resolve(null);
      });
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      const button = await screen.findByTestId("create-complete");
      await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
      await user.click(button);
      await waitFor(() =>
        expect(screen.getByTestId("create-complete")).toHaveAttribute("aria-disabled", "true"),
      );
      expect(screen.getByTestId("create-complete-reason")).toHaveTextContent(
        /no LLM authoring step/,
      );
      expect(document.body.textContent ?? "").not.toMatch(/Phase 0/);
    });
  });

  /** The same ordering, proved on the path where the answer is YES — so the
   *  guard cannot be "passing" merely because every blocked click was already
   *  stopped by the greyed control. If `confirmSpend` ever moves ahead of the
   *  probe, the first assertion below fails even though this run ends
   *  identically. */
  describe("the capability is settled before the money card", () => {
    it("holds the spend card until the probe answers, even when it answers yes", async () => {
      const user = userEvent.setup();
      let allow = () => {};
      const held = new Promise<never>((_resolve, reject) => {
        // The probe reaching the row lookup IS the capability's yes.
        allow = () => reject(new Error("npc '__x__' not found"));
      });
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
        if (cmd === "db_complete") return held;
        if (cmd === "db_new") return Promise.resolve({ id: "1001", row: {} });
        return Promise.resolve(null);
      });
      render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
      const button = await screen.findByTestId("create-complete");
      expect(button).not.toHaveAttribute("aria-disabled");
      await user.click(button);
      await settle();
      // Nobody has been asked for money while the capability is unknown.
      expect(confirmSpendMock).not.toHaveBeenCalled();
      allow();
      // …and once it IS known, the money card is exactly where it was.
      await waitFor(() => expect(confirmSpendMock).toHaveBeenCalled());
      await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === "db_new")).toBe(true));
    });
  });

  it("leaves the control live on a kind the pack CAN author", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "db_types") return Promise.resolve({ types: { npc: NPC_TYPE } });
      // The probe reaches the row lookup, which is the capability's "yes".
      if (cmd === "db_complete") return Promise.reject(new Error("npc '__x__' not found"));
      if (cmd === "db_new") return Promise.resolve({ id: "1001", row: {} });
      return Promise.resolve(null);
    });
    render(<RowEditor typeId="npcs" onClose={() => {}} onCreated={() => {}} />);
    const button = await screen.findByTestId("create-complete");
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    await user.click(button);
    await waitFor(() => expect(confirmSpendMock).toHaveBeenCalled());
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === "db_new")).toBe(true));
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
