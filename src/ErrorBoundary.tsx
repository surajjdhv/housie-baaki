import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="recovery-screen">
          <div className="panel">
            <h1>Let’s get your table back.</h1>
            <p>
              Something prevented the app from opening. Your saved games have
              not been cleared. Try reloading, and make sure this browser allows
              local storage.
            </p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </main>
      );
    return this.props.children;
  }
}
