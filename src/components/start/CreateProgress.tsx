import { fmtElapsed } from "./createProgressCopy";
import { useEffect, useState } from "react";
import { api, type JobProgress } from "../../lib/invoke";
import { phaseLabel, type PackTemplate } from "../../lib/packTemplates";
import { AssetFailureList } from "../AssetFailureList";
import { assetSummaryLine, type AssetStats } from "../assetFailureSummary";

/** The live display for a generation run: what canon is doing right now, what
 *  it already finished, and how long it has been at it.
 *
 *  Exists because a paid `world new` is minutes of silence otherwise — the
 *  question a user actually has is not "how far along is it" but "is this
 *  still alive", so the loudest things here are the CURRENT phase, its
 *  sub-item, and a clock that keeps moving. The bar is secondary.
 *
 *  Reads the folded step log (`Job.progress`), so it renders whatever canon
 *  reported; a phase no installed template names still renders (de-prefixed
 *  and humanized) rather than being hidden.
 *
 *  Row P0-10: the phase NAMES come from `templates` — canon's per-template
 *  phase-id → label map (master §3.0-E) — so a dungeon run reads as "NPCs" /
 *  "Room layouts" through the same component, with no `plat:*` list in this
 *  build at all. */
export function CreateProgress({
  progress,
  startedAt,
  paid,
  error,
  ended = false,
  templates = [],
  onStop,
  packDir,
}: {
  progress?: JobProgress;
  startedAt: number;
  paid: boolean;
  error?: string | null;
  /** The run is OVER, as the thing that owns the run knows it — not as the
   *  step log happens to have reported it. `run_end` is the usual signal, but
   *  a run can end without one reaching this component (a create whose card
   *  was unmounted while the last events arrived), and a clock still ticking
   *  under a finished run is a display that lies. Defaults to false, so a
   *  caller with no such fact behaves exactly as it did before. */
  ended?: boolean;
  /** The templates whose label maps this run may be named by — normally just
   *  the one being created. Empty = every phase renders its humanized id. */
  templates?: PackTemplate[];
  /** ⏹ Stop (row P1-A5, README §10): the same one contract as the job tray
   *  — start nothing new, keep what landed, say what it cost. Absent = no
   *  button (a run that is already over). */
  onStop?: () => void;
  /** The folder the run wrote. Once the run is over, its
   *  `generation_stats.json` is read from here for the post-create asset
   *  summary — `50 images · 43 landed · 7 failed — see list` — so a run
   *  that lost assets never reads as a clean "Finished". Absent = no line. */
  packDir?: string;
}) {
  // Over, however it got there: the step log's own `run_end`, or the caller
  // telling us the run is finished. Everything that must not outlive the run
  // — the clock, the spinners, ⏹ Stop, "don't close cradle" — reads this.
  const over = ended || !!progress?.endedAt;
  const elapsed = useElapsed(startedAt, !error && !over);
  const assets = useAssetStats(packDir, over && !error);
  const phases = progress?.phases ?? [];
  const done = phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const total = progress?.total ?? 0;
  const current = phases.find((p) => p.status === "running");
  const failed = phases.find((p) => p.status === "failed");
  // Between two phases there is briefly nothing running. Naming the last one
  // finished beats falling back to "Working…", which throws away the only
  // information on screen at exactly the moment a reader looks for it.
  const headline = current ?? phases[phases.length - 1];
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const dead = !!error || !!failed;

  // Before the first event: canon is starting up (importing the pack, reading
  // schemas). Say that, rather than showing a 0% bar that looks stuck. A run
  // that is already OVER is never "starting" — reported no steps is a
  // different fact from about to report some, and saying the second one for a
  // finished run is the lie this guard removes.
  const waiting = phases.length === 0 && !error && !over;

  return (
    <div className="cp">
      <div className="cp-head">
        <span className="cp-now">
          {failed || error ? (
            // Where it died is the useful half — the modal heading already
            // says THAT it died, so repeating that here wastes the line.
            <span className="cp-fail">
              {failed
                ? `Stopped in ${phaseLabel(failed.node, templates)}`
                : headline
                  ? `Stopped after ${phaseLabel(headline.node, templates)}`
                  : "Stopped before the first step"}
            </span>
          ) : ended ? (
            // The owner of the run says it is finished. That outranks the step
            // log, which may have stopped reaching us before its last event.
            "Finished"
          ) : waiting ? (
            "Starting canon…"
          ) : progress?.endedAt ? (
            "Finishing up…"
          ) : headline ? (
            phaseLabel(headline.node, templates)
          ) : (
            "Working…"
          )}
        </span>
        <span className="cp-clock" aria-label="elapsed">
          {fmtElapsed(elapsed)}
        </span>
        {onStop && !dead && !over && (
          <button
            className="ag-stop sm"
            onClick={onStop}
            title="Stop — finishes nothing new, keeps what landed, says what it cost"
            aria-label="Stop this run"
            style={{ marginLeft: 8 }}
          >
            ⏹ Stop
          </button>
        )}
      </div>

      {/* The sub-phase line: the one thing that keeps moving during the long
          art/animation phases, where a whole phase can take many minutes. */}
      <div className="cp-item">
        {current?.item && !dead && !over ? (
          <>
            <span className="cp-spin" aria-hidden="true" />
            <span className="cp-item-name">{current.item}</span>
            {current.index != null && (
              <span className="cp-item-count">
                {current.index}
                {current.itemTotal ? ` / ${current.itemTotal}` : ""}
              </span>
            )}
          </>
        ) : (
          <span className="cp-item-idle">
            {/* The spinner is the "still alive" signal. A finished run has
                nothing to be alive for, so it loses the spinner exactly as a
                dead one does. */}
            {!dead && !over && <span className="cp-spin" aria-hidden="true" />}
            <span className="cp-item-name dim">
              {dead ? "stopped" : waiting ? "no output yet" : " "}
            </span>
          </span>
        )}
      </div>

      <div
        className="cp-bar"
        role="progressbar"
        aria-valuenow={total > 0 ? done : undefined}
        aria-valuemin={0}
        aria-valuemax={total || undefined}
      >
        <div
          className={`cp-bar-fill${dead ? " err" : ""}${total > 0 || dead || over ? "" : " idle"}`}
          style={total > 0 ? { width: `${pct}%` } : dead || over ? { width: "100%" } : undefined}
        />
      </div>
      <div className="cp-meta">
        <span>
          {total > 0
            ? `${done} of ${total} steps`
            : dead
              ? "no steps completed"
              : over
                ? // Over, with no step total ever announced. "counting steps…"
                  // would promise a number that is never coming.
                  "no step counts were reported"
                : "counting steps…"}
        </span>
        {/* The warning is about a run in flight; a finished one may be closed. */}
        {paid && !dead && !over && (
          <span className="cp-paid">paid backends — don't close cradle</span>
        )}
      </div>

      {/* The finished phases, newest first: proof of what actually happened,
          and the only place a skip or a failure is legible after the fact. */}
      {phases.length > 0 && (
        <ol className="cp-list">
          {[...phases].reverse().map((p) => (
            <li key={p.node} className={`cp-row ${p.status}`}>
              <span className="cp-mark" aria-hidden="true">
                {p.status === "done"
                  ? "✓"
                  : p.status === "failed"
                    ? "✕"
                    : p.status === "skipped"
                      ? "–"
                      : "•"}
              </span>
              <span className="cp-row-name">{phaseLabel(p.node, templates)}</span>
              {p.status === "skipped" && <span className="cp-row-note">unchanged</span>}
              {p.status === "running" && p.itemTotal != null && (
                <span className="cp-row-note">
                  {p.index} / {p.itemTotal}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {error && <div className="cp-err">{error}</div>}
      <AssetSummary stats={assets} />
    </div>
  );
}

/** The post-create asset line. Failures are acceptable; silence is not: a
 *  finished run with assets that did not land says so here, in the same
 *  card that says "Finished", with the list one click away. A run that
 *  lost nothing gets the tally too — `50 images · all landed` — so the line
 *  is a fact about every run, not a badge of shame on some. */
function AssetSummary({ stats }: { stats: AssetStats | null }) {
  const line = assetSummaryLine(stats);
  if (!line) return null;
  const failures = stats?.failures ?? [];
  if (failures.length === 0) {
    return (
      <div className="cp-assets cp-meta" data-testid="cp-asset-summary">
        <span>{line}</span>
      </div>
    );
  }
  return (
    <details className="cp-assets cp-assets-failed" data-testid="cp-asset-summary">
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--err)", marginTop: 6 }}>
        {line}
      </summary>
      <AssetFailureList failures={failures} compact />
    </details>
  );
}

/** Read the run's `generation_stats.json` once it is over. Never throws: a
 *  missing or unreadable file means no line, not a broken card. */
function useAssetStats(packDir: string | undefined, ready: boolean): AssetStats | null {
  const [stats, setStats] = useState<AssetStats | null>(null);
  useEffect(() => {
    if (!packDir || !ready) return;
    let live = true;
    api
      .readWorldJson(packDir, "generation_stats")
      .then((s) => {
        if (live) setStats((s ?? null) as AssetStats | null);
      })
      .catch(() => {
        if (live) setStats(null);
      });
    return () => {
      live = false;
    };
  }, [packDir, ready]);
  return stats;
}

/** Wall-clock since `from`, ticking while `live`. The clock is the honest
 *  liveness signal when a single phase owns several minutes. */
function useElapsed(from: number, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, (live ? now : Math.max(now, from)) - from);
}
