"use client";

// Route error boundary backstop. If anything on the dashboard throws past the
// per-panel guards, show a friendly message — never a stack trace, never a number.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">This page couldn&apos;t load its budget data</h1>
      <p className="mt-2 text-sm text-default-500">
        The reconciled budget data is temporarily unavailable. Nothing here is estimated — we&apos;d rather show nothing
        than a number we can&apos;t source.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg border border-default-300 bg-content1 px-4 py-2 text-sm font-medium text-foreground hover:bg-default-100"
      >
        Try again
      </button>
    </main>
  );
}
