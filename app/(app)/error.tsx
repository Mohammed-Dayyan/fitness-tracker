"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md card rounded-2xl p-6 text-center">
      <AlertTriangle aria-hidden className="mx-auto size-8 text-critical" />
      <h1 className="mt-3 text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-1 text-sm text-ink-2">
        The page couldn&apos;t be loaded. Your data is unaffected. If this keeps happening, check that the database is
        running.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">Reference: {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-5 inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        <RotateCcw aria-hidden className="size-4" />
        Try again
      </button>
    </div>
  );
}
