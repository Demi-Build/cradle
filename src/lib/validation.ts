import type { ValidationReport } from "./invoke";

/** Total problem count across a report AND its secret-room sub-reports —
 * `ok` folds rooms in, so any count shown beside it must too. */
export function countProblems(r: ValidationReport): number {
  return (
    r.checks.reduce((n, c) => n + c.problems.length, 0) +
    (r.rooms ?? []).reduce((n, room) => n + countProblems(room), 0)
  );
}
