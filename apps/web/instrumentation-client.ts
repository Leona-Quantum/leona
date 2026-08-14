// Browser-side Sentry (errors only at this stage). NEXT_PUBLIC_SENTRY_DSN is a
// client key, not a secret; unset → no-op (AD-10 env gating).
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_MAJORANA_ENV ?? "dev",
    tracesSampleRate: 0,
    // Client-bundle mirror of instrumentation.ts's `release`. Only populated
    // when the project's "Automatically expose System Environment Variables"
    // setting is on; undefined otherwise, which Sentry treats as no release.
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
