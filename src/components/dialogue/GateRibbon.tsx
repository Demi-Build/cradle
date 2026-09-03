// The gate ribbon: `⊳N` plus one dot per condition, coloured by ENGINE
// EVALUABILITY (README Q3: "on the graph, 3+ conditions read as a gate ribbon,
// not text").
//
// Two questions answered at a glance — how gated is this choice, and will the
// game honour it. Green = the engine evaluates it; amber = tester-only, the
// engine ignores the gate and the choice shows unconditionally in game.
//
// The editor NEVER claims pass/fail here, because pass/fail is meaningless
// without a state; that verdict belongs to the tester dock. Ungated choices
// render nothing at all, so ungated trees look exactly as they do today.

import { Tooltip } from "../Tooltip";

export type GateDot = {
  token: string;
  /** The engine evaluates this token at this scope. */
  engineEvaluable: boolean;
  /** Why not, when it doesn't — shown in the tooltip, never hidden. */
  reason?: string | null;
};

export function GateRibbon({
  dots,
  effects = 0,
}: {
  dots: GateDot[];
  /** Effect count, rendered after the conditions as a separate mark. */
  effects?: number;
}) {
  if (dots.length === 0 && effects === 0) return null;
  const lagging = dots.filter((d) => !d.engineEvaluable);
  const title = [
    dots.map((d) => d.token).join("\n"),
    lagging.length
      ? `\nengine lag: ${lagging.length} of ${dots.length} gates are tester-only —\n${lagging
          .map((d) => d.reason ?? `the engine does not evaluate ${d.token}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Tooltip title={`${dots.length} condition${dots.length === 1 ? "" : "s"}`} desc={title}>
      <span className="dlg-ribbon" data-lag={lagging.length > 0 ? "1" : undefined}>
        {dots.length > 0 ? <span className="dlg-ribbon-badge">⊳{dots.length}</span> : null}
        {dots.map((d, i) => (
          <span
            key={`${d.token}#${i}`}
            className="dlg-ribbon-dot"
            data-engine={d.engineEvaluable ? "ok" : "lag"}
          />
        ))}
        {effects > 0 ? <span className="dlg-ribbon-effects">⚡{effects}</span> : null}
      </span>
    </Tooltip>
  );
}
