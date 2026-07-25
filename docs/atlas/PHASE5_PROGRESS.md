# Atlas VQE Phase 5 — corrected product-integration record

Date: 2026-07-26  
Branch: `feature/vqe`  
Source runtime commit: `99e95a9a2589a3ca0ac01c3e44499046fabbce89`  
State: **local Phase 5 candidate implemented and technically requalified;
independent human review, authenticated browser E2E, production runtime, and
public promotion remain blocked**

## 1. Exact claim boundary

The executable H₂ path is a **cross-framework VQE state-evaluation proof**.
Qiskit and PennyLane consume the same frozen Hamiltonian, reference state,
one-parameter canonical ansatz, bounds, and SciPy
`minimize_scalar(method="bounded")` optimizer. Qiskit supplies its
statevector/expectation evaluator and PennyLane supplies its
`default.qubit` evaluator.

It is not a comparison of Qiskit Algorithms VQE against a PennyLane-native
optimizer, not a framework-compiler benchmark, and not reproduction of an
external chemistry paper. The exact-energy value is an internal oracle
obtained by diagonalizing the same frozen qubit Hamiltonian.

## 2. Scientific identity and durable execution

One portable scientific experiment is stored separately from:

- the Registry UUID resolution that supplied its components;
- framework/runtime-specific `ExecutionBinding`;
- append-only attempt observations.

Qiskit and PennyLane executions therefore remain distinct children of the
same scientific experiment. Duplicate execution creation, Run binding, and
attempt allocation are database-fenced and covered by two-session live
PostgreSQL tests.

Materialization is execution-specific:

```text
POST /v1/vqe/executions/{execution_id}/materialize
```

The private candidate bundle contains the portable scientific specification,
Registry resolution, selected execution binding/identity, selected
observation, and all associated digests. It no longer selects the latest
successful framework implicitly.

## 3. Comparable resource protocol

The comparison-eligible numbers describe the deterministic **canonical
ansatz decomposition**, not a hardware-native optimized circuit:

```text
metric_scope: ansatz_only
reference state: excluded
measurement: excluded
hardware optimization: excluded
routing: none
basis: h, s, sdg, rz, cx
```

The canonical fixture records expected metrics and an operation-sequence
digest. Each adapter independently reconstructs its actual framework circuit
or tape, normalizes the observed operations, recomputes dependency depth,
gate/CNOT counts and operation digest, and fails closed on disagreement.

| Observation | CNOT | Depth | Gates | Parameters | Operation verification |
|---|---:|---:|---:|---:|---|
| Canonical expected | 48 | 83 | 152 | 1 | pinned digest |
| Qiskit observed | 48 | 83 | 152 | 1 | passed |
| PennyLane observed | 48 | 83 | 152 | 1 | passed |

Studio labels these as ansatz-only common-protocol values and explicitly says
that reference preparation, measurement, hardware optimization, and routing
are excluded.

## 4. Runtime lifecycle and isolation

The development-only Docker executor uses a unique container name, bounded
streaming stdout/stderr, live cancellation polling, timeout handling, and
verified `docker rm -f` cleanup. Partial output from a cancelled process is
never evidence. Deterministic contract/scientific failures are non-retryable;
runtime unavailability and bounded timeouts have separate retry
classifications.

Both candidates use:

- digest-pinned Python 3.12.12 base;
- independent frozen locks with unused PySCF/Qiskit Nature removed;
- `OMP_NUM_THREADS=1`, `OPENBLAS_NUM_THREADS=1`,
  `MKL_NUM_THREADS=1`, and `NUMEXPR_NUM_THREADS=1`;
- Linux/x86_64, non-root execution, read-only root, bounded no-exec tmpfs;
- `--network none`, capability drop, `no-new-privileges`, and CPU/memory/PID
  limits;
- no credentials, database URL, proxy inheritance, or runtime installation.

Timeout, cancel, output-overflow, invalid-result and failure-JSON paths are
tested. These controls qualify the local Docker executor only; they do not
constitute a production sandbox service.

## 5. Runtime provenance and qualification

Machine-readable evidence:

- `evidence/atlas_vqe_phase5_local_candidate_v1.json`
- `evidence/phase5b_h2_runtime_qualification_2026-07-26.json`
- `evidence/phase5b_runtime_sbom_manifest_v1.json`
- `evidence/phase5b_qiskit_runtime_sbom.spdx.json`
- `evidence/phase5b_pennylane_runtime_sbom.spdx.json`

| Candidate | Local Docker image ID | Runs | Infrastructure failures | Max error (Ha) | Min fidelity |
|---|---|---:|---:|---:|---:|
| Qiskit 1.4.6 | `sha256:820b4fb9c9fa59160abb37062b6f71d43fedcb0a9a955bfcabe1c294889cfd6c` | 10 | 0 | 1.821e-14 | 0.9999999999999896 |
| PennyLane 0.45.1 | `sha256:82d5cc74bd8f5083b64541cf5b7b30633c5c19b9340127b5c02aea41cfebf7a4` | 10 | 0 | 1.732e-14 | 0.9999999999999902 |

The profile and qualification artifact bind the runtime-payload source
commit, Dockerfile, frozen lock, entrypoint, fixture manifest, canonical
circuit file and semantic digests, compilation protocol, operation sequence,
SBOM, and build-attestation manifest. The qualification report separately
records the qualification-tool commit, evidence-generation basis commit, and
audited branch head; those four commit responsibilities must not be collapsed
into one ambiguous `source_git_commit`. Runtime output is compared with the
server-owned expected scientific digests before evidence is accepted.

`container_digest_kind=local_docker_image_id` is explicit.
`oci_manifest_digest` remains `null` because these candidates have not been
pushed to an OCI Registry. A local image ID must not be presented as a
pullable production manifest digest.

## 6. Studio flow

The authenticated product code now supports:

```text
Atlas VQE Methods
→ Open executable workflows in Studio
→ select Registry workflow
→ create portable experiment
→ select Qiskit or PennyLane
→ run / inspect / cancel
→ materialize the selected execution privately
```

The BFF allowlists bare experiment creation and workflow listing. Polling now
uses `GET /experiments/{id}/executions`; the legacy `/events` alias is marked
deprecated because it is not an event stream.

This flow passes typecheck, production build, and non-browser tests. A
minimal authenticated-browser contract suite also passes through the
development-only local identity, the real Next BFF, and a deterministic mock
control plane. It covers create → Qiskit success → result display → private
materialization and a PennyLane runtime-failure path that remains failed and
cannot be materialized. It does not test WorkOS, Neon, or a scientific
runtime, and is not described as a full-stack production E2E.

## 7. Verification performed

- full Python suite: `1119 passed, 79 skipped`;
- local PostgreSQL migration `upgrade 0036 → downgrade 0035 → upgrade 0036`:
  passed;
- VQE live PostgreSQL tests, including concurrent create/bind/attempt:
  `10 passed`;
- durable Worker/observation live PostgreSQL tests: `2 passed`;
- web tests: `95 passed`;
- TypeScript typecheck and targeted Ruff: passed;
- generated canonical circuit and Registry manifest checks: passed;
- strict Linux/x86_64 candidate runs: `10/10` per framework;
- deny-all outbound TCP checks: passed for both images;
- SPDX JSON SBOM generation and provenance hashing: passed.
- authenticated Next/BFF browser contracts: `2 passed`.

Remote `feature/vqe` CI passed at audited implementation head
`a49b6d5de7bf3167fd8cb0fd6cee26579386eb06`, run
[`30165157403`](https://github.com/EshMis/majorana/actions/runs/30165157403):
`py`, `ts`, `db`, and `ui-visual` all passed. The later closure change adds
the production Next build and authenticated-browser contracts to remote CI;
their final remote result is recorded separately rather than retroactively
attributed to run `30165157403`.

## 8. Deliberately open gates

- independent human scientific review of the H₂ definitions and evidence;
- production WorkOS/Neon/runtime browser E2E and owner UX confirmation;
- a production `VqeRuntimeExecutor` implementation and staging
  qualification;
- OCI Registry push and manifest-digest pinning;
- public execution, publication, scientific release, and deployment approval.

The candidate remains `unreviewed`, `unqualified`, private, and blocked from
public execution. Phase 5 evidence does not substitute for these gates.
