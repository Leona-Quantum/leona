# Phase 7.8 — H₂ hardware-efficient RY–CX private executable plan

## Scope and claim boundary

This slice adds one bounded, provider-neutral hardware-efficient ansatz for the
existing H₂/STO-3G/Jordan–Wigner problem. It does not alter the qualified
fixed-excitation, COBYLA, or UCCSD records.

The scientific object is an Atlas-neutral ordered gate definition. It is not
defined by a Qiskit `TwoLocal` class or a PennyLane template because provider
defaults, parameter order, and topology may change by version. Qiskit and
PennyLane adapters must consume the same canonical operation list.

This slice may establish private reproducibility and provider equivalence. It
must not claim public execution, hardware performance, trainability beyond this
H₂ instance, or superiority over UCCSD.

## S0 — frozen scientific specification

| Field | Frozen value |
|---|---|
| Problem | existing H₂, 0.735 Å, STO-3G, 2 electrons |
| Mapping/order | existing Jordan–Wigner, four qubits, qubit-0-first metadata |
| Reference state | existing external Hartree–Fock bitstring `1010` |
| Rotation | `RY` on qubits 0, 1, 2, 3 |
| Entangler | directed linear `CX(0,1)`, `CX(1,2)`, `CX(2,3)` |
| Repetitions | two `RY-all → CX-linear` layers |
| Final rotation layer | absent |
| Parameter sharing | none |
| Parameter count | 8 |
| Optimizer | existing bounded vector SLSQP protocol |
| Measurement | existing exact statevector protocol |
| Noise/hardware | none |

The provider-neutral circuit identity is:

```text
h2.hardware_efficient.ry_linear_cx.reps2.v1
```

The canonical fixture is:

```text
docs/atlas/fixtures/h2_sto3g/canonical_hardware_efficient_v0.1.json
```

Its frozen digests are:

```text
canonical circuit:
  7e28b52d16d694ac59e8b1a2ce2f9b6e215df60e67ac9b3521231e10859016c8
operation sequence:
  349652753a7114f9cdaf6582670594fd07341f846508dc7f51d4094162365c02
compilation protocol:
  c088fcfb95244dbba960cd096fd58fea8e9f289fbce509758e1a59f58270539c
```

## Initialization and low-cost calibration disclosure

An all-zero point is not neutral for this circuit: the parameter-free CX
layers still transform the Hartree–Fock state, and the observed SLSQP run
terminated at a poor stationary point. Before freezing S0, three deterministic
non-zero seeds were evaluated locally on the same exact H₂ objective:

1. monotone symmetric ramp;
2. palindromic symmetry-breaking seed;
3. constant `0.1` seed.

The palindromic seed was selected because it converged within the existing
256-evaluation hard budget and had the lowest observed error of those three
candidates:

```text
[-0.2, -0.1, 0.1, 0.2, 0.2, 0.1, -0.1, -0.2]
```

This is benchmark-specific calibration, not learned initialization and not an
unbiased ansatz comparison. The exact IEEE-754 bytes and slot order are part of
the canonical fixture. Any future comparison must report this calibration and
must not describe initialization as fixed across ansätze.

## Resource protocol

The primary resource scope is ansatz-only and excludes reference-state
preparation, measurement, provider optimization, hardware mapping, and
routing.

```text
basis: RY, CX
logical/common-basis gates: 14
CNOT: 6
ASAP unit-duration dependency depth: 7
parameters: 8
```

Provider-native compiled resources may be retained only as diagnostic evidence
and are not directly comparable unless their compiler protocol is separately
frozen.

## Capability migration and comparison semantics

The transition from UCCSD to this ansatz changes the primary `ansatz` role and
the dependent compilation protocol. Operator-pool, search-selection, and
growth-batching remain not applicable. Therefore:

- it is a controlled capability migration with ansatz as the primary change;
- it is not a strict one-role persisted comparison if compilation identity is
  represented as a separate scientific role;
- energy/resource tables may be shown only with the changed and dependent
  roles explicitly listed;
- no performance ranking is permitted from one initialization and one H₂
  instance.

The existing catalog comparison design must remain an unevaluated specification
until this migration and its evidence are materialized.

## Implementation sequence

1. **S0 specification** — freeze fields, calibration disclosure, and claim
   boundary.
2. **S1 domain model** — immutable provider-neutral schema, deterministic
   fixture, stale-file CI check, mutation rejection tests.
3. **S2 local adapters** — independent Qiskit 1.4.6 and PennyLane 0.45.1
   execution from the canonical list.
4. **S3 equivalence** — operation digest, statevector/energy agreement,
   resource protocol, optimizer trajectory schema, version-drift tests.
5. **S4 Registry/API/worker** — typed capability and private migration,
   fail-closed role applicability, scoped persistence.
6. **S5 UI** — component-first private workflow creation/reopen; no public
   badge or performance claim.
7. **S6 Linux/amd64** — digest-pinned OCI, SBOM, provenance, deny-all egress,
   private E2E, durable evidence.

## Acceptance gates

- Qiskit and PennyLane consume the exact same ordered operation list.
- Both use the exact parameter-slot order and IEEE-754 initial bytes.
- Both independently derive and verify the operation/protocol digests.
- Energy error and state fidelity gates are defined before remote
  qualification.
- The 256 objective-evaluation cap is enforced before exceeding it.
- Failure, timeout, digest mismatch, or parameter-shape mismatch fails closed.
- Catalog status does not become runtime-qualified before immutable OCI and
  private E2E evidence exist.
- Human review remains owner-waived and public execution/publication remain
  blocked.
