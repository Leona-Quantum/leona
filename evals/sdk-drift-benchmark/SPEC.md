# SDK-drift benchmark — spec (first increment)

ai-ops#357 ("Which benchmark should Leona build under its own name…"), option 3. Owner
ruling: "all of them perhaps?", read as build options 1, 2, and 3 in sequence — option 1
(resource-estimation) shipped in PR 953, option 2 (paper-to-code) ships alongside this PR.
This is option 3. Design rationale:
`~/Developer/ai-ops/desk/leona/plans/strategy-20260921/benchmarks-and-jev.md` §3, and
`../resource-estimation-benchmark/SPEC.md`'s "what option 3 would need next" section (written
during that PR, before this one existed).

## Why this benchmark

A model trained on Qiskit code written before a given API changed will keep writing the OLD
idiom — `qiskit.execute()`, `qiskit.providers.aer`, V1 primitives, `qiskit.opflow`, and a
dozen other removed or reshaped APIs — long after that idiom stops working. Public benchmarks
like `quantum-api-drift` (2607.04072) already measure this once, but as a static snapshot; the
credibility case for owning this under Leona's name is specifically the LIVE, re-run property
described in the strategy doc: the same fixed task set, graded against whichever Qiskit
release is current, so the score moves when the SDK moves rather than when the benchmark
author remembers to update it.

## Task format

Each case (`cases/<task_id>.yaml`, validated against
`majorana_evals.sdk_drift.schema.SdkDriftTask`) targets ONE specific, cited Qiskit API change
and has:

- `change` — the citation: `old_api`/`new_api` (short code snippets), `changed_in_version`,
  `release_note_url`, and `release_note_quote` (verbatim, or explicitly marked as a
  table-entry citation when the source page has no standalone prose sentence — see
  `PROVENANCE.md`).
- `prompt` — the self-contained instruction: what small, deterministic routine to
  implement, its exact function signature, and any genuinely functional requirement (a
  backend choice, determinism, serial execution). **Deliberately NEUTRAL**: a prompt never
  names the cited old API, the cited new API, the words removed/deprecated/legacy, or the
  Qiskit version — see "Prompt neutrality" below for why and how this is enforced.
- `entry_point` / `scaffold` — imports + function signature + docstring, no body.
- `canonical_solution` — body only, MODERN idiom. Must pass `hidden_test` against the
  Qiskit version pinned in this repo (`qiskit==2.5.2`, from `uv.lock`).
- `outdated_solution` — body only, deliberately OLD idiom (the code a model trained before
  the change would plausibly write). Must FAIL `hidden_test` against the pinned Qiskit
  version.
- `hidden_test` — Python source defining `check(candidate)`, exactly the `qiskit_human_eval`
  / `paper_to_code` convention: raises on failure, checked BEHAVIOURALLY (a returned counts
  dict, a unitary matrix, a boolean), never by inspecting source structure.
- `expected_failure_pattern` — a regex checked against the outdated run's captured stderr.
  This is what proves a negative-control failure is the CITED drift, not an unrelated bug,
  a timeout, or a plain crash.
- `qiskit_pin_at_authoring` — the Qiskit version this task was verified against (`2.5.2`
  for every case in this increment), so a future drift-check report can say "was verified
  against X, now running against Y".

## Prompt neutrality

**A prompt that names the API under test measures instruction-following, not SDK
currency.** "Build a Bell-pair circuit and run it — use `transpile()` and `backend.run()`,
never the removed `execute()`" tells a model exactly which call to make; a model that
obeys the instruction passes regardless of whether IT would have reached for `execute()`
on its own. This benchmark's premise is the opposite: a model trained on old Qiskit code
will REFLEXIVELY write the old idiom absent any hint, so the prompt must never give one.

Every `prompt` is reviewed to be a NEUTRAL task statement: what the function must do, its
exact signature, and any genuinely functional requirement (which kind of backend, whether
the result must be deterministic, whether it must run with a single worker) — never the
cited `old_api`, the cited `new_api`, the words removed/deprecated/legacy, or the Qiskit
version. Where a task can only be posed by naming a class, the CONCEPT is named, not the
version-specific class — "sample the circuit via a Sampler primitive" is fine;
`StatevectorSampler` (the specific V2 class) is not.

This is enforced mechanically, not just by review discipline:
`majorana_evals.sdk_drift.prompt_neutrality.leaked_identifiers` extracts identifier-shaped
tokens from `old_api` and `new_api`, keeps only the ones DISTINCTIVE to one side (the
symmetric difference — a token appearing in both, like a shared class or function name,
does not reveal which generation to use and is not banned), drops a short reviewed
allowlist of vocabulary needed to state any Qiskit task, and reports any of what remains
found as a substring anywhere in `prompt` — plus the words removed/deprecated/legacy and
any version number from `changed_in_version`, unconditionally. `loader.py` calls this at
load time and refuses to load a case that fails it — a leaking case cannot silently ship.
Mutation-tested (`test_mutation_prompt_neutrality_check_actually_fires_on_the_shipped_corpus`
in `evals/harness/tests/test_sdk_drift.py`): re-inserting a real case's own `old_api` text
into its prompt in memory is confirmed to trip the check before the check is trusted.

## Grading rule

Two-layer, same convention as `paper_to_code`:

1. **The sandbox guard's import allowlist** (`majorana_sandbox.guard.check_python_code`) —
   checked against every canonical solution at LOAD time (a case whose own modern-idiom
   reference needs a blocked import is unusable; see "Cases dropped" in `PROVENANCE.md`).
2. **Behavioural equivalence via subprocess execution** — candidate source + `hidden_test` +
   `check(entry_point)`, run with a 30s timeout. A task passes when `check()` returns
   without raising.

`passed` is a plain boolean (unlike the resource-estimation benchmark's continuous score —
there is no meaningful "partial credit" for a function that raises `ImportError` before it
runs). `drift_reason_matched` is a SEPARATE field, populated only on a failing run: whether
`expected_failure_pattern` matched the captured stderr. This is what lets a report
distinguish "failed because of the cited drift" from "failed for some other reason" —
without it, a negative control that failed due to a typo would look identical to one that
correctly demonstrates the API break.

## Controls (all zero-spend, no model API call of any kind)

Implemented as offline `ModelAdapter`s in `adapters.py`, exercised in
`evals/harness/tests/test_sdk_drift.py` and via the CLI:

| Adapter | What it does | Required result | Measured result |
|---|---|---|---|
| `canonical` | Echoes each task's own `scaffold + canonical_solution` (modern idiom) | 100% pass | **20/20 passed** |
| `outdated` | Echoes each task's own `scaffold + outdated_solution` (old idiom) | 0% pass, AND every failure matches `expected_failure_pattern` | **0/20 passed, 20/20 failures matched the cited drift reason** |

**Mutation-check performed during this build** (not a permanent artifact): `grader.py`'s
`if result.returncode == 0:` line was temporarily replaced with `if True:` (forcing every
run to report a pass regardless of actual exit code). Re-running the `outdated` control
against the mutated grader flipped its result to **20/20 "passed"** — proving the pass/fail
check is load-bearing, not vacuous. The grader was then reverted (confirmed byte-identical
to the pre-mutation file via `diff`) and the control re-run, confirming it correctly returned
to **0/20 passed**.

One authoring-time correction this same discipline caught: the `execute-removed` case's
`expected_failure_pattern` was originally written as `"no attribute 'execute'"` (the error
from `qiskit.execute` as a bare ATTRIBUTE access, which is what a solo interpreter probe
showed). The task's actual outdated solution instead writes `from qiskit import execute`,
which goes through Python's IMPORT machinery and raises a differently-worded
`ImportError: cannot import name 'execute' from 'qiskit'` — a real, if narrow,
attribute-access-vs-import-statement distinction that only running the grader against the
actual case (not a standalone probe) surfaced. Fixed before this PR; see that case's `notes`
field for the full account.

## The "re-run on every release" half

`majorana_evals.sdk_drift drift-check` (see `README.md`) re-runs every task's own
CANONICAL (modern-idiom) solution against whatever Qiskit is installed in the current
environment — zero spend, no model call, no network beyond whatever already installed the
Qiskit being tested against. A non-zero exit means at least one reference solution that used
to pass no longer does: exactly the "does the reference itself drift on a new SDK release"
signal a live leaderboard needs, and the CI workflow this ships with (see below) runs this
half on a schedule.

**What this increment does NOT build** (future work, same reasoning as the resource-estimation
benchmark's "what options 2/3 would need next" section): a public leaderboard page showing
scores across SDK versions side by side, a CI trigger keyed to actual upstream Qiskit
releases (rather than a fixed schedule), and any LIVE model grading. Those all cost money
(a live model call) or need a decision the owner hasn't made (a public-facing leaderboard),
so this increment stops at the harness plus the zero-cost drift-detection half.

## CI

`.github/workflows/sdk-drift-reference-check.yml` (new — blast-radius: workflows) runs
`majorana_evals.sdk_drift drift-check` on a weekly schedule and on manual dispatch. It
installs the LATEST published Qiskit (not the repo-pinned `2.5.2`) into a throwaway venv and
re-runs every canonical solution against it. It needs no secrets and makes no model call —
if a task's own reference has drifted on a newer Qiskit, the job fails and says which task
and why, which is the entire point: catching a task whose CITED API change further changed
underneath it, before anyone tries to grade a model against a broken task.

## Layout

```
evals/sdk-drift-benchmark/
  SPEC.md            — this file
  README.md          — how to run it
  PROVENANCE.md       — per-task citation + verification, and what was dropped
  cases/*.yaml        — 20 cases
evals/harness/src/majorana_evals/sdk_drift/
  schema.py           — SdkDriftTask, ModelAnswer-equivalent, grading result types
  grader.py           — sandbox-guard + subprocess execution + drift-reason matching
  adapters.py         — ModelAdapter protocol + the 2 offline controls
  loader.py           — case loading, validation, dataset hashing
  runner.py           — drives an adapter over the corpus, aggregates a report
  pricing.py          — prices a hypothetical live run (never executed)
  __main__.py         — CLI (`run` and `drift-check` subcommands)
evals/harness/tests/test_sdk_drift.py
.github/workflows/sdk-drift-reference-check.yml
```
