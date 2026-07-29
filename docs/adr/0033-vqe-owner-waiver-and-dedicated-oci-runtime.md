# ADR-0033: Owner waiver does not equal scientific review; private VQE uses a dedicated OCI runtime

**Date:** 2026-07-26 · **Status:** accepted by owner

## Context

ADR-0032 separated Phase 5A product integration from Phase 5B qualification
and required an independent H2 scientific review before public promotion. The
owner has now explicitly waived that review for the current private MVP work.
The owner also excluded Vercel from the current runtime scope because it is not
under their administration.

The two Linux/amd64 runtime payloads have been published to GHCR from source
commit `99e95a9a2589a3ca0ac01c3e44499046fabbce89`, with OCI provenance and
SBOM attestations. A registry-published image is not safe merely because it has
a digest: runtime selection, pre-provisioning, isolation, and evidence labels
must still fail closed.

## Decision

1. Record the scientific review state as `owner_waived`, never
   `human_reviewed`. The waiver permits private execution work but supplies no
   independent scientific evidence.
2. Keep public execution, publication, verified badges, and scientific release
   blocked.
3. Add a private production execution gate that resolves only server-owned
   profiles with `production_runtime_status=qualified`.
4. Pin these OCI index digests:
   - Qiskit:
     `sha256:3b66b9a813346c4ebba446c2cb80119b4d379725797f90463d2068e5285d62f6`
   - PennyLane:
     `sha256:205a795608b99e6901e9a03696a0aa38be718c636cdcadd530ada7492c288fd2`
5. Run those profiles only on an explicitly marked dedicated Docker host.
   Images are provisioned out of band; execution uses `--pull=never` and first
   verifies the exact repository digest. Cloud Run markers fail closed because
   a Cloud Run worker cannot safely provide this Docker-host contract.
6. Preserve deny-all egress, read-only root, non-root UID, no capabilities,
   no-new-privileges, bounded CPU/memory/PIDs/tmpfs/output/time, and a
   completely constructed Docker client environment with no application
   credentials or database URL.
7. Exercise the real production JWT verification code against an ephemeral
   WorkOS-shaped issuer, a disposable Neon branch, the durable job lifecycle,
   and the real OCI runtimes in CI. Label this `WorkOS JWT contract E2E`; it is
   not evidence of a live WorkOS tenant.
8. Pin the normal AuthKit application with verified signature, issuer, expiry,
   required session claims, and exact `client_id`. A custom issuer/JWKS remains
   explicit configuration.
9. Vercel deployment and Vercel runtime validation are outside this decision.

## Consequences

`qualified` means that the exact engineering runtime and its isolation
contract passed the defined qualification path. It does not mean the H2
scientific specification was independently reviewed, that performance claims
were peer reviewed, or that public release was approved.

The API control plane may enqueue private production executions from a managed
service, but the executing worker must be a separately operated dedicated
Docker host. A live WorkOS tenant E2E remains unverified until the owner
provides tenant credentials/configuration.

## Reversal trigger

Stop production execution if a worker can pull at run time, accept a tag or
client-selected digest, inherit credentials, gain network access, run outside
the dedicated-host boundary, or expose owner-waived evidence as independently
reviewed/public.
