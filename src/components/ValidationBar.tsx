import { countProblems } from "../lib/validation";
import { kbd } from "../lib/keys";
import { useStore } from "../store";

export function ValidationBar() {
  const { world, selection, levelValidation } = useStore();
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const current =
    selection.kind === "entity" && selection.typeId === "levels"
      ? levelValidation[selection.id]
      : undefined;
  const problemCount = current ? countProblems(current) : 0;
  return (
    <footer className="validation">
      {world ? (
        <>
          <span className="val-item val-pending">Checker: —</span>
          {current ? (
            <span
              className="val-item"
              style={{ color: current.ok ? "#3ddc84" : "#e0453a" }}
            >
              Validator: {current.level_id}{" "}
              {current.ok
                ? "✓ playable"
                : `✗ ${problemCount} problem${problemCount === 1 ? "" : "s"}`}
            </span>
          ) : (
            <span className="val-item val-pending">Validator: —</span>
          )}
          <span className="val-item val-pending">World Editor: —</span>
          <span className="val-hint">
            {current
              ? "(canon level validate — reachability simulated under the level's own physics)"
              : "(validation trail wiring lands when canon emits it)"}
          </span>
          {/* Right-aligned palette hint — the design puts it here, and it's
              the only place the shortcut is discoverable without knowing it. */}
          <button
            className="val-palette"
            onClick={() => setPaletteOpen(true)}
            title="Open the command palette"
          >
            <span className="kbd">{kbd("K")}</span>
          </button>
        </>
      ) : (
        <span className="val-hint">No world loaded.</span>
      )}
    </footer>
  );
}
