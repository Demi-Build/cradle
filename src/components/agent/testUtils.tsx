// Shared setup for the agent panel's tests: the store seeded with a small
// platformer world, the scripted agent (`agentMock.ts`) behind `agentApi`
// at speed 0, and the Tauri `invoke` mocked so the panel runs exactly as it
// does headless in the browser (I7) — no service, no keys, no network.

import type { Mock } from "vitest";
import { fireEvent } from "@testing-library/react";
import { useStore, INITIAL_AGENT } from "../../store";
import { setAgentTransport } from "../../lib/agent";
import { MOCK_MODELS, cancelledJobs, scriptedAgent } from "../../lib/agentMock";
import { newConversationTab } from "../../lib/agentActions";

/** Each test file hoists its own `invokeMock` (vi.mock factories cannot
 *  reference imports) and hands it to `setupAgent`, which installs the
 *  default answers below. */
export function defaultInvoke(cmd: string, args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case "agent_start": {
      // What the devMock does (I7): the scripted agent adopts the sidecar's
      // `--backend` / `--model`, and a (re)start re-installs the transport
      // that `agent_stop` cleared.
      scriptedAgent.startedOn(
        args?.backend ? String(args.backend) : null,
        args?.model ? String(args.model) : null,
      );
      setAgentTransport(scriptedAgent);
      return { port: 0, pid: 0, mock: true, command: "scripted agent (test)" };
    }
    case "agent_stop":
      return { stopped: true };
    case "agent_status":
      return { running: true, port: 0, pid: 0, pack: "/w", exit_code: null, stderr: [] };
    case "cancel_job":
      // What the devMock's dispatch does: the scripted paid loop stops at
      // its next item when it sees the id here.
      cancelledJobs.add(String(args?.jobId ?? ""));
      return { job_id: args?.jobId, status: "cancelled" };
    case "spend_list":
      return {
        result: "spend",
        spend: { count: 0, total_actual_usd: 0, total_estimate_usd: 0, by_op: {}, entries: [] },
      };
    case "jobs_list":
      return { result: "jobs", jobs: { count: 0, by_op: {}, by_status: {}, entries: [] } };
    case "jobs_record":
    case "spend_record":
      return { result: "ok", entry: args?.entry };
    case "asset_restore":
      return { artifact_id: args?.target, kind: "level" };
    case "list_entities":
      return [];
    case "play_level":
      return { launched: true, engine: "pygame" };
    default:
      return {};
  }
}

export function seedWorld() {
  useStore.setState({
    worldPath: "/w",
    world: {
      path: "/w",
      name: "The Wandering Wick",
      world_kind: "platformer",
      entity_counts: [
        { type_id: "levels", count: 3 },
        { type_id: "enemies", count: 2 },
      ],
    },
    worldStoryTitle: "The Wandering Wick",
    entities: {
      levels: [
        { type_id: "levels", id: "l2", name: "2-2 Ashfall Walk" },
        { type_id: "levels", id: "l3", name: "2-3 Lantern Stair" },
        { type_id: "levels", id: "l4", name: "2-4 Emberfall" },
      ],
      enemies: [{ type_id: "enemies", id: "ember_hopper", name: "Ember Hopper" }],
    },
    selection: { kind: "entity", typeId: "levels", id: "l3" },
    error: null,
    lightbox: null,
    drawerOpen: false,
    paletteOpen: false,
    commands: {},
    jobs: [],
    lastCompletedJob: null,
    layout: {
      focusMode: false,
      minimapCollapsed: false,
      toolRailPos: null,
      minimapPos: null,
      worldRailPos: null,
      dialogueToolRailPos: null,
      navCollapsed: false,
      inspectorCollapsed: false,
    },
    agentUi: { open: true, width: 412, collapsed: false },
    agent: { ...INITIAL_AGENT, service: { ...INITIAL_AGENT.service, status: "ready" } },
  });
}

/** Everything a panel test needs. Returns the transport for spying. */
export function setupAgent(invokeMock: Mock) {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve(defaultInvoke(cmd, args)),
  );
  scriptedAgent.speed = 0;
  setAgentTransport(scriptedAgent);
  seedWorld();
  useStore.getState().setAgent({ models: MOCK_MODELS.map((m) => ({ ...m })) });
  return scriptedAgent;
}

/** A fresh conversation tab with the given mode; returns its (local) id. */
export function openTab(mode = "ask"): string {
  return newConversationTab({ mode, model: "claude-sonnet-4-6" });
}

export function activeConversation() {
  const st = useStore.getState();
  return st.agent.activeId ? st.agent.conversations[st.agent.activeId] : undefined;
}

/** Tiny polling helper for store-level assertions. */
export async function until(pred: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("until(): condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Finished run cards collapse to one line (README §4); tests that inspect
 *  what happened inside a run expand every collapsed card first. */
export function expandRuns(): void {
  for (const head of document.querySelectorAll('.ag-run-head[aria-expanded="false"]')) {
    fireEvent.click(head);
  }
}
