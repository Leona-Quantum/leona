// Deploy-environment seam (GCP migration spike, ai-ops gcp-migration-20260912
// PLAN.md, "Every Vercel dependency" table, the VERCEL_ENV row). Cloud Run has
// no platform-set deploy-stage variable the way Vercel's `VERCEL_ENV` was, so
// deploy-web.yml sets `LEONA_DEPLOY_ENV` explicitly — "production" | "preview"
// | "development" — as a plain env var on the service/revision, and
// cloudbuild.web.yaml passes the same value as a build arg, since the CSP and
// every `NEXT_PUBLIC_*` value are baked in at build time, not read at request
// time.
//
// Every reader in this codebase branches through `deployEnv()` below, which
// reads `LEONA_DEPLOY_ENV` alone. Until Vercel was retired as a host
// (ADR-0033, 2026-09-21) this module also fell back to Vercel's own
// `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA` / `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`,
// so behaviour stayed byte-for-byte unchanged while Vercel still built and
// served the site. Cloud Run is now the only host, so those fallbacks are
// gone and each function below reads exactly one variable.
//
// This module does not interpret `NODE_ENV`. A caller that also falls back to
// `NODE_ENV === "development"` for a bare local `next dev` (which sets no
// platform variable at all) keeps doing that itself, unchanged — see
// lib/lab-direction.ts.
//
// Every caller compares the result with `===` against one known string
// ("preview", "development", …). That is what makes the whole seam fail
// CLOSED for free: an unset var, a typo, or an unrecognised stage name all
// come back not-equal-to anything on the allowlist, so a widening feature
// (/lab, the public-demo showcase) stays off rather than turning on by
// accident. See the individual doc comments this module's callers already
// carry (lib/lab-direction.ts, lib/public-demo.ts) for why each one is
// written as an allowlist rather than a "not production" negation.

/** Raw resolved value of `LEONA_DEPLOY_ENV`, or undefined when unset. */
export function deployEnv(): string | undefined {
  return process.env.LEONA_DEPLOY_ENV;
}

/**
 * Release identifier for Sentry (instrumentation.ts): `LEONA_GIT_COMMIT_SHA`,
 * set as both a build arg and a runtime env var by cloudbuild.web.yaml and
 * deploy-web.yml. Undefined when unset (local dev, an untagged build); Sentry
 * treats an undefined `release` as "no release" rather than an error.
 */
export function releaseSha(): string | undefined {
  return process.env.LEONA_GIT_COMMIT_SHA;
}

/**
 * Client-bundle mirror of `releaseSha()`, for `instrumentation-client.ts`.
 * `NEXT_PUBLIC_*` vars are inlined into the browser bundle at build time, so
 * this needs its own `NEXT_PUBLIC_`-prefixed name rather than reusing
 * `releaseSha()`'s (server-only) one.
 */
export function publicReleaseSha(): string | undefined {
  return process.env.NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA;
}
