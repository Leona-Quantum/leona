# SDK-drift benchmark — provenance

**Prompt neutrality (review pass, same day as the initial build)**: every `prompt` below
was rewritten so it never names the cited old or new API, the words removed/deprecated/
legacy, or the Qiskit version — see `SPEC.md`'s "Prompt neutrality" section for why and
`majorana_evals.sdk_drift.prompt_neutrality` for the mechanical, load-time-enforced check.
Four test-harness function names (`entry_point`) were also renamed where the ORIGINAL name
itself contained a banned identifier as a readable substring: `cnot_circuit_unitary` →
`two_qubit_controlled_x_unitary`, `fredkin_unitary` → `controlled_swap_unitary`,
`squares_via_parallel_map` → `squares_via_batch_map`, `backend_num_qubits` →
`backend_qubit_count`. The citations, `old_api`/`new_api` snippets, and every verified
failure mode below are otherwise unchanged from the initial build.

How every one of the 20 shipped cases was sourced and verified, and which candidates were
dropped and why. Citation research was performed by a research pass against Qiskit's own
documentation (`quantum.cloud.ibm.com` — the current canonical host; `docs.quantum.ibm.com`
301-redirects there — and `github.com/Qiskit/documentation` for two guides pulled off the
live site), spot-checked against two of the most-relied-on pages directly during this build.
**Every case's actual pass/fail behaviour was independently re-verified by running real code
against the repo-pinned `qiskit==2.5.2`** — the citation says what changed and when; the
interpreter is the authority on whether the cited old idiom actually fails today and what
error it raises.

## Cases shipped

| Case | Old API | New API | Changed in | Citation |
|---|---|---|---|---|
| `execute-removed` | `qiskit.execute()` | `transpile()` + `backend.run()` | 1.0.0 | [release-notes/1.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/1.0) |
| `providers-aer-moved` | `qiskit.providers.aer.AerSimulator` | `qiskit_aer.AerSimulator` | 1.0.0 (dep. 0.46) | [release-notes/1.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/1.0) |
| `basicaer-removed` | `qiskit.BasicAer` | `qiskit.providers.basic_provider.BasicProvider` | 1.0.0 (dep. 0.46) | [release-notes/1.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/1.0) |
| `primitives-sampler-v1-to-v2` | `qiskit.primitives.Sampler` | `StatevectorSampler` (PUB shape) | dep. 1.2, removed 2.0 | [release-notes/2.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/2.0) |
| `primitives-estimator-v1-to-v2` | `qiskit.primitives.Estimator` | `StatevectorEstimator` (PUB shape) | dep. 1.2, removed 2.0 | [release-notes/2.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/2.0) |
| `opflow-removed` | `qiskit.opflow` (`X`, `Z`, `I`, `^`) | `qiskit.quantum_info.SparsePauliOp` | superseded by 1.0 | [opflow migration guide](https://github.com/Qiskit/documentation/blob/2d2c2fcad47dd9e7ac1cc6807527dfccd796ea24/docs/migration-guides/qiskit-opflow-module.mdx) |
| `qasm-method-removed` | `QuantumCircuit.qasm()` | `qiskit.qasm2.dumps()` | dep. 0.45, removed 1.0 | [release-notes/1.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/1.0) |
| `backendv1-configuration-removed` | `backend.configuration().n_qubits` | `backend.num_qubits` | dep. 1.2, removed 2.0 | [release-notes/2.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/2.0) |
| `c-if-removed` | `Instruction.c_if()` | `with qc.if_test(...)` | dep. 1.3, removed 2.0 | [release-notes/2.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/2.0) |
| `extensions-unitarygate-removed` | `qiskit.extensions.UnitaryGate` | `qiskit.circuit.library.UnitaryGate` | 1.0.0 | [release-notes/1.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/1.0) |
| `tools-parallel-map-removed` | `qiskit.tools.parallel_map` | `qiskit.utils.parallel_map` | 1.0.0 | [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features) |
| `legacy-qasm-parser-removed` | `qiskit.qasm.Qasm` | `qiskit.qasm2.loads()` | 1.0.0 | [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features) |
| `classicalfunction-phaseoracle` | `qiskit.circuit.classicalfunction.BooleanExpression` | `qiskit.circuit.library.PhaseOracleGate` | dep. 1.4, removed 2.0 | [release-notes/2.0](https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/2.0) |
| `bind-parameters-removed` | `QuantumCircuit.bind_parameters()` | `QuantumCircuit.assign_parameters()` | 1.0.0 | [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features) (table entry) |
| `cnot-removed` | `qc.cnot()` | `qc.cx()` | 1.0.0 | [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features) (table entry) |
| `mct-removed` | `qc.mct()` | `qc.mcx()` | 1.0.0 | [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features) (table entry) |
| `fredkin-removed` | `qc.fredkin()` | `qc.cswap()` | 1.0.0 | [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features) (table entry) |
| `transpile-backend-properties-removed` | `generate_preset_pass_manager(backend_properties=...)` | omit the argument | 2.0.0 | [migration-guides/qiskit-2.0](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-2.0) |
| `transpile-inst-map-removed` | `generate_preset_pass_manager(inst_map=...)` | omit the argument (no alternative) | 2.0.0 | [migration-guides/qiskit-2.0](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-2.0) |
| `transpile-legacy-timing-args-removed` | `generate_preset_pass_manager(instruction_durations=..., timing_constraints=...)` | omit both arguments | 2.0.0 | [migration-guides/qiskit-2.0](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-2.0) |

Four cases (`bind-parameters-removed`, `cnot-removed`, `mct-removed`, `fredkin-removed`) cite
a page whose "Old → New API" section is a table with no standalone prose sentence naming
that specific rename — flagged as such in each case's own `change.release_note_quote` rather
than inventing a sentence that doesn't exist on the page. Every other case's
`release_note_quote` is a verbatim sentence, spot-checked directly against two of the
most-relied-on pages (`release-notes/1.0` and `migration-guides/qiskit-2.0`) during this
build — see the transcript excerpts below.

## Spot-check transcripts (fetched directly during this build, 2026-09-23)

From `https://quantum.cloud.ibm.com/docs/en/api/qiskit/release-notes/1.0`:
- "Qiskit's `execute()` function is removed."
- "Importing from `qiskit.providers.aer` will no longer work, following its deprecation in Qiskit 0.46."
- "The `qiskit.providers.basicaer` module, exposed as `qiskit.BasicAer`, has been removed following it[s] deprecation on the 0.46 release."
- "Removed the `Instruction.qasm` method, which was deprecated in Qiskit 0.45.0."
- "The `qiskit.tools` module has been removed."
- "Removed the `qiskit.extensions` module, which has been pending deprecation since the 0.45 release and has been fully deprecated in the 0.46 release."

From `https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-2.0`:
- c_if: "This legacy method has been removed in Qiskit v2.0; you should use the `if_test` method with a proper condition."
- `backend_properties`: "The `backend_properties` input argument is no longer supported, and the `BackendProperties` class has been removed."
- `instruction_durations`/`timing_constraints`: "The `instruction_durations` and `timing_constraints` input arguments are no longer supported."
- `inst_map`: "The `inst_map` argument has been removed without alternative."
- This page does **not** mention primitives V1 removal or `qiskit.opflow` — those two are
  cited to `release-notes/2.0` and the standalone opflow migration guide respectively, which
  is where that content actually lives; noted here so a reviewer doesn't go looking for it on
  the wrong page.

Every case's `notes` field additionally records the EXACT exception raised when the
outdated solution was actually run against `qiskit==2.5.2` during this build (not assumed
from the citation) — see each `cases/*.yaml` file.

## A transcription trap this build caught

`execute-removed`'s `expected_failure_pattern` was originally authored as `"no attribute
'execute'"`, based on probing `qiskit.execute` as a bare ATTRIBUTE access in an interpreter
(`AttributeError: module 'qiskit' has no attribute 'execute'`). The task's actual
`outdated_solution`, however, writes `from qiskit import execute` — a different Python
construct that goes through the import machinery instead of attribute lookup, and raises a
differently-worded `ImportError: cannot import name 'execute' from 'qiskit'`. Running the
grader against the ACTUAL case (not a standalone probe of the API surface) caught the
mismatch immediately (`test_loads_shipped_cases_and_controls_pass_and_fail_correctly` failed
with `drift_reason_matched=False`); the pattern was corrected before this PR. Left as a
worked example of why "the API is gone" and "this specific code construct fails with this
specific message" are different claims — see `MEMORY-method.md`'s stance on verifying
against the source not catching every error class.

## Cases considered and dropped

- **`qiskit.algorithms` → `qiskit_algorithms`** (VQE/QAOA import path; dep. 0.44, fully
  gone from core by 1.0 — [migration guide](https://github.com/Qiskit/documentation/blob/2d2c2fcad47dd9e7ac1cc6807527dfccd796ea24/docs/migration-guides/qiskit-algorithms-module.mdx)).
  **Dropped: the modern replacement package `qiskit_algorithms` is not in the sandbox
  guard's `ALLOWED_IMPORTS`** (`packages/py/sandbox/src/majorana_sandbox/guard.py`) and is
  not installed in this workspace at all (`ModuleNotFoundError: No module named
  'qiskit_algorithms'`, confirmed directly). A task whose own CANONICAL solution needs a
  blocked (and absent) import is unusable, per this benchmark's own loader invariant — the
  same rule the paper-to-code benchmark applies to reference solutions.
- **`qiskit.providers.fake_provider.FakeSherbrooke` → `qiskit_ibm_runtime.fake_provider`**
  (1.0.0; requires `qiskit-ibm-runtime>=0.17.1| — [migration-guides/qiskit-1.0-features](https://quantum.cloud.ibm.com/docs/en/migration-guides/qiskit-1.0-features)).
  **Dropped for the same reason**: `qiskit_ibm_runtime` is not in `ALLOWED_IMPORTS` (the
  strategy doc for the resource-estimation benchmark independently found the same gap: "44
  tasks" of the vendored Qiskit HumanEval corpus fail for exactly this reason). Used
  `GenericBackendV2` — which IS in qiskit core — for `backendv1-configuration-removed`
  instead, since that case only needs *a* `BackendV2` instance, not an IBM-hardware-specific
  fake.
- **`qiskit.pulse` removed entirely** (dep. 1.3, removed 2.0) and **`qiskit.scheduler` /
  `qiskit.compiler.schedule()`/`sequence()` removed** (2.0.0): all three have **no modern
  replacement at all** — the capability was deleted, not moved. A "write the modern idiom"
  task is not well-posed when there is no modern idiom to write; framed instead as a bare
  "does this still work" probe, these would test nothing but the presence of a
  `ModuleNotFoundError`, which is a strictly weaker case than the 20 shipped (each of which
  demonstrates both a real failure AND a real, working replacement). Dropped for weak task
  design, not weak citation.
- **`Instruction.duration` / `Instruction.unit` removed** (2.0.0): confirmed the old
  attribute access fails (`AttributeError: '_SingletonHGate' object has no attribute
  'duration'`), but the stated replacement (`target["op_name"][qubits].duration`) requires
  constructing a `Target` with timing data, which is materially more setup than every other
  case here for a task whose behavioural check would still boil down to "did this attribute
  access raise". Dropped for the same "task design too thin to be worth a slot" reason as
  the pulse/scheduler items, not because the citation is weak.
- **`qiskit.compiler.assemble()` (Qobj path) deprecated in 1.2** — the research pass could
  not find a clean, citable release-notes sentence for its 2.0 REMOVAL specifically (only
  the 1.2 deprecation notice), and `git blame`-style certainty about exactly when it
  disappeared was weaker than every shipped case's. Dropped rather than citing a version
  number inferred from "it's gone from 2.5.2" alone.
- **`transpile()` default `optimization_level` changing 1 → 2 (Qiskit 1.3, per IBM's Qiskit
  blog rather than a reno-generated release note)**: does not cause a FAILURE — old code
  using the implicit default still runs, it just transpiles differently. This benchmark's
  premise is "old-idiom code fails against current install", so a change that alters output
  quality without raising is a poor fit; dropped rather than forced into a shape it doesn't
  have.
- **`basis_gates` no longer accepting custom gate names** (2.0.0, cited, verified): a real,
  citable, hard-failing change, but reproducing it needs a custom `Target`/`custom_name_mapping`
  setup materially heavier than the four other `generate_preset_pass_manager` argument-removal
  cases already shipped from the SAME migration-guide page. Dropped for redundancy against
  those four, not for a citation or correctness gap — kept as a candidate for a future
  increment.
