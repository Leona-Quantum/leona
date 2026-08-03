> **ARCHIVED 2026-08-04.** self-marked superseded by ADR-0023. The three-state verdict and private materialization shipped (migrations 0026-0033); the strict-verification runtime this plan specifies did not.
> Retained for history; do not treat as current.

# Verification v2 — gated implementation plan

Status: superseded by ADR-0023; retained as historical design context only
Prepared: 2026-07-23  
Target integration path: `feature/* -> dev -> prod`, squash merge only  
Primary scope: `packages/py/{contracts,verification,agent,llm,frameworks}`, `services/{api,worker}`, `evals/`  
UI scope: `apps/web` only after an explicit Eshaan/owner lane override  

The strict-verification runtime described below is not the architecture for new
runs. The current product uses Plan → Generate → Execute → basic contract check →
AI intent review → optional export → private save. Do not implement this plan
without a new owner decision.

## 1. Objective

Implement a verification pipeline in which:

1. planning describes the requested artifact and verification claims, but never authors a
   canonical/reference QASM circuit;
2. previously passing artifacts are never used as correctness oracles;
3. every candidate revision receives a mandatory base sandbox execution under the deny-all policy
   before semantic review; fixed verification policy may perform additional trusted re-executions
   without creating a new candidate revision;
4. the LLM verifier keeps its current role: it reads the request, plan, exact source, recorded
   execution, and deterministic observations, then returns semantic feedback; it does not select
   or launch simulations;
5. a separate strict gate applies trusted deterministic and problem-specific verification;
6. the final decision is `pass`, `fail`, or `inconclusive`;
7. `pass` and `inconclusive` artifacts may be materialized in Studio, but only `pass` may be shown
   as Verified or enter any verified/publication path;
8. a confirmed candidate defect returns to code generation, a plan defect returns to planning,
   and verifier/evidence limitations never consume a candidate revision;
9. the selected-framework source remains canonical and OpenQASM remains optional interchange.

This document is an execution plan, not permission to merge blast-radius changes. Contracts,
migrations, sandbox behavior, auth, workflows, and publication gates require the repository's
normal CODEOWNER/owner review.

## 2. Fixed product decisions

These decisions are not left to the implementing agent:

- Delete `VerificationPlan.reference_source` and `VerificationPlan.reference_qasm`.
- Remove `exact` from the planner-selectable verification methods. Keep historical enum/DB values
  readable until a separately approved retention migration says otherwise.
- Do not use `parent_artifact` QASM, a similar catalog circuit, or a previously passing candidate as
  ground truth.
- Preserve `parent_artifact_id` only as artifact/version provenance.
- Previously verified artifacts may remain generation exemplars, but they are untrusted hints. They
  must never be copied into verification evidence or treated as proof.
- The LLM semantic reviewer does not execute tools or request simulations.
- Simulation happens after each new candidate revision. Trusted verifier re-execution may still run
  under fixed policy; it is not selected by the LLM.
- A candidate source change always creates a new candidate revision and invalidates prior execution,
  review, strict-verification, and conversion evidence.
- `fail` means a defect was positively established. Unsupported checks, low-confidence criticism,
  malformed critic output, timeouts, infrastructure errors, and insufficient evidence resolve to
  `inconclusive`, not `fail`.
- Studio entry is not a trust boundary. Verified publication is.
- Conversion status never upgrades or downgrades the source-code verification decision.
- No QPU, paid provider, deployment, public publication, push, or secret action is authorized by
  this plan.

## 3. Target architecture

```text
User request
    |
    v
Planning --plan defect-----------------------------------+
    |                                                    |
    v                                                    |
Code generation <--- confirmed candidate defect --------+
    |
    v
Base sandbox simulation (mandatory for every candidate revision)
    |
    v
Fast deterministic checks
    | fail: confirmed code/contract defect
    v
LLM semantic review (reads evidence; launches no tools)
    | clear mismatch -> repair/replan
    | pass or uncertainty
    v
Strict deterministic gate
    |-- PASS -----------> optional QASM conversion -> Studio VERIFIED
    |-- FAIL -----------> typed feedback route -> planning or code generation
    `-- INCONCLUSIVE ---> optional QASM conversion -> Studio UNVERIFIED
```

The strict gate must consume immutable records bound by:

```text
candidate.source_fingerprint
    == execution.source_fingerprint
    == semantic_review.source_fingerprint
    == strict_verification.source_fingerprint
    == artifact_version.fingerprint
```

## 4. Decision semantics

### 4.1 Check-level results

Use distinct check outcomes; do not overload `fail`:

| Result | Meaning | Candidate defect? | Final aggregation |
|---|---|---:|---|
| `pass` | Check ran and agreed | No | Supporting evidence |
| `fail` | Check ran and found a concrete mismatch | Yes, unless classified as a plan defect | May produce final FAIL |
| `skipped` | Check is not applicable by design | No | No evidence |
| `unavailable` | Applicable, but capability/evidence is unavailable | No | INCONCLUSIVE if required |
| `error` | Verifier/tool failed to produce a judgement | No | INCONCLUSIVE |

Historical records containing only `pass`, `fail`, and `skipped` must remain readable.

### 4.2 Final decisions

| Decision | Required meaning | Studio | Verified/public gates |
|---|---|---:|---:|
| `pass` | Every required claim has sufficient trusted evidence | Yes | Yes |
| `fail` | A candidate or accepted plan requirement was concretely disproved | Normally feedback loop | No |
| `inconclusive` | Neither correctness nor a defect could be established | Yes, prominently unverified | No |

### 4.3 Failure routing

Persist both a failure class and a retry target:

| Failure class | Examples | Retry target | New candidate? |
|---|---|---|---:|
| `candidate_defect` | wrong measurement, output mismatch, physical mismatch | `code_generation` | Yes |
| `plan_defect` | request/plan contradiction, impossible success criteria | `planning` | Eventually, after new plan | No for replan itself |
| `evidence_gap` | insufficient shots or missing required observation | `simulation` | No |
| `capability_limit` | circuit too large, unsupported dynamic circuit | `none` or `verification` | No |
| `verifier_failure` | critic/schema/transport/internal verifier failure | `verification` | No |
| `evidence_conflict` | independent checks disagree | `planning` or `verification` | No until adjudicated |

The final record must also carry `candidate_defect_observed: bool`. For every
`inconclusive` record it must be `false`.

## 5. Trust and authority hierarchy

The semantic reviewer and strict gate must use this order of authority:

1. explicit user request and user-supplied problem data;
2. provider-owned sandbox observations and immutable execution evidence;
3. trusted deterministic verification results;
4. deterministic classical results derived from user-supplied problem data;
5. validated Plan as an interpretation of the request;
6. generated source comments, self-reported metrics, and retrieved exemplars.

The Plan is not ground truth. If the request and Plan disagree, route to `plan_defect`; do not
rewrite otherwise-correct code to satisfy the wrong Plan.

## 6. Mandatory audit protocol

Every numbered implementation step below is a hard stop.

The implementing agent must:

1. work only on the named step;
2. preserve unrelated user changes;
3. run the step's required tests;
4. report actual output, including skipped tests and warnings;
5. stop with the exact heading `STEP N READY FOR AUDIT`;
6. wait for explicit approval before committing or starting the next step;
7. after approval, create one logical commit using an allowed prefix;
8. never push or merge.

Each audit handoff must contain:

```text
STEP N READY FOR AUDIT

Branch:
Base commit:
Changed files:
Behavior changed:
Invariants checked:
Commands actually run:
Results:
Tests not run and why:
Migration/API compatibility notes:
Known risks or open questions:
git diff --check result:
git status --short result:
Suggested commit message:
```

The auditor must reject a step when:

- unrelated work is mixed into the diff;
- a result is claimed without command output;
- an `inconclusive` path can acquire a Verified label;
- a candidate can be published with mismatched fingerprints;
- a verifier failure consumes a candidate revision;
- QASM becomes an execution or correctness authority;
- a repository-layer function omits `Scope` or a process bypasses the repository layer;
- a migration lacks a real downgrade strategy;
- generated contracts were edited by hand;
- UI derives trust from fallback copy, local storage, slug, or source kind.

## 7. Step-by-step implementation

### Step 0 — Freeze the baseline and record the ADR

Goal: make the agreed architecture reviewable before further code changes.

Current workspace warning: as of 2026-07-23, branch
`feature/remove-parent-verification-reference` contains uncommitted changes removing the
`parent_artifact` verification-reference path and bumping contracts to `2.0.0`. Do not reset,
discard, or silently fold those changes into a larger step.

Actions:

- Perform the repository's mandatory fresh-session bootstrap from `AGENTS.md`, including the five
  required status lines. Read the nested `AGENTS.md` for every package touched by the current step.
  If an external authority/memory path is absent, report it; do not invent a replacement file.
- Review the existing uncommitted parent-reference removal as its own logical change.
- Confirm it preserves artifact lineage while removing parent QASM from planner/verifier inputs.
- Add an ADR, proposed path:
  `docs/adr/0022-three-state-verification-and-studio-materialization.md`.
- Record all fixed decisions from sections 1–5, including the removal of Plan-authored QASM.
- Add a compact state diagram and compatibility/rollback strategy.
- Explicitly state that generation exemplars are not verification evidence.
- Do not implement new behavior in the ADR step.

Audit evidence:

- `git diff --check`
- `rg -n "parent_artifact_qasm|reference_source.*parent_artifact" packages services`
- Existing focused tests already reported for the parent-reference removal must be rerun from the
  audited tree.

Acceptance:

- Parent artifacts remain provenance only.
- The baseline diff is isolated and understandable.
- The ADR fixes terminology before contracts or migrations expand.

Suggested commits after separate approvals:

- `refactor: remove parent artifact verification references`
- `docs: define three-state verification architecture`

### Step 1 — Remove Plan-authored QASM and define shared decision taxonomy

Goal: make the contracts express the target semantics before orchestration changes.

Primary files:

- `packages/py/contracts/src/majorana_contracts/plan.py`
- `packages/py/contracts/src/majorana_contracts/enums.py`
- `packages/py/contracts/src/majorana_contracts/events.py`
- `packages/py/contracts/src/majorana_contracts/models.py`
- `packages/py/contracts/src/majorana_contracts/__init__.py`
- `packages/py/contracts/tests/`
- `packages/py/contracts/openapi.json` (generated)
- `packages/ts/contracts-gen/src/schema.d.ts` (generated)

Actions:

- Delete `VerificationPlan.reference_source` and `reference_qasm`.
- Remove `EXACT` from `PlannableVerificationMethod`.
- Keep `VerificationMethod.EXACT` readable for historical events and rows; document it as legacy.
- Add check outcomes `unavailable` and `error` to `VerificationResultKind`.
- Add closed enums for semantic review decision, failure class, and retry target. Recommended values:
  - semantic review: `ready`, `code_repair`, `replan`, `inconclusive`;
  - failure class: the six values in section 4.3;
  - retry target: `code_generation`, `planning`, `simulation`, `verification`, `none`.
- Add typed summary fields needed by run events and artifact resources:
  - `reason_code`;
  - `candidate_defect_observed`;
  - `failure_class`;
  - `retry_target`;
  - `unverified_claims` or equivalent bounded list.
- Keep additions backward-compatible where possible. Treat removal of Plan fields as the already
  declared contracts major version, not as an undocumented patch.
- Regenerate OpenAPI and TS contracts; never edit generated output manually.

Required tests:

```bash
uv run pytest packages/py/contracts
uv run python -m majorana_contracts.export
pnpm --filter @majorana/contracts-gen gen
git diff --check
```

Add tests proving:

- Plan payloads containing either removed QASM field are rejected;
- `exact` cannot be selected by a new Plan;
- historical `VerificationMethod.EXACT` events still parse;
- all new enum values survive JSON/OpenAPI round trips;
- `inconclusive` requires `candidate_defect_observed=false` in final summaries.

Audit focus:

- Contract version is correct.
- No historical enum or event is made unreadable.
- The generated TypeScript diff exactly follows OpenAPI.

### Step 2 — Add the reversible database expansion

Goal: persist plan revisions, semantic reviews, strict attempts, and three-state routing without
destroying existing evidence.

Primary files:

- new linear Alembic migration after current head
- `services/api/src/majorana_api/orm.py`
- migration tests under `services/api/tests/`

Use an expand-first migration. Do not drop the legacy `agent_runs.plan`/`plan_id` columns in this
step.

Add:

1. `run_plans`
   - `id`, `run_id`, `revision`, `parent_plan_id`, `plan`, `plan_fingerprint`,
     `replan_reason`, `created_at`;
   - unique `(run_id, revision)` and `(run_id, id)`;
   - same-run parent FK;
   - backfill existing `agent_runs.plan` rows as revision 1.
2. `candidate_semantic_reviews`
   - immutable append-only attempts bound to candidate, execution, and source fingerprint;
   - `attempt_seq`, decision, confidence, severity, reason/failure routing, structured feedback;
   - unique `(candidate_id, attempt_seq)`.
3. `candidate_verification_attempts`
   - immutable strict-gate attempts;
   - check list, final decision, evidence strength, claim coverage, failure routing, verifier version;
   - unique `(candidate_id, attempt_seq)`.
4. `agent_runs.current_plan_id` as a nullable expansion column, backfilled from revision 1.
5. New agent-state CHECK values required by Step 5, while retaining all legacy values.
6. Widen `verification_records` check-result allowlist for `unavailable` and `error` if those rows
   are emitted there.

Do not:

- overwrite old candidate verification rows;
- delete exact/QASM historical records;
- put tenant data in `repos/system.py`;
- make migrations seed product data;
- add a second database access path.

Required tests:

```bash
uv run pytest services/api/tests/test_agent_migration.py \
  packages/py/contracts/tests/test_method_allowlist.py
```

Run against a disposable local Postgres:

```text
upgrade previous_head -> new_head
downgrade new_head -> previous_head
upgrade previous_head -> new_head
```

Audit handoff must include row counts and constraint names before and after each direction. A real
Neon gate is ask-first and must not be run without owner authorization.

Acceptance:

- Existing runs backfill to plan revision 1.
- Existing verification evidence remains byte-for-byte readable.
- Downgrade is defined and tested; it must fail closed rather than silently discard incompatible
  post-upgrade data.

### Step 3 — Implement scoped repositories and immutable domain records

Goal: expose the new persistence model without changing runtime behavior yet.

Primary files:

- `services/api/src/majorana_api/repos/agent.py`
- `packages/py/agent/src/majorana_agent/models.py`
- `packages/py/agent/src/majorana_agent/store.py`
- `services/worker/src/majorana_worker/agent_store.py`
- corresponding API/agent/worker tests

Actions:

- Add immutable `PlanRevision`, `SemanticReviewEvidence`, and `StrictVerificationAttempt` models.
- Add scoped repository methods for append and latest-by-sequence reads.
- Every repository method takes `Scope` first and proves run/workspace ownership internally.
- Enforce candidate/execution/source fingerprint equality in both domain validation and repository
  writes.
- Reject duplicate sequence numbers and cross-run parent-plan references.
- Make current-plan selection explicit; never infer the latest plan from timestamps.
- Preserve legacy read compatibility while the runtime still uses old fields.
- Add tests for cross-workspace denial, stale candidate rejection, mismatched fingerprints,
  idempotent reads, and immutable append behavior.

Required tests:

```bash
uv run pytest services/api/tests/test_repo_scoping.py \
  services/api/tests/test_agent_migration.py \
  packages/py/agent/tests services/worker/tests/test_agent_ports.py
uv run ruff check services/api packages/py/agent services/worker
```

Audit focus:

- No raw SQL outside the repository layer.
- No update method exists for immutable evidence payloads.
- Latest-attempt reads order by explicit sequence, not creation time.

### Step 4 — Split fast checks, semantic review, and strict verification

Goal: remove the current responsibility conflation in `EvidenceVerifier` without yet changing the
agent state machine.

Primary files:

- `services/worker/src/majorana_worker/agent_ports.py`
- `packages/py/verification/src/majorana_verification/`
- `packages/py/verification/tests/`
- `services/worker/tests/test_agent_ports.py`

Create three explicit ports/components:

1. `FastCandidateChecker`
   - structural/framework contract;
   - source binding preconditions;
   - result/return contract;
   - resource contract;
   - measurement policy;
   - forbidden operation evidence;
   - no LLM call.
2. `SemanticCandidateReviewer`
   - current LLM critic role and inputs;
   - no tool access and no simulation dispatch;
   - output is review routing, not final publication PASS.
3. `StrictEvidenceVerifier`
   - trusted physical/problem-specific checks;
   - final three-state aggregation;
   - no source mutation and no LLM override of deterministic failures.

Classification rules:

- recognized deterministic disagreement -> `fail` with typed defect/route;
- unsupported/capability limitation -> `unavailable` -> final `inconclusive` when required;
- verifier exception/transport/tool failure -> `error` -> final `inconclusive`;
- not-applicable-by-design -> `skipped`;
- low-confidence semantic result -> semantic `inconclusive`, never repair by itself;
- malformed critic output after bounded retry -> `verifier_failure`, not candidate defect.

Remove all Plan-QASM exact paths from the live verifier. Preserve standalone legacy exact helpers
only if tests or historical tools still require them; mark them non-plannable and ensure the worker
cannot call them from a new Plan.

Required tests:

```bash
uv run pytest packages/py/verification services/worker/tests/test_agent_ports.py
uv run ruff check packages/py/verification services/worker
```

Required test matrix:

- deterministic candidate mismatch -> FAIL;
- unsupported dynamic-circuit check -> INCONCLUSIVE;
- critic timeout/malformed JSON -> INCONCLUSIVE without repair instruction blaming code;
- low-confidence critic -> INCONCLUSIVE;
- semantic request/plan mismatch -> REPLAN;
- clear plan/code mismatch -> CODE_REPAIR;
- LLM is never invoked when a fast confirmed defect already blocks the candidate;
- no verifier path reads parent artifact QASM or Plan reference QASM.

### Step 5 — Add strict evidence sufficiency and property checks

Goal: avoid replacing deleted reference-QASM checks with a semantic-only PASS.

Primary files:

- `packages/py/verification/`
- `packages/py/contracts/src/majorana_contracts/enums.py`
- verifier tests and method allowlist migration if new persisted methods are added

Initial trusted policy:

- retain framework-native statistical comparison;
- retain fixed-policy reproducibility runs;
- retain exact diagonalization for bounded, declarative Hamiltonian data;
- retain brute force for bounded MaxCut/QUBO data;
- add fixed, non-LLM property verifiers for at least Bell and GHZ state preparation;
- do not claim QFT, teleportation, Grover, or arbitrary-circuit physical verification until a
  dedicated property test exists.

Bell/GHZ property checks must cover phase as well as computational-basis counts. Prefer trusted
statevector/stabilizer expectations when available. Counts containing only `00/11` or
`000/111` are insufficient to prove the relative phase.

Define a strict evidence policy:

- `pass` with Verified labeling requires at least one applicable physical/problem-specific check
  to run and pass for every required physical claim;
- structural-only success becomes final `inconclusive` for circuit-correctness claims;
- checks that merely compare a program with itself must state their limited claim scope;
- Plan-declared Hamiltonian/problem data must retain provenance and cannot prove that the Plan
  interpreted the user correctly; semantic review owns that boundary.

Required tests include seeded mistakes:

- Bell/GHZ wrong relative phase;
- wrong qubit order;
- fabricated counts;
- consistently wrong but reproducible program;
- incorrect MaxCut objective with plausible counts;
- incorrect VQE energy with valid return shape;
- unsupported large/dynamic circuit -> INCONCLUSIVE, not FAIL.

Commands:

```bash
uv run pytest packages/py/verification evals/harness/tests
uv run ruff check packages/py/verification evals/harness
```

Audit focus:

- Every new method declares exactly what it proves.
- Evidence strength is derived from checks, never accepted from an LLM.
- Statistical tolerances are policy-owned and cannot be loosened by Plan output.

### Step 6 — Implement plan revision and replan routing

Goal: make `plan_defect -> planning` real rather than converting it into repeated code repair.

Primary files:

- `packages/py/agent/src/majorana_agent/{models,broker,model,tools,runtime,store}.py`
- `services/worker/src/majorana_worker/{agent_ports,agent_store}.py`
- agent and worker tests

Actions:

- Store Plan revision 1 through `run_plans`.
- Add an explicit replan tool/state available only after typed `plan_defect` feedback.
- A replan creates a new immutable Plan revision with `parent_plan_id` and reason.
- New candidates bind to the current Plan revision.
- Existing candidates and evidence retain their original Plan binding.
- Enforce a separate `max_plan_revisions` budget.
- Plan schema/provider failures consume plan-attempt budget, not candidate budget.
- Reject a model attempt to replan without plan-defect evidence.
- Do not let replanning change the user-selected framework, requested seed, or requested shots
  except through existing explicit clamp policy.

Required tests:

- code defect cannot trigger replan;
- plan defect creates revision 2 and candidate 2 binds to it;
- old candidate still resolves revision 1;
- replan budget exhaustion ends honestly;
- crash replay does not duplicate Plan revisions;
- same-run and workspace scoping remains enforced.

### Step 7 — Implement the audited candidate state machine

Goal: enforce the target order mechanically rather than through prompts.

Recommended live states:

```text
new
planned
executed
reviewed
repair_required
replan_required
ready_for_strict_verification
verified
inconclusive
qasm_attempted
materialized
resource_exhausted
failed
cancelled
```

Recommended tools:

```text
request_plan
replan
simulate_<framework>
review_candidate
strict_verify
convert_to_openqasm
materialize_artifact
```

Actions:

- Replace `verify_intent_alignment` with explicit semantic review and strict-verify transitions.
- Broker, not prompt, enforces tool order and latest-candidate use.
- Semantic `ready` and semantic `inconclusive` may proceed to strict verification; semantic
  uncertainty prevents final PASS but still permits deterministic evidence to detect a real FAIL.
- Strict PASS -> `verified`.
- Strict INCONCLUSIVE -> `inconclusive`.
- Strict FAIL routes according to typed failure class.
- A verifier retry never creates a candidate.
- A code repair always creates a candidate and requires a fresh base simulation.
- Separate budgets for steps, plan revisions, candidates, sandbox runs, semantic-review retries,
  strict attempts, and conversions.
- Preserve idempotency and crash recovery for every new tool.

Required tests:

- exhaustive allowed/disallowed transition table;
- no strict verification before execution and semantic review;
- no materialization before a strict terminal verdict;
- no conversion with stale fingerprint;
- same candidate survives verifier retry;
- changed source invalidates all prior evidence;
- malformed model tool calls remain bounded;
- restart at each persistence boundary resumes without duplicate work.

Commands:

```bash
uv run pytest packages/py/agent services/worker/tests/test_agent_ports.py \
  services/worker/tests/test_queue_recovery.py
```

### Step 8 — Persist events and terminal run semantics

Goal: make all decisions and reasons replayable by API/UI consumers.

Primary files:

- `services/worker/src/majorana_worker/agent_events.py`
- `services/worker/src/majorana_worker/handlers.py`
- `services/worker/src/majorana_worker/best_effort.py`
- run event contracts/tests

Actions:

- Emit semantic-review and strict-verification events with IDs, attempt sequence, reason code,
  failure class, retry target, and candidate fingerprint.
- Emit every check, including `skipped`, `unavailable`, and `error`.
- Do not silently drop unknown check methods; contract/DB allowlists must fail tests on drift.
- A materialized INCONCLUSIVE result completes the workflow with top-level
  `RunStatus.SUCCEEDED` and `verifier_decision=inconclusive`. `RunStatus` describes workflow
  completion, not correctness. The UI must never infer verification from `RunStatus`.
- Keep resource exhaustion distinct from a candidate defect.
- Keep `run.best_effort` for true failed/budget-exhausted runs; do not reuse it for a successfully
  materialized INCONCLUSIVE artifact.
- Ensure terminal row and terminal event remain fenced/idempotent.

Audit focus:

- Event replay alone can explain why a candidate was repaired, replanned, passed, or declared
  inconclusive.
- No terminal event says `failed` without a machine-readable reason.

### Step 9 — Separate Studio materialization from Verified publication

Goal: allow INCONCLUSIVE artifacts into the private Studio without weakening trust gates.

Primary files:

- `packages/py/agent/src/majorana_agent/tools.py`
- `services/worker/src/majorana_worker/agent_ports.py`
- `services/api/src/majorana_api/repos/artifacts.py`
- catalog/publication repositories and tests

Actions:

- Replace the current PASS-only artifact-save policy with a private materialization operation that
  accepts strict `pass` or `inconclusive`.
- Persist the exact final decision, evidence strength, reason code, failed/unavailable checks,
  semantic summary, residual risks, source fingerprint, execution ID, and verification attempt ID
  in version metadata or typed columns approved by the contract design.
- For INCONCLUSIVE artifacts, persist `verified=false` semantics explicitly; never derive this from
  missing metadata.
- Keep public catalog staging/publication, Verified badges, verified templates, and any future QPU
  execution gate restricted to PASS. Decide separately whether physical evidence is mandatory for
  public publication; default to yes.
- Preserve immutable version creation and workspace scoping.
- Editing source in Studio must create a stale/unverified draft until a new run succeeds.

Required tests:

- PASS materializes as Verified.
- INCONCLUSIVE materializes privately with unverified metadata.
- FAIL cannot materialize through this path.
- INCONCLUSIVE cannot enter catalog staging/publication.
- Fingerprint mismatch blocks both decisions.
- Imported public references remain imports, not fresh verification evidence.

### Step 10 — Keep conversion optional and verdict-neutral

Goal: support Studio/export for PASS and INCONCLUSIVE without making QASM authoritative.

Actions:

- Allow conversion attempts after either terminal strict decision.
- Bind conversion evidence to the candidate fingerprint and execution.
- Conversion success/failure must not change `pass`, `fail`, or `inconclusive`.
- Exported INCONCLUSIVE artifacts must carry a manifest/metadata warning when the target format
  cannot embed verification state.
- Do not simulate exported QASM as a substitute for framework-native verification.
- Retain normalization/parse checks strictly as conversion evidence.

Required tests:

- PASS + unavailable QASM remains PASS.
- INCONCLUSIVE + available QASM remains INCONCLUSIVE.
- Conversion from stale/mismatched evidence is rejected.
- No QASM is fabricated from LLM output.

### Step 11 — Expose typed API and regenerate clients

Goal: make Studio and run surfaces consume authoritative status without inference.

Primary files:

- `packages/py/contracts`
- `services/api/src/majorana_api/routes/{runs,artifacts}.py`
- corresponding repositories/tests
- generated OpenAPI and TS contracts

Actions:

- Return verifier decision, evidence strength, reason code, unverified claims, and bounded check
  summaries on artifact list/detail and run resources.
- Preserve `None` as absence for legacy artifacts; do not convert absence to PASS.
- Add compatibility tests for legacy versions lacking the new summary.
- Regenerate both contract layers.

Commands:

```bash
uv run pytest packages/py/contracts services/api/tests/test_artifact_routes.py \
  services/api/tests/test_run_terminal.py
uv run python -m majorana_contracts.export
pnpm --filter @majorana/contracts-gen gen
pnpm --filter @majorana/contracts-gen test
```

Audit focus:

- API is the source of trust state.
- The browser does not need to inspect arbitrary metadata to determine the verdict.

### Step 12 — Studio and Run UI integration (owner-assigned UI lane only)

This step is blocked until Eshaan/the owner explicitly assigns the UI lane. A non-UI Codex agent
must stop and hand off rather than implementing it.

Primary files after authorization:

- `apps/web/lib/library-data.ts`
- `apps/web/lib/verification-record.ts`
- `apps/web/app/(app)/studio/studio-workspace.tsx`
- run and library detail surfaces, fixtures, copy, and tests

Actions:

- Replace local `LibraryStatus` inference with typed API verdicts.
- Remove every fallback that turns missing server evidence into `verified`.
- Show persistent, non-dismissed state for INCONCLUSIVE:

  ```text
  Verification unavailable — correctness has not been confirmed.
  ```

- Display reason, passed checks, unavailable/error checks, unverified claims, evidence strength,
  and recommended next action.
- Make Verified visually and textually distinct from Structural/Unverified/Legacy unknown.
- On edit, immediately show `verification stale` and remove Verified presentation.
- Include verdict metadata in downloads/exports.
- Ensure screen-reader text communicates the verdict without relying on color or glyph.
- Add loading, empty, legacy, error, PASS, FAIL, INCONCLUSIVE, and stale-edit fixtures.

Required tests:

```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm turbo run lint typecheck test
```

Required visual QA after authorization:

- PASS artifact in Studio;
- INCONCLUSIVE artifact with persistent warning;
- legacy artifact with unknown evidence;
- edited formerly-PASS artifact shown stale;
- narrow/mobile layout without hidden warning or horizontal overflow.

### Step 13 — Evals and seeded regression corpus

Goal: prove routing honesty, not merely increase pass rate.

Primary files:

- `evals/corpus/`
- `evals/seeded-mistakes/`
- `evals/harness/`
- worker/API integration tests

Add cases for:

1. correct Bell/GHZ -> PASS with physical evidence;
2. wrong relative phase -> FAIL;
3. fabricated result counts -> FAIL;
4. clear request/Plan mismatch -> REPLAN;
5. critic malformed twice -> INCONCLUSIVE, same candidate retained;
6. dynamic circuit unsupported by required strict check -> INCONCLUSIVE;
7. structural-only circuit claim -> INCONCLUSIVE;
8. resource exhaustion -> INCONCLUSIVE without code repair;
9. correct MaxCut/QUBO small instance -> PASS via brute force;
10. incorrect objective -> FAIL;
11. correct/incorrect VQE energy -> exact-diag PASS/FAIL;
12. QASM conversion failure -> unchanged verdict;
13. INCONCLUSIVE private materialization -> succeeds but never publishes publicly;
14. source mutation after verification -> stale/mismatch rejection;
15. historical event/artifact replay -> remains readable and never defaults to Verified.

Scoring must distinguish:

- decision accuracy;
- failure-class accuracy;
- retry-target accuracy;
- candidate revisions consumed;
- false-negative rate;
- false-positive rate;
- INCONCLUSIVE calibration;
- evidence-strength honesty;
- artifact materialization/publication behavior.

Live-provider evals require explicit owner approval and credentials. Unit/integration tests must not
invent live results.

### Step 14 — Full verification, migration gate, and rollout review

Goal: produce the final auditable release candidate; do not deploy it.

Required local checks:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
pnpm turbo run lint typecheck test
git diff --check
```

Required database proof on a disposable database:

```text
upgrade old head -> new head
exercise legacy and new records
downgrade new head -> old head
upgrade old head -> new head
```

Required security assertions:

- every sandbox creation explicitly denies all egress;
- no new secret reaches sandbox spec, events, DB JSON, or client DTOs;
- API/Worker remain the only DB-connected processes;
- every repository mutation is scoped;
- no INCONCLUSIVE/unknown artifact can enter public or Verified paths;
- source/execution/review/verification/artifact fingerprints remain equal;
- generated code cannot influence verifier policy, thresholds, or evidence classification.

Required rollout review:

- backfill behavior for legacy artifacts;
- feature flag for INCONCLUSIVE materialization/UI;
- metrics for PASS/FAIL/INCONCLUSIVE and route reasons;
- alert on verifier `error` rate and fingerprint mismatches;
- rollback behavior when new rows exist;
- no protected-branch push, merge, deployment, public action, or paid run without owner approval.

## 8. Cross-step test matrix

The auditor should maintain this matrix and require all applicable cells before completion.

| Scenario | Semantic review | Strict result | Candidate action | Studio | Public |
|---|---|---|---|---|---|
| Correct, strong evidence | ready | PASS | keep | Verified | eligible |
| Clear code defect | code repair | FAIL | new revision | no | no |
| Clear Plan defect | replan | not yet final | new Plan | no | no |
| Critic low confidence | inconclusive | INCONCLUSIVE unless resolved | same revision | Unverified | no |
| Critic transport/schema failure | inconclusive | INCONCLUSIVE | same revision | Unverified | no |
| Required check unsupported | no blame | INCONCLUSIVE | same revision | Unverified | no |
| Physical check disagrees | repair route | FAIL | new revision | no | no |
| Structural-only evidence | ready/uncertain | INCONCLUSIVE | same revision | Unverified | no |
| Conversion unavailable | unchanged | unchanged | same revision | yes | based on verdict only |
| Source changed after verdict | stale | blocked | new revision required | stale | no |

## 9. Definition of done

Verification v2 is complete only when all statements are true:

- No new Plan or prompt contains reference/canonical QASM.
- No verifier reads a parent artifact as correctness evidence.
- A new candidate cannot bypass sandbox execution.
- The LLM reviewer cannot execute simulations or override deterministic evidence.
- Fast checks, semantic review, and strict verification are separately persisted and replayable.
- Plan defects can produce a real Plan revision without mutating history.
- Verifier/evidence failures do not consume candidate revisions.
- PASS, FAIL, and INCONCLUSIVE have tested, non-overlapping semantics.
- Required physical claims cannot earn Verified from structural evidence alone.
- INCONCLUSIVE artifacts reach private Studio with an unavoidable unverified label.
- INCONCLUSIVE, unknown, stale, and failed artifacts cannot enter Verified/public gates.
- Editing a verified source invalidates the displayed verification immediately.
- QASM remains optional, derived interchange and cannot affect the source verdict.
- All migrations pass up/down/up testing.
- OpenAPI and generated TS contracts are fresh.
- Python and TypeScript full suites pass, with skipped/live tests reported honestly.
- The final diff has been reviewed step-by-step under the audit protocol above.

## 10. Explicit non-goals

- Proving arbitrary large quantum programs correct.
- Using an LLM-authored simulator or arbitrary verifier code as ground truth.
- Automatically searching the catalog for a similar circuit and using it as a reference.
- Treating reproducibility alone as physical correctness.
- Treating OpenQASM export success as verification success.
- Publishing INCONCLUSIVE artifacts to the public/Verified catalog path. Private Studio
  materialization is an explicit goal.
- Adding QPU execution as part of this implementation.
- Restyling Studio beyond the minimum authorized trust-state presentation.

## 11. Final handoff format

After Step 14 passes and every prior audit is approved, the implementing agent must provide:

```text
VERIFICATION V2 READY FOR OWNER REVIEW

Commits by step:
Contract version:
Migration range:
State-machine diagram:
Final decision matrix:
Security invariants:
Python test result:
TypeScript test result:
Migration up/down/up result:
Live tests not run:
Known residual risks:
Owner/CODEOWNER reviews required:
Suggested PR title:
```

No claim of completion is valid if any required command was not run or any audit gate was skipped.

## 12. Starter prompt for the implementing agent

Use this prompt to begin a fresh implementation session:

```text
Implement Verification v2 using
docs/verification/verification-v2-implementation-plan.md as the execution authority.

First perform the mandatory AGENTS.md bootstrap. Then execute Step 0 only. Preserve all existing
workspace changes, do not push or merge, do not start Step 1, and stop with the exact audit handoff
heading `STEP 0 READY FOR AUDIT`. Report only commands that actually ran and results that actually
occurred.
```
