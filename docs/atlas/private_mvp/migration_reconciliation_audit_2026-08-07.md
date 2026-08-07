# Phase 11 migration reconciliation audit — 2026-08-07

## Classification

This is an engineering-correctness and private-schema compatibility audit.  It
is not a VQE performance result, an independent scientific review, or a public
release qualification.

## Detected failure

The first pushed Phase 11 candidate was commit
`d212177d041769673c2ea1f756082581b6e07066`.

| GitHub run | Observed result |
|---|---|
| [`ci` 30995152250](https://github.com/EshMis/majorana/actions/runs/30995152250) | TypeScript and authenticated browser jobs passed; Python stopped at the Phase 9 audit and DB stopped at migration graph construction |
| [`vqe-production-e2e` 30995152198](https://github.com/EshMis/majorana/actions/runs/30995152198) | stopped during migration, before private VQE execution |

The shared root cause was duplicate Alembic revision identifiers:

```text
dev: 0045 → 0046 → 0047
VQE: 0045 → 0046 → 0047 → 0048 → … → 0054
```

Alembic reported duplicate `0046`/`0047` revisions and multiple heads.  This is
a schema-history defect introduced by combining two independently linear
branches.  It is not evidence that the VQE energy, fidelity, controlled-swap
logic, or common resource protocol failed.

## Repair and compatibility contract

The first corrective design used numeric `0048` as a merge point. Before it was
pushed, current `dev` independently added `0048_additional_frameworks.py`.
Reusing a future numeric identifier would therefore reproduce the same defect.
The final corrected graph is:

```text
                     ┌→ 0046 → 0047 → 0048 ┐
0045 ────────────────┤                      ├→ vqe_merge_0055 → vqe_reconcile_0056
                     └→ vqe_0046 → … → vqe_0053 → 0054 ┘
```

- Numeric revision IDs remain owned by `dev`; VQE revisions use a `vqe_`
  namespace so later numeric dev migrations cannot collide again.
- Historical VQE `0054` remains addressable solely so private databases and
  immutable Phase 9 evidence created by the old graph can be reconciled.
- `vqe_merge_0055` is the explicit no-op Alembic merge point.
- `vqe_reconcile_0056` verifies and repairs the dev-side nullable columns,
  indexes, and additional-framework check constraints for a private database
  already stamped `0054` by the old feature-only graph.
- Catalog upstream identity is backfilled using the original official `0046`
  rule; duplicate identities fail closed before a unique index can be created.
- Existing columns, indexes, and constraints are verified against their expected
  shape rather than silently accepted by name. An unfamiliar constraint fails
  closed instead of being replaced.
- `vqe_reconcile_0056` downgrade is a no-op because both corrected branches are
  already ancestors of `vqe_merge_0055`. The original dev migrations own
  removal below the merge point.
- A repository-wide static graph test now rejects duplicate revision IDs,
  missing parents, or more than one current head before Alembic can reduce the
  collision to a warning.

## Evidence obtained before the corrective push

PostgreSQL 14 was used locally because the Docker PostgreSQL 17 daemon was not
available on the workstation.  PostgreSQL 17 remains a required remote CI gate
and is not inferred from the local result.

| Path | Result |
|---|---|
| empty database `base → head → base → head` | passed |
| current dev-side database `base → 0048 → head → 0048 → head` | passed |
| old feature-only migrations `base → old 0054`, then corrected graph `0054 → head` | passed |
| repaired legacy columns | `artifacts.upstream_identity`, `license_assertions.claim_hash`, `runs.idempotency_request_hash`: nullable text |
| repaired legacy indexes | `ux_artifacts_workspace_upstream_identity`, `ix_import_items_artifact_recency`: present |
| repaired legacy constraints | `ck_run_candidates_framework` includes Braket/Qibo/Qulacs; `ck_agent_steps_name` includes their simulation tools |
| namespace/repair unit tests after latest dev merge | 17 passed; no skipped test counted as evidence |
| current Alembic heads | exactly `vqe_reconcile_0056` |
| local database runtime | PostgreSQL 14.18; PostgreSQL 17 remains a remote gate |

## Validation after the latest dev merge

The following commands ran against the integrated working tree after the
namespace repair. Skips are reported but are not counted as successful evidence.

| Gate | Observed result |
|---|---|
| full Python regression | 2895 passed, 429 skipped |
| Ruff lint and formatting | passed across the repository |
| Web lint, typecheck, and unit tests | 693 passed, 0 skipped |
| Next.js production build | passed; 338 routes generated |
| authenticated VQE browser E2E | 5 passed |
| deterministic Private MVP offline gate | GO; 58 scientific/API and 26 Web proof tests passed |
| targeted PostgreSQL VQE live tests | 19 passed, 3 skipped |
| immutable Phase 9 release audit | internally consistent without rewriting historical evidence |

The earlier full-regression counts were obtained before the latest dev merge and
are retained only as historical diagnostic evidence. PostgreSQL 17 and the exact
pushed commit still require remote CI; local PostgreSQL 14.18 is not substituted
for that gate.

## Scientific and release boundaries

- Existing H2 numerical observations were not changed by this repair.
- No optimizer, ansatz, framework, or component-performance claim is made.
- Human review remains owner-waived and is not relabelled as independent review.
- Public execution and publication remain blocked.
- A Private Technical MVP corrective candidate is not qualified until the exact
  pushed commit passes PostgreSQL 17 migration CI and the configured private
  production-E2E gate.

## Remote completion record

Pending the corrective push.  Successful run IDs and exact head commit must be
added only after GitHub reports them; this section must not predict success.
