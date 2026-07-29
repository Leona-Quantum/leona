# ADR-0024: VQE experiments reuse Artifact/Run identity instead of a parallel object model

**Date:** 2026-07-24 · **Status:** superseded in part by ADR-0031

> **Supersession notice:** retain this document as the v0.1 decision history.
> ADR-0031 replaces UUID-bearing scientific identity, the one-experiment/one-run
> cardinality, and binding-dependent experiment identity. ArtifactVersion remains
> the registry/provenance identity.
**Context:** Atlas VQE needs versioned components (ansatz, operator pool, optimizer,
measurement protocol, ...), workflows composed from components, and scientific
experiments run against them, without duplicating the identity, versioning,
provenance, and licensing machinery the catalog/repository layer already owns
(`Artifact`/`ArtifactVersion`, `runs`, `jobs`, `run_events`, `verification_records`).
Modeling a component as a free-text label, or an experiment as a fully independent
entity with its own status field, would fragment provenance, let an unreviewed
component evade license/authorship tracking, and create a second source of truth for
execution lifecycle that can drift from `runs`/`jobs`.
**Decision (historical v0.1):** A VQE component is identified by an existing immutable `ArtifactVersion`,
never a string label; `vqe_component_specs` attaches typed metadata
(`component_type`, `spec_json`, `normalized_spec_sha256`) keyed on
`artifact_version_id`. A Workflow is likewise an ArtifactVersion; `vqe_workflow_components`
links a workflow ArtifactVersion to its component ArtifactVersions via an explicit
`component_role` and `ordinal`. A scientific experiment is a `vqe_experiments` row
holding only the immutable `ScientificExperimentSpec` (what to compute) plus a
UNIQUE `run_id` into the existing `runs` table, which remains the sole authority for
execution status — `vqe_experiments` never duplicates status, chosen framework, or
runtime profile. `ScientificExperimentSpec` (problem/ansatz/optimizer/... version
IDs, initial parameters, seed) is strictly separated from `ExecutionRequest`
(user-supplied capability + framework preference) and `ExecutionBinding`
(server-resolved framework/provider/runtime-profile/adapter/image/architecture/
protocol-version authority, see ADR-0025): the same scientific spec, hashed as
`scientific_spec_sha256`, must be byte-identical whether executed under a Qiskit or
PennyLane binding. Idempotency identity for experiment creation is the
server-generated tuple `scientific_spec_sha256` + `runtime_profile_id` +
`adapter_release_id` + `dataset_snapshot_id` + `protocol_version`, never a
client-chosen key. **ADR-0030 clarification:** this binding-dependent tuple is
the Phase 5 execution identity. The standard HTTP `Idempotency-Key` accepted
while persisting a pre-binding Phase 3 request is a separate replay-safety
value stored as `request_idempotency_key`; it is never scientific or execution
identity. All new repository functions (`vqe_component_specs`,
`vqe_workflow_components`, `vqe_experiments`, `vqe_observations`) take `Scope` as
their first argument and enforce workspace scoping themselves, per the repo-wide
authz invariant; none of them are exempted the way `repos/system.py` is for
pre-Scope bootstrap.
**Consequences:** This buys single-source component/version/license/provenance
tracking — an ansatz's authorship, license, and revision history live in exactly one
place — and keeps VQE executions inside the existing durable run/job/authz machinery
instead of a parallel one. It costs an extra join hop (component metadata requires an
ArtifactVersion join, not a flat row) and requires every curated corpus item (Phase 2)
to be materialized as an ArtifactVersion before a component spec can reference it,
which is stricter than a plain metadata table. `vqe_experiments.run_id` being UNIQUE
means one experiment maps to exactly one run; a retried attempt is a new
`vqe_observations` row under the same experiment (see ADR-0026), never a new run or a
new experiment. Final table shape is fixed by ADR after the Phase 2 curated corpus
validates the component ontology (per the MVP execution plan §8); this ADR fixes the
identity model, not the final column list. Reversal trigger: if curated-corpus volume
or annotation velocity in Phase 2 shows the ArtifactVersion-per-component model is too
heavyweight for rapid annotation, a lighter-weight component identity may be proposed
in a superseding ADR — but it must still preserve single-source provenance and must
not reintroduce string-label component identity.
