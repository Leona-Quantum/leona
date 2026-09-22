import { createHash } from "node:crypto";

import { NOT_FOUND_LOCALE_STYLE } from "./not-found-style.ts";

/**
 * A CSP `'sha256-…'` source for an inline element's exact body.
 *
 * `node:crypto` is safe to reach for here because this module has exactly one
 * importer, `next.config.ts`, which runs in Node at build time; nothing in this
 * file is bundled for a browser. If that ever stops being true the import is
 * what will say so, loudly, at build time rather than at runtime.
 *
 * The digest is over UTF-8 bytes, which is what the CSP specification requires
 * and what browsers hash. Getting the encoding wrong here would not fail the
 * build — it would produce a well-formed hash that simply never matches, and the
 * only symptom is the element silently not applying.
 */
export function inlineHash(body: string): string {
  return `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
}

export function contentSecurityPolicy({
  controlPlane,
  development,
  errorReporting,
  frameAncestors = "'none'",
}: {
  controlPlane: string;
  development: boolean;
  /**
   * The Sentry ingest origin, or null when no DSN is configured.
   *
   * `connect-src` is an allowlist, so the browser SDK's envelope POST to
   * `<org>.ingest.<region>.sentry.io` is refused unless that exact origin is
   * named here — with a console error, not a retry. Measured on production
   * 2026-08-15: every browser event since Sentry was wired was blocked, so the
   * web SDK reported nothing at all while the api and worker SDKs worked. An
   * empty Sentry project reads identically to a healthy one, which is why this
   * survived a release.
   *
   * Derived from the DSN rather than hardcoded: the origin changes if the
   * project is recreated in another region, and a stale literal here would fail
   * exactly the same silent way.
   */
  errorReporting: string | null;
  /**
   * The `frame-ancestors` directive's value, defaulted to `'none'` — no site
   * may frame this response. `/embed/q/[slug]` (ai-ops 355, owner ruling "Any
   * website may embed a published Qapp") is the one caller that passes
   * something else; `next.config.ts` is what scopes that override to the
   * embed route alone — see `lib/embed-routes.ts` for how, and why the plain
   * catch-all cannot simply be given a second, later value instead.
   */
  frameAncestors?: string;
}): string {
  const controlPlaneIsHttp = controlPlane.startsWith("http://");
  const scriptSources = [
    "'self'",
    // **`'unsafe-inline'` stays, and the reasoning is NOT restated here.** It is
    // already written out at length in `next.config.ts` (the file header, ~lines
    // 8-63), which is where the header is assembled — the unhashable per-page RSC
    // flight-data script, why a nonce means per-request rendering and would be
    // baked into the CDN-cached document, and the blunt conclusion that with
    // `'unsafe-inline'` present "this policy is NOT a general XSS defence".
    //
    // This comment deliberately does not duplicate that. Two copies of one
    // argument drift: somebody updates the file they are editing and the other
    // silently becomes the wrong answer, which is worse than having it in one
    // place. **What was genuinely missing was enforcement, not explanation** —
    // the reasoning existed only as prose, and prose does not fail a build.
    //
    // One measurement added here, with its provenance, because the count was the
    // part `next.config.ts` did not state: on **leonaqt.com `/` (the home page),
    // production build, 2026-08-17 JST / 2026-08-16 UTC**, the served HTML carries
    // **five** inline `<script>` elements with bodies — our three constants,
    // Next's `(self.__next_f=…)` bootstrap, and one streamed RSC payload of
    // **41,919 bytes**.
    //
    // `next.config.ts` cites the same script on **`/pricing` at 25,095 bytes**, and
    // the two figures do not conflict — **together they are the argument.** Same
    // script, two routes, a 16 KB difference: that is the per-page variance which
    // makes a build-time hash list impossible in principle rather than merely
    // laborious. Quote both, or neither, and always with the route attached; a
    // single number here reads as a fact about the app when it is a fact about one
    // page.
    //
    // The trap, which is what the test in `content-security-policy.test.ts`
    // actually guards: **the moment any hash appears in this directive,
    // `'unsafe-inline'` is IGNORED** — the same behaviour documented for
    // `style-src-elem` below, learned there from Chrome refusing the dev server's
    // stylesheet. So adding hashes for the four constant scripts does not tighten
    // this policy incrementally; it refuses React's hydration payload and serves a
    // blank page with a green build.
    //
    // Both premises the open directive rests on are asserted in
    // `lib/html-injection-surface.test.ts`: `react-markdown` runs without
    // `rehype-raw`, and `urlTransform` is not overridden — that prop is what keeps
    // a model's `[click](javascript:…)` from becoming a working script link, and
    // `javascript:` URLs are governed by `script-src`, so under `'unsafe-inline'`
    // such a link would execute. Revisit this whole decision if either breaks.
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = [
    "'self'",
    controlPlane,
    ...(errorReporting ? [errorReporting] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // Inline event handler attributes — `<img onerror=…>`, `<a onclick=…>` — the
    // single most common shape an injected XSS payload takes. React never emits
    // one: it attaches listeners from the bundle, so the served markup carries
    // zero of them. Measured rather than assumed — every `on…="…"` attribute in
    // every page of a production build was counted before this line was added,
    // and on the live site's `/`, `/pricing`, `/repository`,
    // `/repository/layers` and a 404. The count was zero.
    //
    // This is the one script directive that CAN be closed here, and it is worth
    // stating why it is not redundant next to `script-src 'unsafe-inline'`:
    // `script-src-attr` does not inherit from `script-src` when it is present,
    // so `'none'` here is enforced even though `script-src` is permissive. The
    // handler class is refused whatever `script-src` says.
    "script-src-attr 'none'",
    // Unchanged, and deliberately still carrying `'unsafe-inline'`.
    //
    // `style-src` is now only consulted by browsers too old to know
    // `style-src-elem`/`style-src-attr` (pre-Chrome 75, pre-Safari 15.4,
    // pre-Firefox 111). Those two shadow it completely everywhere else, so
    // tightening this line would change nothing for a current browser and would
    // break inline `style` attributes — which this app cannot do without — for
    // an old one. Leaving it as the pre-existing behaviour is the fail-open
    // direction on purpose: an old browser gets exactly today's policy, not a
    // broken page.
    `style-src ${["'self'", "'unsafe-inline'"].join(" ")}`,
    // Inline `<style>` ELEMENTS, named by hash instead of admitted wholesale.
    //
    // This application serves exactly one, the 404 page's language-switching
    // CSS, so the hash is a complete list rather than a sample. Anything else
    // that reaches the document as a `<style>` element — an injected one — is
    // refused. `lib/html-injection-surface.test.ts` is what stops a second one
    // being added without this list being updated: it counts the sinks.
    //
    // ## Production ALONE gets the hashed form
    //
    // The one exception is development: the dev server injects stylesheets as
    // `<style>` elements for hot reload and for the error overlay. Neither is
    // hashable and neither exists in a production build.
    //
    // Until 2026-09-21 there was a second exception, preview: Vercel injected
    // `vercel.live/_next-live/feedback/feedback.js` into every preview
    // deployment — the widget the owner reviewed a change with — and it wrote
    // its own inline stylesheets (measured, not predicted: the hashed form on
    // a preview of this very branch refused SIX of them on `/pricing` alone,
    // on a page with no toolbar cookie set). ADR-0033 retired Vercel as a
    // host; preview deployments no longer exist, so that exception is gone —
    // production and development are the only two arms this function has now.
    //
    // ## Why the exception DROPS the hash rather than adding to it
    //
    // Not tidiness: **`'unsafe-inline'` is ignored in any directive that also
    // carries a hash or a nonce.** `'self' <hash> 'unsafe-inline'` is therefore
    // not the permissive union it reads as — the hash silently wins and every
    // other inline stylesheet is refused anyway.
    //
    // That is not deduced from the specification, it is what happened: the first
    // version of this listed the hash and `'unsafe-inline'` together in
    // development, and Chrome refused the dev server's own stylesheet with
    // "Note that 'unsafe-inline' is ignored if either a hash or nonce value is
    // present in the source list". Production is unaffected — it has no
    // `'unsafe-inline'` in this directive for a hash to cancel.
    //
    // ## The one thing this knowingly breaks, and why it is accepted
    //
    // A production build emits a SECOND inline `<style>`, in Next's own
    // `_global-error.html` — the built-in error shell, carrying its
    // `--next-error-*` colour variables. It is not hashed here and it is
    // therefore refused. Counted, not guessed: a build of all 934 pages produced
    // exactly two distinct inline `<style>` bodies, that one and the 404's.
    //
    // It is left refused deliberately. The hash would be Next's, not ours, so it
    // would go stale on the next version bump with no test able to catch it —
    // and a stale hash behaves exactly like no hash, so pinning it buys one
    // release of correctness and then silently returns here. What it costs
    // meanwhile is cosmetic and bounded: that shell renders unstyled black-on-
    // white rather than themed, on a screen that only appears when the app has
    // already failed, and the branded page a reader actually gets in that case is
    // `app/global-error.tsx` — which styles itself entirely with inline `style`
    // ATTRIBUTES and system colour keywords, so it is unaffected by this
    // directive.
    `style-src-elem ${[
      "'self'",
      ...(development ? ["'unsafe-inline'"] : [inlineHash(NOT_FOUND_LOCALE_STYLE)]),
    ].join(" ")}`,
    // Inline `style` ATTRIBUTES, which stay open, stated explicitly rather than
    // inherited so that the split above is legible as a decision.
    //
    // There is no version of this app that closes it. 72 components position
    // themselves with `style={{…}}`, the Atlas map computes transforms per node
    // at render time, and KaTeX emits a `style` attribute on essentially every
    // glyph it lays out (see the math-text.tsx entry in
    // lib/html-injection-surface.test.ts). Hashing is not an escape either:
    // `'unsafe-hashes'` would need every distinct attribute VALUE enumerated,
    // and those values are computed from data.
    //
    // What that leaves open is CSS injection, not script execution — and the
    // usual exfiltration route out of injected CSS is already closed by the
    // other directives here, since `img-src` and `font-src` name no external
    // origin for a `url()` to smuggle a value to.
    "style-src-attr 'unsafe-inline'",
    `img-src ${["'self'", "data:", "blob:"].join(" ")}`,
    `font-src ${["'self'", "data:"].join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(controlPlaneIsHttp ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * The origin a Sentry DSN posts envelopes to, or null if there is no usable DSN.
 *
 * A DSN looks like `https://<key>@<org>.ingest.<region>.sentry.io/<project>`;
 * only its origin belongs in a CSP, never the key. Returns null rather than
 * throwing on a malformed value, because a bad DSN must not fail the build —
 * the SDK itself is already env-gated the same way.
 *
 * The origin must be `https:` and a `sentry.io` host. Without that check this
 * function turns a mis-set environment variable into a CSP hole: whatever host
 * someone typed becomes an allowed `connect-src` target, which is the exact
 * exfiltration path the directive exists to close. Narrowing here is safe in
 * the direction that matters — a rejected DSN loses error reporting, it does
 * not widen the policy.
 *
 * If Sentry is ever self-hosted, this is the line to widen, and it will fail
 * closed and silently until someone does. Raised by Sourcery on PR 628 —
 * numbered without a hash on purpose, because `check-raw-hex` reads a
 * three-digit hash-number as a CSS colour and fails lint on it.
 */
export function errorReportingOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const host = url.hostname;
    if (url.protocol !== "https:") return null;
    if (host !== "sentry.io" && !host.endsWith(".sentry.io")) return null;
    return url.origin;
  } catch {
    return null;
  }
}
