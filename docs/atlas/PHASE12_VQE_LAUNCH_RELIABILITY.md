# Phase 12 — VQE Launch Reliability, Observability, and Scientific Truth

**Branch:** `feature/vqe`  
**Phase 12 source parent:** `7783eb150f770895f1ab47621d082c4fcda600a3`  
**Final dev-sync cutoff:** `d2f4c8e7c4f602de1da5ebfe98fdd6cf12c53a03`  
**Scope:** private component-first VQE MVP; no public or performance claim

The exact release-candidate commit is recorded by Git and by the external
workflow's `GITHUB_SHA`, rather than embedded in a file that would change that
same commit. Ordinary `dev` movement after the cutoff is not merged into this
candidate unless it is a release-blocking security or migration correction.

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
7. The final `dev` sync introduced a document-wide Atlas View Transition into
   authenticated Workspace routes. Next.js streamed navigation could abort the
   transition while replacing hydrated controls, leaving VQE launch actions
   non-actionable. The authenticated layout now explicitly opts out, while the
   public Atlas retains the transition; a source-level regression test guards
   that boundary.
8. The first external Linux run exposed two test/integration seams hidden by
   local execution. Six production-launcher tests cleared Cloud Run markers but
   not GitHub Actions' `CI=true`; the production executor correctly failed
   closed. A shared dedicated-host fixture now clears every managed/CI marker,
   while a separate test proves that restoring `CI=true` is rejected.
9. The frozen Phase 5A Registry workflow and its Phase 7.6 optimizer swaps use
   a deliberate legacy-key/standard-optimizer identity. Registry resolution
   validated that exact 14-role identity, but the later capability gate listed
   only the all-standard identity. The capability allowlist now names the
   complete legacy baseline, legacy-plus-SLSQP, and legacy-plus-COBYLA maps.
   Any partial mixture or unknown key still fails closed.

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
| S8 | Unit, web, and browser regression gates | 959 web tests; 6 Playwright VQE journeys |
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

## Final dev-sync verification recorded on 2026-08-10

- `pytest` targeted API/worker/domain launch suite: **43 passed** after the
  final invariant test was added; the broader Phase 12 targeted suite had
  **72 passed**.
- Deterministic VQE offline gate: **66 Python scientific/API contract tests**
  and **29 web parser tests passed**.
- Web unit suite after integration with the final `dev` cutoff: **959 passed**.
- Authenticated VQE Playwright suite: **6 passed**.
- PostgreSQL 17 migration upgraded to `vqe_launch_0057`.
- Empty database upgrade → downgrade → upgrade succeeded.
- Downgrade with launch-decision evidence was correctly refused.
- Live PostgreSQL delayed-heartbeat and append-only tests: **2 passed**.
- Full repository Python regression suite after the external-run corrections:
  **2935 passed, 431 skipped**; the only warning is an existing Alembic
  `path_separator` deprecation.
- Next.js production build after integration with `dev`: **passed**, including
  **596** generated static pages and the VQE proxy/Studio/Atlas application
  routes.
- TypeScript typecheck, web lint, Ruff check, Ruff format check, and the
  client-bundle secret scan all passed. The bundle scan inspected **381**
  browser-served files and found no secret-shaped strings.
- The post-merge type regression in `AtlasContentSwitch` was detected before
  the merge commit: the wrapper did not forward the new browse query, ordering,
  circuit-only, and row-cap inputs added on `dev`. Forwarding and typed bounds
  were added, then typecheck, lint, all web tests, the deterministic VQE gate,
  and the production build passed.
- Production E2E source was upgraded to require a fresh launch projection and
  worker-authored readiness for the six exact OCI profiles.
- External attempt `31353920594` proved the ordinary CI failure was confined to
  the six non-hermetic production-host simulations; TypeScript, UI visual, and
  PostgreSQL jobs passed. External attempt `31353920608` passed settings,
  PostgreSQL migration, frozen workflow provisioning, and all six exact OCI
  pulls before exposing the cross-layer capability-identity omission. These
  failed attempts are diagnostic evidence, not release evidence.

This local evidence does not close S9. The release decision remains
`NO-GO — pending exact-commit Linux/x86_64 fixed-digest E2E` until the pushed
commit passes ordinary CI and `.github/workflows/vqe-production-e2e.yml`, and
the uploaded redacted evidence is audited.

## Local OCI qualification constraint

The development Mac had only 4.5 GiB free at the final sync while the six qualified linux/amd64
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
