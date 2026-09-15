// Deploy-environment seam (GCP migration spike, ai-ops gcp-migration-20260912
// PLAN.md, "Every Vercel dependency" table, the VERCEL_ENV row). On Vercel,
// `VERCEL_ENV` is a System Environment Variable the platform sets for us —
// "production" | "preview" | "development" ("development" only under
// `vercel dev`). Cloud Run has no such platform variable, so a Cloud Run
// deploy workflow is expected to set `LEONA_DEPLOY_ENV` instead, to the same
// three values, as a plain env var on the service/revision.
//
// Every reader in this codebase that used to branch on `VERCEL_ENV` now goes
// through `deployEnv()` below, which reads `LEONA_DEPLOY_ENV` FIRST and falls
// back to `VERCEL_ENV`. That ordering is what keeps Vercel's behaviour
// byte-for-byte unchanged: Vercel never sets `LEONA_DEPLOY_ENV`, so
// `deployEnv()` reduces to plain `VERCEL_ENV` there, exactly as before this
// module existed. On Cloud Run, `VERCEL_ENV` is never set, so
// `LEONA_DEPLOY_ENV` governs. If a future setup somehow sets both,
// `LEONA_DEPLOY_ENV` wins, as the more specific, deliberately-set signal.
//
// This module does not interpret `NODE_ENV`. A caller that also falls back to
// `NODE_ENV === "development"` for a bare local `next dev` (which sets neither
// platform variable) keeps doing that itself, unchanged — that fallback is
// reader-specific today (see lab-direction.ts vs. this file's own
// `vercelToolbarOrigins` below, which differ in exactly this respect) and
// flattening it into one shared rule would change behaviour, not just move it.
//
// Every caller compares the result with `===` against one known string
// ("preview", "development", …). That is what makes the whole seam fail
// CLOSED for free: an unset var, a typo, or a platform's own unrecognised name
// for a stage all come back not-equal-to anything on the allowlist, so a
// widening feature (the Vercel Toolbar's CSP allowance, /lab, the public-demo
// showcase) stays off rather than turning on by accident. See the individual
// doc comments this module's callers already carry (next.config.ts's
// `vercelToolbar`, lib/lab-direction.ts, lib/public-demo.ts) for why each one
// is written as an allowlist rather than a "not production" negation.

/** Raw resolved value: `LEONA_DEPLOY_ENV`, else `VERCEL_ENV`, else undefined. */
export function deployEnv(): string | undefined {
  return process.env.LEONA_DEPLOY_ENV ?? process.env.VERCEL_ENV;
}

/**
 * Release identifier for Sentry (instrumentation.ts). `LEONA_GIT_COMMIT_SHA`
 * first — set as a build arg by the Cloud Run image build — then Vercel's own
 * `VERCEL_GIT_COMMIT_SHA` System Environment Variable. Undefined when neither
 * is set (local dev, an untagged build), same as before this module existed:
 * Sentry treats an undefined `release` as "no release" rather than an error.
 */
export function releaseSha(): string | undefined {
  return process.env.LEONA_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
}

/**
 * Client-bundle mirror of `releaseSha()`, for `instrumentation-client.ts`.
 * `NEXT_PUBLIC_*` vars are inlined into the browser bundle at build time, so
 * this needs its own `NEXT_PUBLIC_`-prefixed pair rather than reusing
 * `releaseSha()`'s (server-only) names.
 */
export function publicReleaseSha(): string | undefined {
  return process.env.NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
}
