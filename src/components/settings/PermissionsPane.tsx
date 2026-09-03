import { useCallback, useEffect, useState } from "react";
import { agentApi, getAgentTransport, type GrantRow } from "../../lib/agent";
import { specialistLabel } from "../../lib/agentState";
import { parseIdentity } from "../../lib/cost";
import { useStore } from "../../store";
import { formatWhen } from "./grantTime";

/** Settings → **Permissions** (row P1-A6; agent-panel README §6, board 07
 *  "Where grants are revoked").
 *
 *  The per-project list of standing grants — tool, granting specialist, when —
 *  with `Revoke` per row and `Revoke all`. Every "always allow in this project"
 *  footnote in the transcript points here.
 *
 *  Three things the design fixes and this keeps:
 *  - **grants are per project.** The header names the project; the copy says so.
 *  - **paid work is never on this list.** Nothing to filter out: the permission
 *    engine refuses `always` for a $-tier call, so a paid grant cannot exist.
 *    The pane says it anyway, because absence is not an explanation.
 *  - **revoking undoes nothing already done.** Stated on the pane, not in a
 *    tooltip: a revoke changes what happens NEXT.
 *
 *  It reads and writes through row A4's endpoints (`GET/DELETE
 *  /packs/permissions`) — the grants file is service-owned; cradle never writes
 *  a pack file (doctrine 1). The Settings SCREEN arrived with row P0-12 and
 *  MOUNTS this pane as its third tab, unchanged, exactly as A6 planned; the
 *  temporary `PermissionsOverlay` that stood in for it is gone.
 *  Disabled-with-a-reason when the service is not running (doctrine 4) —
 *  grants live in the pack, but only the service reads them. */
export function PermissionsPane({ onClose }: { onClose?: () => void }) {
  const worldPath = useStore((s) => s.worldPath);
  const world = useStore((s) => s.world);
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serviceUp = getAgentTransport() != null;

  const load = useCallback(async () => {
    if (!serviceUp) return;
    try {
      const doc = await agentApi.listGrants(worldPath || undefined);
      setGrants(doc.grants);
      setPath(doc.path);
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 200));
    }
  }, [serviceUp, worldPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (index: number) => {
    setBusy(true);
    try {
      const doc = await agentApi.revokeGrant(index, worldPath || undefined);
      setGrants(doc.grants);
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    setBusy(true);
    try {
      const doc = await agentApi.revokeAllGrants(worldPath || undefined);
      setGrants(doc.grants);
      setErr(null);
    } catch (e) {
      setErr(String(e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="permissions-pane" style={{ color: "var(--fg)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Permissions</h3>
        <span style={{ fontSize: 12, opacity: 0.65 }}>
          {world?.name ?? worldPath ?? "no project"}
        </span>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button onClick={onClose} style={{ cursor: "pointer" }}>
            Close
          </button>
        )}
      </div>
      <p style={{ margin: "6px 0 12px", fontSize: 12, opacity: 0.7, lineHeight: 1.45 }}>
        Standing grants apply to this project only. Paid work is never on this list — a $ action
        confirms every time, in every mode.
      </p>

      {err && (
        <div
          style={{ color: "var(--err)", fontSize: 12, marginBottom: 10 }}
          data-testid="permissions-error"
        >
          {err}
        </div>
      )}

      {!serviceUp ? (
        // Doctrine 4: disabled with a reason, never hidden.
        <div
          data-testid="permissions-disabled"
          style={{
            fontSize: 12,
            opacity: 0.75,
            border: "1px dashed var(--border-hi, var(--border))",
            borderRadius: 8,
            padding: "12px 14px",
            lineHeight: 1.5,
          }}
        >
          The agent service isn’t running, so grants can’t be listed or revoked. They are stored
          with the project and are still in force — open the agent panel to start the service.
        </div>
      ) : grants == null ? (
        <div style={{ fontSize: 12, opacity: 0.6, padding: "10px 0" }}>Loading…</div>
      ) : grants.length === 0 ? (
        <div
          style={{ fontSize: 12, opacity: 0.6, padding: "10px 0" }}
          data-testid="permissions-empty"
        >
          No standing grants. Every write asks, every time.
        </div>
      ) : (
        <div>
          {grants.map((grant) => {
            const { specialist } = parseIdentity(grant.granted_by);
            return (
              <div
                key={`${grant.tool}-${grant.index}`}
                style={row}
                data-testid={`grant-${grant.tool}`}
              >
                <span className="mono" style={{ flex: 1, minWidth: 0 }}>
                  {grant.tool}
                  <span style={{ opacity: 0.65, marginLeft: 10, fontFamily: "inherit" }}>
                    {specialist ? specialistLabel(specialist) : (grant.granted_by ?? "you")} ·
                    granted {formatWhen(grant.when)}
                  </span>
                </span>
                <button
                  onClick={() => void revoke(grant.index)}
                  disabled={busy}
                  style={{ cursor: busy ? "default" : "pointer", fontSize: 12 }}
                >
                  Revoke
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", marginTop: 12, gap: 12 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }} data-testid="permissions-undo-note">
              Revoking does not undo anything already done.
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => void revokeAll()}
              disabled={busy}
              style={{ cursor: busy ? "default" : "pointer", fontSize: 12 }}
            >
              Revoke all
            </button>
          </div>
        </div>
      )}

      {path && (
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 12 }}>
          Stored at <span className="mono">{path}</span>, keyed by tool name.
        </div>
      )}
    </section>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 2px",
  borderBottom: "1px solid var(--border)",
  fontSize: 12,
};
