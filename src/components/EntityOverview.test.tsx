import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useStore } from "../store";

// EntityOverview transitively pulls in @tauri-apps/api/core via Portrait — stub
// it so the component tree mounts in jsdom. The boss-badge slot under test
// doesn't depend on the asset pipeline; the rest of the rendered tree just
// needs to not throw on import.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `mock://${p}`,
  invoke: vi.fn(() => Promise.resolve(null)),
}));

import { EntityOverview } from "./EntityOverview";

// Locks in the schema-driven boss-badge slot: for monsters the badge must
// ALWAYS be present in the overview chip row, regardless of is_boss state.
// This is what guarantees no chip-row width / wrap shift on edit-toggle.
describe("EntityOverview — boss badge slot", () => {
  beforeEach(() => {
    useStore.setState({ entityCache: {}, worldPath: "/w" });
  });

  it("display mode renders an ability-badge.is-off span for non-boss monsters", () => {
    const { container } = render(
      <EntityOverview data={{ is_boss: false }} typeId="monsters" entityId="1" />,
    );
    const badge = container.querySelector("span.ability-badge.is-off");
    expect(badge).not.toBeNull();
    expect(badge?.tagName).toBe("SPAN");
  });

  it("display mode renders an ability-badge.starting span for boss monsters", () => {
    const { container } = render(
      <EntityOverview data={{ is_boss: true }} typeId="monsters" entityId="1" />,
    );
    const badge = container.querySelector("span.ability-badge.starting");
    expect(badge).not.toBeNull();
  });

  it("edit mode renders the badge as a button.is-toggle", () => {
    useStore.setState({
      entityCache: {
        "monsters:1": { pristine: { is_boss: false }, draft: { is_boss: false }, dirty: false },
      },
    });
    const { container } = render(
      <EntityOverview data={{ is_boss: false }} typeId="monsters" entityId="1" editMode={true} />,
    );
    const toggle = container.querySelector("button.ability-badge.is-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.className).toContain("is-off");
  });
});
