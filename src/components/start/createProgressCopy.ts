// The create-progress copy helpers, beside `CreateProgress.tsx` so that file
// exports only its component.
//
// Row P0-10 (master §3.0-E, S5): the 22 hardcoded `plat:*` ids that used to
// live here are TEMPLATE DATA now — canon's `pack templates` / the stamped
// registry carry a phase-id → label map per template, and `phaseLabel` in
// `src/lib/packTemplates.ts` is the one reader every progress surface
// (CreateProgress, the JobTray, the agent's run cards) shares. A dungeon gets
// its labels the same way; there is no second list to grow.

export { phaseLabel } from "../../lib/packTemplates";

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
