import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** The row surface's generation actions. The one under test here is
 *  "✍️ LLM re-complete": it bills, so the CAPABILITY has to be settled before
 *  the money card — a kind this pack cannot LLM-author must never raise a
 *  spend dialog, and must still be on screen with a reason a user can act on
 *  (doctrine 4, as amended: greyed and focusable, not hidden). */

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => p,
}));

const confirmSpendMock = vi.fn(() => Promise.resolve(true));
vi.mock("./agent/confirmGateState", () => ({
  confirmSpend: (...args: unknown[]) => confirmSpendMock(...(args as [])),
  confirmAction: () => Promise.resolve(true),
}));

import { EntityOverview } from "./EntityOverview";
import { useStore } from "../store";
import { resetCompletionGate } from "./db/completionGate";

/** The CLI's structured refusal for a kind that binds no per-row authoring
 *  body — prose (which names a planning row) and payload together. */
const NOT_YET = new Error(
  'canon db failed: {"error":"db complete is not yet available for \'enemy\': the kind ' +
    "binds no per-row completion body — Phase 0 §6 `canon generate / regenerate / reroll` " +
    'registry wiring (unassigned in the master) brings it","not_yet":true,"type":"enemy"}',
);

const ROW = { enemy_id: "grub", name: "Grub", archetype: "patroller", rarity: "common" };

/** Drain pending microtasks and the timer queue, so "has NOT been asked yet"
 *  is a claim about the ordering rather than a race this test happened to
 *  win. Without it, "not called" could just mean "not called by now". */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  useStore.setState({ worldPath: "/w", world: null, entities: {}, selection: { kind: "none" } });
  resetCompletionGate();
  confirmSpendMock.mockClear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

function show() {
  return render(<EntityOverview data={ROW} typeId="enemies" entityId="grub" />);
}

describe("LLM re-complete on a kind this pack cannot author", () => {
  beforeEach(() => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "db_complete" ? Promise.reject(NOT_YET) : Promise.resolve(null),
    );
  });

  /** Re-query rather than holding the node: going blocked re-parents the
   *  button under the tooltip, so the pre-flip node is detached. */
  const blockedButton = async () => {
    await screen.findByTestId("llm-recomplete");
    await waitFor(() =>
      expect(screen.getByTestId("llm-recomplete")).toHaveAttribute("aria-disabled", "true"),
    );
    return screen.getByTestId("llm-recomplete");
  };

  it("never raises the spend card", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await blockedButton());
    expect(confirmSpendMock).not.toHaveBeenCalled();
  });

  it("stays rendered and focusable, with the reason on keyboard focus", async () => {
    show();
    const button = await blockedButton();
    expect(button).not.toBeDisabled();
    button.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/no LLM authoring step/);
    // Its sibling — the thing that DOES work — is untouched.
    expect(screen.getByRole("button", { name: /Edit row/ })).toBeEnabled();
  });

  it("never repeats canon's planning-row prose", async () => {
    show();
    (await blockedButton()).focus();
    await screen.findByRole("tooltip");
    const shown = document.body.textContent ?? "";
    expect(shown).not.toMatch(/Phase 0|not_yet|master/);
    expect(shown).toMatch(/Edit the row/);
  });

  it("asks the capability with a backend that cannot spend", async () => {
    show();
    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === "db_complete")).toBe(true),
    );
    expect(invokeMock.mock.calls.find((c) => c[0] === "db_complete")![1]).toMatchObject({
      entityType: "enemy",
      llmBackend: "none",
    });
  });
});

describe("LLM re-complete clicked while the capability probe is still in flight", () => {
  /** The greyed button is not the guarantee — it arrives late. The probe is a
   *  cold canon subprocess, and the control is LIVE until it answers, so the
   *  click itself has to settle the capability before the money card. This
   *  test deliberately clicks INSIDE that window (the refusal is held back
   *  until after the click) — the window the other cases wait past. */
  it("never raises the spend card", async () => {
    const user = userEvent.setup();
    let refuse = () => {};
    const held = new Promise((_resolve, reject) => {
      refuse = () => reject(NOT_YET);
    });
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "db_complete" ? held : Promise.resolve(null),
    );
    show();
    // Still live: canon has not answered, so nothing has greyed it yet.
    const button = await screen.findByTestId("llm-recomplete");
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    // Asserted BEFORE the refusal lands: the click is parked on the capability,
    // not on a money dialog. A card raised here and dismissed a tick later
    // leaves exactly the same screen behind, so the end state cannot say this.
    await settle();
    expect(confirmSpendMock).not.toHaveBeenCalled();
    refuse();
    await waitFor(() =>
      expect(screen.getByTestId("llm-recomplete")).toHaveAttribute("aria-disabled", "true"),
    );
    expect(confirmSpendMock).not.toHaveBeenCalled();
    // And the click was answered on screen, in the product's words.
    expect(await screen.findByText(/no LLM authoring step/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/Phase 0|not_yet|master/);
  });
});

describe("LLM re-complete on a kind this pack CAN author", () => {
  it("stays live and still gates the money", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd !== "db_complete") return Promise.resolve(null);
      // The probe reaches the row lookup — the capability's "yes".
      if (args.llmBackend === "none") return Promise.reject(new Error("enemy '__x__' not found"));
      return Promise.resolve({ id: "grub", row: ROW, warnings: [] });
    });
    show();
    const button = await screen.findByTestId("llm-recomplete");
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    await waitFor(() => expect(confirmSpendMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.some((c) => c[0] === "db_complete" && c[1].llmBackend !== "none"),
      ).toBe(true),
    );
  });
});

/** The ordering itself, proved on the path where the capability answers YES —
 *  so the guard cannot be "passing" merely because every blocked click was
 *  already stopped by the greyed control. If `confirmSpend` ever moves ahead
 *  of the probe, the first assertion below fails even though this run ends
 *  identically: same row re-completed, same note, same screen. */
describe("the capability is settled before the money card", () => {
  it("holds the spend card until the probe answers, even when it answers yes", async () => {
    const user = userEvent.setup();
    let allow = () => {};
    const held = new Promise<never>((_resolve, reject) => {
      // The probe reaching the row lookup IS the capability's yes.
      allow = () => reject(new Error("enemy '__x__' not found"));
    });
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd !== "db_complete") return Promise.resolve(null);
      if (args.llmBackend === "none") return held;
      return Promise.resolve({ id: "grub", row: ROW, warnings: [] });
    });
    show();
    const button = await screen.findByTestId("llm-recomplete");
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    await settle();
    // Nobody has been asked for money while the capability is still unknown.
    expect(confirmSpendMock).not.toHaveBeenCalled();
    allow();
    // …and once it IS known, the money card is exactly where it always was.
    await waitFor(() => expect(confirmSpendMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.some((c) => c[0] === "db_complete" && c[1].llmBackend !== "none"),
      ).toBe(true),
    );
  });
});
