# AGENTS.md — services/worker

Job runner: same image as services/api, worker entrypoint. Claims jobs from the `jobs`
table via FOR UPDATE SKIP LOCKED; runs pipeline stages; writes run_events (append-only).
No HTTP surface. Poll `run_after`; no LISTEN/NOTIFY (pooled connections).
Contention budget: claim latency <100ms p95 @20 workers (bench B-Q3) — breach = queue ADR.

Deploy note: the Cloud Run service model requires accepting on $PORT, so the
worker runs a static-200 liveness listener there. That is a probe target, not
an API — the no-HTTP-surface rule above means no application endpoints.
