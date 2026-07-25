# ADR-0023: Fixed nameko-style circuit pipeline

**Date:** 2026-07-24 · **Status:** implemented locally (CODEOWNER review required)

**Context:** ADR-0014 replaced a fixed executor with a durable model-directed tool
loop. Its evidence binding and sandbox boundaries are useful, but giving the model a
choice among planning, simulation, review, strict verification, conversion, and
materialization created a large transition graph and many non-product failure modes.
Production failures have included rejected or replayed tool calls, exhausted plan and
candidate budgets, incompatible planner-authored verification policies, and a usable
executed candidate never reaching materialization. namekoQ's successful product shape
is much smaller: plan, generate and simulate, review intent alignment, optionally
export, then return the artifact. namekoQ itself is not a production reference for
sandbox isolation, durable evidence, or server-enforced ordering: it parses model
stdout, relies mainly on prompt-enforced tool order, lets the model resubmit review
inputs, and runs generated code in an ordinary subprocess service. We want its simple
user-visible workflow without copying those trust failures. Search, multi-agent debate,
and strict quantum-correctness certification are out of scope.

**Decision:** Supersede ADR-0014 for newly created execute runs with one deterministic
worker-owned pipeline:

```text
plan -> generate -> sandbox execute -> basic contract checks -> intent review
                                      ^                         |
                                      +---- bounded repair -----+
                                                                |
                                        best-effort OpenQASM -> artifact save
```

The LLM has exactly three roles: emit a structured plan, emit selected-framework
Python, and review the user's request against the stored plan, exact candidate source,
and trusted execution evidence. It never chooses the next stage, tool name,
candidate/plan ID, evidence payload, conversion input, or save operation. The worker
owns the fixed order and automatically attempts export and save after an aligned
review. Each source change remains an immutable Candidate revision.

The first implementation reuses the existing durable Plan, Candidate, execution,
semantic-review, conversion, and materialization records to avoid a migration. New
plans set `verification_plan` to `None`; the new path does not call
`StrictEvidenceVerifier`, evidence sufficiency, exact diagonalization, brute force,
fixed Bell/GHZ property checks, or statistical certification. The Plan contract may be
simplified additively in a later contract-reviewed slice after replay compatibility is
proven. Historical strict-verification records and events remain readable.

The product checks retained before review are operational contracts, not quantum
certification:

- generated source is non-empty, valid Python, and uses only the selected framework;
- the existing guard and resource preflight accept it;
- execution returns the protected, JSON-compatible `RESULT`;
- required output keys exist;
- a protected `FINAL_CIRCUIT` observation exists when the plan requires a circuit;
- candidate, execution, review, conversion, and artifact fingerprints agree.

Untrusted source still runs only through `majorana_sandbox.run`. Production sandbox
creation continues to set deny-all egress and an empty credential environment.
Captured stdout/stderr are diagnostics only; they are never parsed as result evidence.
OpenQASM is derived only from the protected observation of the exact executed
`FINAL_CIRCUIT`; no LLM reconstruction or re-execution is allowed. Export is
best-effort and cannot gate saving the framework-native Python artifact.

The orchestration budget is deliberately small: at most two plan emissions, four
Candidate revisions, one replan, two intent-review attempts per candidate, provider
retry capped by the LLM client, and the existing run-wide timeout. Execution failures
and a high-confidence blocking intent mismatch may create a repaired Candidate.
Plan defects may consume the single replan. Low-confidence review, malformed review
output, or review-provider failure never certifies alignment and never invents a
quantum verdict; after its bounded retry it returns a typed terminal failure with the
best executed candidate when one exists.

Expected failures are data, not uncaught control flow. The fixed pipeline classifies
failures as provider, model output, plan, generation, code, resource, review, export,
persistence, timeout, or cancellation; records whether retry is safe; and has one
terminalization path. Integrity violations (fingerprint/store binding, sandbox policy,
tenant scope, database consistency, or credentials inside the sandbox) remain
fail-closed exceptions and are terminalized by the worker boundary without exposing
raw exception text. Every accepted run must end in exactly one of `succeeded`,
`failed`, or `cancelled`; restart/replay must not duplicate Candidates, artifacts, or
terminal events.

User-facing terminology is `executed`, `AI reviewed`, `aligned`, `needs attention`,
and `export available`. The new path must not emit or display `verified` merely because
the code executed or the reviewer aligned it. It makes no quantum-correctness,
optimality, or hardware claim.

The Worker has one execute engine. `MAJORANA_CIRCUIT_PIPELINE` and the legacy rollback
path were removed after local failure and replay checks passed. Historical records
remain readable through the API, but an unfinished run with legacy steps, Plan, or
Candidates is terminalized as `legacy_run_requires_restart` before any provider or
sandbox work. This prevents mixed-engine evidence while keeping stored history intact.

Implementation proceeds as audited slices:

1. **Baseline and harness.** Record the existing targeted tests and fix eval scoring to
   use protected `RESULT`/observation evidence instead of parsing stdout. Audit:
   adversarial stdout cannot affect a score and existing event replay still parses.
2. **Fixed pipeline core.** Add an internal coordinator, stage outcome/failure types,
   budgets, and isolated unit tests using fake ports. Audit: every branch terminates,
   retry counters are monotonic, cancellation is checked between stages, and no LLM
   value selects control flow beyond the typed plan/review decision.
3. **Production ports.** Wire the coordinator to the metered LLM, sandbox executor,
   repository store/event sink, converter, and materializer. Audit: `Scope` remains
   first at repository calls, all evidence is store-loaded and fingerprint-bound, and
   legacy progress is rejected before work begins.
4. **Save without strict verification.** Add an execution-plus-review materialization
   authority for the simple path while retaining historical strict readers. This is a
   contracts/persistence blast-radius slice and requires CODEOWNER review. Audit:
   export failure does not block save, no artifact is marked Verified/public, and
   old records replay unchanged.
5. **Single path and cleanup.** Run the failure matrix and targeted regression suite,
   remove legacy tool-loop wiring, strict Worker adapters, and engine flags. Keep only
   historical database/API readers required for old records.

Each slice stops on failed tests or an unresolved audit finding. Live-provider evals,
real Vercel sandbox acceptance, pushes, merges, credentials, spending, deployment, and
public publication remain owner-gated and are not authorized by this ADR.

**Consequences:** The user-visible architecture matches namekoQ's short happy path
while the backend retains Majorana's production boundaries: server-enforced order,
durable evidence, deny-all sandbox execution, metering, cancellation, idempotency, and
terminal consistency. This removes model/tool-policy drift and strict-verifier repair
loops from new runs, reduces latency and provider calls, and makes failure behavior
testable as a finite state space. It gives up any claim that the default run has
deterministically proved quantum correctness; AI review is explicitly advisory.
Historical database types remain readable, but the Worker no longer contains a second
execution engine. No stored record is deleted or rewritten.

---

## Amendment 1 (2026-07-25): Plan-declared reference checks, and one actionable review

Two changes to the review stage described above. Neither alters the sandbox
boundary, the durable evidence chain, the fixed stage order, or the product's
refusal to claim `verified`.

**A Plan may again declare an independent reference.** The original decision set
`verification_plan` to `None` for every new Plan. That left
`success_criteria.expected_range` as the only numeric check, and a range the planner
guessed cannot contradict a result the generator produced when both come from the
same model and the same misconception: live H2 VQE run 019f9763 reported -1.419 Ha
against a range derived from its own fabricated Hamiltonian and passed every
structural check. The planner may now declare `exact_diag` with a
`reference_hamiltonian`, or `brute_force` with a `reference_problem` — the operator
or instance the *request* names, written as data. The worker runs the declared check
against the protected `RESULT` and the declared reference only; it never reads the
candidate source, so no program can satisfy it by agreeing with itself. Nothing else
from the strict verifier returns: no evidence-sufficiency policy, no statistical
certification, no fixed Bell/GHZ property checks. A Plan that declares no reference
is graded exactly as it was before, and a declared method whose reference is missing
is dropped rather than failed, because no stage can repair a reference.

A passing reference check records `evidence_strength: physical` and appears in
`checks`, while `VerifierDecision` stays `INCONCLUSIVE`. That is the split
`EvidenceStrength` exists to express: one limited claim really was compared against
what the physics should do, and the run still certifies nothing. The user-facing
terminology is unchanged.

**Every review now names a next step.** `SemanticReviewDecision.INCONCLUSIVE` is no
longer reachable for new runs; stored reviews and the database allowlist keep it so
tool-loop-era records still decode. It named no next step, and the controller's Plan
escalation keys on *consecutive* `CODE_REPAIR` decisions, so a run that kept landing
there regenerated identical evidence until the candidate budget ran out without ever
spending its replan budget. Measured on the fixed pipeline with a reviewer that never
accepts: 8 review calls, `plan_attempts=1`, terminal `intent_review_inconclusive`.
After: 4 review calls, `plan_attempts=2`, terminal `candidate_budget_exhausted`.

The reviewer now chooses among `READY`, `CODE_REPAIR`, and `REPLAN`, and its schema
no longer offers anything else. A blocked review falls back to repairing the
candidate, which is bounded by the same budget, feeds the reviewer's own findings to
the generator, and escalates to a replan after two consecutive repairs. Acceptance
still requires an unhedged review and every deterministic check passing; a failed
check outranks a claimed acceptance. A reviewer's honest note about an imperfection
it is not asking anyone to fix belongs in `residual_risks` and no longer overturns
its own acceptance — that penalty made a careful reviewer more likely to send a good
candidate back around the loop.

`max_review_attempts_per_candidate` now bounds malformed-review retries only.
The run-wide timeout, the sandbox timeout, and every other budget are unchanged.

**Known limit of `exact_diag`.** The check allows for shot noise derived from the
Plan's own `parameters.shots`, so a low-shot plan cannot distinguish a wrong energy
from a noisy one: the 0.28 Ha error that motivated this amendment passes at 100 shots
and fails at 4096. That is honest physics, not a defect — 100 samples genuinely have
not measured the difference — but it means the check bites only when the Plan either
budgets enough shots or declares a tighter `tolerance`, which the planner directive
now says explicitly. A declared tolerance may only tighten the computed bound.

## Amendment 2 (2026-07-25): an advisory review may not veto sound evidence

The original decision made a `READY` intent review a precondition for producing
anything: `SimplePipelineOutcome` requires an artifact to be `succeeded`, and the only
path to save ran through `_next_action`'s ACCEPT, which required `READY`. So the one
signal this ADR explicitly calls advisory was in practice the strongest gate in the
pipeline — a run whose candidate executed in the sandbox, satisfied the basic result
contract, and matched its Plan-declared reference was still destroyed, and reported as
"No accepted result was produced", when the reviewer merely kept asking for
improvements until the budget ran out.

When the budget is exhausted and no review ever said `READY`, the pipeline now
delivers the best candidate whose TRUSTED evidence was complete: it reached review (so
it executed and satisfied the basic contract), every deterministic check recorded
against it passed — including any declared reference check — and the reviewer found no
`major` or `blocking` defect. The reviewer's `decision` is deliberately not consulted
for this, because a reviewer that keeps requesting improvements is expressing a
preference, not contradicting the evidence. A blocking or major severity, or any
failed deterministic check, still disqualifies the candidate and the run still fails.

Nothing claims the review accepted it. The stored review keeps its real decision, the
artifact records `review_status: not_accepted`, the verification summary reports
`reason_code: trusted_evidence_without_review_acceptance` and adds `intent alignment`
to `unverified_claims`, and the artifact's limitations state that alignment was not
established. `VerifierDecision` remains `INCONCLUSIVE` as before.

This is the namekoQ behaviour the fixed pipeline had lost, grounded differently.
namekoQ self-drives largely because it cannot fail: its loop ends on a step count,
its critic's `aligned: false` at minor severity stops nothing, and whatever the model
last said is the deliverable. Majorana keeps a real gate — but the gate is now the
non-forgeable evidence, not the model's opinion about it.

## Amendment 3 (2026-07-25): repair history, repair-time sampling, wider budget

Three changes aimed at the repair loop's success rate, after a comparison against
namekoQ's accuracy on the same tasks.

**The generation port only ever saw the immediately preceding candidate.** It receives
`previous_source` and the latest `repair_feedback`, so a defect corrected away two
revisions earlier could be reintroduced, and at temperature 0 reliably was. namekoQ
gets this for free: its agent is a single conversation, so every earlier attempt,
traceback, and critic verdict is still in the message history when it writes attempt
four. The pipeline now accumulates a compact record of every rejected revision — the
reason, the concrete mismatches, and the fix that was already prescribed and did not
work — and sends it as `repair_feedback.details.prior_attempts`. Sources are
deliberately excluded: the previous source is already sent in full, and what older
attempts contribute is the defect, not another copy of the program.

That history now also survives a replan. Clearing the plan's critique when the plan is
replaced is correct; clearing the code defects it collected was not, and it let the
first candidate under a revised plan re-make the exact defects that forced the replan.

**A repair samples; the first generation does not.** Generation ran at temperature 0
for every attempt, so a repair whose prompt changed only slightly reproduced nearly the
same program and a run could spend its whole budget re-deriving one defect. The first
generation stays deterministic; a repair uses 0.4. Replay determinism is unaffected —
each candidate is a stored immutable revision and the durable LLM-call inbox replays
the recorded response rather than re-sampling.

**Budgets rise to 3 plans and 8 candidate revisions** (from 2 and 4), which is parity
with namekoQ's research mode converted from its units to ours. namekoQ bounds one agent
loop by model turns (`BUILD_MAX_STEPS` 28; standard mode 12) while this pipeline bounds
candidate revisions. Its research happy path spends 6 turns — plan, simulate, debate,
verify, convert, answer — and each repair cycle costs 3 more, so 28 turns buys about 8
candidates and 12 turns about 4.

Time, not budget, is the real ceiling: one candidate costs two provider calls plus a
sandbox run against the API's 600 s `timeout_s` cap. The worker wraps the run in
`asyncio.timeout`, which cancels mid-stage and delivers nothing at all — strictly worse
than budget exhaustion, which delivers the best-effort candidate under Amendment 2. The
pipeline therefore receives the actual time remaining and consults it between
candidates. It reserves only the export/save tail, estimated from recent stage latency
with conservative defaults, plus a small useful-work window. Candidate stages receive a
soft deadline at that reserve: if a provider or sandbox call runs too long it is
cancelled as typed `stage_time_budget_exhausted`, and the soundest candidate is finalized.
This avoids demanding that an entire predicted candidate fit before starting — a single
slow outlier no longer strands unused revision budget. There is no fixed percentage
reservation: fast providers can spend the candidate-revision budget like namekoQ, while
slow providers stop early enough to preserve trusted work. The hard deadline starts
before mode resolution, so time spent deciding chat versus execution is not accidentally
granted a second budget.

The export-and-save tail was extracted into `_finalize` so every exhaustion path can
reach it. Previously the generation-budget guard terminalized on its own, so
Amendment 2's best-effort delivery fired only when the budget ran out *during review*;
an execution failure that consumed the last revision still discarded a sound earlier
candidate.

## Amendment 4 (2026-07-25): the durable stores enforced a retired policy

Amendment 2 never took effect in production. Both `RepoAgentStore` and the in-memory
double gate `add_conversion` and `add_materialization` on the candidate's semantic
review, and that guard demanded `decision == "ready"`. So when the orchestrator decided
to deliver a candidate whose trusted evidence was complete but whose review had asked
for another repair, the store raised, and the run died at the *export* stage with the
artifact discarded — one stage later than before, and with a less recognizable reason.
A run that used to stop at review now stopped just after it.

The guard was encoding a policy, not an invariant. `SemanticReviewEvidence` now owns
one definition — `evidence_is_complete()`, and `is_deliverable()` on top of it — used
by the pipeline's fallback and by both stores. The stores stay fail-closed on what they
are actually for: a review that recorded a failed deterministic check, or a `major` or
`blocking` severity, or no checks at all, is still refused.

Two smaller repairs found by the same end-to-end probe:

- An export failure classified `PERSISTENCE` (not `EXPORT`) terminalized the run. This
  ADR already says export is best effort and cannot gate saving the framework-native
  artifact, so failing to record *optional* interchange data now warns and proceeds.
  `INTEGRITY` stays fatal — that is a binding violation, and the save it guards must not
  proceed on unbound evidence.
- The export-and-save tail became `_finalize` (Amendment 3) so the generation-budget and
  deadline guards reach it too; previously they terminalized on their own, so the
  best-effort delivery fired only when the budget ran out during review.

The lesson worth keeping: a fail-closed store guard that restates an orchestration
policy will silently outlive it. Guards belong on bindings and evidence; policy belongs
in one place both layers read.

## Amendment 5 (2026-07-25): the run view leads with the result, and stops naming the reviewer

Two presentation changes. Neither loosens a claim; one tightens.

**A successful run now ends with what it produced.** The verdict card led with an
eyebrow, a title, a claims callout, and a checks list, and put the measured
distribution, the reported values, and the program itself behind collapsed
`<details>`. The run's product is the result and the code, so those are now the
content: a summary line, the measured distribution, the reported values, the final
program, and the run's facts. Failures keep the outcome card — there the reason is
the content, and it is what the code-based failure copy exists to serve.

**The user-facing vocabulary drops `AI reviewed`.** This ADR originally prescribed it
alongside `executed`, `aligned`, `needs attention`, and `export available`. Naming the
reviewer turned out to invite readers to discount a result on the strength of the
reviewer rather than on the evidence, which is the opposite of what the label was for.
The badge now says `Executed`, and `Executed · needs attention` when the review did not
accept the candidate — a label, not a colour difference, so the distinction survives
for readers who cannot see the tone.

This claims strictly less than before, so the guarantee this ADR exists to protect is
untouched: nothing displays `verified` because code executed or a reviewer aligned it.
What a run did NOT establish is still stated — `unverified_claims` renders under "What
this run does not establish", and the artifact's verification summary keeps its
"Strict quantum correctness was not verified" wording, minus the AI framing.

## Amendment 6 (2026-07-25): close the production-boundary gaps

A final cross-layer audit found four places where the implementation still weakened
the decision above.

- `RepoReviewArtifactSaver` retained its own `READY` requirement after both durable
  stores had moved to `is_deliverable()`. Saving now uses the same evidence-complete
  rule as orchestration and persistence. The rule also fails closed for `READY`:
  advisory model output cannot replace a non-empty set of passing trusted checks.
- Equilibrium-H2 constants were selected by the broad `VQE` algorithm enum, so an
  unrelated molecule or bond length received irrelevant authoritative-looking data.
  The catalog now matches the exact task before planning, shares one reference across
  plan/generate/review, and replaces model-authored H2 coefficients with the
  server-owned total-energy Hamiltonian before the Plan is fingerprinted.
- Framework-native statevectors and 2,048-shot re-executions remained enabled in the
  simple path even though it does not consume them. Framework adapters retain that
  evidence for explicit verification callers, while the simple executor collects only
  the protected result, resource metrics, optimization flag, and optional interchange.
- `ExecutionSpec.memory_mb` stopped at the provider-neutral interface. Vercel sandbox
  creation now maps it to the smallest supported vCPU allocation (2 GiB per vCPU),
  while keeping deny-all egress and an empty environment. Post-execution contract
  checks also reject an observed circuit wider than either the Plan or the 27-qubit
  lane ceiling.

The source contract now rejects invalid Python and imports from a quantum framework
other than the selected one before sandbox creation. The live eval corpus also includes
Cirq and PennyLane generation cases; paid-provider and real-Vercel acceptance remain
owner-gated.
