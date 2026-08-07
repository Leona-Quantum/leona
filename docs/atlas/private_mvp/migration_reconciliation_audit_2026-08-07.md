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

The corrected graph is:

```text
                     ┌→ 0046 → 0047 ┐
0045 ────────────────┤               ├→ 0048 → … → 0054 → 0055
                     └→ vqe_0046 → vqe_0047 ┘
```

- `0048` is an explicit Alembic merge point.
- `0055` verifies and repairs the dev-side nullable columns and indexes for a
  private database already stamped `0054` by the old feature-only graph.
- Catalog upstream identity is backfilled using the original official `0046`
  rule; duplicate identities fail closed before a unique index can be created.
- Existing columns and indexes are verified against their expected shape rather
  than silently accepted by name.
- `0055` downgrade is a no-op because corrected `0054` already declares both
  branch parents applied.  The original dev migrations own removal below the
  `0048` merge point.
- A repository-wide static graph test now rejects duplicate revision IDs,
  missing parents, or more than one current head before Alembic can reduce the
  collision to a warning.

## Evidence obtained before the corrective push

PostgreSQL 14 was used locally because the Docker PostgreSQL 17 daemon was not
available on the workstation.  PostgreSQL 17 remains a required remote CI gate
and is not inferred from the local result.

| Path | Result |
|---|---|
| empty database `base → 0055 → base → 0055` | passed |
| current dev-side database `0047 → 0055` | passed |
| old feature-only migrations `base → old 0054`, then corrected graph `0054 → 0055` | passed |
| repaired legacy columns | `artifacts.upstream_identity`, `license_assertions.claim_hash`, `runs.idempotency_request_hash`: nullable text |
| repaired legacy indexes | `ux_artifacts_workspace_upstream_identity`, `ix_import_items_artifact_recency`: present |
| migration-focused Python tests | 51 passed, 13 skipped; skipped tests are not evidence |
| full Python regression | 2773 passed, 422 skipped; skipped tests are not evidence |
| current Alembic heads | exactly `0055` |
| immutable Phase 9 audit | passed without rewriting historical JSON evidence |

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
