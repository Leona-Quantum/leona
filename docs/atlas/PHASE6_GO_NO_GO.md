# Atlas VQE Phase 6 — corrected hardening and release decision

Date: 2026-07-26  
Branch: `feature/vqe`  
Decision: **NO-GO for public MVP release; GO for remote branch CI,
authenticated E2E, independent scientific review, and production-runtime
design**

## Gate matrix

| Gate | Evidence | Result |
|---|---|---|
| Portable scientific identity / Registry separation | typed contracts and immutable rows | pass |
| Execution-specific materialization | selected execution bundle + route tests | pass |
| Execution create/bind/attempt concurrency | local two-session PostgreSQL tests | pass |
| Runtime streaming output cap | immediate bounded-read termination test | pass |
| Timeout/cancel container cleanup | unique name, force-remove, absence verification tests | pass |
| Retry/failure taxonomy | transient vs deterministic result paths | pass |
| Independent resource observation | adapter-observed sequence/count/depth vs canonical digest | pass |
| Resource metric scope | ansatz-only; reference/measurement/optimization/routing excluded | pass |
| Runtime provenance | source/lock/script/fixture/protocol/SBOM/attestation hashes | pass for local candidates |
| Local Linux/x86_64 repeated H₂ | 10/10 per framework | pass |
| Local deny-all egress | outbound TCP blocked in both strict images | pass |
| Python suite | 1117 passed, 77 skipped | pass |
| Web tests/typecheck | 95 tests; typecheck passed | pass |
| Migration 0036 rollback | local PostgreSQL up→down→up | pass |
| Studio create→run→inspect→save code path | launcher/BFF/panel implemented | pass_static |
| Remote `feature/vqe` CI | push trigger configured | pending_push_result |
| Authenticated browser E2E | not executed | incomplete |
| Independent H₂ scientific review | reviewer not supplied | deferred_external |
| Production runtime provider | local Docker executor only | not_implemented |
| OCI Registry manifest digest | image not pushed | not_implemented |
| GitHub metadata Wrapper | master-plan work has not resumed | not_implemented |
| Public capability/promotion | expressly unauthorized | blocked_owner |

## Scientific conclusion

The local proof demonstrates that one frozen H₂ scientific specification can
be evaluated by Qiskit and PennyLane under one shared SciPy optimization
contract. Both adapters independently reconstruct and verify the canonical
ansatz decomposition. It does not compare native optimizers or compilers,
prove hardware performance or finite-shot behavior, support arbitrary
molecules, or reproduce a paper's headline result.

The Registry corpus remains an initial machine-validated collection rather
than the intended broad, researcher-maintained VQE hub. The executable H₂
candidate remains unreviewed.

## Systems conclusion

The P0 defects identified in the 2026-07-26 audit are corrected in the local
candidate path: framework selection during materialization, experiment
creation UX, output/cancel/cleanup, failure classification, resource
observation, provenance, database races, polling semantics, branch CI
configuration, minimal runtime dependencies, and deterministic thread
settings.

This is not the same as production readiness. No cloud sandbox executor,
Registry-pullable OCI digest, authenticated browser E2E, deployment
monitoring, or incident-response evidence exists.

## Release decision

Public MVP release remains **NO-GO**. The earlier statement that all technical
hardening except human/owner decisions was complete was incorrect and has
been withdrawn. Local P0 hardening is now substantially closed, but remote
CI, authenticated E2E, production runtime, OCI promotion, independent
scientific review, and owner authorization remain explicit gates.

After the remote CI result is recorded, the implementation priority returns
to the original master-plan objective:

1. manual GitHub URL import;
2. immutable commit, license, citation, and dependency capture;
3. VQE metadata candidates and paper relations;
4. claim/metric source locators;
5. human-review workflow and Atlas card generation.

Further molecular execution work is not the next Phase 6 priority.
