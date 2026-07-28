# Phase 7.7 — Provider-neutral scientific interchange and conversion evidence

Status: active

Phase 7.7 introduces the smallest provider-neutral interchange layer needed to
move one frozen H2/STO-3G scientific object through OpenFermion, Qiskit, and
PennyLane without changing its scientific identity. It does not add a new VQE
method, molecule, optimizer, or public result.

## Scientific boundary

The authoritative qubit-operator model remains
`majorana_vqe.canonical.CanonicalHamiltonian`. Phase 7.7 must not create a
second Pauli-Hamiltonian identity. New models cover only:

- a canonical fermionic operator before mapping;
- canonical basis-state preparation;
- a provider-neutral symbolic parametric circuit;
- typed conversion edges and immutable conversion evidence.

Provider objects and package imports remain outside `packages/py/vqe`.
Conversion evidence proves a bounded transformation for one input and one
adapter version; it never proves all inputs equivalent.

## Claim boundary

Allowed:

- schema validation and digest stability;
- adapter-observed equivalence for the frozen H2 fixture;
- provider-neutral reconstruction under the named conventions;
- private runtime qualification evidence.

Blocked:

- public scientific results;
- performance superiority;
- general equivalence of arbitrary fermionic mappings or circuits;
- human-reviewed status;
- promotion of the unresolved WorkOS identity observation to a resolved claim.

The Phase 7.6 authentication observation remains inherited: the browser
account selected by the owner and the identity returned by `/api/me` were not
shown to be the same identity. The owner must not be asked to repeat that login
loop during Phase 7.7.

## Steps and acceptance gates

### S0 — Scope and inherited-state freeze

- Freeze this scope, non-goals, claim boundary, and inherited auth issue.
- Confirm the worktree starts clean and the Phase 7.6 evidence remains
  immutable.

### S1 — Existing-model audit

- Reuse `CanonicalHamiltonian`, exact Hamiltonian digest context, and the
  existing H2 canonical excitation.
- Record why provider objects and conversion code cannot enter the pure domain
  package.

### S2 — Canonical fermionic operator

- Immutable, fail-closed ladder-operator terms.
- Exact IEEE-754 coefficient encoding and deterministic term ordering.
- Digest includes spin-orbital order and coefficient/normal-order convention.

### S3 — Canonical state and parametric circuit

- Immutable basis occupation with explicit qubit ordering.
- General symbolic Pauli-rotation sequence with explicit parameter slots.
- Exact canonical digests independent of provider serialization.

### S4 — Conversion graph and evidence

- Role-specific, typed source and target representations.
- Adapter release/version, input digest, output digest, witness digest,
  verification method, and bounded verification status.
- Graph resolution fails closed for missing, ambiguous, or unverified edges.

### S5 — OpenFermion input adapter

- OpenFermion is an adapter dependency, not a domain dependency.
- Convert a fixed `FermionOperator` into the canonical fermionic model.
- Reject symbolic, non-finite, unsupported, or convention-ambiguous input.

### S6 — Qiskit and PennyLane output adapters

- Convert the same canonical Hamiltonian, state, and symbolic circuit into
  framework-native objects.
- Reconstruct observed canonical values from each provider object.
- Provider-native resource data remains diagnostic, not comparison-primary.

### S7 — H2 equivalence evidence

- OpenFermion → canonical fermionic → Jordan-Wigner canonical qubit path.
- Canonical → Qiskit and Canonical → PennyLane.
- Compare matrix, spectrum, energy, statevector up to global phase, parameter
  semantics, and common-protocol resources under explicit tolerances.

### S8 — Workflow/Registry integration

- Persist only portable digests in scientific identity.
- Bind adapter/runtime identities in execution resolution/evidence.
- Do not place provider names in the portable scientific specification.

### S9 — Fixed Linux/amd64 reproduction

- Use digest-pinned runtime images and frozen dependency locks.
- Record architecture, package versions, source commit, adapter digest,
  canonical input/output digests, and test results.

### S10 — Closeout

- Run pure-domain, runtime-adapter, API integration, and static boundary tests.
- Record limitations and rollback.
- Commit intentionally and push `feature/vqe` only after a clean audit.

## Definition of done

- Canonical digests are deterministic and provider-neutral.
- The pure VQE package imports with no Qiskit, PennyLane, or OpenFermion.
- At least one H2 OpenFermion conversion and both Qiskit/PennyLane output
  conversions carry verifiable input/output evidence.
- The two providers agree under the same frozen scientific specification and
  stated numerical tolerances.
- Negative tests reject ambiguous conventions, digest tampering, invalid
  conversion paths, and non-finite coefficients.
- No public or performance claim is enabled by this phase.

## Rollback

All Phase 7.7 schemas are additive. Rollback removes the new interchange
modules, adapter scripts, bindings, and evidence records. Existing Phase 7.6
workflow and execution records continue to resolve through their prior
adapter releases and are not migrated in place.
