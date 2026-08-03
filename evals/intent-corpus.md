# AUTO routing generalization corpus

This corpus measures whether the Run composer starts an execution only when the
request is runnable as stated. It complements `evals/corpus/`, which scores the
full circuit pipeline after execution has already been selected.

The two splits have different jobs:

- `calibration` exposes broad failure classes while changing routing policy.
- `holdout` must not be consulted while tuning that policy; run it only after the
  change is fixed. A change that improves calibration but regresses holdout is not
  a generalization improvement.

Cases are balanced across concise canonical circuits, explicit intermediate and
research tasks, questions, missing task-specific data, hard resource limits, and
unsupported execution targets/dependencies. Do not add prompt-specific keyword
rules to satisfy an individual case. Add a case when it represents a reusable
decision boundary, and include a differently worded sibling in the other split.

Run against the configured real provider:

```bash
uv run --package majorana-evals python -m majorana_evals.intent_eval \
  --split holdout --out /tmp/majorana-intent-holdout.json
```

Add two reproducible unseen variants from each of the eight balanced procedural
families (16 generated plus 14 fixed holdout cases):

```bash
uv run --package majorana-evals python -m majorana_evals.intent_eval \
  --split holdout --procedural-seed 20260802 \
  --procedural-cases-per-family 2 \
  --out /tmp/majorana-intent-holdout-procedural.json
```

The generated assignment pairs distinguish complete small instances from missing-data
requests and from complete but explicitly oversized one-qubit-per-pair encodings. The
oversized cases route to target-ready artifact generation rather than claiming a local
statevector result. The seed and generator version are recorded in the report note.

This eval intentionally runs sequentially to avoid a provider rate spike. It does
not use a database or sandbox and does not replace the end-to-end corpus.
