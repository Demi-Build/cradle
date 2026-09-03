import { useState } from "react";
import type { PlanItem, PlanStep } from "../../lib/agentState";
import { fmtCents, fmtCentsRange, fmtDuration, specialistLabel } from "../../lib/agentState";
import {
  beginPlanEdit,
  decidePlan,
  resumePlan,
  stopConversation,
  undoPlan,
} from "../../lib/agentActions";
import { showMe } from "../../lib/agentShowMe";
import { useElapsed } from "./useElapsed";
import { ChangeFeed } from "./ChangeFeed";
import { usePanelSurface } from "./panelSurface";

/** Plan mode (README §7): proposed · running · halted · complete (the change
 *  feed). Every step carries a tier badge and a specialist; paid steps their
 *  range; one button approves the batch with the total on it. */
export function PlanCard({ plan, conversationId }: { plan: PlanItem; conversationId: string }) {
  if (plan.status === "complete") return <ChangeFeed plan={plan} conversationId={conversationId} />;
  if (plan.status === "editing") return <PlanEdit plan={plan} conversationId={conversationId} />;
  if (plan.status === "proposed")
    return <PlanProposed plan={plan} conversationId={conversationId} />;
  if (plan.status === "halted") return <PlanHalted plan={plan} conversationId={conversationId} />;
  if (plan.status === "rejected") {
    return (
      <div className="ag-card" data-testid="plan-card" data-state="rejected">
        <div className="ag-card-head">
          <span className="ag-badge plan">plan</span>
          <span className="title">{plan.title}</span>
          <span className="ag-card-mono" style={{ marginTop: 0 }}>
            discarded
          </span>
        </div>
      </div>
    );
  }
  return <PlanRunning plan={plan} conversationId={conversationId} />;
}

function paidTotal(plan: PlanItem): number {
  return plan.steps.reduce((n, s) => n + (s.estimate?.highCents ?? 0), 0);
}

function StepRow({
  step,
  index,
  showTimes,
}: {
  step: PlanStep;
  index: number;
  showTimes: boolean;
}) {
  const mark =
    step.status === "done"
      ? "✓"
      : step.status === "failed"
        ? "✕"
        : step.status === "running"
          ? "●"
          : step.status === "skipped"
            ? "–"
            : String(index + 1);
  return (
    <li className="ag-plan-step" data-testid="plan-step" data-status={step.status}>
      <span className={`n ${step.status}`}>{mark}</span>
      <span className={`t ${step.status}`}>{step.text}</span>
      <span className="meta">
        {!showTimes && (
          <span
            className={`ag-badge ${step.tier === "paid" ? "paid" : step.tier === "write" ? "write" : "read"}`}
          >
            {step.tier}
          </span>
        )}
        {step.specialist && !showTimes && <span>{specialistLabel(step.specialist)}</span>}
        {step.estimate && step.status !== "done" && (
          <span>{fmtCentsRange(step.estimate.lowCents, step.estimate.highCents)}</span>
        )}
        {showTimes && step.durationMs != null && <span>{fmtDuration(step.durationMs)}</span>}
        {showTimes && step.billedCents != null && step.billedCents > 0 && (
          <span>{fmtCents(step.billedCents)}</span>
        )}
        {step.showMe && (step.status === "done" || step.status === "failed") && (
          <button className="btn-link" onClick={() => showMe(step.showMe!)}>
            show me
          </button>
        )}
      </span>
      {step.error && <span className="err">{step.error}</span>}
      {step.note && <span className="hint">{step.note}</span>}
      {step.tier === "paid" && step.status === "pending" && showTimes && (
        <span className="hint">
          will ask · {step.estimate ? `${fmtCents(step.estimate.lowCents)}+` : "paid"}
        </span>
      )}
    </li>
  );
}

function PlanProposed({ plan, conversationId }: { plan: PlanItem; conversationId: string }) {
  // Row A9: the start page's plan IS a create, so its button says so —
  // `Create · up to $X` beside `Edit steps` / `Start blank instead`, with the
  // folder-before-spend footnote (README §11). The editor supplies no
  // surface, so it keeps `Run plan · up to $X` / `Discard` exactly as A5
  // built it.
  const surface = usePanelSurface();
  const total = paidTotal(plan);
  const approve = () =>
    surface.onApprovePlan
      ? surface.onApprovePlan(conversationId, plan.planId)
      : void decidePlan(conversationId, plan.planId, "approve");
  const discard = () =>
    surface.onDiscardPlan
      ? surface.onDiscardPlan(conversationId, plan.planId)
      : void decidePlan(conversationId, plan.planId, "reject");
  const paidIdx = plan.steps.map((s, i) => (s.tier === "paid" ? i + 1 : 0)).filter(Boolean);
  const freeIdx = plan.steps.map((s, i) => (s.tier === "paid" ? 0 : i + 1)).filter(Boolean);
  return (
    <div className="ag-card" data-testid="plan-card" data-state="proposed">
      <div className="ag-card-head">
        <span className="ag-badge plan">plan</span>
        <span className="title">{plan.title}</span>
      </div>
      <ol className="ag-plan-steps">
        {plan.steps.map((s, i) => (
          <StepRow key={i} step={s} index={i} showTimes={false} />
        ))}
      </ol>
      <div className="ag-card-actions">
        <button className="ag-btn primary" data-testid="plan-approve" onClick={approve}>
          {surface.planApproveLabel
            ? surface.planApproveLabel(total)
            : `Run plan${total > 0 ? ` · up to ${fmtCents(total)}` : ""}`}
        </button>
        <button
          className="ag-btn"
          data-testid="plan-edit"
          disabled={!!surface.planEditDisabledReason}
          title={surface.planEditDisabledReason}
          onClick={() => beginPlanEdit(conversationId, plan.planId)}
        >
          Edit steps
        </button>
        <button className="ag-btn" data-testid="plan-discard" onClick={discard}>
          {surface.planDiscardLabel ?? "Discard"}
        </button>
      </div>
      <div className="ag-foot" style={{ marginTop: 6 }}>
        Approving the plan approves{" "}
        {freeIdx.length ? `steps ${listIdx(freeIdx)}` : "the read and write steps"}.
        {paidIdx.length
          ? ` Step${paidIdx.length > 1 ? "s" : ""} ${listIdx(paidIdx)} spend${paidIdx.length > 1 ? "" : "s"} money and will still ask when it gets there.`
          : ""}
        {surface.planFootnote ? ` ${surface.planFootnote}` : ""}
      </div>
    </div>
  );
}

function listIdx(idx: number[]): string {
  if (idx.length <= 1) return idx.join("");
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (consecutive) return `${idx[0]}–${idx[idx.length - 1]}`;
  return `${idx.slice(0, -1).join(", ")} and ${idx[idx.length - 1]}`;
}

function PlanEdit({ plan, conversationId }: { plan: PlanItem; conversationId: string }) {
  const [text, setText] = useState(
    plan.steps.map((s) => `${s.tier} · ${s.specialist ?? "foreman"} · ${s.text}`).join("\n"),
  );
  const submit = () => {
    const steps = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [tier, specialist, ...rest] = l.split("·").map((x) => x.trim());
        return rest.length
          ? { tier, specialist, text: rest.join(" · ") }
          : { tier: "write", text: l };
      });
    void decidePlan(conversationId, plan.planId, "edit", steps);
  };
  return (
    <div className="ag-card ag-plan-edit" data-testid="plan-card" data-state="editing">
      <div className="ag-card-head">
        <span className="ag-badge plan">plan</span>
        <span className="title">Edit steps — one per line: tier · specialist · text</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ marginTop: 8 }} />
      <div className="ag-card-actions">
        <button className="ag-btn primary" onClick={submit}>
          Re-propose
        </button>
      </div>
    </div>
  );
}

function PlanRunning({ plan, conversationId }: { plan: PlanItem; conversationId: string }) {
  // Same override as the header's ⏹ (row A9): stop whatever is actually
  // running, which on the start page is a JobQueue create, not a sidecar turn.
  const surface = usePanelSurface();
  const elapsed = useElapsed(plan.startedAt ?? plan.ts, plan.status === "running");
  const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const cur = plan.steps.findIndex((s) => s.status === "running");
  return (
    <div className="ag-card" data-testid="plan-card" data-state={plan.status}>
      <div className="ag-card-head">
        <span className="ag-badge plan">
          plan · {plan.status === "stopped" ? "stopped" : "running"}
        </span>
        <span className="title">
          {Math.max(done, cur + 1)} of {plan.steps.length} · {fmtDuration(elapsed)}
        </span>
        {plan.status === "running" && (
          <button
            className="ag-stop sm"
            onClick={() =>
              surface.onStop
                ? surface.onStop(conversationId)
                : void stopConversation(conversationId)
            }
            title="Stop the batch"
          >
            ⏹ Stop
          </button>
        )}
      </div>
      <ol className="ag-plan-steps">
        {plan.steps.map((s, i) => (
          <StepRow key={i} step={s} index={i} showTimes />
        ))}
      </ol>
    </div>
  );
}

/** The halted card's ways out (README §7). The service names them as ACTION
 *  TOKENS in `plan_halted.options` (canon `runs.HALT_OPTIONS`); the copy is
 *  the panel's, so the button carries the label and the POST carries the
 *  token — `continue | skip | stop` to `…/plans/{id}/resume`, `undo` to
 *  `…/plans/{id}/undo`. Neither is the decision endpoint: a halted plan is
 *  not `proposed`, and the service refuses it twice over. */
const HALT_ACTIONS = ["continue", "skip", "undo", "stop"];

function PlanHalted({ plan, conversationId }: { plan: PlanItem; conversationId: string }) {
  const at = (plan.haltedAt ?? 0) + 1;
  const elapsed = (plan.endedAt ?? plan.ts) - (plan.startedAt ?? plan.ts);
  const doneIdx = plan.steps.map((s, i) => (s.status === "done" ? i + 1 : 0)).filter(Boolean);
  const label = (action: string): string =>
    action === "continue"
      ? `Continue from step ${at}`
      : action === "skip"
        ? `Skip to step ${at + 1}`
        : action === "undo"
          ? `Undo steps ${listIdx(doneIdx)}`
          : "Stop here";
  const offered = plan.haltOptions.length ? plan.haltOptions : HALT_ACTIONS;
  const options = offered
    .filter((a) => HALT_ACTIONS.includes(a))
    .filter((a) =>
      a === "skip" ? at < plan.steps.length : a === "undo" ? doneIdx.length > 0 : true,
    )
    .map((action) => ({ action, label: label(action) }));
  const choose = (action: string) => {
    if (action === "undo") return void undoPlan(conversationId, plan.planId);
    return void resumePlan(conversationId, plan.planId, action);
  };
  return (
    <div className="ag-card halted" data-testid="plan-card" data-state="halted">
      <div className="ag-card-head">
        <span className="ag-badge plan" style={{ borderColor: "var(--err)", color: "var(--err)" }}>
          plan · halted
        </span>
        <span className="title">
          at step {at} · {fmtDuration(elapsed)}
        </span>
      </div>
      <ol className="ag-plan-steps">
        {plan.steps.map((s, i) => (
          <StepRow
            key={i}
            step={
              i > (plan.haltedAt ?? 0) && s.status === "pending" ? { ...s, note: "not started" } : s
            }
            index={i}
            showTimes
          />
        ))}
      </ol>
      {plan.haltError && (
        <div className="ag-card-mono" style={{ color: "var(--err)" }}>
          {plan.haltError}
        </div>
      )}
      {plan.undone ? (
        <div className="ag-card-mono">Steps {listIdx(doneIdx)} reverted as one History entry.</div>
      ) : (
        <div className="ag-card-actions">
          {options.map((o) => (
            <button
              key={o.action}
              className="ag-btn"
              data-action={o.action}
              onClick={() => choose(o.action)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div className="ag-foot" style={{ marginTop: 6 }}>
        Undo reverts the writes as one History entry. It cannot refund
        {plan.haltBilledCents != null ? ` the ${fmtCents(plan.haltBilledCents)}` : " spend"}.
      </div>
    </div>
  );
}
