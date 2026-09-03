import { useCallback, useEffect, useState } from "react";
import { api, type EnvironmentStatus, type ToolDetection } from "../../lib/invoke";
import { pickDirectory } from "../../lib/openWorld";

/** Settings → **Environment** (row P0-12; Phase 0 W3.5's second pane).
 *
 *  Four facts about this machine, all read, none guessed:
 *
 *  - **the effective canon** — bundled runtime vs a `CANON_BIN` override, with
 *    the whole resolution order. It comes straight from row P0-11's resolver
 *    and startup probe (`environment_status` calls the same
 *    `runtime_status_value`), so this pane can never disagree with what a verb
 *    will actually spawn;
 *  - **Godot detection** — the same `$GODOT_BIN → PATH → /Applications` order
 *    `play_game` walks, from the one detector, so what this says it found is
 *    what ▶ Play will try;
 *  - **`BLENDER_BIN` detection beside it**, with the version gate. Recipes are
 *    pinned to Blender 4.x LTS, and a 5.0 install is REPORTED, never silently
 *    used (`design_handoff_3d`). W2.2's row 1 consumes this detection and
 *    builds only the mesh_smith harness on top — it is the one detector;
 *  - **the project store** — where new projects land, relocatable here.
 *    Relocating changes one default: existing projects are never moved, and a
 *    project opened from anywhere is still written back in place. */
export function EnvironmentPane() {
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEnv(await api.environmentStatus());
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 400));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const relocate = async () => {
    setBusy(true);
    try {
      const picked = await pickDirectory("Where should new projects go?");
      if (picked) {
        await api.setProjectStore(picked);
        await load();
      }
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 400));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api.setProjectStore(null);
      await load();
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 400));
    } finally {
      setBusy(false);
    }
  };

  const store = env?.project_store;
  const lockedByEnv = store?.source === "env";

  return (
    <section data-testid="environment-pane">
      <h3 style={{ margin: "0 0 4px" }}>Environment</h3>
      <p style={note}>What cradle found on this machine, and where your projects go.</p>
      {err && (
        <div className="np-err" data-testid="environment-error">
          {err}
        </div>
      )}
      {!env && <p style={note}>checking…</p>}

      {env && (
        <>
          <Block title="canon runtime" testid="env-canon">
            <Row label="status">
              {env.canon.ok ? "✓ answering" : "✕ not usable"}
              {env.canon.version?.canon_version
                ? ` · canon ${env.canon.version.canon_version}`
                : ""}
            </Row>
            <Row label="resolved by">{originLabel(env.canon.origin)}</Row>
            <Row label="command">
              <code>{env.canon.command}</code>
            </Row>
            {env.canon.error && (
              <div style={{ ...note, color: "var(--err)" }}>{env.canon.error}</div>
            )}
            <details style={{ marginTop: 6 }}>
              <summary style={note}>▸ what was tried, in order</summary>
              <ul style={{ margin: "4px 0 0 14px", padding: 0 }}>
                {env.canon.legs.map((leg) => (
                  <li key={leg.leg} style={note}>
                    <strong>{leg.leg}</strong>
                    {leg.tried ? ` · ${leg.tried}` : ""} — {leg.found ? "found" : "no"}. {leg.note}
                  </li>
                ))}
              </ul>
            </details>
          </Block>

          <Tool detection={env.godot} testid="env-godot" />
          <Tool detection={env.blender} testid="env-blender" />

          <Block title="project store" testid="env-store">
            <Row label="new projects land in">
              <code>{store?.root ?? "—"}</code>
              {store && !store.exists ? " (created on first use)" : ""}
            </Row>
            <Row label="chosen by">{storeSourceLabel(store?.source)}</Row>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                className="btn"
                onClick={() => void relocate()}
                disabled={busy || lockedByEnv}
                title={
                  lockedByEnv
                    ? "CRADLE_PROJECTS_DIR is set in this process and wins — unset it to relocate from here."
                    : "Choose where NEW projects land"
                }
                data-testid="store-relocate"
              >
                Choose folder…
              </button>
              <button
                className="btn"
                onClick={() => void reset()}
                disabled={busy || lockedByEnv || store?.source !== "settings"}
                title={
                  store?.source === "settings"
                    ? "Go back to ~/CradleProjects"
                    : "already the default"
                }
                data-testid="store-reset"
              >
                Use the default
              </button>
            </div>
            <p style={{ ...note, marginTop: 6 }}>
              This changes one default. Projects already created stay where they are, and a project
              opened from anywhere is still written back in place.
            </p>
          </Block>

          {env.config_dir && (
            <p style={note} data-testid="env-config-dir">
              cradle's own settings live in <code>{env.config_dir}</code>.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One detected external tool. Not-installed is a state with a reason and an
 *  install pointer, never an empty row (doctrine 4). */
function Tool({ detection, testid }: { detection: ToolDetection; testid: string }) {
  const d = detection;
  return (
    <Block title={d.label} testid={testid}>
      <Row label="status">
        <span data-testid={`${testid}-gate`} data-gate={d.gate}>
          {d.found ? "✓ found" : "not installed"}
          {d.version ? ` · ${d.version}` : ""}
          {d.gate === "off_major" ? " · outside the pinned major" : ""}
        </span>
      </Row>
      {d.found && (
        <>
          <Row label="resolved by">{toolOriginLabel(d.origin, d.env_var)}</Row>
          <Row label="path">
            <code>{d.path}</code>
          </Row>
        </>
      )}
      <div style={note}>{d.note}</div>
      {!d.found && (
        <div style={note}>
          Install it from{" "}
          <a href={d.install} target="_blank" rel="noreferrer">
            {d.install}
          </a>
          , or set <code>${d.env_var}</code>.
        </div>
      )}
    </Block>
  );
}

function Block({
  title,
  testid,
  children,
}: {
  title: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 10,
        background: "var(--bg-sunken)",
      }}
    >
      <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ opacity: 0.6, minWidth: 150 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}

function originLabel(origin: string): string {
  return (
    {
      env: "the CANON_BIN override",
      bundled: "the runtime bundled with this app",
      path: "`canon` on PATH",
    }[origin] ?? origin
  );
}

function toolOriginLabel(origin: string | null, envVar: string): string {
  return (
    { env: `the $${envVar} override`, path: "PATH", app: "a standard install location" }[
      origin ?? ""
    ] ??
    (origin || "—")
  );
}

function storeSourceLabel(source: string | undefined): string {
  return (
    {
      env: "CRADLE_PROJECTS_DIR (set in this process — it wins)",
      settings: "your choice on this pane",
      default: "the default (~/CradleProjects)",
      error: "could not be resolved",
    }[source ?? ""] ??
    (source || "—")
  );
}

const note: React.CSSProperties = { fontSize: 11.5, opacity: 0.72, lineHeight: 1.5 };
