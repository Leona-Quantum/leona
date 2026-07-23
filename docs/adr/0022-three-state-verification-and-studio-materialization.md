# ADR-0022: Three-state verification and private Studio materialization

**Date:** 2026-07-23 · **Status:** proposed

**Context:** The current pipeline conflates semantic review, deterministic checks, and the final
trust decision. It can treat a Plan-authored reference circuit or an already-passing parent
artifact as a correctness oracle, even though the Plan may misinterpret the request and the parent
may be unrelated to the claim being checked. It also overloads failed or unavailable verification
as a code defect, which can consume candidate revisions without evidence that the candidate is
wrong. Finally, artifact creation and Verified/public eligibility need separate trust boundaries:
an artifact can remain useful in a private workspace when correctness is unresolved, but it must
not acquire a Verified label or enter a public verification path.

**Decision:** Verification is an evidence-bound pipeline with three final decisions: `pass`,
`fail`, and `inconclusive`. Planning describes the requested artifact and its claims but never
authors canonical or reference QASM. The selected-framework source remains authoritative;
OpenQASM is optional derived interchange for explicit conversion only. Parent artifact IDs remain
lineage metadata, but parent QASM, similar catalog circuits, prior passing candidates, and
Plan-authored circuits are never correctness oracles. Retrieved or previously verified artifacts
may be generation exemplars only: they are untrusted hints and must never be copied into
verification evidence or treated as proof.

Every candidate revision receives a mandatory base sandbox execution under the deny-all policy
before semantic review. Fixed verification policy may perform additional trusted re-executions
without creating a new candidate revision. Changing source creates a new candidate revision and
invalidates all prior execution, review, strict-verification, and conversion evidence. The LLM
semantic reviewer reads the request, Plan, exact selected-framework source, immutable execution
evidence, and deterministic observations. It does not select or launch simulations and cannot
override trusted deterministic evidence. Fast checks, semantic review, and the strict deterministic
gate are distinct stages. Their records, the materialized artifact version, and the candidate must
share one source fingerprint:

```text
candidate.source_fingerprint
  == execution.source_fingerprint
  == semantic_review.source_fingerprint
  == strict_verification.source_fingerprint
  == artifact_version.fingerprint
```

Check results have five non-overlapping meanings: `pass` ran and agreed; `fail` ran and established
a concrete mismatch; `skipped` is not applicable by design; `unavailable` is applicable but lacks
capability or evidence; and `error` means the verifier failed to produce a judgement. Only a
positively established defect can produce final `fail`. Unsupported checks, insufficient evidence,
low-confidence criticism, malformed critic output, timeouts, and infrastructure failures produce
`inconclusive`, never blame the candidate, and never consume a candidate revision.

The final decision and routing are explicit. A confirmed candidate defect returns to code
generation and creates a new candidate. A Plan defect returns to planning and creates an immutable
Plan revision without consuming a candidate. Evidence gaps retry simulation on the same candidate;
capability limits stop or retry verification; verifier failures retry verification; evidence
conflicts require adjudication before either code or Plan changes. Persist the failure class, retry
target, and `candidate_defect_observed`; the latter is always false for `inconclusive`.

Authority is ordered as follows: explicit user request and user-supplied data; provider-owned
sandbox observations and immutable execution evidence; trusted deterministic verification;
deterministic classical results derived from user data; validated Plan as an interpretation; then
generated comments, self-reported metrics, and retrieved exemplars. The Plan is not ground truth.
When it conflicts with the request, the outcome is a Plan defect rather than a repair of otherwise
correct code.

The resulting state flow is:

```text
request -> plan -> generate -> sandbox execution -> fast checks -> semantic review
              ^         ^             |                  |              |
              |         +-- candidate defect ------------+--------------+
              +------------ Plan defect --------------------------------+
                                                                    |
                                                                    v
                                                         strict deterministic gate
                                                          /          |           \
                                                      PASS          FAIL     INCONCLUSIVE
                                                        |             |            |
                                               optional conversion    +-- typed     +-- optional
                                                        |                 retry         conversion
                                                        v                               |
                                                Studio VERIFIED                 Studio UNVERIFIED
                                                        |
                                                 Verified/public eligible
```

`pass` requires sufficient trusted evidence for every required claim and is the only decision
eligible for Verified or public paths. `fail` means an accepted requirement or candidate was
concretely disproved and normally routes to repair or replanning. `inconclusive` means neither
correctness nor a defect was established. Both `pass` and `inconclusive` may materialize immutable
private Studio versions, but an inconclusive version carries explicit unverified semantics and can
never enter Verified, public, template, or future QPU gates. Studio entry is not a trust boundary.
Conversion is verdict-neutral: success or failure cannot upgrade or downgrade the source verdict.

Trusted verifier re-execution may still run under fixed policy, but the LLM cannot select it or
change its thresholds.

**Compatibility and rollback:** Existing records containing only `pass`, `fail`, and `skipped`,
historical `VerificationMethod.EXACT` values, stored QASM, stored legacy Plan payloads, and artifact
lineage are retained rather than rewritten or deleted. New Plan validation rejects
reference/canonical QASM and cannot select legacy `exact`; no retention migration deletes
historical values as part of this decision. Persistence
changes are expand-first: add immutable Plan revisions, semantic reviews, strict-verification
attempts, routing fields, and new check outcomes before any legacy column is contracted. Each
schema step must pass previous-head -> new-head -> previous-head -> new-head on a disposable
database. Downgrade must fail closed if post-upgrade data cannot be represented; it must not
silently discard evidence. Runtime rollout must retain legacy readers until backfill and replay
tests prove compatibility. Rollback means disabling new writes/materialization and returning to a
reader that understands the expanded schema; destructive contraction requires a later approved
ADR and migration.

**Consequences:** This separates useful private artifacts from claims of correctness, preserves
candidate budgets when the verifier is uncertain, and makes every repair or replan explainable
from immutable evidence. It costs additional records, explicit retry budgets, typed failure
routing, migration/backfill work, and UI treatment for unverified and stale versions. Structural
success alone no longer earns Verified for physical-correctness claims. No QPU, paid provider,
deployment, public publication, secret action, or change to sandbox policy is authorized by this
ADR. Reversal requires an owner-approved ADR that supplies a stronger trust model without making
LLM-authored code, prior artifacts, or interchange data into correctness authority.
