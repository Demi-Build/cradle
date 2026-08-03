import { api, type JobEntry, type SpendEntry, type Usd } from "./invoke";

/** Money for humans: sub-cent shows 4dp, cents 3dp, dollars 2dp; exact $0 stays "$0". */
export function fmtUsd(n: number | undefined): string {
  if (!n) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** A best–worst forecast as a range ("$0.07–$0.30"), collapsing to one figure
 *  when best == worst and to "$0" when a backend is unpaid. */
export function fmtRange(u: Usd | undefined): string {
  if (!u) return "—";
  if (!u.best && !u.worst) return "$0";
  if (Math.abs(u.best - u.worst) < 1e-9) return fmtUsd(u.best);
  return `${fmtUsd(u.best)}–${fmtUsd(u.worst)}`;
}

/** Record a paid op's actual spend — best-effort: a ledger-write failure must
 *  never surface as if the generation itself failed (the op already ran). */
export async function recordSpend(worldPath: string, entry: SpendEntry): Promise<void> {
  try {
    await api.spendRecord(worldPath, entry);
  } catch (e) {
    console.warn("spend record failed (op still succeeded)", e);
  }
}

/** Record a finished background job to the durable ledger — best-effort, same
 *  as recordSpend: a ledger-write failure never surfaces as a job failure. */
export async function recordJob(worldPath: string, entry: JobEntry): Promise<void> {
  try {
    await api.jobRecord(worldPath, entry);
  } catch (e) {
    console.warn("job record failed (job still ran)", e);
  }
}
