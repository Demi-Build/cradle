import { Component, type ReactNode } from "react";

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("Render error:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <main className="detail detail-error">
          <h2>Something broke in this view</h2>
          <p>
            <code>{this.state.error.message}</code>
          </p>
          <details>
            <summary>stack</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{this.state.error.stack}</pre>
          </details>
          <button className="topbar-btn-secondary" onClick={this.reset}>
            reset view
          </button>
          <p style={{ color: "#888", fontSize: 12, marginTop: 12 }}>
            Full error also logged to DevTools console (Cmd+Option+I).
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}
