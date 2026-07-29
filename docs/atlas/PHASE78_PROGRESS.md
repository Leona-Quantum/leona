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
- S6 remote reproducibility: OCI publish complete; private E2E pending

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

The source payload was frozen at
`a4c11cf5be8d5235901f1c1399f483e381833d4a` and the two Linux/amd64 images
were built, SBOM-attached, provenance-attested, and published successfully by
[GitHub Actions run 30427673977](https://github.com/EshMis/majorana/actions/runs/30427673977).

- Qiskit OCI index:
  `sha256:17a1ee0690ce768a076c370ee17c36de5f536ff4b61d8ebe4ae43b961a277b76`
- PennyLane OCI index:
  `sha256:e29149db8efb338c4dd82879909ad8dd4928174309bc0b9fc1b7db0ef2a21930`

The immutable publish records are stored in:

- `docs/atlas/evidence/phase78/qiskit_oci_publish.json`;
- `docs/atlas/evidence/phase78/pennylane_oci_publish.json`.

The prior production-v1 profiles remain resolvable for historical execution
bindings. New executions select production-v2 with adapter release 0.3.0.

COBYLA must remain a private qualification candidate until the remaining
remote gate succeeds:

1. run the private PostgreSQL + WorkOS-contract + real-OCI E2E;
2. record the exact GitHub Actions run and evidence artifact.

## Claim boundary

This phase establishes executable interoperability and controlled component
replacement only. It does not establish optimizer superiority or a public
scientific result.
