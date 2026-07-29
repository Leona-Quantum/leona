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
  disposable package caches were cleared; no repository or scientific data was
  removed. Because the local Docker VM did not recover cleanly, the final image
  was rebuilt and hardened-executed on a clean GitHub-hosted Linux/amd64 runner.
- Qualification run:
  `https://github.com/EshMis/majorana/actions/runs/30391378015`.
- The reusable manual qualification workflow remains fail-closed and requires
  an immutable full source commit after it reaches the default branch.

## S10 — Closeout

Status: complete

- Public execution, performance claims, and human-reviewed status remain
  blocked.
- Pure-domain regression suite: `208 passed`.
- Locked provider-adapter suite: `6 passed`.
- Relevant API/worker regression suite: `50 passed`.
- Ruff, import-linter, provider-import boundary scan, JSON parsing,
  digest-to-image matching, and `git diff --check` passed.
- Closeout review added fail-closed checks for falsely normal-ordered
  fermionic monomials, repeated ladder operators, all-identity symbolic
  rotations, incomplete/extra/non-finite parameter assignments, and invalid
  witness tolerances.
- Final Linux/amd64 image:
  `sha256:dcd947ad182577e459e470a57548ddfa4c8a3f815135526b6fce02af3d8b91c7`.

## Recorded limitations

- The OpenFermion path starts from reverse-Jordan-Wigner applied to the frozen
  qubit fixture. It verifies the declared interchange path but is not an
  independent electronic-structure derivation.
- The OpenFermion round trip is matrix-equivalent within `2e-12`; exact
  canonical-content identity is not claimed because an approximately-zero
  numerical term is removed.
- The evidence covers one H2/STO-3G fixture and one canonical parametric
  excitation. It does not establish equivalence for arbitrary molecules,
  mappings, ansätze, or provider releases.
- Human review, public execution, and performance claims remain blocked.
- The inherited WorkOS selected-account versus `/api/me` identity discrepancy
  remains unresolved and was not converted into a success claim.

## Post-closeout DEV synchronization (2026-07-29)

Status: verified locally

- `origin/dev` at `b5fe8d96` was merged into `feature/vqe`; the pre-merge VQE
  tip is retained as
  `safety/feature-vqe-pre-dev-sync-20260729` (`8520a8be`).
- DEV remains authoritative for WorkOS identity, active-workspace selection,
  shared-workspace membership, the simple circuit pipeline, and normal run
  execution. Phase 7.7 retains only additive VQE registry, conversion,
  qualification, and private-evidence behavior.
- Eight textual merge conflicts were resolved. Two additional identity
  collisions that Git cannot detect were also removed:
  - DEV ADR-0023 remains fixed; VQE ADRs moved from 0023–0033 to 0024–0034.
  - DEV database revisions 0035–0038 remain fixed; VQE revisions moved from
    0035–0039 to 0039–0043, preserving one linear Alembic head.
- Historical evidence files remain immutable. Consequently, evidence captured
  before this synchronization can contain the revision numbers that were valid
  at capture time. Current code and new evidence use revisions 0039–0043.
- Local verification after the merge:
  - Python: `1358 passed, 168 skipped`.
  - Web: `242 passed`.
  - Turbo lint/typecheck/test: all six tasks passed.
  - Next.js production build: passed.
  - Ruff, import-linter, raw-query scan, and `git diff --check`: passed.
  - Fresh PostgreSQL migration round trip
    (`upgrade head → downgrade base → upgrade head`): passed with one head at
    revision 0043.
- The first post-merge remote `vqe-production-e2e` run correctly failed closed
  because its legacy job still presented a disposable Neon URL while
  `MAJORANA_ENV=production`. DEV moved production persistence to Cloud SQL on
  2026-07-27 and now rejects that split-brain risk. The VQE E2E was therefore
  aligned with DEV rather than bypassing the guard:
  - its isolated database is now PostgreSQL 17, matching the normal DEV CI and
    production PostgreSQL major version;
  - provisioning accepts only the exact loopback `majorana_vqe_e2e` database
    created inside GitHub Actions;
  - WorkOS-shaped JWT verification, digest-pinned OCI execution, and private
    evidence materialization remain covered;
  - the test explicitly does not claim use of a live WorkOS tenant or the
    production Cloud SQL database.
- These checks establish that the synchronized branch is internally
  consistent. They do not claim that future DEV commits cannot conflict, and
  they do not lift the existing blocks on publication, human-reviewed status,
  or performance claims.
