# Contributing

Thanks for improving the course. This file is the short version; if something here conflicts
with what you observe in the repository, the repository wins — open an issue rather than
guessing.

## Ground rules

- **Keep examples local-first.** Every core-course notebook (everything outside
  `bonus_ibm_quantum_hardware/`) must run without an IBM Quantum account, on
  `StatevectorSampler` / `StatevectorEstimator` or local backends such as `GenericBackendV2`.
  A cell that needs the network or credentials is the exception, not the default, and must be
  marked so it does not run in CI (see "Notebook source format" below).
- **Use modern V2 APIs only.** `StatevectorSampler`, `StatevectorEstimator`, `SamplerV2`,
  `EstimatorV2`, `generate_preset_pass_manager`. Do not reintroduce `execute()`, `BasicAer`,
  `Aer` imported from `qiskit` directly, V1 `Sampler`/`Estimator`, `qc.qasm()`,
  `bind_parameters`, `opflow`, or `qiskit.algorithms` — these are removed or deprecated in the
  Qiskit version this course targets, and reappearing even in a comment teaches the wrong
  thing.
- **Preserve the predict/run/observe/explain/modify rhythm.** Every experiment in a lab has a
  written prediction before the run, an observation after it, an explanation of what happened,
  and something the learner is asked to change and re-run. Do not collapse this into a single
  "here's the code, here's the answer" cell.
- **Execute every notebook you changed** before you open a pull request (see below). A
  notebook that reads correctly but has not been run top to bottom is not done.
- **Never commit secrets or real exam content.** No API tokens, no account identifiers, no
  file paths that reveal a personal machine layout, and nothing copied from an actual IBM
  certification exam or exam dump — every certification-track question is original.

## Notebook source format

Course notebooks are authored in a source format and compiled to `.ipynb` — check the
curriculum's own authoring documentation for the exact structure rules per notebook kind (lab,
challenge, quiz, hardware, solution) before adding a new one. In particular:

- A lab's `role=setup` cell imports Qiskit and prints its version.
- A cell that touches `QiskitRuntimeService`, `save_account`, or any other network/credential
  call is marked so it does not execute automatically, and is preceded by prose explaining
  cost, queueing, and where the credential comes from (an environment variable — never the
  notebook itself).
- A challenge's checkpoint only asserts once the learner's variable is no longer `None`, so the
  stubbed notebook still runs end to end before anyone fills anything in.
- Every checkpoint assertion tolerates sampling noise — assert a band, never an exact count.

## Before you open a pull request

```bash
uv sync --locked --extra notebooks --extra dev
uv run pytest
uv run python scripts/validate_notebooks.py --execute --only <the week you changed>
uv run ruff check shared tests scripts
```

Run the validator against the whole repository (drop `--only`) if your change touched
`shared/`, since a helper used across weeks can break a notebook you did not think to check.

## What to include in a pull request

- What changed and why, in terms a learner would recognize (not just "fixed cell 4").
- Which notebooks you executed locally, and how (the exact command).
- Whether the change affects the required Qiskit version range; if so, say what you tested it
  against.

## Reporting a problem instead of fixing it

If you found a bug in a lab or challenge but do not have time to fix it, open an issue with:
the week, the cell (or its role, e.g. "the second checkpoint"), what you predicted, and what
actually happened. That is the same predict/observe pattern the course teaches — it makes a
good bug report for the same reason it makes a good lab.
