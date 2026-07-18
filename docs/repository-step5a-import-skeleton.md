# Repository Step 5a — durable import pipeline (local fixture provider only)

Date: 2026-07-18
Branch: `feature/repository`
State: implementation and local up→down→up validation complete; CODEOWNER review pending

## User outcome

Content can now move through a durable, resumable, item-independent import pipeline
into Step 3's private staging path — but only from a controlled local/file fixture
source, never the open network. This proves the batch/item state machine, the
crash-recovery model, and the failure-code taxonomy before any real ingestion source
(and its much larger security surface) is wired in.

## Implemented

- Migration `0016`: `import_jobs` (one row per batch — provider, upstream ref,
  idempotency key, unique job counts) and `import_items` (one row per item —
  `upstream_identity` unique per job, `state`, `failure_code`, `source_blob_sha256`,
  `resulting_artifact_id`/`resulting_version_id` FKs, bounded `attempts`/`max_attempts`).
  Both CHECK-constrained to closed enums; fail-closed downgrade guard.
- `majorana_contracts`: `ImportProvider` (`local_fixture` only — no network provider
  exists yet), `ImportJobStatus`, `ImportItemState`, and
  `assert_import_item_transition` with a `_IMPORT_ITEM_LEGAL` table:
  `queued → fetching → quarantined → parsing → staged`, with `rejected` reachable only
  from `fetching`/`parsing` and bounded retry via `retry_wait ↔ {queued, dead}`.
  "Quarantined" here means *raw bytes durably stored awaiting parse* — a different sense
  from Step 4's legal-hold quarantine of a `review_state`.
- `catalog_import_fixtures.py` (pure, no DB import): `list_fixture_identities` (flat,
  non-recursive, symlinks excluded, capped at `MAX_FIXTURE_COUNT`) and
  `read_fixture_bytes` (capped at `MAX_FIXTURE_BYTES = 64 KiB`). This is the *entire*
  provider surface for this slice — no URL fetching, no SSRF exposure.
- `repos/catalog_import.py`:
  - `create_import_job` — idempotent on `idempotency_key`; lists fixture identities and
    creates one `queued` `ImportItem` per identity.
  - `process_import_batch` — advances every non-terminal item by one attempt; safe to
    call repeatedly, including after a crash mid-batch. Each item commits or rolls back
    **independently**: a duplicate-hash rejection on item 2 never undoes item 1's
    already-committed `STAGED` outcome.
  - `_advance_item` — walks one item through fetch → quarantine → parse → stage,
    deterministically rejecting with a stable `failure_code` (`oversized`, `unreadable`,
    `malformed_encoding`, `empty_content`, `duplicate_source`) or reusing Step 3's
    `stage_artifact`/`stage_artifact_version` on success. `execution_state` stays
    `template_only` — this slice validates structure, it does not execute or
    framework-parse content, and `authoritative_framework_version="unknown"` is an
    honest placeholder rather than a guessed real version.
- Worker: `handle_catalog_import` registered under `CATALOG_IMPORT_JOB_KIND` in
  `HANDLERS`, resolving the job by idempotency key and delegating to
  `process_import_batch` with the importer scope from `CatalogAuthority.from_env()`.
- Controlled test fixtures under `services/api/tests/fixtures/catalog_import/`: two
  distinct valid circuits, an oversized/empty/malformed-UTF-8 adversarial set, and a
  byte-identical duplicate pair — all local files, no network fixtures.

## Two implementation bugs found and fixed during live-DB validation

Both were caught by the live suite, not the unit suite, because they only manifest with
a real transactional rollback:

1. **Decode failures raised from the wrong state.** `_advance_item` checked
   `decode`/empty-content *before* transitioning `quarantined → parsing`, so those two
   failure codes tried to reject from `quarantined` — a state the legal-transition table
   does not allow rejecting from (only `fetching`/`parsing` can reach `rejected`).
   Fixed by moving the `quarantined → parsing` transition ahead of the content checks,
   matching the model's intent: parsing *is* the step of interpreting the quarantined
   bytes.
2. **Rollback expires in-flight state, silently.** `catalog.stage_artifact_version`
   rolls back its own transaction internally on a duplicate-hash conflict — a Step 3
   behavior reused here unchanged. In an async SQLAlchemy session, a rollback expires
   *every* object still attached to that session, including the item currently being
   rejected, any not-yet-processed sibling items already loaded from an earlier query,
   and the `import_job` row itself. Reading an expired attribute outside an awaited call
   raises `MissingGreenlet` rather than silently reloading. Fixed by: tracking each
   item's furthest-reached state as a plain local variable inside `_advance_item`
   (tagged onto any exception that escapes, so the caller never re-reads a possibly
   expired `item.state`); re-fetching each item fresh via an awaited `session.get()` at
   the top of every loop iteration instead of reusing objects from the pre-loop batch
   query; and using the plain `import_job_id` UUID parameter instead of `import_job.id`
   for the parts of the loop that run after the first possible rollback.

## Deferred deliberately (Step 5b — separate scoping checkpoint before starting)

- a real network fetcher (MQT Bench, QASMBench, or any HTTP source), SSRF hardening,
  archive-bomb protection, and adversarial *network* fixtures;
- the 285-record bootstrap import itself (this slice only proves the pipeline machinery
  with throwaway test content);
- any public route, review/publish transition, or web surface (Step 6+).

Step 5b has a materially larger security surface (outbound network access from a
server-owned identity) than everything shipped so far in this plan and needs its own
explicit go-ahead, not an implicit continuation of Step 5a.

## Local validation (no Neon touched)

Reused the throwaway-local-Postgres-14 pattern from Steps 3/4 (fresh cluster, UTF8,
short-path unix socket, stopped and deleted after):

- `alembic upgrade head` reached `0016` cleanly from `0015`;
- full `downgrade 0015` → `upgrade head` round trip passed on empty tables;
- downgrade fail-closed guard verified directly against real staged data (26
  `import_items` rows): `alembic downgrade 0015` raised
  `cannot downgrade 0016 while import job/item rows exist` (data truncated afterward for
  the clean round trip above);
- live-DB suite (`test_catalog_import_live.py`, 6 tests, `requires_db`-gated) passed
  twice in a row against the same database:
  - both valid fixtures stage and stay `draft`/`private`/private-visibility;
  - a byte-identical pair yields exactly one `staged` and one `rejected` with
    `failure_code="duplicate_source"`, and the rejected item has no resulting artifact;
  - oversized/empty/malformed-UTF-8 fixtures each fail with their specific,
    distinguishable failure code and no resulting artifact;
  - retrying an already-completed batch creates no duplicate version (same
    `resulting_version_id`, same total `ArtifactVersion` count before and after);
  - simulating a crash (one item finished and committed, the other still `queued`) and
    resuming with a fresh `process_import_batch` call only touches the untouched item and
    leaves the already-staged one alone.
  - Note: fixture-staging tests copy their source fixtures into a per-test `tmp_path`
    with a unique marker appended (`_unique_copy`) before staging, so repeated test runs
    never collide with a *previous run's* already-committed `normalized_source_hash` on
    Step 3's global duplicate constraint — the adversarial-set test does **not** do this,
    since none of its fixtures ever reach the hashing/staging step.
- full local suite: 209 passed / 1 skipped (DB present); 185 passed / 25 skipped (no
  `DATABASE_URL`);
- Ruff check/format: passed; import-linter: 3 kept, 0 broken; raw-query gate: clean;
  `python -m majorana_contracts.export --check`: `openapi.json` unchanged (no route or
  response-model field touched).

## Neon gate

Not yet run for this step — pending a fresh temporary Neon branch (Steps 3/4's gate
branch is not reused; each gate slice gets its own).

## Required gate

CODEOWNER review remains required before any Step 5b scoping discussion for the
migration, contracts, and repository-layer changes. `SYSTEM_CATALOG_ENABLED` stays
`false`; no public catalog data exists; nothing in this step ever touches the network.
