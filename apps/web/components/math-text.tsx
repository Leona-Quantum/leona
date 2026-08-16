import katex from "katex";

import { mathSegments } from "../lib/math-text";
import { sanitizeMathHtml } from "../lib/sanitize-math";

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
            // KaTeX's own output, sanitized on the way out. The input is corpus
            // prose authored in this repository and gated by check-math.mjs, and
            // KaTeX itself defaults to `trust: false` — but the injection point
            // no longer depends on either of those staying true. Owner ruling,
            // ai-ops 138: KaTeX is not accepted as its own sanitizer. The config
            // that keeps this from eating KaTeX's MathML is the part that
            // matters; it is documented in lib/sanitize-math.ts.
            dangerouslySetInnerHTML={{
              __html: sanitizeMathHtml(
                katex.renderToString(segment.value, {
                  throwOnError: false,
                  displayMode: false,
                  output: "htmlAndMathml",
                }),
              ),
            }}
          />
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}
