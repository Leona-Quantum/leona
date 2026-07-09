# AGENTS.md — services/worker

Job runner: same image as services/api, worker entrypoint. Claims jobs from the `jobs`
table via FOR UPDATE SKIP LOCKED; runs pipeline stages; writes run_events (append-only).
No HTTP surface. Poll `run_after`; no LISTEN/NOTIFY (pooled connections).
Contention budget: claim latency <100ms p95 @20 workers (bench B-Q3) — breach = queue ADR.
