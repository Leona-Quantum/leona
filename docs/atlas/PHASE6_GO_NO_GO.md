# Atlas VQE Phase 6 — hardening and MVP release decision

Date: 2026-07-25
Branch: `feature/vqe`
Decision: **NO-GO for public MVP release; GO for owner and independent
scientific review**

## Gate matrix

| Gate | Evidence | Result |
|---|---|---|
| Python suite | 1112 passed, 74 skipped | pass |
| TS lint/typecheck/tests | Turbo 6/6, web 95 tests | pass |
| Production web build | 336 pages generated | pass |
| Corpus schema/reconciliation | Phase 2/4.5 generated checks and full suite | pass |
| Authz and repository scoping | local suite + temporary Neon tests | pass |
| Job/retry/reclaim | full worker/API suites | pass |
| Migration rollback | temporary Neon 0034→0035→0034→0035; populated downgrade refused transactionally | pass |
| Append-only observations | DB trigger and live mutation tests | pass |
| Linux/x86_64 repeated H2 | 10/10 per framework | pass for pinned candidates |
| Cross-framework numerical gate | errors below 2e-14; common metrics identical | pass |
| Live deny-all egress | outbound TCP blocked in both strict images | pass |
| SBOM | CycloneDX from build attestations | pass |
| Authenticated Studio browser flow | signed-out browser redirected; not bypassed | not run |
| Independent H2 scientific review | external reviewer not supplied | blocked_external |
| Owner MVP user-flow confirmation | owner action | blocked_owner |
| Public capability/promotion | expressly unauthorized | blocked_owner |

## Scientific conclusion

The implemented path demonstrates that one frozen portable H2 scientific
specification can be executed in two independently locked frameworks while
preserving a common canonical circuit and resource-measurement protocol. It
does **not** demonstrate framework superiority, hardware performance,
finite-shot robustness, arbitrary molecular VQE support, or reproduction of
an external paper's performance claims.

The registry corpus remains machine-validated rather than human-validated.
Unknowns and negative evidence remain explicit. The executable H2 candidate
still requires an independent domain reviewer before any scientific release.

## Security conclusion

The local candidate execution path is materially isolated and credential-free,
and its public capability is fail-closed. The evidence qualifies only the
pinned candidate images on the tested Docker Desktop Linux/x86_64 runtime.
Production deployment topology, host controls, monitoring, and incident
response remain outside this local qualification.

## Release decision

Phase 6 hardening work that can be performed without external authority is
complete. The correct release decision is **NO-GO**, not because an automated
test failed, but because two non-delegable acceptance gates are intentionally
open:

1. independent human scientific review of H2;
2. owner confirmation of the authenticated MVP user flow and public promotion.

No code path in this change converts those missing decisions into a pass.
