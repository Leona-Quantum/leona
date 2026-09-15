// Browser-side Sentry (errors only at this stage). NEXT_PUBLIC_SENTRY_DSN is a
// client key, not a secret; unset → no-op (AD-10 env gating).
import * as Sentry from "@sentry/nextjs";
import { publicReleaseSha } from "./lib/deploy-env.ts";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_MAJORANA_ENV ?? "dev",
    tracesSampleRate: 0,
    // Client-bundle mirror of instrumentation.ts's `release`, via
    // publicReleaseSha() (lib/deploy-env.ts): NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA
    // first, then NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA. The Vercel var is only
    // populated when the project's "Automatically expose System Environment
    // Variables" setting is on; undefined otherwise, which Sentry treats as no
    // release — unchanged from before this seam existed.
    release: publicReleaseSha(),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
