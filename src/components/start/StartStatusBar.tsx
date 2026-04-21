export function StartStatusBar({ note }: { note: string }) {
  return (
    <footer className="statusbar">
      <span><span className="ok-dot" />idle</span>
      <span>{note}</span>
      <div className="spacer" />
      <span>cradle v0.1</span>
      <span>canon 0.4</span>
      <span>tauri 2.0</span>
    </footer>
  );
}
