# Phase 4.5 Neon validation gate

Date: 2026-07-25  
Git commit under test: `7b33d06c71af7e1d792758b0814741275eae1ced`  
Neon branch ID: `br-misty-violet-a6i3vl4q`  
Branch classification: temporary validation branch (owner-confirmed)  
Parent branch: not queried  
Expiry: not queried  
Database: `neondb`, PostgreSQL 17.10  
Connection split: pooled API/test URL and direct Alembic URL both passed  

No connection string, role password, or credential is recorded here.

## Starting state

- Alembic revision: `0034`
- Artifact rows: 338
- Phase 4.5 VQE tables: absent
- Existing Artifact rows were not updated by the migration.

## Migration protocol

Executed against the direct endpoint:

1. `upgrade head` (`0034 → 0035`) — passed.
2. Confirmed all new VQE tables existed and were initially empty.
3. `downgrade 0034` while VQE tables were empty — passed.
4. `upgrade head` (`0034 → 0035`) again — passed.

This proves the empty-schema up/down/up path on Neon PostgreSQL 17, not only
on the local PostgreSQL 14 gate.

## Live repository gate

Executed against the pooled endpoint:

```text
services/api/tests/test_vqe_repo_live.py
6 passed in 36.82s
```

The suite covered:

- component persistence and cross-workspace isolation;
- identical scientific content in distinct workspaces;
- immutable component/workflow identity;
- experiment idempotency;
- one portable experiment with independent Qiskit and PennyLane executions;
- append-only observations enforced against direct UPDATE and DELETE.

## Ending state

```text
alembic revision:          0035
artifacts:                  354
vqe_component_specs:         8
vqe_workflow_components:     1
vqe_experiments:             3
vqe_executions:              3
vqe_observations:             3
```

The 16 additional Artifact rows and VQE rows are isolated live-test fixtures
on the temporary branch. They are intentionally not reclassified as curated
or human-reviewed scientific catalog content.

## Fail-closed rollback evidence

After live evidence existed, `alembic downgrade 0034` was attempted and
rejected with the expected migration guard:

```text
cannot downgrade 0035: VQE registry or execution evidence exists
```

The failed downgrade was transactional; the branch remained at revision
`0035` with all evidence rows intact.

## Decision

Phase 4.5 Neon migration/integrity gate: **PASS**.

Phase 5 remains **NO-GO** for the independent reasons in
`PRE_PHASE5_GATE.md`: human scientific review, promoted digest-pinned Linux
runtime profiles, deny-all egress evidence, and comparable decomposed-circuit
resource metrics are still absent. A passing migration does not authorize
publication or runtime promotion.
