# Phase 7.8 progress

## Scope

`optimizer.cobyla.v1` and the bounded H₂ UCCSD capability have completed
private runtime qualification. Later Phase 7.8 additions remain deferred; this
document does not promote either slice to public execution or publication.

## Status

- S0 specification: complete
- S1 domain model: complete
- S2 runtime adapter: complete locally
- S3 Registry/API/worker: complete locally
- S4 component-first UI: complete locally
- S5 verification/evidence: complete for private macOS/arm64 and Linux/amd64
  evidence
- S6 remote reproducibility: complete for private COBYLA, UCCSD, and bounded
  hardware-efficient qualification

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

The private PostgreSQL + WorkOS-contract + real-OCI E2E succeeded on source
commit `1b0c926a3cc06e9f7a1fb3efcc375f0595874f17`:

- CI:
  [GitHub Actions run 30428158003](https://github.com/EshMis/majorana/actions/runs/30428158003);
- private VQE E2E:
  [GitHub Actions run 30428157848](https://github.com/EshMis/majorana/actions/runs/30428157848);
- uploaded evidence artifact:
  `phase78-cobyla-private-ci-e2e-1b0c926a3cc06e9f7a1fb3efcc375f0595874f17`
  (artifact ID `8714432254`);
- durable qualification record:
  `docs/atlas/evidence/phase78/s6_private_oci_e2e.json`.

The E2E used an isolated PostgreSQL 17 database, a synthetic WorkOS-shaped JWT
contract, the exact Linux/amd64 OCI digests above, and separate Qiskit and
PennyLane executions. It verified exactly one changed role
(`parameter_optimizer`), private materialization for both providers, failure
handling, and session reopening. It did not perform a live human WorkOS login.

`optimizer.cobyla.v1:scipy:1.18.0` is therefore recorded as
`runtime_qualified`, with the local reports, immutable OCI publication records,
and private E2E record all retained as evidence locators. The COBYLA workflow
template remains `structured`: a runnable candidate is produced by cloning the
frozen executable baseline and saving the one-role swap. It is not promoted to
a standalone public Registry workflow.

## Phase close

Phase 7.8 COBYLA is complete for the stated private acceptance boundary:

- selectable and saveable as the sole controlled component change;
- resolved to `scipy_cobyla`;
- executed independently by Qiskit and PennyLane;
- materialized and reopened privately;
- qualified against digest-pinned Linux/amd64 runtimes;
- blocked from public execution and publication.

Human review remains owner-waived. The synthetic authentication contract is
adequate for this private CI qualification but is not evidence of a live
WorkOS tenant session.

## H₂ hardware-efficient RY–CX slice

### Current status

- S0 scientific specification and claim boundary: complete;
- S1 provider-neutral immutable model and generated fixture: complete locally;
- stale UCCSD fixture check: corrected from fail-open to fail-closed;
- S2 Qiskit/PennyLane runtime adapters: complete locally on macOS/arm64;
- S3 provider equivalence evidence: complete locally;
- S4 Registry/API/worker: complete for the bounded private path;
- S5 private UI workflow: complete;
- S6 Linux/amd64 OCI and remote private E2E: complete.

The authoritative bounded specification is
`docs/atlas/PHASE78_H2_HARDWARE_EFFICIENT_EXECUTABLE_PLAN.md`. The canonical
fixture fixes two RY-all/CX-linear layers, eight independent parameters, no
final rotation layer, a benchmark-specific disclosed non-zero seed, and an
ansatz-only common resource protocol.

Independent local reports are retained at:

- `docs/atlas/fixtures/h2_sto3g/raw/qiskit_hardware_efficient_v0.1.json`;
- `docs/atlas/fixtures/h2_sto3g/raw/pennylane_hardware_efficient_v0.1.json`.

Both adapters consumed the same ordered operation list, parameter-slot order,
IEEE-754 initialization bytes, SLSQP settings, and 256-evaluation hard cap.
They independently reconstructed and verified the operation and compilation
protocol digests.

| Adapter | Energy (Ha) | Absolute error (Ha) | Fidelity | Evaluations |
| --- | ---: | ---: | ---: | ---: |
| Qiskit 1.4.6 | -1.137306035753359 | 1.465e-14 | 0.999999999999988 | 164 |
| PennyLane 0.45.1 | -1.137306035753367 | 7.105e-15 | 0.999999999999996 | 164 |

The common ansatz-only resource record is CNOT 6, depth 7, 14 gates, and eight
independent parameters. Provider-native metrics include Hartree–Fock
preparation and are retained only as non-comparable diagnostics.

These macOS/arm64 observations establish local adapter agreement only. Runtime
qualification instead rests on the immutable Linux/amd64 and private E2E
records below. The public catalog record remains structured, and the existing
UCCSD-vs-hardware-efficient comparison remains an unevaluated design rather
than a performance result.

### Hardware-efficient immutable OCI and private E2E

The hardened Linux/amd64 verification succeeded in
[GitHub Actions run 30623109464](https://github.com/EshMis/majorana/actions/runs/30623109464).
Both adapters completed 164 objective evaluations under deny-all egress,
read-only root filesystems, dropped Linux capabilities, no-new-privileges, and
bounded resources:

| Adapter | Energy (Ha) | Absolute error (Ha) | Fidelity | CNOT | Depth | Parameters |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Qiskit 1.4.6 | -1.137306035753359 | 1.510e-14 | 0.999999999999991 | 6 | 7 | 8 |
| PennyLane 0.45.1 | -1.137306035753365 | 8.882e-15 | 0.999999999999992 | 6 | 7 | 8 |

The images were published from source commit
`119df80ac4c642dfa64a7e8468b5c82bec99f7d8` by
[GitHub Actions run 30623203874](https://github.com/EshMis/majorana/actions/runs/30623203874):

- Qiskit OCI index:
  `sha256:1bd4a30499fdb945ee61a89b703d28287eabe2d4dedf610c8a9b4fef6fee555d`;
- Qiskit Linux/amd64 manifest:
  `sha256:ad122a102153447add22f0e2578c5d2aabb61533f94ad0636e23418b451ac47c`;
- PennyLane OCI index:
  `sha256:f6977dcf8cdd99b198c739f6d1f33c98dcf840235a40f66c5632dd5adddeb207`;
- PennyLane Linux/amd64 manifest:
  `sha256:717f1281c825967330bba99d3e9b8ea85ab6aac29c1c2d4954568af169cda2b4`.

Each image has a retained SBOM, provenance statement, and GitHub attestation.
The private authentication → isolated PostgreSQL 17 → exact OCI → worker →
private artifact → separate-session reopen path succeeded in
[GitHub Actions run 30624939038](https://github.com/EshMis/majorana/actions/runs/30624939038)
on source commit `f623e0e1616b67957f020cb7697a67f40d09a6e4`.
The corresponding general
[CI run 30624938943](https://github.com/EshMis/majorana/actions/runs/30624938943)
also succeeded.

The durable record is
`docs/atlas/evidence/phase78/hardware_efficient_private_oci_qualification.json`.
It distinguishes the synthetic WorkOS-shaped JWT contract, disposable
database, and GitHub Actions Docker host from a live WorkOS tenant, Neon
production database, or permanent deployment. The migration changes the
primary `ansatz` and the dependent `compilation_backend`; it is therefore a
controlled capability migration, not a one-component comparison. Public
execution, publication, and performance-superiority claims remain blocked.

## H₂ UCCSD slice

### Current status

- scientific configuration and parameter convention: complete;
- provider-neutral canonical circuit: complete;
- bounded three-parameter optimizer protocol: complete;
- independent macOS/arm64 Qiskit and PennyLane adapters: complete;
- catalog compatibility and adapter-tested bindings: complete;
- typed Registry/API/worker execution: complete for the bounded private path;
- Linux/amd64 OCI publication: complete with digest-pinned images, SBOMs, and
  provenance attestations;
- private remote E2E and runtime qualification: complete.

The frozen configuration is documented in
`docs/atlas/PHASE78_H2_UCCSD_EXECUTABLE_PLAN.md`. It is a separate scientific
specification from the existing one-parameter ansatz:

- three independent amplitudes;
- `exp(theta * generator)`, not the prior
  `exp(theta / 2 * generator)`;
- first-order product with the double generator followed by the two
  spin-conserving single generators;
- Operator Pool, Search, and Growth roles explicitly not applicable.

The provider-neutral canonical fixture is
`docs/atlas/fixtures/h2_sto3g/canonical_uccsd_v0.1.json`:

- canonical circuit digest:
  `e0f4f55c966f2de92046a82c8538fe5074447c030d67155dced9d7ca5a6a9a98`;
- compilation protocol digest:
  `b4553154fdb2db269ca1f43b361d6530fa9814d866103c71490d04d2b0552c52`;
- Pauli rotations: `12`;
- parameters: `3`;
- CNOT: `56`;
- depth: `96`;
- total gates: `188`.

Independent local reports are retained at:

- `docs/atlas/fixtures/h2_sto3g/raw/qiskit_uccsd_v0.1.json`;
- `docs/atlas/fixtures/h2_sto3g/raw/pennylane_uccsd_v0.1.json`.

Both used SciPy SLSQP with the same zero initial vector, bounds, tolerance,
and hard objective budget. Both completed in 17 energy evaluations.

| Adapter | Energy (Ha) | Absolute error (Ha) | Fidelity |
| --- | ---: | ---: | ---: |
| Qiskit 1.4.6 | -1.137306035753347 | 2.665e-14 | 0.999999999999984 |
| PennyLane 0.45.1 | -1.137306035753333 | 4.041e-14 | 0.999999999999971 |

The tiny nonzero single amplitudes differ within floating-point finite-
difference noise. The cross-framework acceptance compares final energy,
fidelity, parameter vector tolerance, canonical input digests, and the exact
common resource sequence; it does not require byte-identical optimizer
trajectories.

The macOS reports alone remain adapter evidence. Runtime qualification is
instead based on the later hardened Linux/amd64 run, immutable OCI publication,
and private remote E2E described below. Publication and public execution remain
blocked.

### Typed identity and applicability gate

The local result is now represented by additive, versioned contracts rather
than by relabeling the frozen one-parameter ansatz:

- portable scientific identity: `0.3.0`;
- executable UCCSD component configuration: `0.3.0`;
- applicable Registry component roles: 11;
- explicitly `not_applicable` roles:
  - `operator_pool`;
  - `search_selection`;
  - `growth_batching`;
- independent initial parameter slots: 3.

The v0.3 Registry resolution contains rows only for applicable roles and must
match those roles, semantic keys, and normalized content digests exactly.
`not_applicable` roles cannot carry a fabricated key or digest. The frozen
portable v0.2 identity and its 14-component Registry resolution remain
unchanged.

Generated evidence:

- `docs/atlas/fixtures/h2_sto3g/executable_components_uccsd_v0.3.json`;
- `docs/atlas/fixtures/h2_sto3g/uccsd_scientific_identity_v0.3.json`;
- `scripts/generate-h2-uccsd-executable-components.py --check`.

This closes the local typed-composition gate. The separate private OCI/runtime
qualification gate is recorded below.

### Linux/amd64 local container gate

Separate UCCSD images now build from `runtimes/vqe/Dockerfile.uccsd` without
changing the frozen fixed-excitation runtime image or entrypoint. Both
frameworks succeeded under:

- `linux/amd64`;
- deny-all network;
- read-only root filesystem;
- all Linux capabilities dropped;
- no-new-privileges;
- bounded CPU, memory, process count, and `/tmp` tmpfs.

The first Qiskit attempt correctly failed because a completely read-only
filesystem exposed `dill`'s need for a temporary directory. The corrected
policy did not make the root writable or enable egress; it added only a
64 MiB `noexec,nosuid` tmpfs at `/tmp`. This operational requirement is
retained in
`docs/atlas/evidence/phase78/uccsd_linux_amd64_local.json`.

The local Linux results preserve 17 objective evaluations, 56 CNOT, depth 96,
three parameters, sub-`4.1e-14` absolute energy error, and fidelity above
`0.99999999999997` for both providers. Local Docker image IDs are explicitly
not treated as OCI Registry digests. Qualification instead uses the immutable
registry digests below.

### Immutable OCI publication and private remote E2E

The hardened Linux/amd64 verification succeeded in
[GitHub Actions run 30520738678](https://github.com/EshMis/majorana/actions/runs/30520738678).
Both providers used the same canonical circuit and resource protocol:

| Adapter | Energy (Ha) | Absolute error (Ha) | Fidelity | CNOT | Depth | Parameters |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Qiskit 1.4.6 | -1.137306035753347 | 2.665e-14 | 0.999999999999984 | 56 | 96 | 3 |
| PennyLane 0.45.1 | -1.137306035753333 | 4.041e-14 | 0.999999999999971 | 56 | 96 | 3 |

The images were published by
[GitHub Actions run 30520940143](https://github.com/EshMis/majorana/actions/runs/30520940143)
from source commit `6e78bdff2b9486f564441dcd267b91a41038a5df`.
Each image is pinned by OCI index and Linux/amd64 platform manifest digest and
has an SBOM plus provenance attestation:

- Qiskit index:
  `sha256:9e0d646fd59cee3d51a72a60d36b306619150732cf01bda73de23c1cdbd119d5`;
- Qiskit Linux/amd64 manifest:
  `sha256:64effada2d704410bc26cbea0734e069dafe6f229a59d0424b6523085d2f3879`;
- PennyLane index:
  `sha256:daac7c918f277555515bc3a4c5c7fa29e6634a44184db1f04f4cd3ef5d3e9980`;
- PennyLane Linux/amd64 manifest:
  `sha256:31d3b3a1042eb1326c01e4eaafc0ac4c9d6839d051852fa14bff12b57c954285`.

The private authentication → database → real-OCI path succeeded in
[GitHub Actions run 30526084585](https://github.com/EshMis/majorana/actions/runs/30526084585)
on source commit `0bd1aa48bc2ea9cfcc3bca92b55797ad18e3573d`.
The corresponding general
[CI run 30526084592](https://github.com/EshMis/majorana/actions/runs/30526084592)
also succeeded. The E2E used:

- an isolated PostgreSQL 17 database;
- a synthetic WorkOS-shaped JWT contract, not a live WorkOS tenant;
- the exact digest-pinned Qiskit and PennyLane OCI images;
- a dedicated GitHub Actions Docker host, not Cloud Run or another permanent
  production host;
- private materialization followed by a separate-session reopen;
- an exercised failure path.

The migration changes the primary `ansatz` role, changes
`compilation_backend` as a scientifically required dependency, and changes
`operator_pool`, `search_selection`, and `growth_batching` to
`not_applicable`. It is therefore a controlled capability migration, not a
one-component controlled comparison and not evidence of performance
superiority.

The durable redacted qualification record is
`docs/atlas/evidence/phase78/uccsd_private_oci_qualification.json`. The
ephemeral GitHub artifact is
`phase78-private-ci-e2e-0bd1aa48bc2ea9cfcc3bca92b55797ad18e3573d`
(artifact ID `8752758394`, archive digest
`sha256:bb160418c141d9220c944db6fb5977e87dcef5d27d00e0c1b89b2aac8ee375c3`).

### H₂ UCCSD private qualification close

The bounded UCCSD slice is complete for private qualification:

- the portable scientific identity is frozen separately from Registry UUIDs;
- exact role, semantic-key, digest, and applicability gates fail closed;
- Qiskit and PennyLane independently execute the three-parameter protocol;
- common-protocol energy, fidelity, CNOT, depth, gate, and parameter evidence
  is retained;
- digest-pinned Linux/amd64 OCI runtimes are SBOM- and provenance-attested;
- private materialized evidence can be reopened in a separate authenticated
  session.

Human review remains owner-waived. A live WorkOS tenant, Neon or another
production database, a permanent production host, public execution, and
publication were not tested and are not implied by this qualification.

## Claim boundary

This phase establishes executable interoperability and controlled component
replacement only. It does not establish optimizer superiority or a public
scientific result.
