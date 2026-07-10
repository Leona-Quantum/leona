// Browser-side Sentry (errors only at this stage). NEXT_PUBLIC_SENTRY_DSN is a
// client key, not a secret; unset → no-op (AD-10 env gating).
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_MAJORANA_ENV ?? "dev",
    tracesSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
