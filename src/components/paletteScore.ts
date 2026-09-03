// The command palette's matcher, in its own module so two palettes can share
// ONE ranking: `⌘K` over commands and the dialogue editor's `⌘P` over trees and
// scenes (row P0-9). Splitting it out of `CommandPalette.tsx` also keeps that
// file exporting components only, which is what react-refresh needs.

import type { Command } from "../store";

/** Subsequence match — "gl" finds "Generate level". Returns null when the
 *  query doesn't match at all, else a score where LOWER is better. */
function scoreOne(haystack: string, query: string): number | null {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  const direct = h.indexOf(q);
  if (direct >= 0) return direct; // contiguous: best, ranked by position
  let i = 0;
  let first = -1;
  let last = 0;
  for (const ch of q) {
    const at = h.indexOf(ch, i);
    if (at < 0) return null;
    if (first < 0) first = at;
    last = at;
    i = at + 1;
  }
  // Scattered: rank after every contiguous hit. `first` is weighted above the
  // span so an early match wins — without it "vll" scored "Save this level"
  // and "Validate this level" IDENTICALLY and stable sort decided by
  // registration order, which put Save on top.
  return 1000 + first * 4 + (last - first);
}

/** Score a command: a hit in the LABEL always outranks one that only lands in
 *  the group or keywords, so typing a visible word never surfaces something
 *  that merely shares a group name.
 *
 *  Exported as `scoreCommand` for the dialogue `⌘P` switcher (row P0-9), which
 *  ranks trees and scenes rather than commands but must rank them the SAME WAY
 *  — two palettes, one ranking, so "nv" finds "night vigil" here exactly as it
 *  finds "New level" there. */
export function scoreCommand(
  cmd: Pick<Command, "label" | "group" | "keywords">,
  query: string,
): number | null {
  if (!query) return 0;
  const inLabel = scoreOne(cmd.label, query);
  if (inLabel !== null) return inLabel;
  const rest = scoreOne(`${cmd.label} ${cmd.group} ${cmd.keywords ?? ""}`, query);
  return rest === null ? null : rest + 10_000;
}
