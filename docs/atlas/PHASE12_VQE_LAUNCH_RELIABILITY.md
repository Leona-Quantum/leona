# Phase 12 — VQE Launch Reliability, Observability, and Scientific Truth

**Branch:** `feature/vqe`  
**Phase 12 checkpoint:** `8a7aad0f`  
**Integrated dev baseline:** `0197600dc759a3ebe5760a86c47eabc98023b859`  
**Scope:** private component-first VQE MVP; no public or performance claim

## Outcome

Phase 12 replaces the launcher’s inferred eligibility with one server-owned,
expiring launch projection. It also records live worker readiness separately
from historical runtime qualification and writes every launch mutation decision
to an immutable PostgreSQL ledger.

The original symptom was real: a workflow could appear in the launcher but all
create attempts returned 422 with no actionable explanation. This was not a
VQE numerical failure. It was a control-plane truth mismatch.

## Root-cause chain

1. The UI loaded the broad Registry workflow list, including unvalidated
   standard seeds.
2. The UI derived “registry qualified” from incomplete fields.
3. `POST /v1/vqe/experiments` used the stricter scientific resolver and refused
   those same entries.
4. The API returned a message shape the UI did not consistently display.
5. Mock E2E bypassed PostgreSQL, strict resolution, worker heartbeat, and the
   exact OCI image check.
6. Earlier evidence used `owner_waived` as if it were a review state, obscuring
   the difference between permission to execute and independent review.

## S0–S12 completion contract

| Step | Required result | Verification |
| --- | --- | --- |
| S0 | Freeze incident, reproduction, and scientific invariants | this document + regression fixtures |
| S1 | Separate definition, composition, implementation, policy, qualification, readiness | `majorana_vqe.launch` typed states |
| S2 | One fail-closed evaluator and expiring projection | evaluator truth-table tests |
| S3 | Persist readiness and append-only decisions | migration `vqe_launch_0057` |
| S4 | Worker probes exact digests and publishes TTL leases | worker readiness tests |
| S5 | Typed RFC 9457 refusals and safe UI messages | API and web tests |
| S6 | Separate validated-draft, create, and start transactions | route transaction tests |
| S7 | Fence delayed heartbeats; reject ledger mutation | live PostgreSQL tests |
| S8 | Unit, web, and browser regression gates | 767 web tests; 6 Playwright VQE journeys |
| S9 | PostgreSQL + API + worker + real OCI E2E | production E2E workflow and evidence artifact |
| S10 | Metrics, structured logs, alert condition, runbook | metric names + debugging runbook |
| S11 | ADR and scientific claim boundary | ADR-0035 + this record |
| S12 | Full gate, secret scan, migration and diff audit | final audit section below |

## Scientific invariants

- Workflow and component identity are content-derived and versioned.
- Create freezes the portable scientific specification and registry resolution.
- Start cannot change scientific identity; it only binds an admitted runtime.
- Framework comparison uses a shared canonical ansatz-only resource protocol.
- CNOT/depth exclude reference-state preparation, measurement, routing, and
  hardware optimization unless a different protocol is explicitly versioned.
- A component swap comparison changes exactly one declared role. Ansatz
  migrations with dependent compilation changes are labeled migrations, not
  one-component comparisons.
- Missing, ambiguous, stale, or contradictory evidence fails closed.
- Private owner-waived execution remains unreviewed and publication-blocked.

## System invariants

- API request handlers never invoke Docker.
- Readiness has an expiry and is keyed by exact runtime profile.
- Older delayed heartbeats cannot overwrite a newer observation.
- Projection digest closes the read/mutate TOCTOU gap.
- Decision rows are append-only at both repository and database layers.
- Metric labels contain only bounded enums; UUIDs appear only in structured
  logs and the scoped decision ledger.
- Validation responses never echo submitted secrets or invalid values.
- A VQE Registry inconsistency blocks VQE launch, not the whole application.

## Required telemetry

| Signal | Attributes / fields | Purpose |
| --- | --- | --- |
| `majorana.vqe.launch.decisions` | action, decision, reason_code, framework | launch volume and refusal reasons |
| `majorana.vqe.launch.invariant_failures` | same bounded labels | eligible projection contradicted by mutation |
| `majorana.vqe.readiness_updates` | status, framework, failure_code | worker/runtime health |
| `vqe_launch_decision` log | request ID, workflow/experiment UUID, projection prefix | request correlation |
| `vqe_runtime_readiness` log | profile, status, generation, expiry, digest prefix | heartbeat debugging |
| `vqe_launch_decisions` table | full scoped immutable decision snapshot | durable audit |

The release alert is: any increase of
`majorana.vqe.launch.invariant_failures` in a 15-minute window. Warning alerts
apply when an admitted framework has no `ready` lease for two TTL periods. A
normal user validation refusal is not an invariant alert.

## Verification recorded on 2026-08-07

- `pytest` targeted API/worker/domain launch suite: **43 passed** after the
  final invariant test was added; the broader Phase 12 targeted suite had
  **72 passed**.
- Web unit suite after integration with `dev`: **767 passed**.
- Authenticated VQE Playwright suite: **6 passed**.
- PostgreSQL 17 migration upgraded to `vqe_launch_0057`.
- Empty database upgrade → downgrade → upgrade succeeded.
- Downgrade with launch-decision evidence was correctly refused.
- Live PostgreSQL delayed-heartbeat and append-only tests: **2 passed**.
- Full repository Python regression suite after readiness-loop isolation:
  **2911 passed, 431 skipped**; the only warning is an existing Alembic
  `path_separator` deprecation.
- Next.js production build after integration with `dev`: **passed**, including
  **415** generated static pages and the VQE proxy/Studio/Atlas application
  routes.
- The post-merge type regression in `AtlasContentSwitch` was detected before
  the merge commit: the wrapper did not forward the new browse query, ordering,
  circuit-only, and row-cap inputs added on `dev`. Forwarding and typed bounds
  were added, then typecheck, lint, all web tests, the deterministic VQE gate,
  and the production build passed.
- Production E2E source was upgraded to require a fresh launch projection and
  worker-authored readiness for the six exact OCI profiles.

## Local OCI qualification constraint

The development Mac had only 6.6 GiB free while the six qualified linux/amd64
runtime images were not present. A controlled pull was stopped when free space
fell to 1.2 GiB; only the newly pulled qualified images and temporary Docker
credentials were then removed, restoring 6.3 GiB without deleting pre-existing
developer images. This is an environment constraint, not passing evidence. The
GitHub production E2E remains the authoritative linux/x86_64 run because it
pre-pulls every exact digest and uploads its redacted evidence only after
success.

## Final claim boundary

Phase 12 may claim that launch decisions are consistent, observable, and
fail-closed under the tested contracts. It may not claim that H₂, LiH, UCCSD,
hardware-efficient VQE, Qiskit, or PennyLane results are independently reviewed,
publicly qualified, more accurate, or faster than another implementation.
