// AD-10: OTel once, exported twice — Sentry for errors, OTLP for traces
// (Grafana Cloud). Env-gated: with no SENTRY_DSN / OTEL_EXPORTER_OTLP_ENDPOINT
// set, local dev and CI run with zero observability config.
import * as Sentry from "@sentry/nextjs";
import { releaseSha } from "./lib/deploy-env.ts";

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
      // releaseSha() (lib/deploy-env.ts) reads LEONA_GIT_COMMIT_SHA (set as a
      // build arg on Cloud Run) first, then VERCEL_GIT_COMMIT_SHA — a Vercel
      // System Environment Variable, always present on a Vercel deploy, absent
      // (and harmless as undefined) in local dev/CI. Ties an event to the
      // exact commit it came from.
      release: releaseSha(),
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
