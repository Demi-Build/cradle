import type { ToolItem } from "../../../lib/agentState";
import { showMe } from "../../../lib/agentShowMe";
import {
  decidePermission,
  sendMessage,
  setDraft,
  stopRun,
  undoWrite,
} from "../../../lib/agentActions";
import { cancelJob } from "../../../lib/agentActions";
import { PermissionChips, GrantedLine } from "../PermissionChips";
import { DiffSpatial } from "./DiffSpatial";
import { DiffFields } from "./DiffFields";
import { DiffCode } from "./DiffCode";
import { PaidCard } from "./PaidCard";

/** A write (README §5 "write"): bordered card, filled accent WRITE badge, the
 *  diff always visible before the chips, Show me on every card. Picks a diff
 *  renderer by payload kind (spatial / fields / code); a write whose result
 *  carried no `diff` block still shows what it did and the journal handles
 *  (before → after hashes) so "undo this" works.
 *
 *  A paid tool renders the PaidCard in this slot instead — same place in
 *  the log, different weight. */
export function WriteCard({ tool, conversationId }: { tool: ToolItem; conversationId: string }) {
  if (tool.tier === "paid") return <PaidTool tool={tool} conversationId={conversationId} />;
  const pending = tool.permission && !tool.permission.decision;
  const rejected = tool.permission?.decision === "reject";
  const title = `${prefix(tool)}${tool.permission?.target ?? tool.label}`;
  return (
    <div
      className={`ag-card write${tool.undone ? " undone" : ""}`}
      data-testid="write-card"
      data-tool={tool.name}
    >
      <div className="ag-card-head">
        <span className="ag-badge write">write</span>
        <span className="title">{title}</span>
        {tool.showMe && (
          <button className="btn-link ag-showme" onClick={() => showMe(tool.showMe!)}>
            Show me ↗
          </button>
        )}
      </div>
      {tool.diff && (
        <div className="ag-card-body">
          {tool.diff.kind === "spatial" && (
            <DiffSpatial
              before={tool.diff.before}
              after={tool.diff.after}
              added={tool.diff.added}
              summary={tool.diff.summary}
            />
          )}
          {tool.diff.kind === "fields" && (
            <DiffFields fields={tool.diff.fields} unchanged={tool.diff.unchanged} />
          )}
          {tool.diff.kind === "code" && (
            <DiffCode
              path={tool.diff.path}
              unified={tool.diff.unified}
              added={tool.diff.added}
              removed={tool.diff.removed}
            />
          )}
        </div>
      )}
      {!tool.diff && tool.status === "ok" && (
        <div className="ag-card-mono">
          {tool.summary ?? "written"}
          {tool.journal?.length ? ` · ${tool.journal.map(hashes).join(" · ")}` : ""}
        </div>
      )}
      {tool.status === "error" && !rejected && (
        <div className="ag-card-mono" style={{ color: "var(--err)" }}>
          failed: {tool.error}
        </div>
      )}
      {tool.status === "running" && !pending && <div className="ag-card-mono">writing…</div>}
      {tool.allowedByGrant && !tool.permission && (
        <div style={{ marginTop: 6 }}>
          <GrantedLine specialist={tool.specialist} what={tool.summary ?? tool.label} />
        </div>
      )}
      {tool.permission && (
        <PermissionChips
          perm={tool.permission}
          onDecide={(decision, reason) =>
            void decidePermission(conversationId, tool.permission!.requestId, decision, reason)
          }
          onAllowAfterAll={() =>
            void sendMessage(conversationId, `Go ahead and ${tool.permission!.target} after all.`)
          }
          onTellWhy={() =>
            setDraft(conversationId, `I rejected "${tool.permission!.target}" because `)
          }
        />
      )}
      {tool.status === "ok" && tool.journal?.some((j) => j.before_hash) && !tool.undone && (
        <div className="ag-card-actions">
          <button className="ag-btn" onClick={() => void undoWrite(conversationId, tool.id)}>
            undo this
          </button>
        </div>
      )}
      {tool.undone && (
        <div className="ag-card-mono">undone — restored to the before hash (a new version).</div>
      )}
    </div>
  );
}

function prefix(tool: ToolItem): string {
  if (!tool.diff) return "";
  return tool.diff.kind === "spatial"
    ? "Spatial · "
    : tool.diff.kind === "fields"
      ? "Row · "
      : "Code · ";
}

function hashes(j: { before_hash?: string; after_hash?: string; artifact_id?: string }): string {
  const s = (h?: string) => (h ? h.slice(0, 7) : "—");
  return `${j.artifact_id ?? ""} ${s(j.before_hash)} → ${s(j.after_hash)}`;
}

function PaidTool({ tool, conversationId }: { tool: ToolItem; conversationId: string }) {
  const paid = tool.paid;
  const perm = tool.permission;
  if (!paid) {
    return (
      <div className="ag-card paid" data-testid="paid-card" data-state="pending">
        <div className="ag-card-head">
          <span className="ag-badge paid">paid</span>
          <span className="title">{tool.label}</span>
        </div>
        {perm && !perm.decision && (
          <PermissionChips
            perm={perm}
            onDecide={(d, r) => void decidePermission(conversationId, perm.requestId, d, r)}
          />
        )}
        {perm?.decision === "reject" && <PermissionChips perm={perm} onDecide={() => {}} />}
      </div>
    );
  }
  const requestId =
    perm && !perm.decision
      ? perm.requestId
      : paid.state === "estimate"
        ? paid.requestId
        : undefined;
  const stopRunning = () => {
    if (paid.state === "running" && paid.jobId) void cancelJob(paid.jobId);
    else if (tool.runId) void stopRun(tool.runId);
  };
  if (paid.state === "estimate" && perm?.decision === "reject") {
    return (
      <div className="ag-card paid" data-testid="paid-card" data-state="rejected">
        <div className="ag-card-head">
          <span className="ag-badge paid">paid</span>
          <span className="title">{tool.label}</span>
        </div>
        <PermissionChips
          perm={perm}
          onDecide={() => {}}
          onAllowAfterAll={() =>
            void sendMessage(conversationId, `Go ahead and ${perm.target} after all.`)
          }
          onTellWhy={() => setDraft(conversationId, `I rejected "${perm.target}" because `)}
        />
      </div>
    );
  }
  return (
    <PaidCard
      paid={paid}
      title={perm?.target ?? tool.label}
      specialist={paid.state === "estimate" ? tool.specialist : undefined}
      tool={tool}
      onAccept={
        requestId ? () => void decidePermission(conversationId, requestId, "accept") : undefined
      }
      onReject={
        requestId ? () => void decidePermission(conversationId, requestId, "reject") : undefined
      }
      onStop={paid.state === "running" ? stopRunning : undefined}
      onFinishLast={
        paid.state === "stopped"
          ? () =>
              void sendMessage(
                conversationId,
                `Finish the last one: ${paid.notStarted.join(", ")}.`,
              )
          : undefined
      }
      onUndoAll={
        paid.state === "stopped"
          ? () =>
              void sendMessage(
                conversationId,
                `Undo all ${paid.kept.length} — ${paid.kept.join(", ")}.`,
              )
          : undefined
      }
    />
  );
}
