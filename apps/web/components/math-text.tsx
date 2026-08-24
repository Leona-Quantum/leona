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
  // Sanitized again. The incident that took this call out is kept rather than
  // deleted, because its recorded cause was wrong and the correction is the
  // reason a version pin exists two files away.
  //
  // leona 690 put `sanitizeMathHtml` here on the owner's ruling (ai-ops 138).
  // Every page that renders MathText then returned HTTP 500 on production —
  // `/repository/<slug>` and `/repository/layers/*`, six slugs checked — while
  // `/`, `/repository` and `/repository/papers`, which render no mathematics,
  // stayed 200. leona 693 withdrew the call to restore service and wrote down
  // that it *"did NOT reproduce locally, which is the part worth recording"*,
  // attributing the difference to Vercel tracing files differently.
  //
  // It reproduces locally in one command, once you know which one:
  //
  //     node --no-experimental-require-module -e 'require("isomorphic-dompurify")'
  //
  // Vercel runs every function with that flag. jsdom 27+ then cannot load at
  // all, whatever Node version the project selects. `lib/sanitize-math.ts` and
  // `pnpm-workspace.yaml` carry the measurement; `lib/sanitize-math-runtime.test.ts`
  // runs that command in CI so the next regression is a red test and not a
  // production 500.
  const html = sanitizeMathHtml(
    katex.renderToString(tex, {
      throwOnError: false,
      displayMode: false,
      output: "htmlAndMathml",
    }),
  );
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
            // KaTeX's own output, sanitized and memoized — see `typeset` above.
            //
            // This is the sink, and it now has three things holding it up rather
            // than two. The two that were always here: the input is corpus prose
            // authored in this repository and gated by `check-math.mjs`, so no
            // visitor can reach it, and KaTeX defaults to `trust: false`, which
            // refuses `\href{javascript:…}` and escapes raw HTML. The third is
            // `sanitizeMathHtml`, wired in on the owner's ruling (ai-ops 138)
            // precisely so the sink does not depend on a third-party default
            // staying what it is today, or on the input staying repo-authored.
            //
            // The first two are arguments about the input. Only the third is a
            // check on the output, which is why it is the one that survives if
            // either argument stops being true.
            dangerouslySetInnerHTML={{ __html: typeset(segment.value) }}
          />
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}
