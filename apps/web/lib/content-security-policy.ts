export function contentSecurityPolicy({
  controlPlane,
  development,
  errorReporting,
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
}): string {
  const controlPlaneIsHttp = controlPlane.startsWith("http://");
  const scriptSources = [
    "'self'",
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
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
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
