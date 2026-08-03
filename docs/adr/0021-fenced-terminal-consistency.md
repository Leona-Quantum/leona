# ADR-0021: Terminal queue writes are lease-fenced and Dead Letter closure is atomic

**Date:** 2026-07-19 · **Status:** implemented

> **Status corrected 2026-08-04.** Shipped as migration
> `0017_dead_letter_delivery_claims` together with the `lease_expires_at > now()`
> predicates on `finish_job` and `retry_job`, on top of `0012_job_leases`. It extends
> ADR-0007's Postgres queue rather than replacing it.

**Context:** A matching job token could previously write terminal state after its
database lease expired. Separately, Dead Letter handling committed `run.error`,
`run.finished`, and the Run's `FAILED` status independently. Cancellation, process
termination, or a competing callback could therefore expose a partial or contradictory
terminal sequence.

**Decision:** `finish_job` and `retry_job` require `lease_expires_at > now()` using the
database clock at every terminal update. Zero affected rows means lease loss, even when
no replacement Worker has claimed the job. Dead Letter Run closure locks the scoped Run,
conditionally accepts only `QUEUED` or `RUNNING`, appends deterministic `run.error` and
`run.finished` events, updates status and `finished_at`, and commits once. A concurrent
cancel or callback either wins the Run lock first or observes the resulting terminal
state and makes no conflicting write.

Normal progress events retain their existing per-event commits so SSE clients continue
to receive durable incremental progress. This ADR narrows atomic batching to the final
Dead Letter closure where partial visibility is invalid.

**Consequences:** A Worker that finishes just after expiry loses its result and recovery
owns the durable outcome. This intentionally chooses fencing correctness over accepting
late work. Deterministic event IDs make retries idempotent and allow the new closure to
repair a compatible partial sequence created by an older Worker. Live Postgres tests
must cover expired completion/retry, cancellation races, rollback on event failure, and
exactly one terminal event sequence.
