import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Chessverse Uncaught Error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleReset = () => {
    try {
      localStorage.removeItem("chessverse:game-id");
    } catch {
      // Ignore storage errors
    }
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#071320] text-stone-200 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(11,24,39,0.96),rgba(9,18,31,0.98))] p-6 sm:p-8 shadow-2xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
              An Unexpected Glitch Occurred
            </h1>
            
            <p className="mt-2.5 text-sm text-stone-300/80 leading-relaxed">
              Chessverse encountered an unhandled rendering error. Your local match history and credentials are safe.
            </p>

            {this.state.error && (
              <div className="mt-4 p-3 rounded-lg bg-black/40 border border-white/5 text-left text-xs font-mono text-rose-300/90 overflow-x-auto max-h-28">
                {this.state.error.message}
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-5 py-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white font-medium text-xs sm:text-sm transition-colors cursor-pointer"
              >
                Try To Recover
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="px-5 py-2.5 rounded-xl border border-cyan-400/30 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 font-semibold text-xs sm:text-sm shadow-[0_0_15px_rgba(6,182,212,0.25)] transition-all cursor-pointer"
              >
                Reload & Clear State
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
