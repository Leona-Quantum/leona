"use client";

// Segment error boundary. Copy rule: what happened + what we did + one action;
// never a bare stack trace outside collapsible details. Server errors arrive
// masked by Next.js with only a digest — show that for log correlation; never
// echo raw error internals.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="mx-auto max-w-[720px] p-6">
      <h1 className="text-20 font-semibold">Something went wrong</h1>
      <p className="text-text-1">
        This page failed to load. Nothing was saved or lost; you can try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="cursor-pointer rounded-control bg-accent px-4 py-2 font-medium text-bg-0"
      >
        Retry
      </button>
      {error.digest ? (
        <details className="mt-4 text-text-2">
          <summary>Details</summary>
          <p className="font-mono text-12">Error reference: {error.digest}</p>
        </details>
      ) : null}
    </section>
  );
}
