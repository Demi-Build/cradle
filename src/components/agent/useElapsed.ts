import { useEffect, useState } from "react";

/** A ticking elapsed clock in ms (row P1-A5): the paid card's running
 *  state, a run card, the plan's header, "Service starting…". One second
 *  granularity; `live = false` freezes it at the last tick. Beside
 *  `ToolCall/PaidCard.tsx`, which used to export it, so component files
 *  export only components. */
export function useElapsed(from: number, live = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, now - from);
}
