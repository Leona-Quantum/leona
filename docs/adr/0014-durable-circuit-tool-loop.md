# ADR-0014: Durable tool loop for circuit generation

**Date:** 2026-07-16 · **Status:** superseded by ADR-0023

This ADR describes the removed model-directed tool loop. New runs use the fixed
nameko-style pipeline in [ADR-0023](0023-fixed-nameko-style-circuit-pipeline.md);
the old broker, runtime, model selector, and strict-verification execution path no
longer ship in `majorana_agent` or the Worker.

**Context:** The fixed twelve-stage executor duplicated generation, execution, and
finalization state across a mutable dictionary and a large worker handler. Repair meant
rewinding stages, so stale evidence could survive and the architecture could not prove
that executed, verified, converted, and published source were identical. The useful
namekoQ behavior was its model-directed tool loop, but its prompt-enforced ordering,
local subprocess execution, resubmitted verification inputs, and LLM-reconstructed
OpenQASM were not safe production boundaries.
**Decision:** Replace the stage executor with a bounded, durable circuit-agent loop.
The model chooses one typed tool call at a time; `ToolBroker` enforces legal state,
selected framework, argument schemas, budgets, latest-candidate use, and publication
gates. Each repair creates an immutable Candidate revision bound to its framework-native
source fingerprint and durable execution/verification evidence. Tool calls are
idempotent by `tool_call_id` and can resume after partial worker failure. Generated code
runs only in the deny-all sandbox and returns `RESULT`, circuit observation, and its
control-plane-supplied fingerprint through a bounded protected sidecar. Deterministic
verification cannot be overridden by the semantic critic. OpenQASM is optional
interchange exported from the same executed `FINAL_CIRCUIT`; publishing the verified
selected-framework source never depends on conversion success.
**Consequences:** The exact code returned to the user is the code whose fingerprint
passed execution and verification, repairs remain auditable, and worker restarts do not
duplicate candidates or artifacts. The worker becomes assembly code around agent ports,
while PostgreSQL stores run state, tool steps, candidates, and evidence. Stored legacy
stage events remain parseable, but no stage executor or dual execution path remains.
Costs are additional persistence rows, explicit tool budgets, and a migration requiring
owner review. Reversal trigger: replace the loop only if another orchestrator preserves
the same fingerprint binding, deterministic verification authority, sandbox boundary,
idempotency, and framework-native publication guarantees.
