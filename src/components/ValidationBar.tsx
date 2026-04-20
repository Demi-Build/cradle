import { useStore } from "../store";

export function ValidationBar() {
  const { world } = useStore();
  return (
    <footer className="validation">
      {world ? (
        <>
          <span className="val-item val-pending">Checker: —</span>
          <span className="val-item val-pending">Validator: —</span>
          <span className="val-item val-pending">World Editor: —</span>
          <span className="val-hint">(validation trail wiring lands when canon emits it)</span>
        </>
      ) : (
        <span className="val-hint">No world loaded.</span>
      )}
    </footer>
  );
}
