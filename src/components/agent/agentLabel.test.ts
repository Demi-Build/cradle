import { describe, it, expect, afterEach } from "vitest";
import { useStore } from "../../store";
import type { PackInfo, WorldSummary } from "../../lib/invoke";
import {
  DEFAULT_AGENT_NAME,
  agentLabel,
  agentMonoLabel,
  agentName,
  packAgentName,
} from "./agentLabel";

/** The agent's name has ONE definition. It used to be derived from the
 *  project's story title — "The Silent Gospel" made the agent "GOSPEL" — which
 *  coupled the name to the world and made renaming it impossible. */

/** The `pack info` document, with whatever the case under test declares. */
const info = (extra: Record<string, unknown>): PackInfo => ({ pack_type: "platformer", ...extra });

const world = (packInfo?: PackInfo | null): WorldSummary => ({
  path: "/w",
  name: "The Wandering Wick",
  world_kind: "platformer",
  entity_counts: [],
  pack_info: packInfo ?? null,
});

afterEach(() => useStore.setState({ world: null, worldStoryTitle: null } as never));

describe("the agent's name", () => {
  it("is the constant, not anything derived from the project", () => {
    expect(DEFAULT_AGENT_NAME).toBe("Wright");
    expect(agentName()).toBe("Wright");
    expect(agentMonoLabel()).toBe("WRIGHT");
    // The three call sites still pass the project title. It is ignored.
    useStore.setState({ world: world(), worldStoryTitle: "The Silent Gospel" } as never);
    expect(agentLabel("The Silent Gospel")).toBe("WRIGHT");
    expect(agentLabel(null)).toBe("WRIGHT");
    expect(agentLabel()).toBe("WRIGHT");
  });

  it("comes from pack data when a pack names one", () => {
    expect(packAgentName(info({ agent_name: "Mason" }))).toBe("Mason");
    expect(agentName(info({ agent_name: "  Mason  " }))).toBe("Mason");
    useStore.setState({ world: world(info({ agent_name: "Mason" })) } as never);
    expect(agentLabel("The Silent Gospel")).toBe("MASON");
  });

  it("treats a declared name as pack DATA, not as markup", () => {
    // `pack_info` is an open document; a name is bounded and stripped before
    // it lands in the status bar, and one that survives none of that falls
    // back to the constant rather than rendering blank.
    expect(packAgentName(info({}))).toBeNull();
    expect(packAgentName(info({ agent_name: "   " }))).toBeNull();
    expect(packAgentName(info({ agent_name: 7 }))).toBeNull();
    expect(packAgentName(null)).toBeNull();
    expect(agentMonoLabel(info({ agent_name: "<b>x</b>\ny" }))).toBe("BXBY");
    expect(agentMonoLabel(info({ agent_name: "***" }))).toBe("WRIGHT");
    expect(agentMonoLabel(info({ agent_name: "n".repeat(80) }))).toHaveLength(24);
  });
});
