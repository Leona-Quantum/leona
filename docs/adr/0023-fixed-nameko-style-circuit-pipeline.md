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
