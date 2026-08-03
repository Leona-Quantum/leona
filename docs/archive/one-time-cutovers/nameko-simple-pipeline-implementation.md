> **ARCHIVED 2026-08-04.** a local execution and audit log from one checkout; the decision it records is ADR-0023, and the shipping code is `simple_plan.py` + `simple_ports.py`.
> Retained for history; do not treat as current.

# Nameko-style simple pipeline implementation log

This is the local execution and audit log for ADR-0023. The authoritative external
plan and memory paths referenced by the repository `AGENTS.md` were not present in
this environment on 2026-07-24, so this file records only work and command output
actually observed in this checkout. It does not replace owner/CODEOWNER review.

Branch: `feature/nameko-simple-pipeline`

## Audit rule

Every step follows this sequence and stops on a failure:

1. confirm scope and applicable `AGENTS.md`;
2. implement one bounded slice;
3. run targeted tests and static checks;
4. inspect the diff for security, failure-path, and compatibility regressions;
5. record the observed result here before starting the next slice.

## Step 0 — architecture and boundaries

Status: passed on 2026-07-24.

- Added proposed ADR-0023 to supersede the model-directed tool loop only for new
  execute runs.
- Kept deny-all sandbox creation, protected RESULT/FINAL_CIRCUIT, source
  fingerprints, repository Scope, durable events, cancellation, metering, and
  historical readers as non-negotiable boundaries.
- Marked contracts, persistence, sandbox, live-provider spend, deployment, push, and
  merge as owner/CODEOWNER-gated.
- Chose a `legacy|simple` rollout flag and no mid-run engine switching.
- `git diff --check` passed.

Open review item: ADR-0014 is accepted and ADR-0023 remains proposed until owner and
CODEOWNER review; implementation stays feature-flagged and does not change the
production default before that review.

## Step 1 — eval harness trusted RESULT

Status: passed on 2026-07-24.

Changed the corpus harness to load the latest Candidate's stored
`ExecutionEvidence.result`, verifying candidate ID and source fingerprint binding
before scoring. Removed stdout JSON/count/value/key parsing. Sandbox stdout remains
available only for human diagnostics and cannot satisfy a corpus expectation.

Observed checks:

```text
uv run pytest evals/harness/tests \
  services/worker/tests/test_agent_events_v2.py \
  services/worker/tests/test_agent_store.py -q
20 passed, 1 skipped

uv run ruff check evals/harness \
  services/worker/src/majorana_worker/agent_store.py
All checks passed!

uv run ruff format --check evals/harness
6 files already formatted

git diff --check
passed
```

Audit findings:

- adversarial stdout containing plausible counts and values cannot influence score;
- missing protected RESULT fails only expectations that require result content;
- stale fingerprint evidence is rejected rather than scored;
- old report payloads remain readable because new evidence fields have defaults;
- no contracts, database, sandbox, or production worker behavior changed in this step;
- the live-provider self-test was skipped because its explicit environment gate was
  not enabled; no live quality result is claimed.

## Step 2 — fixed pipeline core

Status: passed on 2026-07-24.

Added `SimpleCircuitPipeline` in `majorana_agent` as an isolated coordinator. Its port
surface contains fixed methods for plan, generate, execute, basic contract check,
intent review, export, and save. It has no `ToolCall`, `ToolName`, `ToolBroker`,
strict-verifier, stdout parser, or model-selected transition.

The core returns typed `SimplePipelineFailure` data for expected and unexpected stage
failures. It enforces finite plan/generation/execution/review/save budgets, checks
cancellation before each external operation, sanitizes unexpected exceptions, and
returns only succeeded/failed/cancelled terminal outcomes. Candidate, execution,
review, conversion, and artifact bindings are checked before downstream use.

The initial test pass exposed two manual-audit findings that were fixed before this
step was accepted:

- a first Plan/Candidate with a skipped revision could satisfy its record model but
  was not valid for a new pipeline run; the coordinator now requires revision 1 and
  no parent at both initial boundaries;
- an INCONCLUSIVE review was retried before its binding was checked; every review
  attempt is now fingerprint-checked before it may influence retry.

The provider-free matrix covers the fixed happy path, code repair, one replan,
inconclusive review, provider retries at planning/execution/review, cancellation,
candidate/save budget exhaustion, exception sanitization, export neutrality,
integrity failures, and stale execution/review evidence. Only a typed ordinary
`export` failure is downgraded to a warning; export integrity/internal failures remain
fail-closed.

Observed checks:

```text
uv run pytest packages/py/agent/tests/test_simple_pipeline.py -q
18 passed

uv run --all-packages pytest <LLM, agent, frameworks, openqasm, verification,
sandbox, worker agent, and eval harness targeted suites> -q
458 passed, 2 skipped, 4 warnings

uv run ruff check packages/py/agent evals/harness
All checks passed!

uv run ruff format --check packages/py/agent evals/harness
26 files already formatted

git diff --check
passed
```

The four warnings are PennyLane dependency deprecations. No contracts, database,
sandbox provider, worker dispatch, production default, or external provider was
changed or called in this step.

## Step 3 — production ports and engine selection

Status: passed on 2026-07-24.

Added metered production ports for simple planning, source generation, existing
sandbox execution, basic contract checks, AI intent review, trusted OpenQASM export,
and artifact saving. The planning prompt omits strict verification policy and the
generation prompt emits only source; neither prompt offers tools or stage selection.
The reviewer receives the stored request/Plan/source/protected RESULT evidence and
only two already-passed basic check summaries, not stdout.

Every durable step ID begins with `simple:` and uses existing append-only step,
Plan, Candidate, execution, review, conversion, and materialization records. A worker
restart deterministically replays from the start, but stored stage outputs and metered
LLM responses prevent duplicate provider calls, sandbox runs, Candidate revisions, or
artifacts. The Worker now has only this engine. Legacy progress is detected before a
provider call and terminalized with `legacy_run_requires_restart`.

The simple terminal path records `ai_review_aligned` with no verifier decision or
Verified claim. Typed failure codes are emitted through `run.error`, and the failure
message contains no raw provider exception. Ordinary OpenQASM failure remains
best-effort; integrity/internal export errors remain terminal.

Observed checks:

```text
uv run pytest services/worker/tests/test_simple_ports.py \
  services/worker/tests/test_handlers.py -q
42 passed

uv run --all-packages pytest <targeted LLM/agent/framework/openqasm/
verification/sandbox/worker/eval suites> -q
466 passed, 2 skipped, 4 warnings

uv run ruff check <changed Python packages and files>
All checks passed!

uv run ruff format --check <changed Python packages and files>
37 files already formatted

git diff --check
passed
```

Audit findings:

- no simple port calls or persists strict verification;
- protected RESULT, not stdout, supplies contract keys and review evidence;
- production sandbox selection is unchanged, so deny-all remains owned by the
  existing sandbox provider;
- repository access remains through `AgentStore` or Scope-first repository calls;
- replay tests prove one provider plan call, one generation call, one sandbox
  execution, one review, one conversion, and one save despite running the same
  pipeline twice;
- the production default remains legacy;
- the repository store still requires strict evidence for conversion/materialization,
  so the non-default simple path intentionally stops at `simple_save_not_enabled`.
  Step 4 must remove that stale repository-only gate before simple mode is usable.

## Step 4 — private save without strict verification

Status: passed locally on 2026-07-24; persistence blast-radius review remains required.

Added a simple-path artifact saver authorized by successful sandbox execution plus a
fingerprint-bound READY semantic review. It writes the executed framework source as
the canonical representation and attaches OpenQASM only when trusted conversion
succeeds. Export failure remains a disclosed warning and does not block private save.

The artifact metadata says `verified: false`, `decision: not_run`, and
`strict_verification_not_run`; it identifies AI review as advisory and lists quantum
correctness, physical fidelity, and optimality as unverified claims. The event stream
uses the same review-only language and does not say that bound strict verification
passed. The existing public visibility repository gate still requires an
`agent_candidate` with a verified physical PASS; an explicit test proves a
`simple_pipeline_candidate` cannot cross that gate.

The Worker store and Scope-first API repository now authorize conversion and
materialization from a successful execution plus READY review, with complete
candidate/execution/review/fingerprint binding. A strict attempt is optional; if one
exists its fingerprint must still match. No database schema or migration changed.
These repository authority changes are blast-radius changes and must receive
CODEOWNER review before merge.

Observed checks:

```text
uv run pytest services/api/tests/test_agent_review_gates.py \
  services/worker/tests/test_simple_ports.py \
  services/worker/tests/test_agent_store.py \
  services/worker/tests/test_agent_events_v2.py \
  services/worker/tests/test_handlers.py \
  services/api/tests/test_artifact_verification_gates.py -q
83 passed

uv run ruff check <Step 4 API/Worker source and tests>
All checks passed!

uv run ruff format <Step 4 API/Worker source and tests>
2 files reformatted, remaining files unchanged

git diff --check
passed
```

Audit findings:

- no simple save creates or fabricates a strict-verification attempt;
- failed/non-READY or stale reviews cannot authorize conversion or save;
- the repository itself rechecks Scope-scoped evidence rather than trusting Worker
  input;
- the artifact is created private and cannot be made public through the existing
  visibility gate;
- replay reuses the existing materialization and does not create a second artifact;
- legacy strict records, repository fields, readers, and event schemas remain intact;
- no live database, external provider, deployment, push, or publication was used, so
  those production acceptance claims remain untested.

## Step 5 — default, failure matrix, and safe cleanup

Status: passed locally on 2026-07-24.

All execute runs use the fixed pipeline. `MAJORANA_CIRCUIT_PIPELINE` and its legacy
rollback were removed. A legacy step or a step-less historical Plan/Candidate is
rejected before provider or sandbox work and must be resubmitted as a new run.

The simple review no longer reuses the legacy fail-closed quantum critic. It makes one
metered model call over request, Plan, exact source, protected RESULT, resource
observation, and already-passed basic checks. Its prompt explicitly disclaims strict
verification. Low-confidence or internally inconsistent repair/replan output becomes
INCONCLUSIVE; only a concrete medium/high-confidence major mismatch can spend a code
or Plan revision. Malformed review output is a typed model-output failure and receives
at most the pipeline's two review attempts.

Two failure-path findings were fixed before accepting this step:

- run-wide timeout used to fabricate an INCONCLUSIVE verifier verdict when no strict
  attempt existed; it now records only `run_timeout` unless real bound strict evidence
  from a legacy run already exists;
- an artifact transaction failure could be retried on the same failed DB session;
  simple save now rolls back first and retries only after rollback succeeds. A rollback
  failure is terminal and sanitized.

The corpus harness now scores the default product semantics:
`succeeded + ai_review_aligned + trusted RESULT + expected export + saved artifact`.
`verifier_decision` is optional and checked only for an explicitly legacy case. Existing
report JSON remains readable because new report fields are defaulted.

Cleanup audit:

- the Worker model-directed adapter, strict verifier, strict event projector, engine
  selector, and legacy best-effort ranker were deleted;
- fixed execution and OpenQASM adapters live in `runtime_ports.py`, and the event
  projector accepts only `simple:` tool records;
- historical schemas and API readers remain intact so old records can still render;
- unfinished legacy runs are not resumed or mixed with fixed-pipeline evidence.

Observed checks:

```text
uv run --all-packages pytest <LLM/agent/framework/openqasm/verification/sandbox/
API-review-gates/Worker/eval targeted suites> -q
535 passed, 2 skipped, 4 warnings

uv run pytest -q
930 passed, 67 skipped, 4 warnings

uv run ruff check .
All checks passed!

uv run ruff format --check .
243 files already formatted

pnpm turbo run lint typecheck test
6 tasks successful; Web tests: 89 passed

git diff --check
passed
```

The first full Python run found one false positive in the raw-query security gate:
the protocol method name `.execute(...)` looked like a SQL session call. The security
gate was not weakened; the port was renamed `run_execution`, its targeted tests passed,
and the full suite then produced the result above.

Remaining acceptance limits: 67 tests were skipped by their documented environment
gates; no real database integration, paid LLM, Vercel deny-all sandbox acceptance,
deployment, push, merge, or public action ran. The four warnings are existing
PennyLane dependency deprecations.

## Step 6 — final cross-boundary audit

Status: passed locally on 2026-07-24; ready for owner/CODEOWNER review.

The final audit found and fixed one replay-specific issue: metered LLM responses are
keyed by request fingerprint, but intent-review attempts 1 and 2 initially had
identical requests. That made a stored malformed or inconclusive response replay
forever. `review_attempt` is now part of the model request: a restart reuses the exact
same attempt, while the second bounded attempt has a distinct fingerprint and may
produce a new answer. The integration test exercises INCONCLUSIVE then READY and
asserts the two requests differ.

Final boundary result:

- **Control flow:** worker-owned Plan → Generate → sandbox Execute → basic contract →
  advisory intent review → best-effort OpenQASM → private save; no model-selected tool
  or strict verifier is reachable for a new default run.
- **Trust:** protected RESULT and FINAL_CIRCUIT observation remain authoritative;
  stdout/stderr are diagnostics only; candidate, execution, review, conversion,
  artifact, run-version, and workspace bindings are checked.
- **Sandbox:** no sandbox source changed; provider-free hostile tests still assert
  deny-all egress and an empty credential environment at creation.
- **Durability:** deterministic IDs, durable LLM response/metering records, bounded
  retries, transaction rollback before save retry, cancellation checks, engine pinning,
  and atomic terminal run fencing remain in place.
- **Claims:** simple success carries a typed `inconclusive`/`structural` summary with
  `ai_review_aligned`; it records the two basic checks that ran, lists strict quantum
  claims as unverified, remains private, and fails the physical-PASS public gate.
- **Compatibility:** database schema, migrations, contracts, historical strict
  evidence, legacy event readers, and legacy in-flight execution remain intact.
- **Scope:** all new persistence authority is Scope-first; the raw-query repository
  gate is clean.

Final observed checks:

```text
uv run ruff check .
All checks passed!

uv run ruff format --check .
243 files already formatted

uv run pytest -q
931 passed, 67 skipped, 4 warnings

uv run pytest packages/py/sandbox/tests -q
33 passed, 1 skipped

uv run python scripts/check_raw_queries.py
check_raw_queries: clean

pnpm turbo run lint typecheck test
6 tasks successful; Web tests: 89 passed

git diff --check
passed
```

No contracts, migration, generated TypeScript contract, sandbox implementation, CI
workflow, credential, deployment, or public state was changed. The Scope-first
repository authorization changes in `services/api/.../repos/agent.py` are still a
blast-radius slice and require CODEOWNER review. Production release additionally
requires an owner-authorized real database replay/migration smoke test, paid-provider
quality eval, and Vercel canary proving actual network denial; none is claimed here.

## Step 7 — namekoQ reliability cleanup and typed GUI outcome

Status: passed locally on 2026-07-25; paid-provider and Vercel canaries remain external.

The failure investigation compared Majorana's failed run history with namekoQ's
request loop. It found four product causes rather than one provider outage:

- the model had to emit the large legacy Plan schema, including hidden cross-field
  rules absent from JSON Schema, and the retry prompt discarded the actual validation
  errors;
- execution repair received only an exit code even though bounded sandbox diagnostics
  were already stored;
- DeepSeek used both SDK retries and wrapper retries, multiplying transient failures,
  and V4 Pro thinking was not explicitly disabled;
- successful simple runs wrote an untyped pseudo-summary, so the GUI classified new
  records as legacy evidence.

The fixed pipeline now uses a small tolerant `SimplePlan`, maps it to the durable Plan
internally, returns bounded validation and sandbox diagnostics to the next permitted
attempt, disables DeepSeek thinking, and has one retry authority. Quota, auth,
permission, model, and bad-request failures stop immediately; only rate limit,
timeout/connection, and transient upstream failures retry up to three total provider
calls. All substantive stages use `deepseek-v4-pro`. The worker's omitted-timeout
default is 600 seconds, matching the API maximum.

Run and Artifact now share one Pydantic-validated advisory summary:
`inconclusive`, `structural`, `ai_review_aligned`, `evidence_gap`, with passing
`structural` and `return_contract` checks. The GUI renders this as “Executed and
AI-reviewed,” never as Legacy and never as Verified.

Observed checks:

```text
uv run pytest
941 passed, 67 skipped, 4 dependency warnings

uv run ruff check .
All checks passed!

uv run ruff format --check .
245 files already formatted

uv run python scripts/check_raw_queries.py
check_raw_queries: clean

node scripts/check-repository-data.mjs
repository data valid (283 entries)

pnpm turbo run lint typecheck test
6 tasks successful; Web tests: 90 passed

DATABASE_URL=<local PostgreSQL> uv run pytest \
  services/api/tests/test_pipeline_e2e.py -k simple -vv
1 passed, 2 deselected

git diff --check
passed
```

The provider-free E2E exercised API creation, queue claim, fixed worker, real local
subprocess execution, durable PostgreSQL records, private artifact save, API replay,
and SSE replay. It also corrected a dormant live-test ORM attribute typo. It did not
call an external LLM, spend provider credit, deploy, push, merge, change credentials,
or validate Vercel's production deny-all network policy.

## Step 8 — remove the retired runtime package

Status: passed locally on 2026-07-25; owner/CODEOWNER and live canaries remain.

The final cleanup removed the retired `majorana_agent` broker, model-directed runtime,
toolset, state-machine store protocol, prompts, and their legacy-only tests. The
package now exports only the fixed pipeline, its small typed records, simple Plan
parser, and an in-memory fixed-pipeline store. Persisted legacy enum values remain
readable, but there is no transition table or executor behind them.

The Worker now emits `code.generated` as soon as the immutable Candidate is stored,
before sandbox execution begins. The event ID is deterministic and shared with replay,
so the GUI can move from Generate to Execute without introducing duplicate events.
A regression test also proves historical `strict_verify`/`verified` rows still decode.

The LLM package no longer ships the retired strict Plan prompt/parser, analysis
record, or free-form code extractor. Its public prompt surface is now only chat,
intent routing, and the fixed pipeline's Plan/Generate/Review prompts. The production
Worker dependency graph no longer includes `majorana-verification`.

New runs now persist every Plan, including revision 1, through the same append-only
`RunPlan` revision path. The retired `PlanRecord` wrapper and Worker-side `set_plan`
dual-write were removed; historical `AgentRun.plan` columns and their API compatibility
reader remain untouched. Candidate records also no longer carry unused embedded
execution/verification IDs because those relationships live in their own fingerprint-
bound evidence records.

An event append failure after a durable step commit no longer turns successful domain
work into a false failed run. The Worker rolls back the failed projection transaction,
continues from the committed evidence, and reconciles deterministic events before
terminalization. Real PostgreSQL tests cover both this failure and a worker interruption
after Candidate persistence: Plan/generation provider responses, Candidates, events,
sandbox evidence, artifacts, and terminal events are not duplicated.

Latest observed checks:

```text
uv run pytest -q
769 passed, 70 skipped, 4 dependency warnings

uv run ruff check .
All checks passed!

uv run ruff format --check .
228 files already formatted

uv run python scripts/check_raw_queries.py
check_raw_queries: clean

node scripts/check-repository-data.mjs
repository data valid (283 entries)

pnpm turbo run lint typecheck test
6 tasks successful; Web tests: 103 passed

DATABASE_URL=<temporary local PostgreSQL> uv run --all-extras pytest \
  services/api/tests/test_pipeline_e2e.py -q
4 passed, 1 live-provider test skipped

DATABASE_URL=<temporary local PostgreSQL> uv run --all-extras pytest \
  services/api/tests/test_job_queue_live.py \
  services/api/tests/test_run_terminal_live.py \
  services/api/tests/authz -q
13 passed

DATABASE_URL=<temporary local PostgreSQL> uv run pytest \
  services/api/tests/test_pipeline_e2e.py \
  services/api/tests/test_job_queue_live.py \
  services/api/tests/test_run_terminal_live.py \
  services/api/tests/test_repo_scoping.py \
  services/api/tests/test_agent_review_gates.py -q
50 passed, 1 live-provider test skipped

alembic upgrade head -> downgrade base -> upgrade head
passed on an empty temporary PostgreSQL database

git diff --check
passed
```

Both temporary PostgreSQL databases and their test-only data were deleted after the
checks. No external provider or Vercel credentials were present, and the in-app
browser controller was unavailable. Therefore paid DeepSeek V4 Pro, managed-database
canary, Vercel deny-all execution, and visual GUI acceptance were not run or claimed.
UI source changes remain subject to the explicit Eshaan lane restriction.

## Step 9 — namekoQ-style run UI refinement

Status: passed locally on 2026-07-25; visual acceptance remains owner-reviewed.

The owner explicitly authorized this bounded UI change, overriding the standing
non-UI lane for this step. The live run now projects the fixed pipeline into one
stable five-stage activity card with numbered queued stages, explicit active/error
states, a completion count and meter, and technical events behind a disclosure.
This follows namekoQ's readable progress hierarchy without restoring a model-directed
tool feed.

The terminal result is a separate structured card with a clear outcome, evidence and
save badges, compact algorithm/framework/revision facts, an explicit verification
limitation, and collapsed evidence and generated code. Duplicate Evidence/Artifact
facts were removed because their state is already represented by the badges and
disclosures. The same component handles success, failure, cancellation, best-candidate,
and historical typed verification states.

Observed checks:

```text
pnpm turbo run lint typecheck test
6 tasks successful; Web tests: 103 passed

pnpm --filter @majorana/ui-visual a11y
36 passed

uv run pytest -q
769 passed, 70 skipped, 4 dependency warnings

curl http://127.0.0.1:3000/run/demo-reviewed
HTTP success; rendered markup included the activity, progress, outcome, evidence,
and generated-code surfaces and did not include the legacy-evidence warning.

git diff --check
passed
```

The visual suite covers active, complete, and failed progress; reviewed and failed
outcomes; WCAG checks; and mobile overflow for both progress and outcome cards. The
in-app browser controller was still unavailable, so no screenshot-based visual
acceptance is claimed. The existing local fixture is available for owner inspection
at `/run/demo-reviewed`; no deployment, push, merge, credential, or public action ran.

## Step 10 — namekoQ-style validation and autonomous repair

Status: passed locally on 2026-07-25; live-provider quality remains untested.

The advisory review now applies namekoQ's four standard layers: request-to-Plan,
Plan-to-source, source/RESULT-to-success-criteria, and artifact-contract alignment.
Its typed output includes concrete passed/failed checks, mismatches, minimal repair
instructions, and residual risks. A claimed READY result is downgraded when either
the model or a deterministic check reports a failure.

The Worker now derives a trusted `success_criteria` check from the protected RESULT.
It verifies that the Plan's primary metric exists and, when an expected numeric range
is supplied, compares the finite observed value against its min/max bounds. Successful
advisory summaries expose structural, return-contract, and success-criteria checks;
they remain explicitly inconclusive/structural and do not claim strict quantum
correctness.

Two INCONCLUSIVE reviews over unchanged evidence no longer end the run immediately.
The fixed pipeline sends the bounded review feedback and previous source to Generate,
creates a new immutable Candidate, re-runs the sandbox and contract checks, and reviews
the new evidence. This continues within the existing four-Candidate budget. Repeated
inconclusive results still fail closed at that finite boundary, so the workflow cannot
loop or spend indefinitely.

Observed checks:

```text
uv run pytest packages/py/agent/tests/test_simple_pipeline.py \
  services/worker/tests/test_simple_ports.py \
  services/worker/tests/test_handlers.py -q
62 passed

uv run pytest -q
773 passed, 70 skipped, 4 dependency warnings

uv run ruff check .
All checks passed!

uv run ruff format --check .
228 files already formatted

pnpm turbo run lint typecheck test \
  --filter=@majorana/ui --filter=@majorana/web --filter=@majorana/ui-visual
6 tasks successful; Web tests: 103 passed

pnpm --filter @majorana/ui-visual a11y
36 passed
```

No paid DeepSeek request, deployment, database migration, contract schema change,
credential action, push, merge, or public action ran. Provider outages and an entire
candidate budget of genuinely insufficient evidence remain explicit terminal
conditions rather than being mislabeled as a successful review.
