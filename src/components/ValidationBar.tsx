import { countProblems } from "../lib/validation";
import { kbd } from "../lib/keys";
import { specialistLabel } from "../lib/agentState";
import { agentMonoLabel } from "./agent/agentLabel";
import { agentActor } from "../lib/actor";
import { isRemoteConversation } from "../lib/agentActions";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";

/** The actor for a conversation, or null when it cannot honestly be spelled.
 *
 *  Two ways it comes back null. The service may not know the conversation yet
 *  — a tab that has never sent still carries the placeholder id it was minted
 *  with, and an actor built from THAT matches no journal row, no ledger entry
 *  and nothing the job tray filters on. And `agentActor` throws on an id it
 *  refuses to spell; the status bar must not go down for that. */
function realActor(conversation: string, specialist: string): string | null {
  if (!isRemoteConversation(conversation)) return null;
  try {
    return agentActor(conversation, specialist);
  } catch {
    return null;
  }
}

export function ValidationBar() {
  const { world, selection, levelValidation } = useStore();
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const agentStatus = useStore(
    useShallow((s) => {
      // The status bar's agent segment (README §2; PLAN "ValidationBar"): the
      // ACTIVE conversation's specialist, and `+N` when others are running.
      // Shallow-compared: the selector builds an object, and zustand v5
      // re-renders on every new reference otherwise.
      const active = s.agent.activeId ? s.agent.conversations[s.agent.activeId] : null;
      const running = Object.values(s.agent.conversations).filter(
        (c) => c.status === "streaming" || c.status === "awaiting_approval",
      );
      const others = running.filter((c) => c.id !== active?.id).length;
      if (!active) return null;
      const busy = active.status === "streaming" || active.status === "awaiting_approval";
      return {
        title: active.title,
        // The agent's NAME (`agent/agentLabel` — one definition, pack data or
        // the constant). It is a label, not an identity: the segment used to
        // render it as `agent:<name>`, which claimed to be the actor the job
        // tray and History match on and was not one — actors are
        // `agent:<conversation>/<specialist>`.
        agent: agentMonoLabel(s.world?.pack_info),
        // The real thing, from lib/actor.ts — the ONE constructor, never a
        // string spelled here. It is present only when the segment's text is
        // ABOUT the running conversation and the service knows that
        // conversation, and absent otherwise: with `busy` false the segment
        // reads "<name> idle +N", where the active conversation is not the one
        // running and may never have been sent at all. An actor is shown only
        // when hovering it tells the truth; there is no placeholder string.
        actor: busy ? realActor(active.id, active.specialist) : null,
        specialist: active.specialist,
        busy,
        others,
        status: active.status,
      };
    }),
  );
  // The dialogue surface's mode and unsaved count (row P0-9). Read straight
  // from the slice rather than passed down: the statusbar is a sibling of the
  // DetailPane, not an ancestor.
  const dialogueMode = useStore((s) => s.dialogue.mode);
  // The SCOPE slot (step 11/12): npc | quest | scene. Rendered beside MODE
  // because a quest-scope save touches several characters and a scene edit fans
  // out across surfaces — knowing which scope you are in is load-bearing.
  const dialogueScope = useStore((s) => s.dialogue.scope);
  const dialogueDirty = useStore((s) => {
    const key = s.dialogue.activeKey;
    if (!key) return 0;
    return s.dialogue.buffers[key]?.cursor ?? 0;
  });
  const current =
    selection.kind === "entity" && selection.typeId === "levels"
      ? levelValidation[selection.id]
      : undefined;
  const problemCount = current ? countProblems(current) : 0;
  return (
    <footer className="validation">
      {world ? (
        <>
          {agentStatus && (agentStatus.busy || agentStatus.others > 0) && (
            <span
              className="val-item"
              data-testid="status-agent"
              data-actor={agentStatus.actor ?? undefined}
              title={agentStatus.actor ?? undefined}
              style={{ color: agentStatus.busy ? "var(--accent)" : "var(--fg-muted)" }}
            >
              ●{" "}
              {agentStatus.busy
                ? `${agentStatus.agent} — ${specialistLabel(agentStatus.specialist).toLowerCase()} ${agentStatus.status === "awaiting_approval" ? "waiting" : "running"}`
                : `${agentStatus.agent} idle`}
              {agentStatus.others > 0 ? ` +${agentStatus.others}` : ""}
            </span>
          )}
          {dialogueMode !== "view" && (
            // Indicator #4 of the four the dialogue design states mode with
            // (README Q2). Same `data-mode` the segmented control, the canvas
            // border and the mode pill read, so they cannot disagree.
            <span
              className="val-item dlg-status-mode"
              data-mode={dialogueMode}
              data-testid="status-mode"
            >
              MODE {dialogueMode.toUpperCase()}
            </span>
          )}
          {dialogueMode !== "view" && dialogueScope !== "npc" && (
            <span className="val-item dlg-status-scope" data-testid="status-scope">
              SCOPE {dialogueScope.toUpperCase()}
            </span>
          )}
          {dialogueDirty > 0 && (
            <span className="val-item dlg-status-unsaved" data-testid="status-dialogue-unsaved">
              {dialogueDirty} unsaved
            </span>
          )}
          <span className="val-item val-pending">Checker: —</span>
          {current ? (
            <span className="val-item" style={{ color: current.ok ? "var(--ok)" : "var(--err)" }}>
              Validator: {current.level_id}{" "}
              {current.ok
                ? "✓ playable"
                : `✗ ${problemCount} problem${problemCount === 1 ? "" : "s"}`}
            </span>
          ) : (
            <span className="val-item val-pending">Validator: —</span>
          )}
          <span className="val-item val-pending">World Editor: —</span>
          <span className="val-hint">
            {current
              ? "(canon level validate — reachability simulated under the level's own physics)"
              : "(validation trail wiring lands when canon emits it)"}
          </span>
          {/* Right-aligned palette hint — the design puts it here, and it's
              the only place the shortcut is discoverable without knowing it. */}
          <button
            className="val-palette"
            onClick={() => setPaletteOpen(true)}
            title="Open the command palette"
          >
            <span className="kbd">{kbd("K")}</span>
          </button>
        </>
      ) : (
        <span className="val-hint">No world loaded.</span>
      )}
    </footer>
  );
}
