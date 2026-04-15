"use client";

import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Props / State                                                      */
/* ------------------------------------------------------------------ */

interface Props {
  children: ReactNode;
  /** Label shown in error UI (e.g. "3D Viewer", "Map") */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/* ================================================================== */
/*  Error boundary                                                     */
/* ================================================================== */

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` – ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center animate-fade-in">
          <AlertTriangle size={28} className="text-amber-500" />
          <p className="text-sm font-medium text-zinc-300">
            {this.props.label ?? "Component"} crashed
          </p>
          <p className="max-w-xs text-xs text-zinc-500">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-2 flex cursor-pointer items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
