# Instructor guide

This is the running guide for whoever leads a session. Read the week's own `README.md` first —
it has the specific objectives and prep for that week. This document covers what stays the same
every week: the session shape, the predict-first discipline, the misconceptions worth heading
off, and how to use the challenge/solution split.

## Before the session

1. Pull the latest repository and run `uv sync --locked --extra notebooks --extra dev`.
2. Run the validator on the week you are teaching:

   ```bash
   uv run python scripts/validate_notebooks.py --execute --only week03
   ```

   Do this even if you did not change anything — a dependency bump or an environment
   difference can break a notebook that worked last time. See "When `uv` is not allowed"
   below if your machine cannot run `uv`.
3. Open the week's `lab.ipynb` yourself and run it top to bottom once, live, on the machine
   you will present from. A notebook that ran on your laptop last week is not guaranteed to
   run on the room's projector machine.
4. Skim the week's `challenge.ipynb` and its solution under `solutions/<week>/`. Know which
   checkpoints are easy to get stuck on so you can help without just handing over the answer.

## The 90-minute plan

The course is designed for this shape; adjust timing to your group, but keep the order.

| Segment | Minutes | What happens |
|---|---|---|
| Warm-up | 10 | Recap last week's remaining question. Preview this week's deliverable in one sentence. |
| Concepts | 20 | Introduce only the vocabulary this week's lab needs, at the point it is needed — not before. |
| Lab | 40 | Work through `lab.ipynb` together. Predict before every run. Pause on each `explain` cell for a group answer before revealing the notebook's own explanation. |
| Challenge | 15 | Learners attempt `challenge.ipynb` solo or in pairs, without opening `solutions/`. |
| Wrap-up | 5 | Restart-and-run-all on the challenge. State one remaining question out loud; write it down. |

If a group is slower than this, cut concepts time before cutting lab time — the lab is where
the actual learning happens; a slide is not a substitute for a learner's own prediction being
wrong.

## The predict-first discipline

Every experiment in a lab has a `predict` cell before the `run` cell. Do not let the group skip
straight to running the code. In person:

- Ask for a show of hands or a one-word shout ("more zeros, more ones, or about even?") before
  anyone touches the run button.
- When a prediction is wrong, that is the valuable moment, not a failure to route around. Ask
  "what did you expect to see, and what does the actual output rule out?" before reading the
  notebook's own `explain` cell.
- Sampling fluctuates. If a learner's prediction was right in spirit but the count is a little
  off from what they expected, that is expected behavior, not a mistake — see each week's
  checkpoints, which assert a band, never an exact count.

## Using challenges and solutions

- `challenge.ipynb` in each week directory has the exercise prose and hints but no filled-in
  answers; every reference to a solution variable stays defined (usually as `None`) so the
  notebook runs top to bottom even before anyone fills anything in.
- The runnable answer lives separately, under `solutions/<week_directory>/challenge_solution.ipynb`,
  next to that week's `SELF_EVALUATION.md` checklist. Keep this separation visible to learners:
  finishing the challenge and then diffing against the solution is the intended workflow, not
  reading the solution first.
- Encourage restart-and-run-all before comparing. A notebook that "worked" only because of
  cells run out of order will look fine to the learner and then fail during review — catch that
  before it reaches you.

## Common misconceptions, by week

Each entry is the misconception you will hear and the one-line correction to give.

- **Week 00 — Setup.** "I need a quantum computer or an IBM account to start." Everything in
  the core course runs locally on `StatevectorSampler`; no account is needed until the optional
  bonus hardware chapter.
- **Week 01 — Qubits and circuits.** "One run of the circuit tells me the answer, like calling
  a function." A circuit sampled with `shots` returns a distribution of outcomes, not a single
  deterministic value; rerun with different shot counts to make the fluctuation visible.
- **Week 02 — Multiple qubits.** "Entangled qubits send information to each other at
  measurement time." The correlation was fixed when the state was prepared; nothing is
  transmitted during measurement. The classical analogy of two envelopes packed together is
  useful, but flag where it breaks down (it cannot reproduce every quantum correlation).
- **Week 03 — Gates and state.** "If a gate did something, I should see it in the counts."
  A pure phase on a basis state does not change measurement probabilities by itself — you need
  `Statevector.from_instruction()` or a following gate that turns phase into amplitude to see
  its effect.
- **Week 04 — Transpilation.** "Transpiling is just reformatting for a different vendor."
  Routing to a coupling map can insert `SWAP` gates and basis decomposition can add depth;
  always compare `qc.depth()` and gate counts before and after, not just that it produced
  *some* circuit.
- **Week 05 — Primitives.** "Sampler and Estimator are interchangeable — pick either one."
  `SamplerV2` returns bitstring counts from a circuit that has measurements; `EstimatorV2`
  returns an expectation value for an observable from a circuit that has none. The question
  you're asking decides which one you need.
- **Week 06 — Grover search.** "Grover finds the answer in one shot, like a lookup table."
  Grover shifts probability toward the marked state; the iteration count is what makes that
  state *likely*, and too many iterations overshoot and make it less likely again.
- **Week 07 — Hybrid algorithms.** "The circuit trains itself the way a classical model does."
  A classical optimizer is calling the quantum circuit as a black-box objective function; every
  optimizer step is a full sampler or estimator call, so the iteration count is a real cost.
- **Week 08 — Mini project.** "The project has to demonstrate something new about quantum
  physics." The deliverable is integration and explanation of concepts from earlier weeks —
  pick one template and go deep enough to demo it clearly, rather than trying to cover
  everything.

## When `uv` is not allowed

Some organizations block installing new tooling. Fall back to the compatibility files:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -r requirements-notebooks.txt
jupyter lab
```

`requirements.txt` and `requirements-notebooks.txt` are pinned loosely to match
`pyproject.toml`; they are not resolved and locked the way `uv.lock` is, so results can vary
slightly by platform. If a learner hits a version mismatch this way, check their installed
Qiskit version first (`python -c "import qiskit; print(qiskit.__version__)"`) — it should be
`2.5.x`.

## Running the validator before a session

```bash
uv run python scripts/validate_notebooks.py --execute
```

This walks every notebook in the repository, runs it end to end through `nbclient`, and prints
one line per notebook plus a pass/fail summary. Run it with `--only <substring>` to check a
single week while you are drafting a change, and without `--execute` for a fast structural-only
pass. See [`VISUALIZATION_GUIDE.md`](VISUALIZATION_GUIDE.md) if a figure cell fails rather than
a text cell — that is almost always a missing optional dependency, not a broken notebook.
