# ADR-0010: Observability = OpenTelemetry once, exported twice

**Date:** 2026-07-09 · **Status:** accepted
**Context:** Need errors + metrics/logs/traces at $0, without instrumenting twice or
locking into one vendor's SDK.
**Decision:** Instrument with OTel only: `@vercel/otel` + `instrumentation.ts` (web) and
`opentelemetry-instrumentation-fastapi` (api). Export to Sentry (errors, free dev tier)
and Grafana Cloud free (metrics/logs/traces/uptime/k6), hard-capped at $0. Skip Highlight
(LaunchDarkly acquisition, stalled).
**Consequences:** Buys vendor portability (exporters are config) and a $0 bill. Costs:
two dashboards. Reversal trigger: logs outgrowing Grafana's 50 GB/mo → add Axiom for
logs only.
