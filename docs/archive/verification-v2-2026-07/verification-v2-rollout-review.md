> **ARCHIVED 2026-08-04.** a release-candidate check record for the verification-v2 design that ADR-0023 superseded.
> Retained for history; do not treat as current.

# Verification v2 rollout review

Date: 2026-07-23
Branch: `feature/remove-parent-verification-reference`
Contract version: `2.3.0`
Migration range: `0026` through `0033` (compatibility base: `0025`)

This document records the Step 14 release-candidate checks. It is not deployment
approval. No protected-branch push, merge, deployment, public action, paid sandbox,
live LLM call, or external database action was performed.

## Migration proof

The full cycle ran on local disposable PostgreSQL 17 database
`majorana_step14_full_audit_20260723_01`.

| Point | Alembic head | Run rows | `runs.verification_summary` | Evidence |
|---|---:|---:|---|---|
| Previous head | `0025` | 1 | absent | legacy PASS row readable; Verification v2 tables absent |
| New head | `0033` | 1 | present | legacy row backfilled as `NULL`; three Verification v2 tables present |
| New record exercise | `0033` | 2 | present | legacy row plus typed INCONCLUSIVE row readable |
| Guard exercise | `0033` | 2 | present | downgrade rejected while a typed summary existed |
| Downgrade | `0025` | 1 | absent | legacy PASS row remained readable after removing only the disposable incompatible row |
| Final upgrade | `0033` | 1 | present | legacy row remained readable and summary remained `NULL`; three Verification v2 tables restored |

The guarded downgrade exited 1 with
`cannot downgrade 0033: typed run verification summaries exist`. This is the intended
fail-closed behavior. The compatibility cycle then removed only the disposable new row,
downgraded, and upgraded again.

Schema checks counted 58 information-schema constraints across the relevant tables at
`0025`, 126 at `0033`, 58 after downgrade, and 126 after the final upgrade. The three
Verification v2 tables (`run_plans`, `candidate_semantic_reviews`, and
`candidate_verification_attempts`) followed the expected `0 -> 3 -> 0 -> 3` sequence.
These counts intentionally differ because migrations `0026` through `0033` add the new
tables, relationships, checks, and typed run summary.

The disposable database is retained only through the independent audit so the auditor
can inspect it. It must be dropped after approval.

## Security invariants

- Every Vercel sandbox creation uses `network_policy="deny-all"`; the provider creation
  spec also fixes `env={}`. The local subprocess remains a development/test double and
  is rejected in production, Vercel, and CI environments.
- No credential field exists in `ExecutionSpec`, sandbox result/event contracts, or
  verification client DTOs. The sandbox provider reads credentials only in the control
  plane and never forwards them into generated execution.
- Import-linter kept all three architecture contracts. API and Worker remain the only
  DB-connected processes, and raw-query scanning was clean.
- Repository mutation scope, public artifact gates, and source/execution/review/strict/
  artifact fingerprint equality are covered by the full Python suite.
- INCONCLUSIVE, unknown, stale, failed, structural-only PASS, imported, and fingerprint-
  mismatched artifacts cannot become public or display as Verified.
- Strict policy, thresholds, evidence classification, and trusted observer setup remain
  provider-owned code. Generated source is data to the sandbox and cannot modify them.
- Optional QASM conversion remains verdict-neutral and outside the correctness path.

## Rollout and rollback

Legacy artifacts keep `verification_summary=NULL`. API resources return no typed summary,
and web surfaces render `Legacy evidence unknown`; absence never becomes PASS.

New INCONCLUSIVE materialization is guarded by the server-side environment flag
`MAJORANA_INCONCLUSIVE_MATERIALIZATION_ENABLED`. It defaults off. Enable it only after
owner/CODEOWNER review and alert configuration. Turning it off stops new private
INCONCLUSIVE artifact writes before any repository mutation. Existing INCONCLUSIVE
artifacts continue to show their persistent warning; hiding an existing trust state is
not a safe UI rollback.

The worker exports these OpenTelemetry counters:

- `majorana.verification.decisions`, attributed by PASS/FAIL/INCONCLUSIVE;
- `majorana.verification.routes`, attributed by closed decision, route, and failure-
  class buckets; unknown values collapse to `unknown`/`other`;
- `majorana.verification.errors`, attributed by a closed route bucket;
- `majorana.verification.fingerprint_mismatches`, attributed by binding boundary.

Before enabling the flag, operations must create alerts for any fingerprint mismatch and
for a sustained verifier-error ratio above the owner-approved threshold. Alert creation is
a deployment mutation and was not authorized in this task.

These counters are operational signals, not an audit or billing ledger. Durable terminal
rows and append-only events remain authoritative; a process crash after the database write
but before the in-process counter update can undercount.

Rollback order is: disable the materialization flag, roll back application revisions, and
leave additive schema `0033` in place while any typed summary rows exist. Migration `0033`
deliberately refuses a destructive downgrade; downgrade is permitted only after an
owner-approved compatibility cleanup proves there are no typed summaries.

## Local verification results

- Python: `837 passed, 67 skipped, 4 warnings`.
- TypeScript Turbo: `6 successful, 6 total`.
- UI visual/a11y: `29 passed`.
- Ruff check: passed.
- Ruff format: `223 files already formatted`.
- Import-linter: `3 kept, 0 broken`.
- Raw-query gate: clean.
- OpenAPI freshness: current.
- Generated TypeScript contract: byte-for-byte current.
- `git diff --check`: passed.

Live-provider harness, external Neon suites, real Vercel sandbox egress canary, and paid
LLM/QPU runs were not run because they require explicit owner approval and credentials.
