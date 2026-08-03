# Phase 10 S8 hardened-executor probe preflight

Status: offline observation contract complete; hardened executor and live
qualification are not complete.

## Purpose

S8 requires proof from the exact deployment class that will execute untrusted
source.  A statement such as "network disabled" or a passing local Docker run
is not sufficient.  The observation contract in
`services/api/src/majorana_api/phase10_executor_probe.py` requires one bounded,
content-addressed result for every mandatory isolation probe.

This code does not execute source, create a sandbox, contact a cloud provider,
or grant qualification.

## Required probe set

The probe set is fixed and ordered.  Missing, duplicate, reordered, or unknown
probes fail closed.

- OCI index digest and `linux/amd64` platform verification;
- confirmation that no image pull occurs during execution;
- blocked IPv4, IPv6, DNS, Unix-socket, and metadata-endpoint access;
- non-root UID and GID;
- read-only root filesystem;
- all capabilities dropped and `no-new-privileges` enforced;
- no host mount and no daemon socket;
- exact environment allowlist with no inherited credential;
- bounded scratch space;
- graceful timeout, forced termination, and complete cleanup;
- hard stdout, stderr, and result-size limits.

Each probe carries only a probe ID, boolean outcome, evidence digest, and a
stage-specific failure code.  Raw stdout, stderr, credentials, filesystem
paths, or cloud diagnostics are not accepted by this contract.

## Binding and integrity

An observation binds:

- a unique attempt UUID and canonical UTC timestamp;
- exact deployment-class identifier;
- S7 candidate qualification identity;
- policy digest;
- OCI index digest and platform;
- the complete ordered probe result set;
- the observation digest.

`probe_outcome` and `failed_probe_ids` are derived from the individual results.
They cannot be self-reported independently.  Failure codes remain specific to
the stage that established the failure, rather than collapsing to a generic
execution error.

## Deliberate fail-closed boundary

Even when every probe passes, `qualification_status` remains `unqualified` and
the following blockers remain mandatory:

1. `live_executor_owner_review_pending`
2. `hostile_corpus_qualification_pending`
3. `independent_runtime_attestation_pending`

This prevents an executor, source repository, client, or test fixture from
self-certifying production safety.

## Tests

`services/api/tests/test_phase10_executor_probe.py` covers:

- complete passing and stage-specific failing observations;
- stable failure-code enforcement;
- missing, duplicate, and reordered probe rejection;
- exact runtime/policy/attempt binding;
- unknown-field and digest-tampering rejection;
- qualification-escalation rejection;
- derived outcome/list forgery rejection;
- timezone-aware canonical timestamp enforcement.

## Remaining S8 exit-gate work

The exit gate remains closed until an owner-approved isolation class exists and
the hostile corpus runs on that exact digest-pinned deployment class.  The live
harness must independently produce the evidence digests, retain non-sensitive
diagnostics in append-only evidence, demonstrate cleanup, and be reviewed by
the designated security/operational owners.  Docker Desktop and unrestricted
shared Docker daemons do not satisfy this gate.

