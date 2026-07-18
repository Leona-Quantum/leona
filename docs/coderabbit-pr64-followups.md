# PR #64 CodeRabbit review disposition

Date: 2026-07-18  
Branch: `feature/repository`  
Scope: PR #64 review fixes only; no Step 5b network importer or public catalog

## Fixed in this branch

| Finding | Resolution | Commit |
|---|---|---|
| New content could retain `pending_review` | Reset to `draft`; quarantine remains a legal hold | `117e878` |
| Unknown license could be approved without SPDX ID | Require a concrete resolved ID | `117e878` |
| An idempotency key could name a different request or race | Compare request fields; recover the unique race | `cc334dc` |
| Hanging heartbeat I/O could outlive the lease | Bound I/O by the remaining lease budget | `f38c0c4` |
| CI seed used a direct application URL and bypass | Use pooled seed URL and enforce pooling in CI | `a3681f4` |
| Artifact review omitted the human actor | Append an audit row in the review transaction | `bf60cd2` |
| Concurrent version allocation could choose one sequence | Lock the artifact row before allocation | `8bc2a59` |
| Dead-letter callback could retry forever | Abandon terminally after five failed deliveries | `2dfe5d8` |
| Dead-letter batch could delay normal claims | Run a normal job first, then one callback | `2dfe5d8` |
| DB boundary docs named only FastAPI | State API + Worker processes, one repository layer | `fb1e154` |

## Intentional scoped exceptions

- `repos/system.py` is the single no-`Scope` repository surface. It contains only
  identity bootstrap that must run before a Scope exists and workspace-neutral durable
  job control. It is not a tenant-data request path.
- `ImportJob` has no `workspace_id` because one server-configured system catalog exists
  per database. Human/importer entry points validate that fixed catalog Scope first;
  the unscoped idempotency lookup is Worker-internal. Multiple catalogs would require a
  new workspace FK, scoped queries, migration, and leakage matrix before support.

## Deferred as separate reviewed slices

These proposals are valid, but changing them inside this review-fix series would alter
schema or transaction semantics beyond a safe patch:

1. **DB-enforced append-only license ledger.** The repository only appends today, but
   Postgres does not reject UPDATE/DELETE for `license_assertions`. Add a new reversible
   migration and live role/grant/trigger tests; never edit frozen migration `0015`.
2. **Fully atomic terminal event/state transition.** `RepoEventSink` intentionally commits
   events individually for durable SSE progress. This needs an ADR covering visibility
   versus atomicity, conditional terminal transitions, crash injection, and replay.
3. **Reject finish after wall-clock lease expiry.** Fenced tokens already prevent a
   replaced Worker from writing, and heartbeat now cancels before locally known expiry.
   Adding an expiry predicate may reject a legitimate completion before recovery; settle
   that availability/strictness trade-off in the queue ADR with live race tests.

No deferred item changes the present release gates: publication remains disabled,
imports remain private/staged, callback retries are bounded, and replacement Workers are
fenced.
