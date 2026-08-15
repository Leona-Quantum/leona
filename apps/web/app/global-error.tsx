"use client";

/**
 * The last boundary: errors thrown by the ROOT layout itself.
 *
 * `app/error.tsx` sits inside the root layout, so it cannot catch a failure of
 * the thing rendering it. When that happens Next falls back to this file, and
 * if this file does not exist, to its own built-in screen — a developer-facing
 * page with no branding on the most visible failure the site has.
 *
 * ## Why the styling is inline and looks nothing like the rest of the app
 *
 * `global-error.tsx` REPLACES the root layout, which means it must render its
 * own `<html>` and `<body>`, and the global stylesheet the layout imports is
 * not applied. Reaching for `mj-*` classes here would produce an unstyled page
 * precisely when everything else has already failed — the classes would resolve
 * to nothing. So the few rules needed are inline and self-contained, and they
 * are the only place in this codebase where that is the correct choice rather
 * than a shortcut.
 *
 * Colours are the CSS system keywords `Canvas` and `CanvasText` rather than
 * tokens or hex. Tokens live in the stylesheet that is not loaded; hex would
 * both fail `check-raw-hex` and hard-code one theme. The system keywords follow
 * the reader's OS light/dark setting with no stylesheet and no script, which is
 * exactly the constraint this file is under.
 *
 * `lang` is hard-coded to English. The locale lives in a cookie read by a script
 * in the root layout — the layout that just failed — so there is nothing to read
 * it with here, and claiming a language we cannot determine is worse for a
 * screen reader than defaulting.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          lineHeight: 1.5,
          padding: "2rem",
        }}
      >
        {/* `role="alert"` sits on the inner element, not on `<main>`. Putting it
            on the landmark REPLACES the implicit `main` role rather than adding
            to it, so a screen-reader user loses the one landmark on a page that
            has nothing else to navigate by. The nested element keeps both: the
            landmark, and the live announcement. */}
        <main style={{ maxWidth: "34rem" }}>
          <div role="alert">
            <p style={{ fontSize: "0.8125rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6 }}>
              Leona Quantum
            </p>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 600, margin: "0.5rem 0 1rem" }}>
              Something went wrong.
            </h1>
            <p style={{ margin: "0 0 1.5rem" }}>
              Nothing was saved or changed. Reloading usually clears it; if it does not, the site itself
              is having trouble and we are already being told.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                font: "inherit",
                padding: "0.625rem 1.25rem",
                border: "1px solid CanvasText",
                borderRadius: "0.5rem",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {error.digest ? (
              <p style={{ fontSize: "0.8125rem", opacity: 0.6, marginTop: "1.5rem" }}>
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
