import { useStore } from "../../store";

export function StartStatusBar({ note }: { note: string }) {
  // What the last action actually did, when there was one — the design uses
  // the statusbar to confirm that removing a card is not a delete.
  const startNote = useStore((s) => s.startNote);
  return (
    <footer className="statusbar">
      <span>
        <span className="ok-dot" />
        idle
      </span>
      <span>{startNote ?? note}</span>
      <div className="spacer" />
      <span>cradle v0.1</span>
      <span>canon 0.4</span>
      <span>tauri 2.0</span>
    </footer>
  );
}
