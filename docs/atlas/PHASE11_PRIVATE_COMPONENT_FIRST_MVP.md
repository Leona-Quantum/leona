# Phase 11 — Private Component-First VQE MVP consolidation

Date: 2026-08-05 JST

## Decision and boundary

Phase 11 is a consolidation phase. It does not increase the component catalog,
introduce a new VQE method, enable public execution, or make a performance
claim. Its purpose is to prove that one scientifically controlled private VQE
journey is coherent across Registry identity, workflow composition, execution,
comparison, persistence, and reopen.

The primary journey is frozen as:

```text
H2 / STO-3G
→ Fixed Excitation
→ SLSQP
→ exact statevector
→ private Qiskit and PennyLane candidates
→ change exactly parameter_optimizer to COBYLA
→ execute both sides
→ server-recomputed controlled comparison
→ private save
→ same-subject reopen
```

UCCSD remains a secondary capability smoke path. Hardware-Efficient RY–CX is a
capability migration only and must not be represented as the primary
one-component comparison.

## Authority

Status must flow through the following committed chain:

```text
immutable Registry records
+ runtime/review/deployment evidence
→ private_mvp/capability_manifest_v1.json
→ generated API/UI projections
→ offline and operator-controlled release gates
```

Paper count, repository count, component count, and GitHub popularity are not
MVP success metrics. Papers and repositories remain provenance/evidence behind
component definitions and implementations.

## Step record

| Step | Outcome | Status |
|---|---|---|
| S-1 Dev reconciliation | Latest fetched `origin/dev` is an ancestor of the feature branch; no unresolved merge conflict exists | complete |
| S0 Scope and claim freeze | Private-only, no superiority, no public/external execution, no new component intake | complete |
| S1 Capability Manifest | Committed single status authority with generated projections and drift check | complete |
| S2 Truthful Component-First UI | Component and Workflow are primary; paper/repository data is provenance; blocked capabilities stay visibly blocked | complete |
| S3 Primary Golden Journey | Fixed H2 Qiskit/PennyLane execution contracts pass locally and in synthetic authenticated browser coverage | verified_local |
| S4 Controlled optimizer swap | Exactly `parameter_optimizer` changes from SLSQP to COBYLA; production-shaped evidence is parsed fail-closed and saved/reopened | verified_local |
| S5 Secondary capability smoke | UCCSD and Hardware-Efficient entries remain bounded by their declared capability state | verified_local |
| S6 Persistence and failure coverage | Immutable identity, tenant boundary, idempotency, malformed evidence, status/audit mismatch, and reopen boundaries have automated coverage | verified_local |
| S7 Unified release gate | Offline gate returns GO; full Python/web/build/browser regressions pass | verified_local |
| S8 Digest-pinned private CI | Prerequisites absent; gate exits nonzero rather than skipping successfully | **NOT_RUN — GO判定不可** |
| S9 Live WorkOS same-account reopen | No new live-staging evidence committed in this phase | **NOT_RUN — GO判定不可** |
| S10 Public/external execution | Outside Private MVP scope and blocked by manifest/API/UI | blocked_external |
| S11 Audit and handoff | Local evidence, defects, known debt, and remaining operator actions are committed as reviewable documents | complete |

## Post-push CI correction — 2026-08-07

The first pushed Phase 11 candidate (`d212177`) exposed an Alembic history
collision after the latest `dev` merge: both the VQE branch and `dev` used
revision identifiers `0046` and `0047`.  The Python scientific tests and Web
journey passed, but the database and production-E2E jobs stopped before
qualification because the graph had multiple heads.  No failed job is counted
as scientific or deployment evidence.

The first repair was superseded when current `dev` added its own numeric `0048`.
The durable repair therefore gives every continuing VQE revision a `vqe_`
namespace, keeps only the historical VQE terminal stamp `0054` addressable,
merges dev `0048` and VQE `0054` at `vqe_merge_0055`, and reconciles legacy
private databases at `vqe_reconcile_0056`. Historical Phase 9 evidence remains
immutable: its recorded `0054` head must still resolve, while the present graph
is independently required to have exactly one head.

Detailed root cause, compatibility paths, tests, and the completed remote
PostgreSQL 17 qualification are recorded in
[`private_mvp/migration_reconciliation_audit_2026-08-07.md`](private_mvp/migration_reconciliation_audit_2026-08-07.md).

After integration with current `dev`, the repaired working tree passed 2895
Python tests, 693 Web tests, the 338-route production build, five authenticated
VQE browser journeys, the deterministic Private MVP gate, and all three real
PostgreSQL 14.18 migration paths. These are local/private qualification results,
not public scientific performance evidence; skipped tests and PostgreSQL 17 are
not inferred from them.

## Scientific acceptance

| Requirement | Local decision |
|---|---|
| Only one component role changes | GO |
| Fixed problem, representation, state, ansatz, measurement, stopping, evaluation, resource protocol, and provider | GO |
| Qiskit and PennyLane observations remain distinct | GO |
| Comparison is computed from persisted execution evidence | GO |
| Numerical metrics are hidden unless every invariant passes | GO |
| CNOT/depth semantics are explicit and common-protocol | GO |
| Wall time excluded from scientific optimizer judgment | GO |
| Independent scientific review | waived by owner; not claimed |
| Public or superiority claim | blocked |

## Engineering acceptance

| Requirement | Local decision |
|---|---|
| Unknown, ambiguous, or incompatible component fails closed | GO |
| Malformed or obsolete comparison payload fails closed | GO |
| Comparable status cannot coexist with a failed invariant | GO |
| Workflow identity is frozen before provider execution | GO |
| Private save and reopen are covered in browser E2E | GO (synthetic auth) |
| Full Python, TypeScript, lint, format, import, build, and browser regressions | GO |
| Missing private credentials become a successful skip | prohibited and verified |
| Digest-pinned remote runtime execution | GO (corrective commit `c179a00`, production-E2E run 31146034351) |
| Live WorkOS same-subject browser reopen | not requalified by this corrective code run; external deployment validation only |

## Release decision

The deterministic implementation and corrective migration history are qualified
as a Private Technical MVP at the code-and-contract boundary: exact corrective
commit `c179a00` passed standard CI run 31146034335 and digest-pinned private E2E
run 31146034351. This is not a public release or scientific-performance
qualification. A fresh live-tenant browser session remains deployment evidence,
not a prerequisite for this owner-scoped development MVP.

The authoritative command results and defect log are in
[`private_mvp/phase_completion_audit_2026-08-05.md`](private_mvp/phase_completion_audit_2026-08-05.md).
The boundary-to-test mapping is in
[`private_mvp/failure_coverage_matrix.md`](private_mvp/failure_coverage_matrix.md).
