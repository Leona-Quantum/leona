"use client";

/**
 * The boundary for every route that does not bring its own.
 *
 * `/repository`, `/dashboard` and the workspace group each have one; the six
 * marketing pages under `app/[locale]/` had none, so a render error on the
 * landing page, pricing, or contact fell through to Next's built-in error
 * screen — unstyled, unbranded, and worded for a developer. Those are the
 * pages a stranger meets first (ai-ops issue 116, "include a clear
 * error-handling path for failed requests").
 *
 * Deliberately says nothing about *what* failed. `error.digest` is a server-side
 * correlation id, not an explanation, and the visitor cannot act on either; what
 * they can act on is knowing nothing was lost and that retrying is safe. The
 * digest is rendered anyway, quietly, because it is the only handle support has
 * if someone does write in — and it is already in the Sentry event either way.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mj-public-site">
      <div className="mj-public-frame">
        <section className="mj-public-page-hero" aria-labelledby="root-error-heading" role="alert">
          <p className="mj-section-label">Leona Quantum</p>
          <h1 id="root-error-heading">This page did not load.</h1>
          <p>
            Nothing was saved or changed. Try again, or head back to the home page — the rest of the
            site is unaffected.
          </p>
          <div className="mj-public-actions">
            <button className="mj-primary-button" type="button" onClick={reset}>
              Try again
            </button>
            <a className="mj-secondary-button" href="/">
              Return home
            </a>
          </div>
          {error.digest ? <p className="mj-section-label">Reference: {error.digest}</p> : null}
        </section>
      </div>
    </main>
  );
}
