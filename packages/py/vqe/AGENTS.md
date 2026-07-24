# AGENTS.md — majorana-vqe

Pure VQE domain package: components, workflows, scientific experiment specs, canonical
Hamiltonians, comparison. Authority: `docs/adr/0023-vqe-experiment-identity.md`,
`docs/adr/0024-vqe-runtime-profiles.md`, `docs/adr/0025-vqe-scientific-evidence.md`,
`docs/atlas/atlas_vqe_mvp_execution_plan_ja.md`.

- Never import `qiskit`, `pennylane`, `fastapi`, or `sqlalchemy` here. This package must
  be usable with zero framework packages installed — that is a Phase 1 acceptance gate,
  not a style preference. Framework-specific code belongs in `runtimes/vqe/*`.
- Every model is immutable (`ConfigDict(frozen=True, extra="forbid")`) and carries an
  explicit `schema_version` field. Unknown fields fail closed, not silently drop.
- `ScientificExperimentSpec` never contains a framework name, provider version, runtime
  profile, or digest — those live only in `ExecutionRequest`/`ExecutionBinding`. Do not
  add a field that blurs this line; it is the ADR-0023 boundary the rest of the platform
  depends on.
- No field ever accepts a filesystem path, Python module reference, or arbitrary code as
  data — see `models.py`'s `_reject_path_module_or_code`. This applies to every
  free-text/JSON-payload field added later, not just the ones present today.
- Canonicalization (`canonical.py`) must stay deterministic: same logical Hamiltonian in,
  same digest out, regardless of input dict/list ordering or which of two runtime
  candidates produced it (post-permutation/local-gauge normalization).
- Component identity is an `ArtifactVersion` UUID reference, never a string label
  (ADR-0023). This package validates the UUID's shape only; existence/Scope checks are
  the repository layer's job in a later phase.
- `corpus_validation.py` validates the Phase 2 curated corpus (`docs/atlas/corpus/`,
  outside this package) offline — it lives here because it needs `ComponentType` for
  enum checks. Per ADR-0026, its `validation_state` is machine-only: there is no
  `human_reviewed` value anywhere in that state machine, and nothing here may claim
  a corpus record has been human-validated. The online URL-reachability audit is a
  separate, explicitly-online script (`docs/atlas/corpus/validator/online_url_audit.py`)
  that never runs as part of this package's own test suite.
