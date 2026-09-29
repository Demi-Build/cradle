/** The assets a generation run did NOT land — which, why, and what to do.
 *
 *  Reads canon's `generation_stats.json`: the per-family counters it has
 *  always carried (`images_succeeded`, `music_succeeded`, `sfx_succeeded`)
 *  plus the `failures` list its asset executor now records — one record per
 *  asset that stayed missing after its retries, each with the provider's own
 *  reason, the HTTP status when there was one, the attempt count and a
 *  `hint` canon computed from the classification (a wrong key reads
 *  differently from a rate-limit burst). Every kind, provider and hint is a
 *  plain string off the record; nothing here knows the families or providers
 *  by name.
 *
 *  Exists because the first paid dungeon run lost 26 of 73 assets, reported
 *  `ok`, opened, and the owner found out by reading the JSON. A run with
 *  failures still opens (nothing is blocked); it must not LOOK clean. The
 *  repair is named by each record's own `hint` — canon composes it from the
 *  pack's verbs (`asset generate --target missing` for the dungeon, the
 *  platformer's `enemy:<id>` / `audio:<stage>` forms for it), so nothing
 *  here hardcodes a command a pack might refuse. */

import type { AssetFailure } from "./assetFailureSummary";

export function AssetFailureList({
  failures,
  compact = false,
}: {
  failures: AssetFailure[] | undefined;
  /** Inside a progress card: no heading, tighter rows. */
  compact?: boolean;
}) {
  if (!failures || failures.length === 0) return null;
  const rows = [...failures].sort((a, b) =>
    `${a.kind ?? ""}:${a.target ?? ""}`.localeCompare(`${b.kind ?? ""}:${b.target ?? ""}`),
  );
  return (
    <div className={`asset-failures${compact ? " compact" : ""}`} data-testid="asset-failures">
      {!compact && (
        <p className="asset-failures-intro">
          {failures.length} asset{failures.length === 1 ? "" : "s"} did not land. Nothing else
          was held back — each row names the command that brings it back.
        </p>
      )}
      <ul className="asset-failure-rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((f, i) => {
          const where = [f.provider, f.status != null ? String(f.status) : null]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={`${f.target ?? "?"}-${i}`}
              className="asset-failure-row"
              data-testid="asset-failure-row"
              style={{ padding: "6px 0", borderTop: i ? "1px solid var(--border)" : undefined }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <code className="asset-failure-target">{f.target ?? f.path ?? "(unnamed asset)"}</code>
                {f.kind && <span className="chip chip-muted">{f.kind}</span>}
                {where && <span className="chip chip-muted">{where}</span>}
                {typeof f.attempts === "number" && (
                  <span className="meta-k">
                    {f.attempts} attempt{f.attempts === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {f.message && (
                <div className="asset-failure-message" style={{ fontSize: 12 }}>
                  {f.message}
                </div>
              )}
              {f.hint && (
                <div className="asset-failure-hint meta-k" style={{ marginTop: 2 }}>
                  {f.hint}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
