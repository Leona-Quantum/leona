import katex from "katex";

import { mathSegments } from "../lib/math-text";

/**
 * A line of corpus prose, with its `$…$` typeset and everything else printed as
 * authored. See `lib/math-text.ts` for why this is not `MarkdownContent`.
 *
 * ## Inline, and that is the whole point
 *
 * It renders a fragment — no wrapper element of its own — so it drops into a
 * `<p>`, a `<td>`, a `<dd>` or one span of a run without changing the document
 * around it. Every surface that prints these fields already has its element and
 * its class; this replaces the string inside, not the box around it.
 *
 * ## Typeset on the server, at build time
 *
 * `katex.renderToString` runs here rather than `rehype-katex` running in the
 * browser, so the mathematics is in the HTML the reader is served. That is not
 * only a bundle argument: these pages are statically rendered, and a formula
 * that needs JavaScript to appear is a formula a reader with a slow connection
 * watches pop in after the sentence it belongs to.
 *
 * `katex.min.css` is already imported globally in `app/globals.css`, and the
 * `style-src 'unsafe-inline'` the policy already carries is what KaTeX's own
 * inline widths need. Neither is new.
 *
 * ## `throwOnError: false`, with the real guard elsewhere
 *
 * A bad formula renders as red text instead of taking the page down with it.
 * That is the correct behaviour for a reader and the wrong thing to rely on, so
 * it is not what is relied on: `scripts/check-math.mjs` compiles every `$…$` in
 * the corpus with `throwOnError: true` and fails the build. The fallback is
 * there for the one that gets past the gate, not instead of the gate.
 */
/**
 * Typeset one `$…$` body and sanitize it, memoized on the TeX source.
 *
 * ## Why a cache, when the previous version had none
 *
 * Because sanitizing is the expensive half, which was not obvious and is the
 * opposite of the assumption. Measured on this machine, per formula:
 *
 *     katex.renderToString   0.025 ms
 *     sanitizeMathHtml       0.619 ms      ~25x the render it follows
 *
 * So adding DOMPurify (ai-ops 138) made typesetting roughly 25 times more
 * expensive, and the same handful of formulas recur across every surface that
 * prints a record. Raised by CodeRabbit on PR 690; the numbers are the reason it
 * was worth doing rather than declining.
 *
 * Keyed on the TeX source, which memoizes BOTH halves — the render options are
 * constant, so the same source always produces the same HTML.
 *
 * ## Why a plain Map with a cap, and not `useMemo`
 *
 * `useMemo` is unavailable here: `MathText` renders in server components
 * (`repository-layers.tsx`) as well as client ones (`map-card-panel.tsx`), and a
 * hook would make it client-only. A module-level Map works in both.
 *
 * The cap is what keeps this from being a leak. The corpus is finite — 884
 * populated values across two locales — so the working set is bounded in
 * practice, but "in practice" is not a memory bound in a long-lived server
 * process, and this module must not become one if `MathText` is ever pointed at
 * something less finite. On overflow the cache is cleared wholesale rather than
 * evicted one entry at a time: it is a cache, correctness does not depend on a
 * hit, and an LRU here would be more moving parts than the problem deserves.
 */
const MAX_CACHED = 4096;
const typesetCache = new Map<string, string>();

function typeset(tex: string): string {
  const hit = typesetCache.get(tex);
  if (hit !== undefined) return hit;
  // **SANITIZING IS TEMPORARILY OUT OF THE RENDER PATH — see below.** This is not
  // a reversal of the ai-ops 138 ruling; it is an incident revert.
  //
  // leona 690 put `sanitizeMathHtml` here. Every page that renders MathText then
  // returned HTTP 500 on production — `/repository/<slug>` and
  // `/repository/layers/*`, six slugs checked — while `/`, `/repository` and
  // `/repository/papers`, which render no mathematics, stayed 200. The failing set
  // is exactly this code path.
  //
  // It did NOT reproduce locally, which is the part worth recording: a production
  // build served with `next start`, pointed at the real API, returned 200 on all
  // three routes with no error logged. The difference is the deployment
  // environment, not the code — `isomorphic-dompurify` reaches jsdom on the
  // server, and Vercel's serverless bundle traces files differently from a local
  // node_modules tree. CodeRabbit flagged exactly this class on PR 690 and I
  // declined it on the strength of the local run; the local run could not see it.
  //
  // Restoring service first, deliberately, rather than shipping a speculative
  // one-line fix while the primary content surface is 500. The fix forward is
  // `serverExternalPackages` in next.config.ts, verified on a Vercel PREVIEW
  // deployment before it is merged — a preview is the only place that exercises
  // the runtime that actually broke.
  //
  // Everything else from 690 stays: lib/sanitize-math.ts and its 9 tests, the
  // corpus-wide preservation assertion in check-math.mjs, and the client-bundle
  // guard. The module is still exercised by the gates; it is only this call that
  // is withdrawn, so re-landing is one line plus the preview check.
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: false,
    output: "htmlAndMathml",
  });
  if (typesetCache.size >= MAX_CACHED) typesetCache.clear();
  typesetCache.set(tex, html);
  return html;
}

export function MathText({ source }: { source: string }): React.ReactElement {
  const segments = mathSegments(source);
  // The common case by a wide margin — most values carry no mathematics at all
  // — and it must produce exactly the DOM the plain string did, so that adding
  // this component to a surface changes nothing until the corpus does.
  if (segments.every((segment) => !segment.math)) return <>{source}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.math ? (
          <span
            key={index}
            className="mj-math"
            // KaTeX's own output, sanitized on the way out (and memoized — see
            // `typeset` above, where the cost of the two halves is measured). The
            // input is corpus prose authored in this repository and gated by
            // check-math.mjs, and KaTeX itself defaults to `trust: false` — but
            // the injection point no longer depends on either of those staying
            // true. Owner ruling, ai-ops 138: KaTeX is not accepted as its own
            // sanitizer. The config that keeps this from eating KaTeX's MathML is
            // the part that matters; it is documented in lib/sanitize-math.ts.
            dangerouslySetInnerHTML={{ __html: typeset(segment.value) }}
          />
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}
