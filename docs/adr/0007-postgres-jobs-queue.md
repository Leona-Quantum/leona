# ADR-0007: Jobs/queue = Postgres, no Redis at MVP

**Date:** 2026-07-09 · **Status:** accepted
**Context:** Pipeline runs need durable, resumable background execution and a live UI
stream; a queue vendor or Redis would be a second stateful system before any measured
need.
**Decision:** A `jobs` table with `FOR UPDATE SKIP LOCKED` workers; the worker is a second
Cloud Run service off the same image. Runs stream via SSE from the control plane by
replaying `run_events`; state transitions are rows, so runs survive restarts and are
resumable.
**Consequences:** Buys durability and resumability with zero new infrastructure; the
event log doubles as audit trail and UI fixture source. Costs: Postgres contention at
high job throughput. Reversal trigger: benchmark B-Q3 shows measurable contention at
real jobs/sec — only then introduce Redis/queue vendor.
