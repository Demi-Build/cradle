// The agent's display name — one module, so the transcript label, the
// first-run copy and the status bar's segment all say the same thing.
//
// Extracted from `Transcript.tsx` so that file exports only components
// (react-refresh). The identity itself is `lib/actor.ts`'s job — this is the
// human-facing name, not the actor string.
//
// It used to be DERIVED: the last word of the project's story title, so "The
// Silent Gospel" made the agent "GOSPEL". The name is the agent's, not the
// project's, and a derived name cannot be renamed — so it is a constant here
// with an optional override in pack data.

import type { PackInfo } from "../../lib/invoke";
import { useStore } from "../../store";

/** THE agent's name. This is cradle's one definition — renaming the agent is
 *  editing this line.
 *
 *  SECOND PLACE, unavoidably: canon's `src/canon/agent/roster/core.md`, the
 *  prompt that teaches the MODEL its own name. It lives in the other repo and
 *  is read by the sidecar process, so cradle cannot share a literal with it;
 *  canon's own copy is single (`core.md` is the only place canon spells it —
 *  `canon.agent.evals` reads the name back out of that prompt). Change both
 *  lines, or the UI and the model will introduce themselves differently. */
export const DEFAULT_AGENT_NAME = "Wright";

/** How wide a name the mono label will render. A pack-declared name is pack
 *  DATA, so it is bounded here rather than trusted to be short. */
const LABEL_MAX = 24;

/** The name a pack declares for its agent, or null when it declares none.
 *
 *  The source is the `pack info` document `load_world` already loads once per
 *  world and keeps on `world.pack_info` — an OPEN document (canon may add keys
 *  without a cradle change), which is why this reads the key defensively
 *  instead of the type promising it. Nothing in cradle enumerates backends,
 *  kinds or names; if a pack names its agent, that name wins. */
export function packAgentName(packInfo?: PackInfo | null): string | null {
  const declared = packInfo?.agent_name;
  if (typeof declared !== "string") return null;
  const trimmed = declared.trim();
  return trimmed ? trimmed : null;
}

/** The agent's name for the open project: what the pack declares, else
 *  {@link DEFAULT_AGENT_NAME}. */
export function agentName(packInfo?: PackInfo | null): string {
  return packAgentName(packInfo) ?? DEFAULT_AGENT_NAME;
}

/** The agent's mono label — the name in caps.
 *
 *  Pack data is data (never markup, never a newline in the status bar): the
 *  name is stripped to letters and digits and capped, and a name that survives
 *  none of that falls back to the constant. */
export function agentMonoLabel(packInfo?: PackInfo | null): string {
  const cleaned = agentName(packInfo)
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toUpperCase()
    .slice(0, LABEL_MAX);
  return cleaned || DEFAULT_AGENT_NAME.toUpperCase();
}

/** The agent's mono label for the open project.
 *
 *  The parameter is the project title the older call sites still pass. It is
 *  deliberately IGNORED: the name is no longer derived from the project. It
 *  stays in the signature so that renaming the agent did not have to edit
 *  `Transcript.tsx` and `FirstRun.tsx`; drop it when those two are next
 *  touched, and they should call {@link agentMonoLabel} directly.
 *
 *  Reads the open pack through `getState` rather than a subscription: the
 *  declared name cannot change while a project is open (it arrives with the
 *  `pack_info` of the load), and both call sites already re-render on the
 *  world they pass. A surface that wants it reactive selects `pack_info` and
 *  calls {@link agentMonoLabel} — `ValidationBar` does. */
export function agentLabel(_projectTitle?: string | null): string {
  return agentMonoLabel(useStore.getState().world?.pack_info);
}
