"use client";

// Segment error boundary. Copy rule: what happened + what we did + one action;
// never a bare stack trace outside collapsible details. Server errors arrive
// masked by Next.js with only a digest — show that for log correlation; never
// echo raw error internals.
//
// Styling note: this used ad-hoc Tailwind (`p-6`, `mt-4`, a bare `<h1>` and
// `<p>` with no gap between them) while every other workspace surface is built
// from the mj-* vocabulary and the spacing tokens. The result was an error
// screen that did not look like the product it appeared inside — the one screen
// where looking broken is most expensive.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mj-app-error">
      <section className="mj-app-error-card" role="alert">
        <p className="mj-eyebrow">Leona Quantum</p>
        <h1>Something went wrong</h1>
        <p className="mj-app-error-body">
          This page failed to load. Nothing was saved or lost; you can try again.
        </p>
        <div className="mj-app-error-actions">
          <button type="button" onClick={reset} className="mj-primary-button">
            Retry
          </button>
          <a className="mj-secondary-button" href="/studio">
            Back to Studio
          </a>
        </div>
        {error.digest ? (
          <details className="mj-app-error-details">
            <summary>Details</summary>
            <p>Error reference: <code>{error.digest}</code></p>
          </details>
        ) : null}
      </section>
    </main>
  );
}
