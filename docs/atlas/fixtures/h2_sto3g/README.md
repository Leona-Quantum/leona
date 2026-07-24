# H2/STO-3G Phase 0B fixture

Status: **automated cross-validation PASS. Human/owner review PENDING.**
Do not treat `manifest.json` as the reviewed golden fixture required by
`atlas_vqe_mvp_execution_plan_ja.md` Part III §12 until an owner has signed
off — see `manifest.json`'s `review_record` field.

This directory is the output of the Phase 0B scientific spike: proving the
Qiskit-current and PennyLane-current runtime candidates
(`runtimes/vqe/qiskit-current/`, `runtimes/vqe/pennylane-current/`) can
independently reproduce the same H2/STO-3G ground-state physics before any
DB/API/UI work begins.

## What's here

- `raw/qiskit_current.json`, `raw/pennylane_current.json` — unmodified spike
  output from each runtime candidate: an independent PySCF FCI reference
  energy (no qubit mapping involved), plus that candidate's own
  Jordan-Wigner-mapped qubit Hamiltonian and its exact-diagonalization
  ground-state energy.
- `manifest.json` — the cross-checked, frozen result: canonical Hamiltonian
  (Qiskit's qubit-ordering convention, electronic-only), its SHA-256 digest,
  the discovered qubit-permutation + local-Pauli-frame correspondence between
  the two candidates' native conventions, and both energies' agreement with
  the independent FCI reference.
- `generate_fixture.py` — stdlib + numpy only, reads the two `raw/*.json`
  files and writes `manifest.json`. Fails loudly (non-zero exit) rather than
  writing a fixture if any cross-check fails.

## Headline result (see `manifest.json` for full detail)

- Geometry: H–H, 0.735 Å, STO-3G, singlet, no frozen core, Jordan-Wigner, 4 qubits.
- Independent direct FCI reference: **-1.1373060357534004 Ha**.
- Qiskit-current qubit-Hamiltonian exact diagonalization: -1.1373060357533982 Ha
  (error vs. FCI: 2.2e-15 Ha).
- PennyLane-current qubit-Hamiltonian exact diagonalization: -1.1373060357532858 Ha
  (error vs. FCI: 1.1e-13 Ha).
- The two candidates' canonical Hamiltonians are **not** byte-identical out of
  the box: PennyLane bakes nuclear repulsion into its identity coefficient
  (Qiskit does not), and the two libraries assign spin-orbitals to qubits
  differently (block vs. interleaved) with a per-qubit Jordan-Wigner
  phase-convention difference on 2 of the 4 qubits. Both are accounted for
  explicitly and reconciled by an exhaustive search (not assumed) —
  see `cross_framework_equivalence` in `manifest.json`. An independent
  full 16-eigenvalue spectrum match (`spectrum_cross_check`) confirmed the
  two operators are physically identical *before* that reconciliation was
  attempted, so the search was known to be looking for a real correspondence,
  not chasing a coincidence.

## Deliberately NOT in this fixture yet

`ansatz_and_initial_point` is `not_defined`. Phase 0 acceptance only requires
the exact energy and canonical Hamiltonian (`atlas_vqe_mvp_execution_plan_ja.md`
Phase 0 Acceptance); an approved ansatz, initial point, and VQE-accepted
tolerance (<=1e-5 Ha) are Phase 1/5 scope and require their own owner review.

## Regenerating

```bash
cd runtimes/vqe/qiskit-current && uv run python spike/h2_sto3g_spike.py
cd runtimes/vqe/pennylane-current && uv run python spike/h2_sto3g_spike.py
cd docs/atlas/fixtures/h2_sto3g && python3 generate_fixture.py
```

Coefficients are rounded to 12 decimal places before hashing
(`coefficient_rounding_decimals` in the manifest), so the digest is stable
across re-runs despite SCF-convergence-level float jitter in the last few
ULPs — regenerating should reproduce the same `hamiltonian_digest_sha256`.
