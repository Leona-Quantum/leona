// AD-10: OTel once, exported twice — Sentry for errors, OTLP for traces
// (Grafana Cloud). Env-gated: with no SENTRY_DSN / OTEL_EXPORTER_OTLP_ENDPOINT
// set, local dev and CI run with zero observability config.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName: "majorana-web" });
  }
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.MAJORANA_ENV ?? "dev",
      tracesSampleRate: 0.1,
      // VERCEL_GIT_COMMIT_SHA is a Vercel System Environment Variable — always
      // present on a Vercel deploy, absent (and harmless as undefined) in
      // local dev/CI. Ties an event to the exact commit it came from.
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
