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
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
