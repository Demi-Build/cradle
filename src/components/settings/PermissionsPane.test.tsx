import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Row P1-A6 — Settings → Permissions (agent-panel README §6, board 07).
 *
 *  The pane is small and its whole value is that the copy is exact: standing
 *  grants are per project, paid work is never on the list, and **revoking
 *  undoes nothing already done**. A pane that revokes without saying that last
 *  thing is a pane that misleads someone into thinking they undid a write. */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));

import { PermissionsPane } from "./PermissionsPane";
import { formatWhen } from "./grantTime";
import { setAgentTransport, type AgentTransport, type GrantsDoc } from "../../lib/agent";
import { agentActor } from "../../lib/actor";
import { useStore } from "../../store";

const GRANTS: GrantsDoc = {
  pack: "/w",
  path: "/w/.canon/agent/permissions.json",
  grants: [
    {
      index: 0,
      tool: "import_level_grids",
      granted_by: agentActor("wick", "level_designer"),
      when: "2026-09-13T14:06:00Z",
      scope: "project",
    },
    {
      index: 1,
      tool: "update_row",
      granted_by: agentActor("wick", "writer"),
      when: "2026-09-08T09:31:00Z",
      scope: "project",
    },
  ],
};

function transport(overrides: Partial<AgentTransport> = {}): AgentTransport {
  return {
    listGrants: vi.fn().mockResolvedValue(GRANTS),
    revokeGrant: vi.fn().mockResolvedValue({ ...GRANTS, grants: [GRANTS.grants[1]] }),
    revokeAllGrants: vi.fn().mockResolvedValue({ ...GRANTS, grants: [] }),
    ...overrides,
  } as unknown as AgentTransport;
}

beforeEach(() => {
  useStore.setState({
    worldPath: "/w",
    world: { path: "/w", name: "The Wandering Wick", world_kind: "platformer", entity_counts: [] },
  });
});

afterEach(() => setAgentTransport(null));

describe("PermissionsPane", () => {
  it("lists every grant with its tool, granting specialist and when", async () => {
    setAgentTransport(transport());
    render(<PermissionsPane />);
    const grid = await screen.findByTestId("grant-import_level_grids");
    expect(grid.textContent).toContain("import_level_grids");
    expect(grid.textContent).toContain("Level designer");
    expect(grid.textContent).toContain("granted");
    expect(screen.getByTestId("grant-update_row").textContent).toContain("Writer");
    // Board 07: grants are per project, and paid is never on this list.
    expect(screen.getByTestId("permissions-pane").textContent).toContain("this project only");
    expect(screen.getByTestId("permissions-pane").textContent).toContain(
      "Paid work is never on this list",
    );
    expect(screen.getByTestId("permissions-pane").textContent).toContain(
      "/w/.canon/agent/permissions.json",
    );
  });

  it("revokes one grant through the service and drops the row", async () => {
    const t = transport();
    setAgentTransport(t);
    render(<PermissionsPane />);
    await screen.findByTestId("grant-import_level_grids");
    await userEvent.click(screen.getByTestId("grant-import_level_grids").querySelector("button")!);
    await waitFor(() => expect(screen.queryByTestId("grant-import_level_grids")).toBeNull());
    expect(t.revokeGrant).toHaveBeenCalledWith(0, "/w");
    expect(screen.getByTestId("grant-update_row")).toBeTruthy();
  });

  it("revoke all empties the list", async () => {
    const t = transport();
    setAgentTransport(t);
    render(<PermissionsPane />);
    await screen.findByTestId("grant-update_row");
    await userEvent.click(screen.getByRole("button", { name: "Revoke all" }));
    await waitFor(() => expect(screen.getByTestId("permissions-empty")).toBeTruthy());
    expect(t.revokeAllGrants).toHaveBeenCalledWith("/w");
  });

  it("says revoking undoes nothing already done — the copy is the contract", async () => {
    setAgentTransport(transport());
    render(<PermissionsPane />);
    const note = await screen.findByTestId("permissions-undo-note");
    expect(note.textContent).toBe("Revoking does not undo anything already done.");
  });

  it("is disabled WITH A REASON when the service is not running, never hidden", async () => {
    setAgentTransport(null);
    render(<PermissionsPane />);
    const disabled = await screen.findByTestId("permissions-disabled");
    expect(disabled.textContent).toContain("isn’t running");
    expect(disabled.textContent).toContain("still in force");
    expect(screen.queryByRole("button", { name: "Revoke all" })).toBeNull();
  });

  it("surfaces a service error instead of showing an empty list", async () => {
    setAgentTransport(transport({ listGrants: vi.fn().mockRejectedValue(new Error("boom")) }));
    render(<PermissionsPane />);
    expect((await screen.findByTestId("permissions-error")).textContent).toContain("boom");
    expect(screen.queryByTestId("permissions-empty")).toBeNull();
  });
});

describe("formatWhen", () => {
  const now = new Date("2026-09-13T18:00:00Z");
  it("reads as a time for today and a date otherwise", () => {
    expect(formatWhen("2026-09-13T14:06:00Z", now)).toMatch(/ today$/);
    expect(formatWhen("2026-09-08T09:31:00Z", now)).toContain("2026-09-08");
  });
  it("never throws on a missing or malformed stamp — it is a label, not a clock", () => {
    expect(formatWhen(undefined, now)).toBe("—");
    expect(formatWhen("not a date", now)).toBe("not a date");
  });
});
