# ADR-0035: VQE launch truth separates scientific review, execution policy, and live runtime readiness

**Date:** 2026-08-07 · **Status:** accepted for `feature/vqe`

## Context

The component-first Atlas UI could list a workflow as “registry qualified” and
still receive HTTP 422 when creating an experiment. Four independently valid
facts had been collapsed into one label:

1. whether a component definition exists;
2. whether a workflow composition passes the strict scientific resolver;
3. whether the owner permits private execution without independent review;
4. whether an exact digest-pinned runtime is available on a worker now.

The generic Registry list included structured seeds that were intentionally
unvalidated. The launch mutation correctly failed closed, but the launcher did
not use the same evaluator and the error body was not rendered. Mock browser
tests returned a prearranged success response and therefore did not exercise
the strict resolver, a live readiness lease, or PostgreSQL constraints.

ADR-0033 used `owner_waived` as a scientific review state. This ADR supersedes
that representation. It does not revoke the owner's permission for private
execution or weaken the public-release block.

## Decision

1. Scientific review remains `unreviewed` until an independent review actually
   occurs. An owner waiver is represented only as execution policy
   `owner_waived_private`.
2. Historical runtime qualification and current worker readiness are separate.
   A qualified OCI profile is not launchable without a non-expired worker
   heartbeat for that exact runtime profile.
3. `ImplementationResolutionState` is evaluated independently for each
   framework. Framework/provider, adapter release, runtime profile, component
   digests, and scientific capability must resolve exactly.
4. One fail-closed launch evaluator produces an expiring projection for both
   UI display and mutations. Create and start requests must echo
   `expected_projection_sha256`; the server recomputes and rejects stale truth.
5. Experiment creation freezes scientific identity. Execution start is a
   separate mutation that checks the selected framework's live readiness.
6. Every create/draft/start decision is appended to
   `vqe_launch_decisions`. Rows contain an HMAC actor pseudonym, bounded request
   ID, stable reason code, projection and registry digests, and readiness
   snapshot. Database triggers reject UPDATE and DELETE.
7. The worker probes exact OCI repository digests out of band. One failed
   profile cannot suppress other heartbeats. Exception text is never logged.
8. Refusals use RFC 9457-compatible `application/problem+json` with
   `request_id`, `trace_id`, and a stable `reason_code`. Validation errors must
   not echo request values.
9. Registry drift or missing readiness blocks only VQE launch. It must not take
   down unrelated Atlas surfaces.
10. `unreviewed`, private runtime qualification, or owner waiver can never
    imply publication approval, public execution, an independent scientific
    result, or a performance claim.

## Status and HTTP semantics

| Condition | Decision | HTTP | Retry |
| --- | --- | ---: | --- |
| Structured standard seed needs derivation | `draft_required` | direct create: 422 | create validated draft |
| Composition or implementation unresolved | `blocked` | 422 | after correction |
| Private execution policy denied | `blocked` | 403 | after policy change |
| Live runtime unknown, stale, or unavailable | `blocked` | 503 at start | yes |
| Projection digest changed or expired | `stale_rejected` | 412 | refresh projection |
| Eligible projection contradicts strict resolver | `invariant_rejected` | 422 | operator incident |

## Consequences

The launcher shows both eligible and blocked workflows, including the concrete
blockers. “Registry qualified” is no longer a launch promise. A successful
private run remains `scientific_review=unreviewed`,
`execution_policy=owner_waived_private`, and `publication=blocked`.

Runtime probes add a short delay outside request handling, and clients must
refresh stale projections. In return, the UI and mutation path cannot silently
disagree about the same snapshot, and an operator can reconstruct every
decision without storing raw identity or credentials.

## Verification

- Unit tests cover evaluator truth tables, stale projections, typed refusals,
  failure isolation, and eligible-to-resolver invariant contradictions.
- PostgreSQL tests cover delayed-heartbeat fencing and append-only triggers.
- Browser E2E covers blocked and eligible workflows and safe reason display.
- The production E2E publishes real worker readiness after inspecting all six
  approved OCI digests, then exercises create, start, execution, comparison,
  materialization, and session reopen.

