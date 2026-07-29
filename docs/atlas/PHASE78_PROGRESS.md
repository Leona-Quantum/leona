# Phase 7.8 progress

## Scope

Only `optimizer.cobyla.v1` is being promoted from a structured catalog entry
to a private executable component. H₂ UCCSD and all later Phase 7.8 additions
remain deferred until this slice closes.

## Status

- S0 specification: complete
- S1 domain model: complete
- S2 runtime adapter: complete locally
- S3 Registry/API/worker: complete locally
- S4 component-first UI: complete locally
- S5 verification/evidence: complete for private macOS/arm64 adapter evidence
- S6 remote reproducibility: pending

## Local verification

- Qiskit 1.4.6 + SciPy 1.18.0:
  - energy: `-1.137306035753356 Ha`;
  - absolute error: `1.7763568394002505e-14 Ha`;
  - COBYLA energy evaluations: `42`.
- PennyLane 0.45.1 + SciPy 1.18.0:
  - energy: `-1.137306035753355 Ha`;
  - absolute error: `1.865174681370263e-14 Ha`;
  - COBYLA energy evaluations: `43`.
- Common ansatz-only protocol for both:
  - CNOT: `48`;
  - depth: `83`;
  - total gates: `152`;
  - parameters: `1`.

The observations above were produced on macOS/arm64. They establish adapter
behaviour only. They do not qualify a Linux/amd64 OCI image or the deployed
private execution path.

The machine-checked local evidence bundle is:

- `docs/atlas/evidence/phase78/qiskit_cobyla_local.json`;
- `docs/atlas/evidence/phase78/pennylane_cobyla_local.json`;
- `docs/atlas/evidence/phase78/manifest.json`.

`services/worker/tests/test_vqe_runtime.py` independently loads both raw
reports, applies the typed evidence adapter, checks the optimizer identity and
resource protocol, and rejects an attempted SLSQP reinterpretation.

## Remote gate

The currently configured production OCI digests predate the COBYLA adapter.
Therefore COBYLA must remain non-qualified until all of the following occur:

1. commit the exact runtime payload;
2. build and attest new Linux/amd64 images from that commit;
3. bind the returned immutable OCI digests and attestations;
4. run the private PostgreSQL + WorkOS-contract + real-OCI E2E;
5. record the exact GitHub Actions runs and evidence artifacts.

## Claim boundary

This phase establishes executable interoperability and controlled component
replacement only. It does not establish optimizer superiority or a public
scientific result.
