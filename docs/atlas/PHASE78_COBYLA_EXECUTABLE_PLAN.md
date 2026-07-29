# Phase 7.8 — First additional executable component: COBYLA

## Decision

Phase 7.8 adds exactly one new executable component:
`optimizer.cobyla.v1`.

The scientific question is deliberately narrow:

> Can the frozen H₂/STO-3G one-parameter workflow replace only its optimizer
> with SciPy COBYLA while preserving every other scientific component and
> producing independently measured Qiskit and PennyLane evidence?

This phase does not claim that COBYLA is faster, more accurate, or generally
better than SLSQP. Public execution, publication, and performance claims
remain blocked.

## Frozen comparison boundary

The following remain identical:

- H₂ geometry, basis, active space, Hamiltonian snapshot, and reference energy;
- Jordan–Wigner mapping and qubit ordering;
- Hartree–Fock reference state;
- canonical one-parameter double-excitation ansatz;
- exact-statevector measurement;
- canonical logical CNOT/depth protocol;
- initial parameter, bounds, objective-evaluation cap, and wall-time cap;
- Qiskit and PennyLane package/runtime pins.

The only changed semantic role is `parameter_optimizer`:

```text
optimizer.slsqp.v1 -> optimizer.cobyla.v1
```

## COBYLA-specific semantics

SciPy documents COBYLA `tol` as a lower bound on the final trust-region size,
not as an energy-convergence tolerance. It must therefore never be populated
from `energy_tolerance_float64_hex`.

The executable COBYLA component records these distinct fields:

- `initial_trust_region_radius_float64_hex`;
- `final_trust_region_radius_float64_hex`;
- `constraint_tolerance_float64_hex`.

The shared objective-evaluation cap remains authoritative. SciPy COBYLA
interprets `maxiter` as the maximum number of objective evaluations; Atlas
also guards the objective before every call, so the cap fails closed even if a
provider changes behaviour.

Official semantics:
<https://docs.scipy.org/doc/scipy/reference/optimize.minimize-cobyla.html>

## Step gates

### S0 — specification

- freeze the one-component comparison boundary;
- distinguish energy tolerance from trust-region tolerance;
- keep all claims private and owner-waived.

### S1 — domain model

- admit `optimizer.cobyla.v1` into the H₂ portable identity;
- require all COBYLA-specific fields and reject them on non-COBYLA optimizers;
- preserve provider/version separation from scientific identity.

### S2 — runtime adapter

- implement `scipy_cobyla` in the shared optimizer protocol;
- pass the same algorithm into both Qiskit and PennyLane adapters;
- reject unsupported algorithms and over-budget objective calls.

### S3 — Registry/API/worker

- allow only SLSQP or COBYLA optimizer swaps;
- resolve the semantic key to the matching runtime algorithm;
- keep every non-optimizer Registry UUID equal to the frozen baseline;
- preserve idempotency and tenant scope.

### S4 — component-first UI

- allow either supported optimizer to be saved from the workflow composer;
- name the selected optimizer instead of hard-coding SLSQP copy;
- retain the private/non-public warning.

### S5 — verification and evidence

- test quadratic recovery, bounds, determinism, hard budgets, and invalid specs;
- execute both provider adapters locally;
- verify energy, fidelity, resource metrics, and optimizer identity;
- generate private evidence without modifying frozen Phase 5 fixtures.

### S6 — remote reproducibility

- commit and push only after the relevant and full local gates pass;
- require GitHub CI and VQE E2E to finish successfully;
- record exact commit and run URLs in the progress log.

## Acceptance criteria

- COBYLA is not merely listed; it can be selected, saved, resolved, executed,
  and materialized privately.
- Qiskit and PennyLane report `optimization.algorithm == "scipy_cobyla"`.
- The two providers agree within the existing H₂ acceptance tolerance.
- CNOT, depth, and parameter counts remain 48, 83, and 1 under the common
  ansatz-only protocol.
- A controlled-comparison record shows exactly one changed role.
- No result is labelled human-reviewed, public, or performance-superior.

