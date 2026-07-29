# Phase 7.8 — H₂ UCCSD private executable plan

## Decision boundary

This increment promotes the existing structured `ansatz.uccsd.v1` seed toward
one private executable H₂/STO-3G workflow. It does not rename or mutate the
frozen one-parameter H₂ double-excitation workflow.

The scientific claim is deliberately narrow:

> Under the frozen H₂/STO-3G problem, Jordan–Wigner mapping, Hartree–Fock
> reference, exact statevector measurement, and offline exact-energy
> acceptance protocol, Atlas can construct and independently evaluate the
> same explicitly ordered three-parameter UCCSD product in the qualified
> Qiskit and PennyLane runtimes.

No performance superiority, public execution, or public scientific result is
claimed.

## Frozen UCCSD configuration

- molecule: H₂ at the existing frozen geometry;
- basis: STO-3G;
- active space: two electrons in four spin orbitals;
- orbital and qubit order:
  `canonical_rhf_spin_orbitals_alpha_then_beta`, qubit 0 first;
- mapping: Jordan–Wigner;
- reference state: `1010`, qubit 0 first;
- generator convention: anti-Hermitian `tau - tau†`;
- parameter orientation: `exp(theta * generator)`;
- product formula: first-order, one repetition;
- parameter sharing: none;
- ordered generators:
  1. double excitation `0,2 -> 1,3`;
  2. alpha single excitation `0 -> 1`;
  3. beta single excitation `2 -> 3`;
- independent parameter count: three.

The ordered product is a Component Configuration, not part of the provider-
neutral meaning of every possible UCCSD implementation. The double-before-
singles order matches PennyLane 0.45.1's documented/decomposed UCCSD template
for one repetition. Provider-native circuits remain diagnostics only; the
primary resource comparison uses the Atlas canonical logical circuit.

## Parameter-scaling boundary

The earlier fixed H₂ ansatz uses `exp(theta / 2 * G)`. This UCCSD configuration
uses the conventional `exp(theta * G)`. The two parameter values therefore
must never be compared or reused as if they had the same orientation.
Controlled comparison may replace the ansatz component, but it must preserve
each ansatz's own typed parameter slots and record that all three UCCSD slots
are newly initialized.

## Common resource protocol

The canonical circuit is the sequential Jordan–Wigner Pauli-rotation
decomposition of the three generators above.

- metric scope: ansatz only;
- reference preparation: excluded;
- measurement: excluded;
- routing and hardware optimization: excluded;
- basis: `h`, `s`, `sdg`, `rz`, `cx`;
- topology: four-qubit all-to-all;
- compiler: deterministic Atlas Pauli-rotation compiler;
- parameter count: three;
- expected rotations: twelve (eight double, two per single);
- CNOT and depth values: generated and independently checked, never entered
  from a provider-native transpiler.

## Optimizer protocol

The scalar bounded optimizer is incompatible and must fail closed. The first
executable UCCSD candidate uses a vector SLSQP configuration with:

- three zero-valued initial slots;
- identical `[-pi, pi]` bounds for each slot;
- the same explicit energy tolerance and hard objective-call budget across
  Qiskit and PennyLane;
- complete vector-valued trajectory evidence;
- no inference that fewer calls or lower wall time implies scientific
  superiority.

## Applicability

UCCSD is a fixed ansatz. Operator pool, search selection, and growth batching
are scientifically `not_applicable`; placeholder singleton ADAPT components
must not be retained merely to satisfy an old executable schema.

## Qualification sequence

1. Add a provider-neutral typed UCCSD configuration and canonical circuit.
2. Generate an immutable fixture and digest.
3. Add fail-closed three-parameter composition validation.
4. Add bounded vector optimization without changing the frozen scalar path.
5. Add independent Qiskit and PennyLane canonical adapters.
6. Prove Hamiltonian, reference, generator order, parameter orientation,
   resource sequence, energy, and state overlap parity locally.
7. Add the controlled fixed-ansatz → UCCSD swap and private persistence path.
8. Publish exact Linux/amd64 OCI images and record registry index digests.
9. Run the authenticated private deployed E2E with disposable database state.
10. Only after all prior gates pass, promote the implementation binding to
    `runtime_qualified`. The workflow remains private and publication-blocked.

## Rollback

Any mismatch in provider state, energy, parameter orientation, operation
sequence, resource metric, digest, persistence isolation, or session reopen
returns the UCCSD binding to structured/adapter-tested status. The frozen
one-parameter workflow and Phase 7.8 COBYLA evidence are not modified.
