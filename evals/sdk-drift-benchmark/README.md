# SDK-drift benchmark (ai-ops#357 option 3, first increment)

ai-ops#357 option 3: a benchmark that fails code written for old Qiskit. See `SPEC.md` for
the task format, grading rule, and the "re-run on every release" design; `PROVENANCE.md` for
every task's citation and how it was verified (and what was dropped, and why).

**This increment builds and validates the harness. It does not run any real model.** Every
number below comes from one of two zero-spend offline adapters (`adapters.py`) — no adapter
here has ever called a network or a paid model API. A real (future, paid) adapter is out of
scope for this PR.

**Every prompt is neutral by construction and by a load-time check**: no prompt names the
API it grades (old or new), the words removed/deprecated/legacy, or the Qiskit version —
see `SPEC.md`'s "Prompt neutrality" section. A prompt that told a model which API to call
would measure instruction-following, not whether the model's own default idiom still
works.

## Layout

```
cases/*.yaml          20 cases, each targeting one cited Qiskit API change
SPEC.md               task format, grading rule, controls, CI design
PROVENANCE.md         per-task citation + verification, dropped candidates
```
The harness code (schema, grader, adapters, loader, runner, CLI) lives in
`evals/harness/src/majorana_evals/sdk_drift/`, a sibling module to `resource_estimation`
(PR 953) and `paper_to_code` (this same PR series), reusing their conventions.

## Running it

```bash
# Zero-spend controls — what "run the harness" means until a real model adapter exists:
uv run --package majorana-evals python -m majorana_evals.sdk_drift run \
    --adapter canonical --out /tmp/sdk-canonical.json
uv run --package majorana-evals python -m majorana_evals.sdk_drift run \
    --adapter outdated --out /tmp/sdk-outdated.json

# The "re-run on every release" half — zero spend, no model call, just re-runs every
# task's own canonical (reference) solution against WHATEVER Qiskit is installed right now:
uv run --package majorana-evals python -m majorana_evals.sdk_drift drift-check \
    --out /tmp/sdk-drift-check.json
```

No database, no sandbox worker queue, no `DATABASE_URL` needed — like the
resource-estimation benchmark, this grades a candidate's Python source directly against its
own hidden test in a subprocess, never through Nala's production pipeline.

## What the offline controls found (measured, not simulated)

| Adapter | Result |
|---|---|
| `canonical` (positive control — modern idiom) | **20/20 passed (100%)** |
| `outdated` (negative control — pre-1.0/pre-2.0 idiom) | **0/20 passed (0%)**, and **20/20 failures matched their task's own `expected_failure_pattern`** (i.e. every failure is confirmed to be the CITED drift, not an unrelated bug) |
| `drift-check` (canonical solutions vs. the currently-installed Qiskit) | **20/20 still pass against qiskit==2.5.2** — no drift detected yet |

The grader was mutation-tested during this build (see `SPEC.md`'s "Controls" section for the
break/observe/revert procedure) to confirm these numbers reflect a real comparison, not a
vacuously-passing check.

## The zero-cost CI job

`.github/workflows/sdk-drift-reference-check.yml` installs the latest published Qiskit and
re-runs `drift-check` on a weekly schedule (plus manual dispatch). It needs no secrets and
makes no model call. See `SPEC.md`'s "CI" section for what it does and does not do.
