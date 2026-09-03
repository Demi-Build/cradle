import { createContext, useContext } from "react";

/** WHICH SURFACE the panel column is drawn on (row P1-A9; agent-panel README
 *  §11 "Start page").
 *
 *  The start page is *the same column*, not a second panel: the same tabs,
 *  transcript, cards, composer and Stop. What differs is a short list of
 *  facts — Allow is off because grants are per project, the first-run seeds
 *  cannot be drawn from a project that isn't open, and the plan card's button
 *  says `Create · up to $X` beside `Start blank instead` — so those facts ride
 *  a context instead of forking the components.
 *
 *  Every field is optional and every default is the EDITOR's behaviour, so a
 *  component that reads this without a provider behaves exactly as it did
 *  before this row (`AgentPanel` in the editor supplies nothing).
 */
export type PanelSurface = {
  /** `"editor"` (default) or `"start"` — for `data-surface` hooks and copy. */
  surface: "editor" | "start";
  /** Why Allow is disabled, rendered in the header strip and as the disabled
   *  button's reason (doctrine 4: disabled-with-a-reason, never hidden). */
  allowDisabledReason?: string;
  /** First run: the seeded prompts and the one sentence of law. On the start
   *  page the seeds cannot come from an open project, so they come from here. */
  seeds?: string[];
  firstRunTitle?: string;
  firstRunLead?: string;
  /** Composer: what the empty box says and what the mode line reads. The
   *  mode line is a FUNCTION of the live mode, not a fixed string: board 05
   *  reads "Plan mode · no project open", and only the second half is the
   *  surface's fact — replacing the whole line with a constant would state a
   *  mode the header's segmented control disagrees with. */
  composerPlaceholder?: string;
  composerModeLine?: (mode: string) => string;
  /** Send override — the start page has no sidecar to POST to (a conversation
   *  requires an open pack until the service's own row lifts that), so its
   *  turns are produced locally and dispatched through the SAME reducer. */
  onSend?: (conversationId: string, text: string) => void;
  /** `request_input` answers, same reason. */
  onAnswerInput?: (conversationId: string, itemId: string, answer: string) => void;
  /** Plan card: the approve button's copy and what approving does. */
  planApproveLabel?: (totalCents: number) => string;
  planDiscardLabel?: string;
  /** The footnote under the plan's buttons — the start page's promise that a
   *  folder exists before anything is spent. */
  planFootnote?: string;
  onApprovePlan?: (conversationId: string, planId: string) => void;
  onDiscardPlan?: (conversationId: string, planId: string) => void;
  /** Why `Edit steps` is disabled, when it is. The editor's edit decision is
   *  a POST the service re-plans from; a surface with no service cannot make
   *  that round trip, and doctrine 4 says the button stays and states why
   *  rather than trapping the card in `editing` (row P1-A9). */
  planEditDisabledReason?: string;
  /** Stop override — the header ⏹, the running plan card's ⏹ and Esc all
   *  route here. `stopConversation` stops a SIDECAR conversation; a surface
   *  whose work is a JobQueue run must cancel that job instead, or the button
   *  reports a stop that did not happen (A4.5's cancel contract). */
  onStop?: (conversationId: string) => void;
};

/** The editor surface: every override absent, so nothing changes. */
export const EDITOR_SURFACE: PanelSurface = { surface: "editor" };

export const PanelSurfaceContext = createContext<PanelSurface>(EDITOR_SURFACE);

export function usePanelSurface(): PanelSurface {
  return useContext(PanelSurfaceContext);
}
