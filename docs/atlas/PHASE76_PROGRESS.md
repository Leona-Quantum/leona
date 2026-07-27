# Atlas VQE Phase 7.6 progress

Date: 2026-07-28 JST  
Branch: `feature/vqe`  
Starting commit: `ef62a005479e9a141715406d02e65ecff442c79f`  
Starting Alembic head: `0038`  
State: **S0 verified locally; S1 in progress**

## S0 — Baseline freeze and claim inventory

### Outcome

The pre-remediation Phase 7.5 state is frozen under
`docs/atlas/evidence/phase76/`.

```text
standard component seed candidates: 29
generated implementation bindings: 28
Workflow templates: 7
comparison specifications: 3
```

The 28 bindings are explicitly recorded as a pre-remediation Cartesian
projection, not as 28 independently runtime-qualified Component
implementations.

### Scientific protocol

The first Phase 7.6 comparison is fixed to:

```text
H2 / STO-3G / 0.735 Å / neutral singlet
Jordan–Wigner / four qubits / no tapering
Hartree–Fock |1010> in canonical qubit0-first ordering
one canonical double-excitation parameter
exact statevector energy
canonical ansatz-only CNOT/depth protocol
bounded scalar baseline vs SLSQP candidate
```

Identity evidence:

```text
fixture manifest SHA-256:
  6424713c69c2b734172db47329b7deb62b67a743c80fd792f48173fdaa4e3edc
Hamiltonian legacy digest:
  d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79
canonical circuit SHA-256:
  f4fdb1ac3f041185fff63f6a7acb9d3ab1e9742131ed5bd3bb9ba2d99081a58c
compilation protocol SHA-256:
  778fe0c7f3d361c54e9c41a0240ef31cc7926dacbe8fbc33ff96a57ee104393c
```

### Fresh local observations

Both current locked environments were executed with `--stdout-only`; the
canonical fixture was not mutated.

| Framework | Energy (Ha) | Absolute error (Ha) | Objective evaluations | CNOT | Depth |
|---|---:|---:|---:|---:|---:|
| Qiskit 1.4.6 | -1.137306035753356 | 1.7763568394002505e-14 | 14 | 48 | 83 |
| PennyLane 0.45.1 | -1.137306035753356 | 1.7763568394002505e-14 | 21 | 48 | 83 |

The local host was macOS arm64. These observations confirm the current local
scientific behavior, but do not replace the recorded digest-pinned
Linux/x86_64 runtime qualification.

The different objective-evaluation counts are retained as evidence. They show
that equal final energy and equal optimizer name do not imply equal numerical
work across evaluator implementations. Phase 7.6 therefore treats objective
evaluations as a first-class comparison metric.

### Existing implementation discovered

`majorana_vqe.executable` already contains a strong typed H2 executable schema:

- exact geometry, charge, multiplicity, basis, active electrons and orbitals;
- preparation provider/version and orbital conventions;
- mapping, qubit ordering, reference state;
- generator definition, normalization convention, order, parameter slot and
  canonical circuit digest;
- SciPy bounded optimizer configuration;
- exact measurement and fixed compilation/resource protocol;
- cross-component invariants.

Phase 7.6 S2 must extend and connect this implementation. It must not create a
second competing scientific schema.

### Verification

```text
baseline generator --check: passed
targeted VQE tests: 17 passed
```

Covered tests:

- typed executable Component validation;
- current Qiskit/PennyLane scientific-input equality;
- energy/state/parameter agreement;
- canonical resource equality;
- current standard-catalog behavior.

### S0 decision

S0: **verified_local**

No scientific identity field required by the existing H2 slice is unknown.
S1 may proceed.

## Current safety boundary

- No public publication.
- No verified scientific badge.
- No production/main Neon migration.
- No external Repository code execution.
- No new Component catalog expansion.
- Evidence is additive and the canonical H2 fixture remains unchanged.
