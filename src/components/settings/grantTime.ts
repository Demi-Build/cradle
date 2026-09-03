/** Grant timestamps for the Permissions pane (row P1-A6, board 07 copy).

    Its own module so `PermissionsPane` exports only components (the
    react-refresh rule), and so the format is testable without rendering. */
/** "14:06 today" for today's grants, the ISO date otherwise — board 07's copy.
 *  Never throws on a malformed stamp; it is a label, not a clock. */
export function formatWhen(when: string | undefined, now = new Date()): string {
  if (!when) return "—";
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return when;
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toTimeString().slice(0, 5);
  return sameDay ? `${time} today` : `${at.toISOString().slice(0, 10)} ${time}`;
}
