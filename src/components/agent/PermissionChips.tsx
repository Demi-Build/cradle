import type { PermissionState } from "../../lib/agentState";
import { specialistLabel } from "../../lib/agentState";
import { useStore } from "../../store";

/** Permission chips (README §6). Inline where the action would happen,
 *  inside the card that wants it. Copy is always "‹Specialist› wants to
 *  ‹verb› ‹target›." Buttons `Accept · Always allow in this project ·
 *  Reject` — the middle one is never shortened; disabled-with-a-reason in
 *  Ask/Plan mode; never shown for paid (the PaidCard owns that state).
 *  Decisions go to the service (`decidePermission`). */
export function PermissionChips({
  perm,
  onDecide,
  onAllowAfterAll,
  onTellWhy,
}: {
  perm: PermissionState;
  onDecide: (decision: string, reason?: string) => void;
  onAllowAfterAll?: () => void;
  onTellWhy?: () => void;
}) {
  const project = useStore((s) => s.worldStoryTitle ?? s.world?.name ?? "this project");
  const who = specialistLabel(perm.specialist);
  if (perm.decision === "reject") {
    return (
      <div className="ag-perm" data-testid="perm-rejected">
        <div className="ag-rejected">
          <b>Rejected.</b> {who} did not {perm.target}.
          {perm.insteadNote && <div style={{ marginTop: 4 }}>{perm.insteadNote}</div>}
        </div>
        <div className="ag-perm-btns" style={{ marginTop: 6 }}>
          <button className="ag-btn" onClick={onAllowAfterAll} disabled={!onAllowAfterAll}>
            Allow after all
          </button>
          <button className="ag-btn" onClick={onTellWhy} disabled={!onTellWhy}>
            Tell it why
          </button>
        </div>
      </div>
    );
  }
  if (perm.decision) {
    return perm.grant ? (
      <div className="ag-granted" style={{ marginTop: 6 }} data-testid="perm-granted-now">
        ✓ allowed in this project from now on · <code>{perm.tool}</code>
      </div>
    ) : null;
  }
  const paid = perm.tier === "paid";
  return (
    <div className="ag-perm" data-testid="perm-chip" data-request={perm.requestId}>
      <div className="copy">
        {who} wants to {perm.target}.
      </div>
      <div className="ag-perm-btns">
        <button className="ag-btn primary" onClick={() => onDecide("accept")}>
          Accept
        </button>
        {!paid && (
          <button
            className={`ag-btn${perm.alwaysAllowed ? "" : " dashed"}`}
            disabled={!perm.alwaysAllowed}
            onClick={() => onDecide("always")}
            title={perm.alwaysAllowed ? undefined : (perm.alwaysReason ?? undefined)}
          >
            Always allow in this project
          </button>
        )}
        <button className="ag-btn" onClick={() => onDecide("reject")}>
          Reject
        </button>
      </div>
      {!paid && !perm.alwaysAllowed && perm.alwaysReason && (
        <div className="ag-perm-reason" data-testid="perm-reason">
          {reasonCopy(perm.mode, perm.alwaysReason)}
        </div>
      )}
      {!paid && perm.alwaysAllowed && (
        <div className="ag-foot" style={{ marginTop: 4 }}>
          “Always allow” covers <code>{perm.tool}</code> for {project} only. Revoke in{" "}
          {/* Row P1-A6: the footnote is the deep link the design asks for —
              "every 'always allow in this project' footnote points here". */}
          <button
            className="ag-linkish"
            data-testid="perm-settings-link"
            onClick={() => useStore.getState().openSettings("permissions")}
          >
            Settings → Permissions
          </button>
          .
        </div>
      )}
      {paid && (
        <div className="ag-foot" style={{ marginTop: 4 }}>
          Paid work is never covered by “always allow”. Every spend asks.
        </div>
      )}
    </div>
  );
}

/** The design's Ask-mode line, else the engine's own reason verbatim. */
function reasonCopy(mode: string, reason: string): string {
  if (mode === "ask")
    return "Disabled in Ask mode — standing grants are only offered in Allow mode.";
  return reason;
}

/** The quiet line for a write that ran under a standing grant (README §6
 *  "Already granted"). */
export function GrantedLine({ specialist, what }: { specialist?: string; what: string }) {
  return (
    <div className="ag-granted" data-testid="perm-granted">
      ✓ {specialistLabel(specialist)} {what} · allowed in this project
    </div>
  );
}
