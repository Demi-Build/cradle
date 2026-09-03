import type { Conversation } from "../../lib/agentState";
import { fmtCents, inFlight } from "../../lib/agentState";
import { setMode, stopConversation } from "../../lib/agentActions";
import { useStore } from "../../store";
import { ModelPicker } from "./ModelPicker";
import { usePanelSurface } from "./panelSurface";

/** The header (README §9): `Ask · Plan · Allow` segmented control, the model
 *  picker, the running session cost, `⏹ Stop` while anything is in flight.
 *  No agent picker. The start page's disabled Allow (README §11) is row
 *  A9's; the `allowDisabledReason` prop is the seam it uses. */
const MODES = ["ask", "plan", "allow"] as const;

export function PanelHeader({
  conversation,
  allowDisabledReason,
}: {
  conversation: Conversation;
  allowDisabledReason?: string;
}) {
  const stopping = useStore((s) => s.agent.stopping);
  // Row A9: whose Stop this is depends on WHOSE work is in flight. On the
  // start page the approved plan is a JobQueue create the sidecar never held,
  // so `stopConversation` there would write "stopped by you" over a run that
  // kept going — the surface supplies the stop that actually stops it.
  const surface = usePanelSurface();
  const busy = inFlight(conversation);
  const cost = conversation.costCents;
  const tokens = conversation.usage.input_tokens + conversation.usage.output_tokens;
  return (
    <>
      <div className="ag-head" data-testid="panel-header">
        <div className="ag-seg" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={conversation.mode === m}
              data-on={conversation.mode === m ? "1" : "0"}
              disabled={m === "allow" && !!allowDisabledReason}
              title={m === "allow" && allowDisabledReason ? allowDisabledReason : modeTitle(m)}
              onClick={() => setMode(conversation.id, m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <ModelPicker conversation={conversation} />
        <span
          className="ag-cost"
          title={
            cost == null
              ? `${tokens} tokens (no rate known for this model)`
              : `${tokens} tokens · priced at the picker's rate; the ledger is the measured truth`
          }
        >
          {cost == null ? (tokens ? `${tokens} tok` : "$0") : fmtCents(cost)}
        </span>
        {busy && (
          <button
            className="ag-stop"
            onClick={() =>
              surface.onStop
                ? surface.onStop(conversation.id)
                : void stopConversation(conversation.id)
            }
            disabled={stopping === conversation.id}
            title="Stop the reply and every run beneath it (Esc from the composer)"
          >
            ⏹ Stop
          </button>
        )}
      </div>
      {allowDisabledReason && <div className="ag-head-strip">{allowDisabledReason}</div>}
    </>
  );
}

function modeTitle(m: string): string {
  return (
    {
      ask: "Reads freely. Every write and spend asks. No standing grants offered.",
      plan: "Answers with a numbered plan first. One approval runs the batch.",
      allow: "Honours standing grants for this project. Paid still always asks.",
    }[m] ?? m
  );
}
