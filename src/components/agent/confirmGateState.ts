// The editor's confirm gate — the state half (row P1-A5). The paid card
// stands in for every `window.confirm` the editor's own buttons used to
// raise (user decision 2026-09-01: the 13 sites; PLAN step 6: two gates
// never coexist). The rendering half is `ConfirmGate.tsx`; this module is
// what the call sites import, so the component file exports only components.
//
//  - `confirmSpend` opens the PaidCard's ESTIMATE state (backend + model
//    named, the range in the Accept button, today's spend for context) for
//    a paid selection — and resolves `true` at once for a $0 selection
//    (fake / none): doctrine 3, free never spend-confirms, and everything
//    that is not free always asks, estimate or no estimate.
//  - `confirmAction` opens a plain confirm card for the editor's non-cost
//    confirms (hand a map back to the generator, import from the library,
//    restore a version) — the same chassis, no accent outline, no price,
//    because none is spent.
//
// The estimate contract is P0-7's (`low, high, backend, model, unitCount`
// on the estimate JSON, additive); the older `total_usd.best/worst` is the
// fallback. Reads only: no ledger row is written here (A6 journals).

import type { CostEstimate } from "../../lib/invoke";

export type SpendGateOpts = {
  title: string;
  body?: string;
  /** The estimate call's answer, when one was made. */
  estimate?: CostEstimate | null;
  /** The backends the run will use — `$0` when every one is free. */
  backends: Record<string, string>;
  /** Named for the card when the estimate JSON does not name them. */
  backend?: string;
  model?: string;
  unitCount?: number;
  unitLabel?: string;
  /** A fixed price when no estimate call exists (music per track). */
  fixedUsd?: number;
};

export type ActionGateOpts = { title: string; body?: string; confirmLabel?: string };

type Pending =
  | { kind: "spend"; opts: SpendGateOpts; resolve: (ok: boolean) => void }
  | { kind: "action"; opts: ActionGateOpts; resolve: (ok: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}

/** Backends that cost nothing — a selection made only of these never sees
 *  the spend card. Ids are data; the set is the editor's own $0 vocabulary. */
export const FREE_BACKENDS = new Set(["fake", "none", "", "off"]);

export function isFreeSelection(backends: Record<string, string>): boolean {
  return Object.values(backends).every((b) => FREE_BACKENDS.has((b ?? "").toLowerCase()));
}

type EstimateExtra = CostEstimate & {
  low?: number;
  high?: number;
  backend?: string;
  model?: string;
  unitCount?: number;
};

/** The card's numbers from the estimate JSON (P0-7's keys first). */
export function paidFromEstimate(opts: SpendGateOpts): {
  lowCents: number;
  highCents: number;
  backend: string;
  model: string;
  unitCount: number;
  unitLabel: string;
} {
  const e = (opts.estimate ?? null) as EstimateExtra | null;
  const low = e?.low ?? e?.total_usd?.best ?? opts.fixedUsd ?? 0;
  const high = e?.high ?? e?.total_usd?.worst ?? opts.fixedUsd ?? low;
  const paidBackend =
    Object.entries(opts.backends).find(
      ([, b]) => !FREE_BACKENDS.has((b ?? "").toLowerCase()),
    )?.[1] ?? "";
  const model =
    e?.model ??
    opts.model ??
    Object.values(e?.llm?.by_task ?? {})[0]?.model ??
    (e?.assets?.vlm as { model?: string } | undefined)?.model ??
    "default model";
  const unitCount = e?.unitCount ?? opts.unitCount ?? Math.max(1, e?.llm?.calls ?? 1);
  return {
    lowCents: Math.round(low * 100),
    highCents: Math.round(high * 100),
    backend: e?.backend ?? opts.backend ?? paidBackend,
    model,
    unitCount,
    unitLabel: opts.unitLabel ?? `${unitCount} ${unitCount === 1 ? "call" : "calls"}`,
  };
}

/** Gate a paid button. Resolves `true` to proceed. $0 → `true` at once. */
export function confirmSpend(opts: SpendGateOpts): Promise<boolean> {
  // Doctrine 3 runs ONE way: a $0 selection never asks, and everything else
  // always does. A missing or zero estimate is "we don't know the price",
  // never "it's free" — six of the call sites reach here with a null
  // estimate (the estimate call failed, or its promise has not resolved
  // yet), and the card renders the estimate as unknown rather than
  // spending on a paid backend with no gate at all.
  if (isFreeSelection(opts.backends)) return Promise.resolve(true);
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { kind: "spend", opts, resolve };
    notify();
  });
}

/** Gate a non-cost action. Resolves `true` to proceed. */
export function confirmAction(opts: ActionGateOpts): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { kind: "action", opts, resolve };
    notify();
  });
}

/** Test hook: is a gate showing? */
export function gateIsOpen(): boolean {
  return pending !== null;
}

/** The host subscribes to gate changes and renders whatever is pending. */
export function subscribeGate(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function peekGate(): Pending | null {
  return pending;
}
/** Answer the pending gate (the host's buttons / scrim). */
export function settleGate(cur: Pending, ok: boolean): void {
  if (pending === cur) pending = null;
  cur.resolve(ok);
  notify();
}
export type { Pending as PendingGate };
