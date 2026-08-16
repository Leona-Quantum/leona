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
  vercelToolbar,
}: {
  controlPlane: string;
  development: boolean;
  /**
   * Whether to admit the Vercel Toolbar's six origins. True on preview
   * deployments, false on production.
   *
   * Next bundles a loader for the toolbar into the client on every deployment,
   * production included. It is gated on a cookie, so it is inert for a visitor:
   *
   *     if (/(?:^|;\s)__vercel_toolbar=1(?:;|$)/.test(document.cookie)) { ... }
   *
   * For anyone holding `__vercel_toolbar=1` it appends a `vercel.live` script
   * tag, this policy refuses it, and the refusal is logged on every page. That
   * is what the owner was seeing on production and reported as a site bug
   * (ai-ops issue 116 — numbered without a hash on purpose, because
   * `check-raw-hex` reads a three-digit hash-number as a CSS colour and fails
   * lint on it). It is not one — an anonymous load of leonaqt.com requests no
   * `vercel.live` at all, checked before this was written — but a console that
   * cries wolf on every navigation is how a real error goes unread.
   *
   * The toolbar needs SIX directives widened, not one: `script-src`,
   * `connect-src` (including a `wss://` to Pusher), `img-src`, `frame-src`,
   * `style-src` and `font-src`. That is the whole reason this is keyed on the
   * environment rather than granted everywhere. On a preview deployment the
   * toolbar is the point — it is how a change gets commented on before it
   * ships — and the blast radius is a URL nobody but us opens. On production it
   * would buy one developer a convenience in exchange for letting a third-party
   * origin execute script, frame, and open a socket on the page every visitor
   * loads. `frame-ancestors 'none'` is untouched either way.
   *
   * Production consequence, stated so it is not a surprise: the toolbar cannot
   * work on leonaqt.com under this policy. Clearing the `__vercel_toolbar=1`
   * cookie for the domain silences the message at the source.
   */
  vercelToolbar: boolean;
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
}): string {
  const controlPlaneIsHttp = controlPlane.startsWith("http://");
  // Exactly the origins vercel.com/docs/vercel-toolbar/managing-toolbar lists,
  // per directive. Empty on production, which is what keeps the arrays below
  // byte-identical to the policy that shipped before this parameter existed.
  const toolbar = (...origins: string[]) => (vercelToolbar ? origins : []);
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
    ...toolbar("https://vercel.live"),
  ];
  const connectSources = [
    "'self'",
    controlPlane,
    ...(errorReporting ? [errorReporting] : []),
    ...toolbar("https://vercel.live", "wss://ws-us3.pusher.com"),
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
    `style-src ${["'self'", "'unsafe-inline'", ...toolbar("https://vercel.live")].join(" ")}`,
    // Inline `<style>` ELEMENTS, named by hash instead of admitted wholesale.
    //
    // This application serves exactly one, the 404 page's language-switching
    // CSS, so the hash is a complete list rather than a sample. Anything else
    // that reaches the document as a `<style>` element — an injected one — is
    // refused. `lib/html-injection-surface.test.ts` is what stops a second one
    // being added without this list being updated: it counts the sinks.
    //
    // Development keeps `'unsafe-inline'` because the dev server injects
    // stylesheets as `<style>` elements for hot reload and for the error
    // overlay, both of which are unhashable and neither of which exists in a
    // production build. Note it drops the HASH to do that, which is not a
    // tidiness choice: **`'unsafe-inline'` is ignored in any directive that also
    // carries a hash or a nonce.** Listing both is therefore not "permissive
    // with a hash for good measure" — the hash silently wins and every other
    // inline stylesheet is refused.
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
      ...toolbar("https://vercel.live"),
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
    `img-src ${["'self'", "data:", "blob:", ...toolbar("https://vercel.live", "https://vercel.com")].join(" ")}`,
    `font-src ${["'self'", "data:", ...toolbar("https://vercel.live", "https://assets.vercel.com")].join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    // Only ever emitted for the toolbar. Absent on production, where `frame-src`
    // falls back to `default-src 'self'` exactly as it did before.
    ...toolbar("frame-src https://vercel.live"),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
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
