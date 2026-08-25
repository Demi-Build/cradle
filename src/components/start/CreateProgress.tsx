import { useEffect, useState } from "react";
import type { JobProgress } from "../../lib/invoke";

/** The live display for a generation run: what canon is doing right now, what
 *  it already finished, and how long it has been at it.
 *
 *  Exists because a paid `world new` is minutes of silence otherwise — the
 *  question a user actually has is not "how far along is it" but "is this
 *  still alive", so the loudest things here are the CURRENT phase, its
 *  sub-item, and a clock that keeps moving. The bar is secondary.
 *
 *  Reads the folded step log (`Job.progress`), so it renders whatever canon
 *  reported; a phase this build has no name for shows its raw node id rather
 *  than being hidden. */
export function CreateProgress({
  progress,
  startedAt,
  paid,
  error,
}: {
  progress?: JobProgress;
  startedAt: number;
  paid: boolean;
  error?: string | null;
}) {
  const elapsed = useElapsed(startedAt, !error && !progress?.endedAt);
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
  // schemas). Say that, rather than showing a 0% bar that looks stuck.
  const waiting = phases.length === 0 && !error;

  return (
    <div className="cp">
      <div className="cp-head">
        <span className="cp-now">
          {failed || error ? (
            // Where it died is the useful half — the modal heading already
            // says THAT it died, so repeating that here wastes the line.
            <span className="cp-fail">
              {failed
                ? `Stopped in ${phaseLabel(failed.node)}`
                : headline
                  ? `Stopped after ${phaseLabel(headline.node)}`
                  : "Stopped before the first step"}
            </span>
          ) : waiting ? (
            "Starting canon…"
          ) : progress?.endedAt ? (
            "Finishing up…"
          ) : headline ? (
            phaseLabel(headline.node)
          ) : (
            "Working…"
          )}
        </span>
        <span className="cp-clock" aria-label="elapsed">
          {fmtElapsed(elapsed)}
        </span>
      </div>

      {/* The sub-phase line: the one thing that keeps moving during the long
          art/animation phases, where a whole phase can take many minutes. */}
      <div className="cp-item">
        {current?.item && !dead ? (
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
            {!dead && <span className="cp-spin" aria-hidden="true" />}
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
          className={`cp-bar-fill${dead ? " err" : ""}${total > 0 || dead ? "" : " idle"}`}
          style={total > 0 ? { width: `${pct}%` } : dead ? { width: "100%" } : undefined}
        />
      </div>
      <div className="cp-meta">
        <span>
          {total > 0
            ? `${done} of ${total} steps`
            : dead
              ? "no steps completed"
              : "counting steps…"}
        </span>
        {paid && !dead && <span className="cp-paid">paid backends — don't close cradle</span>}
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
              <span className="cp-row-name">{phaseLabel(p.node)}</span>
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
    </div>
  );
}

/** Human name for a canon pipeline node. Cradle-side on purpose: canon's node
 *  ids are its own contract, and an id this build hasn't seen still renders
 *  (de-prefixed and de-underscored) instead of vanishing. */
export function phaseLabel(node: string): string {
  const id = node.replace(/^phase:/, "");
  const known: Record<string, string> = {
    "plat:world": "World premise",
    "plat:stage": "Stages",
    "plat:style": "Art direction",
    "plat:enemies": "Enemy roster",
    "plat:items": "Item pool",
    "plat:tileset": "Tile slots",
    "plat:layout": "Level layouts",
    "plat:terrain": "Terrain",
    "plat:background": "Backgrounds",
    "plat:placement": "Placing enemies",
    "plat:item_placement": "Placing items",
    "plat:decorator": "Decoration",
    "plat:tileset_art": "Tileset art",
    "plat:sprite_art": "Sprite art",
    "plat:sprite_animation": "Animation",
    "plat:backdrop_art": "Backdrops",
    "plat:world_art": "Title art",
    "plat:audio": "Music & SFX",
    "plat:render": "Review renders",
    "plat:vlm_qa": "Quality pass",
    "plat:manifest": "Manifest",
    "plat:level_steps": "Level steps",
  };
  if (known[id]) return known[id];
  const bare = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return bare.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
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

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
