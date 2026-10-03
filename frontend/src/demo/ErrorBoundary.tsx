import { Component, type ReactNode } from "react";
import { resetDemo } from "./mockApi";

/** If anything in the demo throws, offer a reset instead of a blank page. */
export class DemoErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="content" style={{ maxWidth: 640, margin: "60px auto" }}>
        <div className="card card-pad">
          <h1 style={{ color: "var(--purple)", marginTop: 0 }}>The demo hit a problem</h1>
          <p>This usually means data saved by an older version of the demo is still in this browser.</p>
          <button className="btn primary" onClick={() => { resetDemo(); location.reload(); }}>Reset demo data and reload</button>
          <p className="muted small" style={{ marginTop: 14 }}>If it keeps happening, send this message along:</p>
          <pre className="source-text">{String(this.state.error?.message ?? this.state.error)}</pre>
        </div>
      </main>
    );
  }
}
