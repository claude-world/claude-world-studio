import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const tag = this.props.name ? `ErrorBoundary:${this.props.name}` : "ErrorBoundary";
    console.error(`[${tag}]`, error, errorInfo);

    // Report to server error ring buffer (Claude Code pattern: centralized error tracking)
    const stack = [error.stack, errorInfo.componentStack].filter(Boolean).join("\n---\n");
    fetch("/api/diagnostics/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, message: error.message, stack }),
    }).catch(() => {
      // Fire-and-forget — don't let reporting failure break anything
    });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="text-red-500 dark:text-red-400 text-lg font-semibold mb-2">
            Something went wrong
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-4 max-w-md">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
