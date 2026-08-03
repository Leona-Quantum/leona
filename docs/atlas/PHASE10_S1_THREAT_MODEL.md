# Phase 10 S1 — External source threat model and hostile-test contract

Date: 2026-08-03 JST  
Status: **design baseline — S1 is not accepted; external fetch and execution remain disabled**  
Parent plan: `PHASE10_EXTERNAL_EXECUTION_PLAN.md`

## 1. Decision boundary

This document turns Phase 10 S1 into a reviewable security contract. It does
not approve external repository execution and it does not claim that the
controls described below are already implemented.

ADR-0017 is still proposed and S0 has no named security owner. Therefore:

```text
external network fetch        disabled
repository/archive checkout   disabled
external source execution     disabled
dynamic dependency install    forbidden
public evidence/materialize   forbidden
```

The machine-readable source of this threat inventory is
`docs/atlas/evidence/phase10/threat_control_matrix_v1.json`. The checked-in
validator checks completeness and vocabulary only. Passing it is not evidence
that a control works on a live deployment.

## 2. Scope

### In scope

- operator-requested acquisition of one approved public GitHub source;
- immutable commit and selected-file identity;
- quarantine, normalization, static inspection and runtime mapping;
- execution of selected source in a separate ephemeral runtime;
- bounded result ingestion and independent verification;
- private candidate retention and later publication gating.

### Out of scope until a later review

- arbitrary URL fetching;
- private repositories;
- `git clone`, archive download or archive expansion;
- submodules and Git LFS resolution;
- source-selected containers, commands, packages or native extensions;
- outbound network or QPU access from the executor;
- unattended public execution or automatic scientific claims.

## 3. Assets and security objectives

| Asset | Required property | Failure impact |
| --- | --- | --- |
| WorkOS/user/workspace identity | confidentiality and tenant isolation | cross-workspace disclosure or authority theft |
| Neon/application data | no fetcher/executor access; append-only evidence | evidence corruption or data exfiltration |
| Cloud, GitHub, registry, signing, LLM and QPU credentials | absent from executor; least privilege elsewhere | infrastructure compromise or paid abuse |
| Host/kernel/container control plane | isolated from untrusted source | host escape and lateral movement |
| Quarantine bytes and manifest | content-addressed integrity and private access | source substitution or cross-tenant leak |
| Runtime and policy identities | exact digest/platform binding | execution under an unreviewed environment |
| Scientific input/result evidence | complete provenance, units and protocol identity | invalid comparison or false scientific claim |
| Publication state | explicit reviewed transition only | unreviewed source/result presented as public truth |
| Rights metadata | decision provenance and separate use/publication rights | license or redistribution violation |
| Availability and spend | bounded CPU, memory, disk, output and retries | denial of service or cost exhaustion |

## 4. Actors

1. **External source author** — may intentionally or accidentally publish
   malicious files, metadata, build scripts or forged results.
2. **Authenticated workspace operator** — may submit abusive coordinates,
   trigger excessive work or attempt cross-workspace access.
3. **Compromised upstream or network path** — may change mutable refs, return
   inconsistent objects, redirect, rebind DNS or truncate responses.
4. **Compromised fetcher** — has limited source egress and quarantine-write
   authority; must not gain database, executor or publication authority.
5. **Compromised executor payload** — runs hostile code and must have no
   network, credentials, host control or publication authority.
6. **Buggy verifier or application** — may accept ambiguous data, bind the
   wrong digest, overwrite evidence or promote a candidate incorrectly.
7. **Reviewer/administrator error** — may approve the wrong source, runtime,
   rights or qualification identity.

## 5. Trust boundaries and data flow

```text
Authenticated operator
        |
        | typed connector + opaque coordinate
        v
API/control plane -----> append-only job/evidence store
        |
        | narrow job message; no arbitrary URL/command
        v
Network fetcher -----> approved immutable upstream
        |
        | bounded bytes + retrieval manifest
        v
Private content-addressed quarantine
        |
        | read-only normalized manifest
        v
Static reviewer/runtime mapper
        |
        | approved qualification identity only
        v
Ephemeral deny-all executor -----> bounded untrusted result envelope
                                      |
                                      v
                              Independent verifier
                                      |
                                      v
                         private append-only observation
```

The two deliberate privilege breaks are:

- the network-capable fetcher cannot execute, read application data or publish;
- the execution-capable runtime cannot use network, credentials, database or
  publication authority.

## 6. Existing-control audit

### Present and tested for the Phase 7 metadata-only path

- canonical `https://github.com/<owner>/<repository>` coordinate parsing;
- fixed GitHub API origin, `trust_env=False` and redirects disabled;
- serial bounded JSON reads and stable connector failures;
- immutable commit/tree/blob identities and Git object digest verification;
- truncated/unbounded trees rejected;
- bounded metadata file count and byte total;
- symlinks and submodules excluded from metadata selection;
- durable snapshot identity and append-only import evidence.

These controls apply to the narrow recorded/metadata snapshot boundary. They
are not proof that arbitrary source acquisition or execution is safe.

### Present for Atlas-authored controlled VQE runtimes

- server-authoritative runtime capability resolution;
- digest-pinned Linux/amd64 Qiskit and PennyLane images;
- non-root, read-only-root, capability-dropped, no-network runtime profiles;
- bounded controlled result envelopes and private publication state.

These runtimes execute Atlas-authored payload contracts. They have not been
qualified for third-party repository source.

### Missing or unqualified

- DNS answer validation and connection pinning on the live fetcher;
- a separately deployed fetcher identity and content-addressed object store;
- external-source normalizer and entrypoint approval mapping;
- repository/archive hostile corpus;
- exact executor-class host-escape, Unix-socket, cleanup and credential probes;
- complete source/runtime/policy/input/result attestation;
- independent rejection of forged source-reported scientific metrics;
- named security and operational owners.

## 7. Threat classification

The matrix uses these severities:

- `critical`: credential, host, control-plane, cross-tenant or publication
  compromise;
- `high`: source/result substitution, isolation bypass, unbounded resource use
  or scientific evidence corruption;
- `medium`: bounded availability, ambiguity or provenance degradation that
  cannot directly cross a critical boundary;
- `low`: observability or usability weakness without authority gain.

Control states are intentionally explicit:

- `implemented_existing`: present and covered on the narrow existing path;
- `partial_existing`: related control exists but is insufficient for Phase 10;
- `blocked_by_design`: feature is currently disabled/rejected;
- `planned`: no qualifying implementation evidence yet.

Only `implemented_existing` with a real test locator counts as existing
evidence. `blocked_by_design` is a valid pre-release safety posture but is not
proof that a future implementation will be safe.

## 8. High-level threat/control mapping

The complete row-level mapping is in the JSON evidence file. The release
blocking groups are:

| Group | Representative attacks | Required preventive boundary | Required detection/evidence |
| --- | --- | --- | --- |
| Network acquisition | SSRF, DNS rebinding, redirects, IPv4/IPv6 ambiguity, metadata service | fixed connector operation, all-answer address rejection, pinned connection, no proxy/header input | destination decision record and hostile mock/live probe |
| Source identity | mutable ref drift, response truncation, digest substitution | immutable resolved commit and content-addressed manifest | upstream and locally recomputed digests |
| Source shape | traversal, links, devices, archive bombs, Unicode collisions, nested archives | archives disabled initially; later pre-scan before materialization | stable rejection and cleanup evidence |
| Git semantics | submodule, LFS, hook and build-script side effects | no clone/submodule/LFS/hook execution; selected files only | manifest records rejected object types |
| Runtime | dynamic install, network, secret discovery, host escape, fork/memory/disk/output bombs | fixed launcher in reviewed image; deny-all network; zero secrets; kernel boundary and hard limits | independent probes, runtime counters and cleanup record |
| Result integrity | forged success, digest swap, replay, NaN/Inf, metric spoofing | bounded strict schema and complete qualification binding | verifier observation independent from source output |
| Scientific integrity | self-certified reference, mixed resource protocols, missing units | independent reference/protocol resolution | explicit unknown/rejected state, never inferred zero |
| Rights/publication | license laundering, automatic promotion, cross-tenant read | separate rights decisions, reviewed publication transition, scoped repository reads | append-only review/audit evidence and negative authorization tests |

## 9. Stable failure semantics

Failure codes belong to the stage that first proves the invariant failed. The
same attack must not become a generic `execution_failed` merely because it was
observed later.

Examples:

```text
destination_blocked
redirect_rejected
immutable_ref_required
fetch_limit_exceeded
content_digest_mismatch
source_shape_rejected
entrypoint_not_approved
runtime_digest_mismatch
network_isolation_failed
credential_isolation_failed
resource_limit_exceeded
execution_timeout
result_schema_invalid
result_binding_mismatch
scientific_invariant_failed
rights_unknown
rights_conflict
cleanup_failed
```

A source-facing message may be less detailed, but the private append-only
observation retains the stable internal code, stage, policy identity and
non-sensitive diagnostics.

## 10. Hostile-test contract

Each matrix row has a deterministic `fixture_id`. Planned fixtures must be
inert checked-in data or run only inside the explicitly isolated private
security workflow. Normal CI must not fetch or execute public untrusted source.

Each hostile test records:

```text
fixture digest
policy digest
runtime/executor identity when applicable
expected stage and failure code
observed stage and failure code
wall time and resource ceiling
network/credential observation
cleanup result
retry/idempotency result
```

Passing conditions:

1. hostile fixtures are rejected at the earliest applicable boundary;
2. benign controls succeed under the same limits;
3. no forbidden route, credential, socket or cross-workspace read is observed;
4. timeout/kill/partial-write paths leave no reachable partial output;
5. repeated execution does not rewrite earlier evidence;
6. unexplained nondeterminism is a failure, not a flaky-test waiver.

## 11. Residual risks and S1 exit status

The matrix gives every critical/high threat a proposed accountable role,
preventive control, detective evidence, stable failure code and fixture ID.
However, the people filling the security and operational roles are not named,
and most Phase 10-specific fixtures and live controls are still planned.

Therefore S1 is **designed but not accepted**. Its exit gate remains blocked by:

1. S0 owner acceptance or amendment of ADR-0017;
2. named security and operational owners;
3. review of severity, residual risk and control ownership;
4. implementation and successful execution of the planned tests at their
   assigned later stage.

The safe next step is S2 design and recorded-response qualification only. Live
network fetching remains disabled until S0/S1 approval and the fetcher boundary
is separately qualified.
