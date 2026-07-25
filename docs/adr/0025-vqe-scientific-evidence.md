# ADR-0025: VQE observations are append-only evidence keyed to a canonical, digested Hamiltonian

**Date:** 2026-07-24 · **Status:** accepted for Phase 4.5 persistence; cardinality clarified by ADR-0030
**Context:** A VQE result is only useful as evidence if a reader can trust that two
runs claiming to compute "the same thing" actually used the same qubit Hamiltonian,
not just the same molecule name, and that a retried or re-run experiment cannot
silently overwrite or lose a prior observation. Quantum-chemistry Hamiltonians are
sensitive to basis, mapping, orbital/qubit ordering, and coefficient rounding — the
same physical problem can serialize to non-identical operators across Qiskit and
PennyLane unless canonicalization is explicit. Separately, finite-shot (sampled) VQE
results are statistical estimates, not exact evidence; conflating them with
exact/statevector results would let a noisy run silently pass what should be a strict
numerical gate.
**Decision:** Every Hamiltonian used in a VQE experiment is reduced to a canonical
form (deterministically sorted Pauli terms, normalized coefficient dtype/precision)
before hashing; `hamiltonian_digest` is computed from that canonical form, and two
Hamiltonians that differ only by a documented qubit permutation are recorded as
permutation-equivalent, never silently treated as identical without that record.
`vqe_observations` is strictly append-only: a retry adds a new row with an
incremented `attempt` under the same `execution_id`, nothing about a prior
observation is ever UPDATEd, and a correction to a component's definition produces a
new `ArtifactVersion` (ADR-0023), never a mutation of an existing one. The MVP golden
fixture is H2/STO-3G only, and its authoritative energy values are never hand-typed
into planning documents or code — they come only from an independent exact
diagonalization, cross-checked across both runtime candidates, and recorded with a
review record in a fixture file (`docs/atlas/fixtures/`). Numerical acceptance uses
two tolerances sourced from that fixture, not invented in this ADR: exact-
diagonalization cross-check agreement at <=1e-10 Ha, and VQE-accepted-result
agreement at <=1e-5 Ha; finite-shot (sampled) execution is disabled or marked
`experimental` in the MVP UI and is never sufficient to satisfy a scientific pass
condition. The result contract distinguishes `logical_or_compiled` gate/depth
metrics and records `compiler`/`optimization_level`/`layout`/`routing` alongside
them, so a resource-metric claim always states which stage it was measured at. Raw
runtime stdout/stderr is never stored as the result contract — it is bounded,
secret-scanned log data — and `energy_trajectory` beyond a bounded summary size is
written to a content-addressed object store with only its URI, hash, and size kept in
Neon.
**Consequences:** This buys tamper-evident, reproducible evidence: anyone can
recompute a `hamiltonian_digest` from the canonical form and confirm two
claimed-identical experiments actually were identical, and no observation can be
quietly edited after the fact. It costs extra storage (append-only means failed or
retried attempts accumulate rather than being overwritten) and up-front engineering
(a canonicalization routine that must stay deterministic across Qiskit/PennyLane
coefficient ordering and dtype differences). It also means the MVP cannot claim a
"verified" result from a single finite-shot run — a deliberate scientific-integrity
constraint, not an oversight. Reversal trigger: finite-shot evidence may become an
accepted evidence *class*, distinct from and not substituting for exact/statevector
evidence, once a shot-noise statistical-significance protocol is defined and reviewed
in a superseding ADR.
