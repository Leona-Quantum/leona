# Phase 7.7 progress

## S0 — Scope and inherited-state freeze

Status: complete

- Scope and claim boundary are frozen in
  `PHASE77_PROVIDER_NEUTRAL_CONVERSION_PLAN.md`.
- Phase 7.6 evidence is treated as immutable input.
- Public execution and performance claims remain blocked.
- The unresolved WorkOS selected-account versus `/api/me` identity observation
  is inherited without asking the owner to repeat the login sequence.

## S1 — Existing-model audit

Status: complete

- `CanonicalHamiltonian` remains the only canonical qubit Hamiltonian.
- `CanonicalExcitationCircuit` remains the qualified H2 resource-protocol
  source; Phase 7.7 generalizes interchange without changing that fixture.
- Provider imports remain confined to runtime adapters.

## S2 — Canonical fermionic operator

Status: complete

- Added immutable fermionic terms with explicit ladder actions and spin-orbital
  ordering.
- Coefficients use exact IEEE-754 hexadecimal encoding.
- Non-finite coefficients, invalid indices, and digest tampering fail closed.

## S3 — Canonical state and parametric circuit

Status: complete

- Added a provider-neutral basis-state model with explicit qubit ordering.
- Added symbolic Pauli rotations and immutable parameter slots.
- Scientific digests are independent of Qiskit, PennyLane, and OpenFermion.

## S4 — Conversion graph and evidence

Status: complete

- Added role-specific representations, typed conversion edges, and immutable
  evidence bundles.
- Missing, ambiguous, unverified, and discontinuous paths are rejected.
- Adapter identity and verification witness remain execution evidence, not
  portable scientific identity.

## S5 — OpenFermion adapter

Status: complete

- OpenFermion is pinned only in the adapter runtime.
- Frozen H2 input converts through canonical fermionic and Jordan-Wigner
  representations.
- Reverse-Jordan-Wigner makes this a structural round-trip test, not an
  independent molecular derivation.
- The observed maximum matrix difference is
  `1.000532989792191e-12`, below the declared `2e-12` tolerance. Exact content
  identity is explicitly not claimed.

## S6 — Qiskit and PennyLane adapters

Status: complete

- Qiskit `SparsePauliOp` round-trip preserves exact canonical content.
- PennyLane reconstructs the same Hamiltonian matrix.
- Explicit Qiskit little-endian normalization prevents silent basis-order
  disagreement.

## S7 — H2 equivalence evidence

Status: complete

- Qiskit/PennyLane Hamiltonian maximum matrix difference: `0.0`.
- Qiskit/PennyLane statevector absolute overlap:
  `0.9999999999999896` on Linux/amd64.
- Canonical resource counts remain protocol-defined and are not replaced by
  provider-native diagnostics.

## S8 — Workflow/Registry integration

Status: complete

- Portable workflow identity continues to contain only canonical scientific
  digests.
- Adapter/runtime identity is represented by conversion evidence and execution
  resolution.
- No database migration is required because Phase 7.7 adds evidence types
  without rewriting Phase 7.6 scientific records.

## S9 — Fixed Linux/amd64 reproduction

Status: complete

- Built and executed a Linux/amd64 image from a digest-pinned Python base and
  frozen `uv.lock`.
- Execution used a non-root UID, read-only filesystem, deny-all network,
  dropped capabilities, no-new-privileges, and bounded PID/CPU/memory settings.
- The verified image digest and observed output are recorded in
  `evidence/phase77/linux_amd64_conversion_evidence.json`.
- A full-disk condition initially caused Docker Desktop export to fail. Only
  disposable package caches were cleared; the daemon was restarted; the build
  then succeeded. No repository or scientific data was removed.

## S10 — Closeout

Status: complete

- Public execution, performance claims, and human-reviewed status remain
  blocked.
- Pure-domain regression suite: `208 passed`.
- Locked provider-adapter suite: `6 passed`.
- Relevant API/worker regression suite: `35 passed`.
- Ruff, provider-import boundary scan, secret-pattern scan, JSON/hash
  cross-check, and `git diff --check` passed.
- Final Linux/amd64 image:
  `sha256:f45c496286e7b7f5ffeb8b2e57153f80236b243dcb9a2ce83339ed904d4b4fac`.
- Commit and push are the only remaining delivery operations.
