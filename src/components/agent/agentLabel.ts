// The agent's display name — one module, so the transcript label, the first
// -run copy and the status bar's segment all say the same thing (row P1-A5;
// README §3/§8; boards 01 and 07 draw the status bar as
// `● agent:wick — level-designer running +1`).
//
// Extracted from `Transcript.tsx` so that file exports only components
// (react-refresh). The identity itself is `lib/actor.ts`'s job — this is the
// human-facing name, not the actor string.

/** The agent's mono label (README §3 "WICK"): derived from the project's
 *  title (ASSUMPTION-14 — the default name is the title's last word). */
export function agentLabel(title: string | null | undefined): string {
  const words = (title ?? "").trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "agent";
  return last.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase() || "AGENT";
}
