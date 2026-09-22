# Resource-estimation benchmark (proposal 1, first increment)

ai-ops#357 option 1: the first public benchmark Leona builds under its own name. Nobody owns
an LLM benchmark for fault-tolerant quantum resource estimation — see `SPEC.md` for the task
format, grading rule, and anti-contamination argument, and `PROVENANCE.md` for how each of the
9 cases was verified (and what was dropped, and why).

**This increment builds and validates the harness. It does not run any real model.** Every
number below comes from one of three zero-spend offline adapters (`adapters.py`) — no adapter
here has ever called a network or a paid model API. A real (future, paid) adapter is out of
scope for this PR.

## Layout

```
cases/*.yaml          9 cases, each with its own prompt, reference values, and provenance
SPEC.md               task format, grading rule, anti-contamination argument
PROVENANCE.md         per-case sourcing, transcription traps handled, dropped candidates, cross-checks
```
The harness code (schema, grader, adapters, loader, runner, CLI) lives in
`evals/harness/src/majorana_evals/resource_estimation/`, a sibling module to the
`public_benchmarks` package from PR 944, reusing its pinning/schema/runner/pricing
conventions where they apply.

## Running it

```bash
# Zero-spend controls — what "run the harness" means until a real model adapter exists:
uv run --package majorana-evals python -m majorana_evals.resource_estimation run \
    --adapter reference --out /tmp/re-reference.json
uv run --package majorana-evals python -m majorana_evals.resource_estimation run \
    --adapter perturbed-10x --out /tmp/re-perturbed.json
uv run --package majorana-evals python -m majorana_evals.resource_estimation run \
    --adapter constant-guess --out /tmp/re-constant.json
```

No database, no sandbox, no `DATABASE_URL` needed — unlike `public_benchmarks`, this
benchmark doesn't drive Nala's own product pipeline; it grades a structured numeric answer
directly against a paper-derived reference. See `SPEC.md` for why that's a deliberately
different architecture from the code-generation harness.

## What the offline controls found (measured, not simulated)

| Adapter | Result |
|---|---|
| `reference` (positive control) | **9/9 passed, mean score 1.000** |
| `perturbed-10x` (negative control) | **0/9 passed, mean score 0.000** |
| `constant-guess` (baseline) | **0/9 passed, mean score 0.003** |

The grader was mutation-tested during this build (see `SPEC.md`'s "Controls" section for the
break/observe/revert procedure) to confirm these numbers reflect a real comparison, not a
vacuously-passing check.

## Optional: reproducing the second-tool cross-checks

Each case's `cross_check` field records an independent estimate from Microsoft's QDK resource
estimator, run once during curation — not re-run automatically by this harness. To reproduce:

```bash
python3 -m venv /tmp/qdk-venv && /tmp/qdk-venv/bin/pip install 'qdk>=1.30,<2'
/tmp/qdk-venv/bin/python -c "
from qdk.estimator import LogicalCounts
import json
counts = LogicalCounts({'numQubits': 1537, 'cczCount': 6_500_000_000, 'tCount': 0,
                         'rotationCount': 0, 'rotationDepth': 0, 'measurementCount': 0})
result = counts.estimate({'errorBudget': 0.01,
                           'qubitParams': {'name': 'qubit_gate_ns_e3'},
                           'qecScheme': {'name': 'surface_code'}})
print(json.loads(result.json)['physicalCountsFormatted']['runtime'])
"
```

Or, inside this workspace: `uv sync --package majorana-evals --extra
resource-estimation-crosscheck` (never a default/runtime dependency — see the extra's comment
in `evals/harness/pyproject.toml`).
