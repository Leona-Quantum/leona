# QCircuitEval — provenance

- **Source**: https://github.com/conductorquantum/QCircuitEval (Conductor Quantum)
- **Pinned commit**: `e7e4eb300074286191380f81b97697b155a573f5` (branch `main`, authored 2026-08-27)
- **License**: MIT (`LICENSE` in this directory, copied verbatim from the pinned commit)
- **Announcement**: https://blog.conductorquantum.com/p/qcircuiteval-a-benchmark-for-quantum —
  70 tasks (58 "core" + 12 QEC) across four frameworks (Qiskit, Cirq, PennyLane, CUDA-Q),
  graded on measured behavior via "structural and functional graders", published 2026-09-03.
- **Fetched**: 2026-09-20, via `raw.githubusercontent.com` at the pinned commit.

## What is vendored, and why only this much

The full `QCircuitEval` repo ships four frameworks' worth of task assets plus its own
grading engine (`src/qceval/`, packaged as `qceval`). Nala's product default is Qiskit
(`packages/py/llm/AGENTS.md`: "Qiskit is the default framework, no silent switch"), so only
the **Qiskit-framework task files** are vendored — the other three frameworks' task/asset
files are not fetched or used:

- `qiskit/core.jsonl` — the 58 "core" tasks, Qiskit framework
- `qiskit/qec.jsonl` — the 12 QEC tasks, Qiskit framework

```
sha256(qiskit/core.jsonl) = c0a7e8c88c017534dae109f40827a35b06a202c5a54031eea473305c480cbe30
sha256(qiskit/qec.jsonl)  = 901e49554ac7d907fa27e52b75a615dd9e0793b876a13f6ff928ad5e28f80038
```

The loader (`majorana_evals.public_benchmarks.qcircuiteval`) recomputes both hashes at load
time and raises if either does not match.

Each record carries: `task_id`, `category`, `task_mode`, `prompt` (a complete
scaffold-plus-instructions block, written by QCircuitEval to be handed directly to a code
model — used here close to verbatim as the task prompt), `entry_point`,
`canonical_solution`, and `canonical_class` (the per-task grading contract: a `type` —
observed across the 70 vendored tasks: `deterministic_dominant`, `peak_match`,
`support_uniformity`, `exact_distribution`, `case_table` — plus `metadata_checks`
(`min_entangling_gate_count`, `min_measurement_count`, `min_non_measurement_operation_count`,
`min_num_qubits`, `forbid_returned_counts`, `forbid_returned_probabilities`) and
`forbidden_imports`).

## Scoring gap — read before trusting a QCircuitEval number

**This harness does not run QCircuitEval's own grading engine, and does not reimplement all
of it.** Two things are real and load-bearing here:

1. `qceval` (the upstream grader) is not on PyPI and is not a lightweight import: its
   `pyproject.toml` lists `cirq`, `pennylane`, `cudaq`, and `cuda-quantum-cu13` as
   *required* (not optional-extra) dependencies, and `qceval/__init__.py` imports
   `qceval.core.bench`, which pulls in the multi-framework runner. `cuda-quantum-cu13`
   is CUDA-coupled; whether it even installs (let alone runs) on this Mac or on a
   GitHub Actions `ubuntu-latest` runner with no GPU was not tested, and pulling five
   additional heavy SDKs into `evals/` for one benchmark is itself a decision the owner
   should see before it happens.
2. The grading logic behind the five `canonical_class.type` values (statevector/unitary
   equivalence, Hellinger-distance thresholds, multi-case parametrized QEC checks, …) is
   genuinely non-trivial. A hasty from-scratch reimplementation that is subtly wrong would
   produce a plausible-looking but false score — exactly the failure mode this repo's "no
   invented results" rule exists to prevent.

So this harness implements only the **structural** half of each task's contract —
`forbidden_imports` and every field under `metadata_checks` — by static/AST inspection of
the candidate's Qiskit source, which is mechanical and directly derived from the fields the
vendored dataset actually ships (not invented). The **functional** half (does the measured
distribution actually match `expected_dominants` / `expected_peaks` / `exact_distribution`
within tolerance) is deliberately left unimplemented: `score_qcircuiteval_task(...)` reports
`functional_grading: "not_implemented"` rather than guessing, so a QCircuitEval report from
this harness can never show a false PASS driven by a grader nobody has verified against the
upstream one. `evals/public-benchmarks/qcircuiteval/PROVENANCE.md` and the harness's own
module docstring both say this; the PR that introduces this harness flags it as an open
question for the owner (wire up real `qceval` with its dependency cost, or invest in an
audited from-scratch functional grader, before QCircuitEval numbers are ever published).

## Second gap — 7 tasks need argument values this repo does not vendor

70 total tasks split as: 51 take no REQUIRED arguments (either none at all, or every
parameter has a default — e.g. task `25`'s `qpe_grover00_gate(n_count=3)`), 12 (all QEC)
are `case_table` tasks whose `cases[].args` give concrete call arguments inline, and **7
declare a required-argument `entry_point`** (e.g. `qaoa_maxcut_ansatz(G, beta, gamma)`,
`bb84_prepare_qubit(alice, bob)`) whose concrete values are described only in the task's
prose (`prompt`), not as structured data anywhere in `core.jsonl`/`qec.jsonl`. QCircuitEval's
own grader resolves them from `src/qceval/assets/targets/{core,qec}/*.json` (target/manifest
files), which were not fetched or vendored (same dependency-cost reasoning as the grading
engine above — pulling in the full asset tree without the engine that consumes it buys
little). The 7 affected task IDs (core): `04`, `06`, `29`, `39`, `40`, `41`, `42`. The
harness reports these with a reason prefixed `ungradable:` and `passed=False`
(`qcircuiteval.UNGRADABLE_PREFIX`) rather than guessing at plausible argument values or
silently dropping the task.

## License note

MIT permits vendoring with attribution and license retention, both done here.
