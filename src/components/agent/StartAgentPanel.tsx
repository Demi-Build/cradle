import { useEffect, useMemo } from "react";
import { useStore } from "../../store";
import { setMode } from "../../lib/agentActions";
import { AgentPanel } from "./AgentPanel";
import { PanelSurfaceContext, type PanelSurface } from "./panelSurface";
import { useStartCreate } from "./startCreate";
import {
  ALLOW_DISABLED_REASON,
  CREATE_FOOTNOTE,
  PLAN_EDIT_DISABLED_REASON,
  START_SEEDS,
  answerStartInput,
  approveCreatePlan,
  sendStartMessage,
  startBlankInstead,
  startModeLine,
  stopStartWork,
} from "./startConversation";
import "./agent.css";

/** The start page's panel (row P1-A9; agent-panel README §11, board 05) —
 *  **step 10 of the package's build order**, which A5 deliberately left until
 *  P0-10's create flow existed to drive.
 *
 *  It is the SAME column: `AgentPanel` renders it, with the same tabs,
 *  transcript, cards, composer, rail and Stop. What this component adds is the
 *  short list of things that differ with no project open (a `PanelSurface`):
 *
 *  - **Allow is disabled with its reason** in the header strip — *No project
 *    open — Allow mode is off. Grants are per project.* Ask and Plan only
 *    (doctrine 4: disabled-with-a-reason, never hidden), and a conversation
 *    that arrives in Allow mode (carried from an editor session's preference)
 *    is moved to Ask rather than left on a mode that cannot work.
 *  - **First-run seeding adapted to "no project open"**: the seeds cannot be
 *    drawn from a project, so they are the three shapes of thing this page can
 *    do.
 *  - **Create is a conversation, not a modal**: at most two clarifying
 *    questions, then a numbered plan whose button reads `Create · up to $X`
 *    beside `Edit steps` / `Start blank instead`, with the folder-before-spend
 *    footnote. `NewProjectModal` remains the button route; both feed
 *    `CreateProgress`. `Edit steps` is DISABLED with its reason — the edit
 *    decision is a POST the service re-plans from, and there is no service
 *    with no project open (doctrine 4: never a button that traps the card).
 *  - **Stop stops the create**: the header's ⏹, the running plan card's ⏹ and
 *    Esc all take `surface.onStop`, which cancels the same JobQueue job the
 *    run card's own ⏹ cancels. `stopConversation` would have reported a stop
 *    the create never heard (A4.5's cancel contract, doctrine 5).
 *
 *  The run card hangs below the transcript rather than inside it, because the
 *  create outlives the turn that proposed it — the same reason `CreateProgress`
 *  lives outside the wizard's form.
 */
export function StartAgentPanel() {
  const conversations = useStore((s) => s.agent.conversations);
  const activeId = useStore((s) => s.agent.activeId);
  const collapsed = useStore((s) => s.agentUi.collapsed);
  const create = useStartCreate();

  // The tab itself is `AgentPanel`'s (it already guarantees one, in Ask mode
  // by default) — a second guard here raced it and opened two.
  //
  // Allow cannot apply here, so a conversation carrying it is moved to Ask.
  // (The button is disabled either way; this stops the mode LINE from
  // promising standing grants that no project could hold.)
  useEffect(() => {
    for (const c of Object.values(conversations)) {
      if (c.mode === "allow") setMode(c.id, "ask");
    }
  }, [conversations]);

  const surface = useMemo<PanelSurface>(
    () => ({
      surface: "start",
      allowDisabledReason: ALLOW_DISABLED_REASON,
      seeds: START_SEEDS,
      firstRunTitle: "Describe a game and I'll build the project.",
      firstRunLead:
        "I read everything once a project is open, and I ask before I change or spend anything. " +
        "A folder is written to disk before anything is spent.",
      composerPlaceholder: "Describe a game, or ask about a world you have…",
      composerModeLine: startModeLine,
      onSend: (id, text) => void sendStartMessage(id, text),
      onAnswerInput: (id, itemId, answer) => void answerStartInput(id, itemId, answer),
      planApproveLabel: (totalCents) =>
        totalCents > 0 ? `Create · up to $${(totalCents / 100).toFixed(2)}` : "Create · $0",
      planDiscardLabel: "Start blank instead",
      planFootnote: CREATE_FOOTNOTE,
      onApprovePlan: (id, planId) => void approveCreatePlan(id, planId),
      onDiscardPlan: (id, planId) => startBlankInstead(id, planId),
      planEditDisabledReason: PLAN_EDIT_DISABLED_REASON,
      onStop: (id) => void stopStartWork(id),
    }),
    [],
  );

  return (
    <PanelSurfaceContext.Provider value={surface}>
      <div
        className="start-agent"
        data-testid="start-agent"
        data-creating={create.status === "creating" ? "1" : "0"}
        data-collapsed={collapsed ? "1" : "0"}
        data-active={activeId ?? ""}
      >
        <AgentPanel allowDisabledReason={ALLOW_DISABLED_REASON} />
      </div>
    </PanelSurfaceContext.Provider>
  );
}
