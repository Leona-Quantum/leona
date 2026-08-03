# Phase 10 S7 execution-policy preflight

Status: offline contract complete; owner approval and live qualification are
not complete.

## Purpose

S7 prevents a caller from assembling a supposedly safe execution environment
by choosing individual enforcement parameters.  Atlas instead binds an exact
runtime OCI **index** digest, required platform, fixed launcher, proposed
sandbox class, complete limit set, network/credential policy, determinism
controls, binding rules, failure taxonomy, and retry rule into one canonical
policy digest.

The implementation is
`services/api/src/majorana_api/phase10_execution_policy.py`.

## What is implemented

- Digest-only OCI identity (`sha256:<64 lowercase hex>`), never a tag.
- Required platform is exactly `linux/amd64`.
- The launcher identifier, launcher argument vector, file roots, schemas,
  deny-all network policy, no-credential policy, deterministic controls,
  binding requirements, failure taxonomy, and manual-only retry rule are fixed
  Atlas-owned values.
- Exact CPU, memory, PID, scratch, file, time, stdout, stderr, and result limits
  are represented together.  The contract does not provide guessed defaults.
- A qualification-identity candidate derives repository ID/name, immutable
  commit, and retrieval digest from the actual S2 acquisition result. It also
  requires the actual S3 quarantine plan, S5 normalized manifest, and S6 static
  candidate and verifies their workspace, manifest, file, locator, and digest
  chain before binding the OCI digest, platform, and policy digest. Parallel
  caller-supplied source scalars are not accepted.
- Unapproved candidate identities use `phase10-qic:<sha256>`. The client
  selection schema rejects that namespace and accepts only a distinct
  authority-issued `phase10-qi:<sha256>` identity plus the expected policy
  digest. Unknown fields—including individual limit overrides—are rejected.
- Resolution is possible only against a deployment-owned trusted mapping.  This
  module cannot create or sign an approval.

## Deliberate fail-closed boundary

Every policy and qualification identity produced here is `unqualified` and
contains these mandatory blockers:

1. `owner_security_decision_pending`
2. `runtime_digest_not_live_verified`
3. `sandbox_class_not_live_qualified`

The S6 blockers are also retained on the source-specific qualification
identity.  Self-consistent JSON edits that claim `qualified`, relax network or
credential policy, change the platform/launcher, remove blockers, or alter an
integrity-bound field are rejected.

The trusted mapping accepted by the pure resolver is not itself evidence of an
approval. A later deployment layer must issue the separate `phase10-qi`
identity, load its mapping from an access-controlled reviewed source, and
retain immutable approval evidence that binds it to the exact `phase10-qic`
candidate and live probe evidence. This module cannot issue an approved
identity. No such deployment or authority exists in this preflight.

## Scientific boundary

A qualification identity means only that one exact source selection is bound to
one exact runtime and policy proposal.  It does not prove scientific
correctness, equivalence to a paper, reproducibility outside the recorded
environment, or performance superiority.  Results remain unavailable until the
independent S9 verifier accepts their bounded schema and scientific protocol
identities.

## Tests

`services/api/tests/test_phase10_execution_policy.py` covers:

- canonical digest stability and round-trip parsing;
- digest-only runtime and `linux/amd64` enforcement;
- positive bounded integer representation for every proposed limit;
- denial of qualification escalation and policy-surface relaxation;
- complete S2 acquisition → S3 quarantine → S5 normalization → S6 static
  candidate → S7 policy binding;
- rejection of cross-repository and cross-source evidence splicing;
- runtime-profile mismatch rejection between S6 and S7;
- rejection of unknown client-selected parameters and unapproved `phase10-qic`
  candidate IDs;
- exact trusted-registry resolution and digest mismatch rejection.

## Remaining S7 exit-gate work

The exit gate remains closed until the owner/security process supplies and
records all of the following without inference:

- dated owner and security approvals;
- an actual OCI index digest whose `linux/amd64` manifest was independently
  verified;
- reviewed launcher artifact and digest;
- approved sandbox class and exact limit values;
- an access-controlled qualification registry and immutable approval evidence;
- live enforcement probes on the exact deployment class.
