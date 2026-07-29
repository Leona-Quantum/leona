# Pre-Phase 5 gate

Decision date: 2026-07-25  
Current decision: **GO for Phase 5A product integration only**

This decision does **not** authorize public execution, publication, an MVP
release, or a scientific performance claim. Those states remain blocked.

| Gate | Evidence | State |
|---|---|---|
| Portable UUID-free scientific identity | ADR-0031, unit tests | pass |
| Typed H2 composition | executable v0.2 fixture, cross-role validator | pass |
| Actual VQE numerical parity | Qiskit/PennyLane raw v0.2 evidence | pass locally |
| Canonical decomposed excitation | frozen Pauli rotations, digest, adapter equivalence tests | pass |
| Comparable CNOT/depth protocol | canonical logical and common-basis stages; provider-native diagnostic excluded | pass |
| Experiment → multiple executions | migration 0039 + live PostgreSQL tests | pass locally |
| Append-only scientific evidence | DB trigger/privileges + live mutation tests | pass locally |
| Machine/human review truthfulness | independent states + fail-closed resolver | pass in code |
| Independent human review of H2 | `human_review_state=unreviewed` | **owner-approved deferral** |
| Linux/x86_64 digest-pinned OCI + SBOM | `production_runtime_status=unqualified` | **owner-approved deferral** |
| Deny-all egress design/static enforcement | immutable binding policy, fixed environment, static tests | pass for Phase 5A |
| Live promoted-runtime egress proof | no qualified production image | **deferred to Phase 5B** |
| Temporary Neon branch up/down/up | PostgreSQL 17 migration + six live tests | pass |
| Public execution / publication / scientific release | not authorized | **blocked** |

## Owner-approved boundary

Phase 5 is split into:

- **Phase 5A — durable product integration:** approved to start using
  unreviewed candidate scientific data and unqualified local runtimes only in
  fail-closed, non-public paths.
- **Phase 5B — production qualification:** requires independent H2 scientific
  review, digest-pinned Linux/x86_64 OCI images with SBOMs, and live deny-all
  egress evidence before public execution or a scientific release.

The deferrals are schedule decisions, not successful validations. The system
must continue to expose `human_review_state=unreviewed`,
`production_runtime_status=unqualified`, and blocked public
execution/publication/scientific-release states.

## First Phase 5A slice

Integrate the immutable `ExecutionBinding` and server-owned isolation policy
with the durable job lifecycle. The worker may resolve only fixed candidate
profiles and must not inherit environment variables, receive credentials or
database URLs, install packages dynamically, or enable public execution.
