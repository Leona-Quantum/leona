# ADR-0031: VQE product integration precedes production qualification

**Date:** 2026-07-25 · **Status:** accepted by owner

## Context

The original pre-Phase 5 gate coupled durable product integration to two
external qualification activities: independent scientific review of the H2
candidate and Linux/x86_64 digest-pinned runtime promotion. That prevented
work on the durable execution path even though it can remain fail-closed and
non-public.

Deferring a gate must not be confused with passing it. Machine-generated H2
evidence is not human review, and successful macOS runs do not qualify a
Linux production runtime.

## Decision

1. Split Phase 5 into **5A product integration** and **5B production
   qualification**.
2. Phase 5A may integrate immutable experiment/execution identity, durable
   jobs, server-owned runtime resolution, result persistence, failure
   semantics, and non-public Studio states.
3. During Phase 5A, H2 remains `human_review_state=unreviewed` and runtime
   profiles remain `production_runtime_status=unqualified`.
4. Public execution, publication, scientific claims, and MVP release remain
   blocked.
5. Before Phase 5A, freeze an explicit decomposed excitation circuit, a
   versioned comparable CNOT/depth protocol, independent comparison
   dimensions, a discriminated actual-VQE result contract, one-to-many
   experiment/execution identity, database immutability, and deny-all static
   launch policy.
6. Phase 5B requires independent H2 scientific review, digest-pinned
   Linux/x86_64 OCI images with SBOMs, and live deny-all egress evidence.

## Consequences

Durable integration can proceed without fabricating qualification evidence.
The product can exercise lifecycle and failure behavior earlier, while all
promotion paths continue to fail closed. Phase 5B remains a real release
gate rather than silently becoming optional.

## Reversal trigger

If Phase 5A exposes execution publicly, emits scientific performance claims,
or materializes an unreviewed candidate as accepted evidence, stop Phase 5A
and restore the pre-public gate before further execution.
