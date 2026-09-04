# Authoring the Qiskit 2.x Study Group — the rules every notebook follows

This directory is a **curriculum source**. Notebooks are written in Leona notebook source
(`.nb.py`, jupytext percent format with a YAML header) and built into the collaborator's
repository by `leona-notebooks build-curriculum`. The brief this answers is
`BRIEF-from-quanmatic.md` (their README); the deliverable is a repository in exactly that shape.

## Files per week

```
weekNN_topic/
  README.md          the week's concise guide (what, why, the 90-minute plan, prep, homework)
  lab.nb.py          kind: lab        -> lab.ipynb
  challenge.nb.py    kind: challenge  -> challenge.ipynb (stubs) + solutions/weekNN_topic/challenge_solution.ipynb
  CHECKLIST.md       -> solutions/weekNN_topic/SELF_EVALUATION.md
```

Week 08 (project) additionally has one `.nb.py` per project template under
`week08_project/templates/` and a complete reference project per template (kind `solution`)
under `week08_project/reference/`. `bonus_ibm_quantum_hardware/` has `guide.nb.py` (kind
`hardware`). `certification/` has `practice_questions.nb.py` (kind `quiz`), `mock_exam.nb.py`
(kind `quiz`) and `ANSWER_KEY.md`.

## The format (read `packages/py/notebooks/src/leona_notebooks/source.py` for the parser)

```
# ---
# title: Week 01 — Qubits and circuits
# kind: lab
# summary: One sentence.
# objectives:
#   - Build a one-qubit circuit and sample it
# prerequisites:
#   - Week 00 environment verified
# duration_minutes: 60
# ---

# %% [markdown] role=objective
# ## What you will build
# Prose. Every markdown line starts with `# `. Maths is `$...$`.

# %% role=setup
import qiskit
print(qiskit.__version__)
```

Roles: `setup objective concept predict run observe explain modify checkpoint figure exercise
hint solution question answer summary references note`. A cell that needs credentials or the
network is `execute=false`. A `role=solution` code cell carries `stub="..."` (JSON string) — the
learner-facing placeholder that leaves every name a checkpoint reads defined (`answer = None`).
A cell meant to fail is `tags=["raises-exception"]`. **No ids** — they are assigned.

Structure a kind must satisfy (`leona-notebooks structure FILE` prints what a file fails):

- **lab**: first cell `role=objective`; a `role=setup` cell that imports and prints the Qiskit
  version; the loop `predict → run → observe → explain → modify` at least once, in that order;
  at least two `role=checkpoint` code cells, each with an `assert` that tolerates sampling noise
  (bands, never exact counts); ends with `role=summary` or `role=references`.
- **challenge**: `role=exercise` markdown followed by a `role=solution` code cell with a `stub`;
  at least one `role=hint`; every `role=checkpoint` asserts only when the learner's variable is
  not `None` (`if answer is not None: assert ...`). The stubbed notebook must still run end to end.
- **quiz**: at least three `role=question` cells, each with a `role=answer` cell (hidden in the
  challenge build) — a code cell that checks the answer where one can be checked.
- **hardware**: every cell touching `QiskitRuntimeService` / `save_account` is `execute=false`
  and preceded by prose on cost, queueing and where the token comes from (an environment
  variable, never the notebook); a local path with `GenericBackendV2` runs the same ISA circuit
  first with `execute=true`.
- **solution**: `role=solution` cells with the exercise they answer before them.

## Qiskit 2.5 facts (verified against 2.5.2 on 2026-09-02; `prompts.QISKIT_2_FACTS` is the source)

- `from qiskit import QuantumCircuit`; `from qiskit.primitives import StatevectorSampler,
  StatevectorEstimator`; `from qiskit.quantum_info import SparsePauliOp, Statevector, Operator`;
  `from qiskit.transpiler import generate_preset_pass_manager`;
  `from qiskit.providers.fake_provider import GenericBackendV2`; `from qiskit.circuit import Parameter`.
- REMOVED: `execute`, `BasicAer`, `Aer` from `qiskit`, V1 `Sampler`/`Estimator`, `qc.qasm()`,
  `bind_parameters`, `opflow`, `qiskit.algorithms`. Never write them, not even in a "don't do this".
- Sampling: `StatevectorSampler(seed=42).run([qc], shots=1000).result()[0].data.meas.get_counts()`
  (`meas` from `measure_all()`; a register named `c` reads `.data.c`).
- Expectation: `StatevectorEstimator().run([(qc, SparsePauliOp("ZZ"))]).result()[0].data.evs`
  — circuit without measurements; parameterised as `(qc, obs, [values])`.
- Transpile: `GenericBackendV2(num_qubits=5, seed=1)`, `generate_preset_pass_manager(optimization_level=1,
  backend=backend).run(qc)`; basis cx/id/rz/sx/x (+delay/measure/reset).
- Bit order: qubit 0 is the RIGHTMOST character. Say so the first time counts appear (week 02).
- `qc.draw("text")` always; `qc.draw("mpl")` and `plot_histogram` need matplotlib+pylatexenc
  (both in the course environment) — put figures in `role=figure` cells and always print the
  text form or counts too, so a reader without a display still sees the result.
- Seed every sampler. Keep every notebook under ~45 s total and ≤ 8 qubits (≤ 12 in week 08).
- Only import: qiskit, qiskit_aer (avoid; the course does not use Aer), numpy, scipy, matplotlib,
  math, json, itertools, functools, collections, random, time, warnings — nothing from `os`, `sys`,
  `subprocess`, no `open()`. (This is the product sandbox's allowlist; the course venv is
  broader, but a notebook that runs in both is the point.)

## Voice and pedagogy (from the brief)

- Predict → Run → Observe → Explain → Modify, every idea. A prediction is a specific written guess.
- Jargon only when it becomes useful, introduced at the moment it is used.
- No matrices required; week 03 uses the minimum mathematics to explain an observation code
  alone cannot. Dirac notation is introduced in week 02 as notation, not assumed.
- Sampling fluctuates: say so where it first shows, and make checkpoints bands.
- Each session ends with something working and one remaining question written down.
- Plain English, second person, short paragraphs. No emoji. No "in this exciting lesson".
- Certification questions are **original** — never copied from any exam or dump — and label
  which API area they drill (construction, visualisation, transpilation, primitives, results,
  OpenQASM 3, debugging).

## Checks before you report a notebook done

```
uv run leona-notebooks structure weekNN_x/lab.nb.py            # structure rules pass
uv run leona-notebooks execute weekNN_x/lab.nb.py --runner nbclient   # every cell runs
uv run leona-notebooks execute weekNN_x/challenge.nb.py --runner nbclient --build challenge
uv run leona-notebooks execute weekNN_x/challenge.nb.py --runner nbclient --build solution
```

Run them from the repository root with the repo's `.venv` (Python 3.13, qiskit 2.5.2 —
the collaborator's target is 3.11, same Qiskit). Quote the runner's last lines in your report.
