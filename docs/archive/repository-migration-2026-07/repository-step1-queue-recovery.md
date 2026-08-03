> **ARCHIVED 2026-08-04.** shipped as migrations `0012_job_leases` and `0017_dead_letter_delivery_claims` (ADR-0021).
> Retained for history; do not treat as current.

# Quantum Repository Step 1 - durable queue recovery report

Status: implemented on `feature/repository`; owner/CODEOWNER review and live Neon
migration gate pending  
Scope: shared Postgres job queue reliability only  
Catalog schema/import/data changes: none

## 1. Safety invariants

- A claimed job receives a random `lease_token`; heartbeat and terminal updates
  require the same token.
- A Worker whose lease expires cannot finish, retry, or overwrite a replacement
  Worker.
- Heartbeat uses a separate short database session and stops the handler before
  the locally known lease expires when renewal is unavailable.
- Expired jobs requeue only while `attempts < max_attempts`; exhausted jobs become
  `dead`.
- Only `RetryableJobError` requests a retry. Unknown exceptions remain terminal
  `failed` outcomes rather than looping unexpectedly.
- Unknown job kinds fail closed as `dead`.
- Dead-letter callbacks are at-least-once and must be idempotent. Delivery is
  attempted at most five times; an exhausted callback is terminally marked with
  its final error so it cannot retry forever. The existing
  `run.execute` callback uses deterministic event IDs and closes an active Run as
  failed.
- Historical terminal jobs are marked delivered by the migration so deployment
  cannot replay old dead-letter callbacks.

## 2. Additive schema

Migration `0012_job_leases.py` adds:

```text
lease_token
lease_expires_at
last_heartbeat_at
max_attempts
last_error_kind
dead_lettered_at
dead_letter_error
dead_letter_attempts
```

It also adds lease-shape and retry-budget checks plus partial indexes for expired
running jobs and pending dead letters. No existing status enum value changes.

## 3. State behavior

```text
queued
  -> running (new token, attempt + 1, lease deadline)
  -> running (heartbeat extends the same token)
  -> done
  -> failed (unclassified/permanent handler error)
  -> queued with run_after (explicit retryable error or expired lease)
  -> dead (unknown kind or exhausted attempt budget)
```

Terminal `failed` and `dead` rows remain inspectable. A separate idempotent callback
closes related domain state and records `dead_lettered_at`; callback errors remain
pending with a delayed retry until the five-attempt budget is exhausted. Normal jobs
run first and only one dead-letter callback follows per poll cycle, so terminal
notification cannot monopolize the Worker.

Before callback I/O, a Worker now reserves one terminal row with
`FOR UPDATE SKIP LOCKED`, stores a dedicated random delivery token and expiry, and
commits that short transaction. Completion/retry updates require the same unexpired
token. Other Workers skip the reservation, while a crash makes it reclaimable after
expiry. The ordinary job lease fields remain separate and retain their original
running-job-only constraint.

Ordinary job completion and retry now also require the matching lease to be unexpired
according to PostgreSQL `now()` at the write. A late Worker loses the result even when
no replacement has claimed it yet; stale recovery owns the durable outcome. Dead Letter
Run closure is narrower than normal SSE delivery: it locks the scoped Run and commits
`run.error`, `run.finished`, and `FAILED` together, so cancellation or another callback
cannot expose a contradictory terminal sequence.

## 4. Configuration and telemetry

| Environment variable | Default | Constraint |
|---|---:|---|
| `WORKER_JOB_LEASE_S` | 120 | positive, at most 3600 in repository validation |
| `WORKER_JOB_HEARTBEAT_S` | 30 or lease/3 | positive and less than lease |
| `WORKER_RETRY_BASE_S` | 5 | positive and not greater than max |
| `WORKER_RETRY_MAX_S` | 300 | positive |
| `WORKER_DEAD_LETTER_TIMEOUT_S` | 30 | positive; one callback runs per poll cycle |
| `WORKER_DEAD_LETTER_LEASE_S` | max(45, timeout + 15) | positive and greater than callback timeout |

OTLP telemetry records claims, queue age, attempt count, requeues by reason,
terminal outcomes, and lease loss. With no OTLP endpoint the instruments remain
safe no-ops and local/CI behavior does not require observability credentials.

## 5. Deployment and rollback

Deployment order:

1. stop or drain old Workers;
2. run migration 0012 through the direct Neon migration connection;
3. deploy API and Worker from the same reviewed revision;
4. confirm heartbeat, queue-age, requeue, terminal, and lease-loss telemetry;
5. inject one controlled Worker interruption and prove recovery before importer work.

Migration `0017` adds only the dedicated Dead Letter delivery reservation columns,
shape constraint, and pending-delivery index. Deploying it follows the same drain,
direct-migration, paired API/Worker rollout, and recovery-injection sequence above.

Rollback order:

1. stop/drain Workers and stop new job creation;
2. inspect running and pending dead-letter rows;
3. downgrade 0012 only after no new Worker is using fenced lease fields;
4. deploy the previous API/Worker revision together;
5. verify queued Runs and jobs reconcile before reopening traffic.

To roll back `0017` to `0016`, first drain all Workers and wait for or inspect every
active Dead Letter reservation. Never remove the reservation columns while a callback
from the newer Worker revision is still running.

Do not run an old Worker concurrently with the new schema behavior during migration
or rollback.

## 6. Verification evidence

Executed locally through the existing `.venv` fallback rather than the required `uv run`
entry point:

- Ruff formatting and checks over all changed Python files: passed;
- queue repository and migration tests: 8 passed;
- focused Worker queue/handler tests: 6 passed;
- complete `services/api/tests` plus `services/worker/tests`: 90 passed, 9 skipped;
- import-linter: 3 contracts kept, 0 broken;
- raw-query guard: clean;
- repository catalog validator: 285 entries valid;
- OTLP metric exporter and Worker queue imports: passed.

Not executed locally:

- live Neon `upgrade -> downgrade -> upgrade`;
- live database pipeline E2E and live LLM tests represented by the skipped tests;
- contention benchmark B-Q3.

These remained required CI/review gates at the time of this Step 1 report. The required
`uv run pytest`, `uv run ruff check .`, and `uv run ruff format --check .` commands were
not executed in that session: `packages/py/baselines` matched the workspace glob but had
no `pyproject.toml`. The recorded results above came from the existing `.venv` with
explicit package source paths and must not be read as successful `uv run` results.

## 7. Exit state

The former Step 2 prerequisite was subsequently satisfied for continued branch
development. Production merge and deployment remain blocked on Ryu/Eshaan/CODEOWNER
review and the required migration, pipeline, and operational checks.
