import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort boundary for the clinical shell.
 *
 * A render failure must not leave a clinician or patient staring at a blank
 * page mid-consultation. This surfaces an honest, accessible fallback with a
 * reload action; details stay in the console rather than on screen, which may
 * carry PHI in a stack trace.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[medzone] render failure', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen w-full bg-[#f2f6f7] text-[#16232b] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#e8eef0] rounded-2xl p-6 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[#fef2f2] text-[#b4232a] flex items-center justify-center text-xl font-black">
            !
          </div>
          <h1 className="mt-4 text-lg font-extrabold tracking-tight">This screen could not load</h1>
          <p className="mt-2 text-[13px] text-[#5b6b75]">
            Your session and records are still safe. Reload to reopen the chart.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 px-4 py-2 rounded-xl bg-[#0e8aa0] hover:bg-[#0b6e81] text-white text-[13px] font-semibold cursor-pointer"
          >
            Reload MedZone
          </button>
        </div>
      </div>
    );
  }
}
