# Atlas VQE Phase 6 — private production-system E2E evidence

Date: 2026-07-26  
Branch: `feature/vqe`  
Implementation commit: `6cceb1255a57973b9bf388ada3c615407bc991e2`

## Result

GitHub Actions run
[`30172634273`](https://github.com/EshMis/majorana/actions/runs/30172634273)
passed both Qiskit and PennyLane cases (`2 passed in 22.03 s`). The companion
full CI run
[`30172634255`](https://github.com/EshMis/majorana/actions/runs/30172634255)
also passed.

Each case exercised:

1. RS256 token signing and remote JWKS retrieval through the production JWT
   verifier;
2. exact issuer, expiry, required session claims, and `client_id` validation;
3. first-login identity/workspace resolution;
4. API creation of a server-resolved frozen H2 experiment;
5. server-only production `ExecutionBinding`;
6. durable Neon job claim and worker lifecycle;
7. real pre-provisioned GHCR image execution by exact digest with
   `--pull=never`, `--network none`, read-only root, non-root UID, dropped
   capabilities, no-new-privileges, and bounded resources;
8. append-only evidence persistence and authenticated API retrieval;
9. numerical error gate `≤ 1e-10`;
10. deletion of the temporary Neon branch.

## OCI identities

| Framework | OCI index digest | Linux/amd64 manifest |
|---|---|---|
| Qiskit 1.4.6 | `sha256:3b66b9a813346c4ebba446c2cb80119b4d379725797f90463d2068e5285d62f6` | `sha256:e82b920d7858d69360bb2e12ca5e997b87c286adcc56ce70ab55b3ab4345fb54` |
| PennyLane 0.45.1 | `sha256:205a795608b99e6901e9a03696a0aa38be718c636cdcadd530ada7492c288fd2` | `sha256:37f41aa59b8b2a90fb968e3a5eb33dbbe183b63883743769c1a9b87a005ca0ca` |

The images were published by run
[`30171738557`](https://github.com/EshMis/majorana/actions/runs/30171738557)
from frozen runtime payload commit
`99e95a9a2589a3ca0ac01c3e44499046fabbce89`, with OCI SBOM and provenance
attestations.

## Claim boundary

This is a **WorkOS JWT contract E2E**, not a live WorkOS tenant E2E. The test
uses an ephemeral local JWKS issuer with the documented WorkOS AuthKit claim
shape and runs the real production verifier. No WorkOS tenant credential was
available in repository secrets.

The owner explicitly excluded Vercel from this phase. No Vercel deployment,
browser, or runtime claim is made.

Independent H2 scientific review was owner-waived. Evidence is labeled
`owner_waived`, never `human_reviewed`. Runtime qualification does not turn
machine-generated H2 evidence into independent scientific validation. Public
execution, publication, verified badges, and scientific release remain
blocked.

## 2026-07-27 revalidation and schema-drift correction

A manual re-run at source head
`e4e0f8fce8093c7f25663f5654be4c8142cd482b` initially failed before runtime
execution because the newly created Neon child inherited an inconsistent
parent state: `alembic_version` indicated the current revision while
`vqe_component_specs` was absent. Run
[`30270582015`](https://github.com/EshMis/majorana/actions/runs/30270582015)
is retained as negative infrastructure evidence.

Commit `7bc436c54845a24ebd40f44d9ec62015fe3744f0` corrected the E2E isolation:
the workflow now drops and recreates `public` only on its named disposable
child branch before applying migrations. It does not reset the parent or any
persistent database.

Revalidation run
[`30271046708`](https://github.com/EshMis/majorana/actions/runs/30271046708)
then passed both framework cases (`2 passed in 14.06 s`), including exact OCI
digest pre-provisioning, durable execution, numerical gates, evidence
persistence, and child-branch deletion. Companion full CI run
[`30271046766`](https://github.com/EshMis/majorana/actions/runs/30271046766)
passed Python, TypeScript/production build, database/Neon, and UI-visual jobs.

This correction makes the test independent of the mutable parent schema. It
does not repair or make a claim about that parent; persistent database drift
must be audited separately before using it as a migration authority.
