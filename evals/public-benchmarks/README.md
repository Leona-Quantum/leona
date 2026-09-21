# Public benchmarks (proposal 1)

Owner-approved proposal (2026-09-20): run Nala against two public quantum-code benchmarks —
Qiskit HumanEval and QCircuitEval — publish the numbers and the method, and re-run on every
model change. This directory holds the vendored, pinned, hashed task data; the harness code
lives in `evals/harness/src/majorana_evals/public_benchmarks/` (a submodule of the existing
`majorana-evals` package, reusing its conventions and its `runner.py` helpers).

**This pass builds and prices the harness. It does not run either benchmark for real** — no
paid model call was made producing anything under `evals/public-benchmarks*`. Every number
this harness has produced so far comes from `StubPipelineLLM`, a zero-cost double (see its
docstring in `stub_llm.py`) — real Nala quality on these benchmarks is not yet known.

## Layout

```
qiskit-human-eval/
  dataset_qiskit_test_human_eval.json   # vendored, Apache-2.0, 151 tasks
  LICENSE
  PROVENANCE.md                          # source, pinned commit, sha256, what's NOT vendored
qcircuiteval/
  qiskit/core.jsonl                      # vendored, MIT, 58 tasks (Qiskit framework only)
  qiskit/qec.jsonl                       # vendored, MIT, 12 tasks (Qiskit framework only)
  LICENSE
  PROVENANCE.md                          # source, pinned commit, sha256, TWO scoring gaps
PRICING.md                               # the price of one full run, and every assumption behind it
```

Read each `PROVENANCE.md` before trusting a number from that benchmark — in particular
QCircuitEval's, which documents that this harness implements only STRUCTURAL scoring for it
(no functional grader), and that 7 of its 70 tasks cannot be called at all with the data
vendored here.

## Running it

```bash
# Zero-spend self-test (what "run the harness" means until the owner approves a real run):
uv run --package majorana-evals python -m majorana_evals.public_benchmarks run \
    --benchmark qiskit-human-eval --stub canonical --out /tmp/qhe.json
uv run --package majorana-evals python -m majorana_evals.public_benchmarks run \
    --benchmark qiskit-human-eval --stub garbage --out /tmp/qhe-garbage.json

# A REAL run spends provider money on every task — see PRICING.md first.
uv run --package majorana-evals python -m majorana_evals.public_benchmarks run \
    --benchmark qcircuiteval --live --out evals/public-benchmarks-report.json
```

Needs `DATABASE_URL` always (the pipeline persists through the repository layer regardless
of which LLM is injected, exactly like the internal `majorana_evals` harness); `--live`
additionally needs a configured provider profile.

## What the stub run already found (measured, not simulated)

Full zero-spend `--stub canonical` runs:

- **Qiskit HumanEval: 106/151 (70.2%)** — not the ~100% a "positive control" might suggest
  at a glance. Every one of the 45 failures was traced to a real, pre-existing product
  constraint, not a harness defect: 44 tasks use an import
  `majorana_sandbox.guard.ALLOWED_IMPORTS` does not permit (43× `qiskit_ibm_runtime`, plus
  one each of `qiskit_ibm_transpiler`/`inspect`/`importlib` on overlapping tasks) and 1 task
  writes to the filesystem (`open(..., "wb")`), which the guard also denies.
- **QCircuitEval: 63/70 (90.0%)** — every one of the 7 failures is exactly the 7 tasks whose
  `entry_point` needs argument values this harness cannot resolve (see
  `qcircuiteval/PROVENANCE.md`'s "Second gap"), not a scoring defect.

Both `--stub garbage` runs scored **0/151** and **0/70** — the clean negative control.

See the PR body for the full breakdown and the owner questions these findings raise.
