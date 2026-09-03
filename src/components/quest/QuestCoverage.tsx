// The quest-coverage list — one row per quest state with its beat count, amber
// where there are none (README screen 07, "Tray").
//
// EXTENDS nothing: this is the one genuinely new reading the quest scope adds.
// It answers "where does this conversation have holes?", which the NPC scope
// structurally cannot — a hole is an absence spread across characters.
//
// A quest state with no beats is a WARNING, never an error: the engine falls
// back to the quest's own one-liner, and the row says so where it happens
// (doctrine: loud fallback, named at the point of use).

/** The quest states, from the pack's own `quest` operand vocabulary — never a
 *  hardcoded five. `canon pack info`'s `dialogue.operands.quest.states`. */
export type CoverageRow = { state: string; beats: number };

export function QuestCoverage({
  rows,
  activeState,
  onPick,
}: {
  rows: CoverageRow[];
  activeState?: string | null;
  onPick?: (state: string) => void;
}) {
  return (
    <section className="dlg-inspector-sect dlg-coverage" data-testid="quest-coverage">
      <header>
        <span>quest coverage</span>
        <span className="dlg-rail-count">{rows.reduce((n, r) => n + r.beats, 0)}</span>
      </header>
      {rows.map((row) => (
        <button
          key={row.state}
          className={`dlg-coverage-row ${row.state === activeState ? "on" : ""}`}
          data-empty={row.beats === 0 ? "1" : undefined}
          disabled={!onPick}
          onClick={() => onPick?.(row.state)}
        >
          <span className="dlg-mono">{row.state}</span>
          <span className="dlg-rail-count">
            {row.beats === 0 ? "no beats" : `${row.beats} beat${row.beats === 1 ? "" : "s"}`}
          </span>
        </button>
      ))}
      <p className="dlg-inspector-note">
        A quest state with no dialogue is a warning, not an error — the engine uses the quest&apos;s
        own one-liner.
      </p>
    </section>
  );
}
