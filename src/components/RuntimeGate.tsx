import { type RuntimeStatus } from "../lib/invoke";

/**
 * Row P0-11 / W3.6 — the STARTUP PROBE and its guided failure screen.
 *
 * Before this row, a cradle that could not find canon said nothing at launch
 * and then died at the first verb with a raw "No such file or directory" that
 * named neither what was tried nor what to do. W3.6's spec text is the whole
 * brief: *probe the resolved canon at launch; a failed probe gets a guided
 * screen (what was tried, what to do)*. It is a PATTERN build — no board
 * designs this screen — so it follows the conventions already in the app:
 * App.css tokens, `.btn` / `.btn.pri`, and doctrine 4 (a disabled control
 * always says why).
 *
 * The probe itself is `useRuntimeProbe` in `src/lib/` (beside
 * `useDraggablePanel`), so this file exports only a component.
 */

/** Human copy per resolution leg. The id is the contract; the prose lives
 *  here so the Rust side stays a data source, not a copy deck. */
const LEG_TITLE: Record<string, string> = {
  env: "1 · CANON_BIN (developer override)",
  checkout: "2 · a canon checkout beside this one (dev builds)",
  bundled: "3 · the runtime bundled with the app",
  path: "4 · canon on your PATH",
};

function legTitle(leg: string, index: number): string {
  return LEG_TITLE[leg] ?? `${index + 1} · ${leg}`;
}

export function RuntimeFailure({
  status,
  checking,
  onRetry,
}: {
  status: RuntimeStatus;
  checking: boolean;
  onRetry: () => void;
}) {
  const bundledLeg = status.legs.find((l) => l.leg === "bundled");
  const envLeg = status.legs.find((l) => l.leg === "env");
  return (
    <main className="rt-gate">
      <div className="rt-card">
        <h1 className="rt-title">Cradle can&rsquo;t start canon</h1>
        <p className="rt-lede">
          Everything cradle does — opening a project, creating a world, playing a level — runs
          through the <code>canon</code> command line. It tried three places, in order, and none of
          them answered.
        </p>

        <section className="rt-section">
          <h2 className="rt-h2">What it tried</h2>
          <ol className="rt-legs">
            {status.legs.map((leg, i) => (
              <li key={leg.leg} className={leg.found ? "rt-leg found" : "rt-leg"}>
                <span className="rt-leg-mark" aria-hidden="true">
                  {leg.found ? "✓" : "✗"}
                </span>
                <div className="rt-leg-body">
                  <div className="rt-leg-title">{legTitle(leg.leg, i)}</div>
                  {leg.tried && <code className="rt-path">{leg.tried}</code>}
                  <div className="rt-leg-note">{leg.note}</div>
                </div>
              </li>
            ))}
          </ol>
          {status.error && (
            <div className="rt-error">
              <div className="rt-h3">Then it ran the probe and got:</div>
              <code className="rt-path">{status.error}</code>
            </div>
          )}
        </section>

        <section className="rt-section">
          <h2 className="rt-h2">What to do</h2>
          <ul className="rt-todo">
            {envLeg?.tried && !envLeg.found && (
              <li>
                <b>CANON_BIN points at nothing.</b> It is set to <code>{envLeg.tried}</code> and
                that file is not there. Fix the path, or unset the variable so cradle falls through
                to the runtime it ships with.
              </li>
            )}
            {bundledLeg && !bundledLeg.found && (
              <li>
                <b>The bundled runtime is missing.</b> In an installed app that means a damaged
                download — reinstall Cradle. In a checkout, run <code>npm run fetch-runtime</code>{" "}
                and start cradle again.
              </li>
            )}
            <li>
              <b>Or use your own canon.</b>{" "}
              <code>pip install &quot;canon-ai[cli,platformer]&quot;</code> puts <code>canon</code>{" "}
              on your PATH; or set <code>CANON_BIN</code> to the <code>canon</code> inside a
              virtualenv you already have.
            </li>
          </ul>
        </section>

        <div className="rt-actions">
          <button
            className="btn pri"
            onClick={onRetry}
            disabled={checking}
            title={checking ? "the probe is running" : "run the probe again"}
          >
            {checking ? "Checking…" : "Try again"}
          </button>
          <span className="rt-hint">
            {checking
              ? "running canon --version"
              : "Fix one of the above, then try again — no restart needed."}
          </span>
        </div>

        <footer className="rt-foot">
          <span>
            resolved to <code>{status.command}</code>
          </span>
          {status.triple && <span>platform {status.triple}</span>}
          {status.resource_dir && (
            <span>
              resources <code>{status.resource_dir}</code>
            </span>
          )}
        </footer>
      </div>
    </main>
  );
}
