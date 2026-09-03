import { useMemo } from "react";
import { seedPrompts, sendMessage } from "../../lib/agentActions";
import { useStore } from "../../store";
import { agentLabel } from "./agentLabel";
import { usePanelSurface } from "./panelSurface";

/** First run (README §2): three seeded prompts drawn from the project and
 *  the one sentence of law that earns the column.
 *
 *  Row A9 adapts it to "no project open" (README §11): the start page has no
 *  project to draw seeds from, so the surface supplies them — and a seed
 *  clicked there starts the create conversation through the surface's own
 *  send, not the sidecar's. Both halves fall back to the editor's behaviour
 *  when no surface is provided. */
export function FirstRun({ conversationId }: { conversationId: string }) {
  const surface = usePanelSurface();
  const title = useStore((s) => s.worldStoryTitle ?? s.world?.name);
  const entities = useStore((s) => s.entities);
  const projectSeeds = useMemo(() => seedPrompts(), [entities]); // eslint-disable-line react-hooks/exhaustive-deps
  const seeds = surface.seeds ?? projectSeeds;
  const name = agentLabel(title);
  const pretty = name.charAt(0) + name.slice(1).toLowerCase();
  const send = (text: string) => {
    if (surface.onSend) surface.onSend(conversationId, text);
    else void sendMessage(conversationId, text);
  };
  return (
    <div className="ag-firstrun" data-testid="first-run">
      <h3>{surface.firstRunTitle ?? `${pretty} can work on this world with you.`}</h3>
      <p>
        {surface.firstRunLead ??
          "It reads everything in the project, and asks before it changes or spends anything."}
      </p>
      <div className="seeds">
        {seeds.map((s) => (
          <button key={s} onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
