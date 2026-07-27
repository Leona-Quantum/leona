# Atlas VQE Phase 6 — corrected hardening and release decision

Date: 2026-07-27  
Branch: `feature/vqe`  
Decision: **NO-GO for public MVP release; GO for GitHub metadata Wrapper,
claim/metric source modeling, independent scientific review, and
production-runtime design**

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
| Python suite | 1119 passed, 79 skipped | pass |
| Web tests/typecheck | 95 tests; typecheck passed | pass |
| Migration 0036 rollback | local PostgreSQL up→down→up | pass |
| Studio create→run→inspect→save code path | launcher/BFF/panel implemented | pass_static |
| Remote `feature/vqe` CI | implementation run 30165157403 at a49b6d5 and closure run 30171168974 at 6d8a054; py/ts/db/ui-visual | pass |
| Authenticated browser contract E2E | local identity + real Next BFF + deterministic mock API; success/failure | pass_limited |
| Private production system E2E | WorkOS-shaped JWT verification + disposable Neon + durable worker + real OCI runtime | pass for Qiskit and PennyLane |
| Live WorkOS tenant/browser control-plane E2E | WorkOS Staging→Vercel Preview→Cloud Run FastAPI→Neon test branch; owner-observed `/api/me` 200 | pass_control_plane |
| Independent H₂ scientific review | explicitly waived by owner; not relabeled as review | owner_waived |
| Production runtime provider | pre-provisioned dedicated Docker host, exact digest, `--pull=never` | implemented_private |
| OCI Registry manifest digest | GHCR Linux/amd64 indexes with SBOM/provenance attestations | pass |
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

The private production path now has Registry-pullable OCI digests and a
dedicated-host executor. Run `30172634273` passed a disposable-Neon system E2E
for both frameworks through the real JWT verifier, API, durable queue/worker,
real OCI image, and persisted evidence. Its issuer was an ephemeral
WorkOS-shaped JWKS service.

Separately, on 2026-07-27 the owner completed a live WorkOS Staging login
through the Vercel `feature/vqe` Preview and obtained a successful `/api/me`
response through Cloud Run FastAPI and the Neon test branch. This closes the
live control-plane authentication gate, not a browser-triggered OCI execution
gate. See `PHASE6_LIVE_CONTROL_PLANE_E2E.md`. Deployment monitoring and
incident-response evidence for a persistent dedicated runtime host remain
absent.

## Release decision

Public MVP release remains **NO-GO**. Private/test Phase 6 is complete enough
to start Phase 7 metadata-only GitHub import. This is not a public release:
one continuous live browser→dedicated-worker execution E2E, persistent-host
operations, independent scientific review, license approval, and owner
publication authorization remain explicit gates.

Remote CI passed at `6cceb1255a57973b9bf388ada3c615407bc991e2`
(CI run `30172634255`; production-system E2E run `30172634273`, two tests in
22.03 s). Development priority now returns to the original
master-plan objective:

On 2026-07-27 a manual E2E re-run exposed inherited Neon parent schema drift.
The failed run is retained as evidence (`30270582015`). After making the named
disposable branch self-initializing, production-system E2E run `30271046708`
passed both frameworks and full CI run `30271046766` passed all four jobs at
commit `7bc436c54845a24ebd40f44d9ec62015fe3744f0`.

1. manual GitHub URL import;
2. immutable commit, license, citation, and dependency capture;
3. VQE metadata candidates and paper relations;
4. claim/metric source locators;
5. human-review workflow and Atlas card generation.

Further molecular execution work is not the next Phase 6 priority.
