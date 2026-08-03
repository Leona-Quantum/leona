# Phase 10 — External repository execution security plan

Date: 2026-08-03 JST  
Status: **preflight only — implementation and external execution are blocked**  
Branch: `feature/vqe`

## 1. Purpose and boundary

Phase 10 is a separate security milestone. Its purpose is not to increase the
number of catalog records. It is to determine whether selected, immutable
third-party source can be acquired, inspected, and eventually executed without
giving that source network, credential, database, publication, or host
authority.

This plan implements the Phase 10 entry conditions in
`atlas_vqe_mvp_execution_plan_ja.md` and the threat boundary proposed in
ADR-0017. ADR-0017 is still `proposed`; therefore this document does **not**
authorize external source execution.

The current Qiskit and PennyLane VQE runtimes execute Atlas-authored, reviewed
payload contracts in digest-pinned images. They are evidence that a controlled
runtime can be isolated. They are not evidence that an arbitrary repository is
safe to execute.

## 2. Current-state audit

### Available foundations

- immutable GitHub commit and selected-file snapshot metadata;
- append-only VQE execution and review evidence;
- provider-neutral workflow/component identities and controlled swaps;
- digest-pinned Linux/amd64 Qiskit and PennyLane runtime profiles;
- no-network, non-root, read-only-root, capability-dropped container execution;
- CPU, memory, process, wall-time, and output limits;
- publication and scientific claims blocked for unreviewed candidates.

### Missing Phase 10 controls

- ADR-0017 has not received the required owner/security acceptance;
- fetched repository bytes are not stored in a separate private,
  content-addressed quarantine object store;
- the network-capable fetcher is not yet a separately deployed identity with no
  database, execution, signing, QPU, or publication credentials;
- repository/archive expansion, symlink, device-file, nested archive,
  submodule, LFS, and hook rejection have not been qualified together;
- there is no reviewed mapping from a source manifest to an approved entrypoint
  and prebuilt runtime digest;
- the current hostile corpus does not prove repository-specific attacks and
  forged-result attacks are rejected;
- result envelopes are not yet attested to the exact source digest, runtime
  digest, policy digest, input digest, and output digest;
- source-license review is not an execution authorization.

Consequently, Phase 10 starts in a fail-closed state:

```text
external fetch: disabled
archive expansion: disabled
external source execution: disabled
dynamic dependency installation: forbidden
public materialization: forbidden
performance/scientific claims: forbidden
```

## 3. Security invariants

The following invariants are release-blocking and may not be weakened to make a
test pass.

1. The API accepts a typed connector and opaque source coordinates, never an
   arbitrary URL, shell command, image, module, path, or entrypoint.
2. The fetcher can reach only allowlisted immutable-source endpoints. It cannot
   execute source or publish records.
3. The executor has no network route and receives no database, WorkOS, GitHub,
   cloud, QPU, signing, LLM, or publication credential.
4. Import jobs never install packages. Every dependency and executable is in a
   reviewed, digest-pinned runtime image built outside the execution request.
5. Source input is read-only. The root filesystem is read-only. Writable space
   is an empty, size-limited scratch mount destroyed after the attempt.
6. The process is non-root with all Linux capabilities dropped,
   `no-new-privileges`, PID/CPU/memory/disk/time/output limits, and a reviewed
   syscall isolation boundary.
7. Results are untrusted data until an independent verifier binds them to all
   input/runtime/policy digests and recomputes cheap invariants.
8. A timeout, partial result, malformed result, missing locator, unknown right,
   digest mismatch, policy mismatch, or verifier disagreement is a terminal
   non-public failure—not a degraded success.
9. Evidence is append-only. Retries create new observations and never rewrite a
   prior failure.
10. Execution qualification is per exact source commit × selected manifest ×
    runtime digest × policy digest. It is not inherited by a repository name,
    branch, tag, organization, paper, or provider.

## 4. Scientific invariants

- Repository execution establishes only that the selected source ran under the
  recorded contract. It does not establish correctness, reproducibility on
  other systems, superiority, or equivalence to a paper.
- Reported energy, error, fidelity, CNOT, depth, parameter, optimizer, shot, and
  timing values must carry their measurement/resource protocol identifiers.
- Provider-native resource values are not compared unless both observations
  resolve to the same canonical logical protocol.
- A source result cannot self-certify its expected value. Reference values and
  cheap invariants come from an independent verifier or reviewed fixture.
- Unknown or unavailable metrics remain `unknown`; they are never inferred as
  zero.
- Source, runtime, input, environment, seed, package inventory, and failure
  taxonomy are retained with each observation.

## 5. Rights invariants

- A detected SPDX string is metadata, not legal approval.
- Unknown, conflicting, non-redistributable, or review-required rights block
  execution/materialization according to the approved policy.
- No paper text, figure, proprietary dataset, model weight, or repository asset
  is redistributed without a recorded basis.
- Source retrieval, internal analysis, execution, artifact retention, and public
  redistribution are separate decisions.

## 6. Step-by-step execution plan

### S0 — Owner security decision

Deliverables:

- accept, amend, or reject ADR-0017;
- name the security owner and operational owner;
- approve the initial connector, quarantine provider, sandbox class, exact
  limits, retention window, and incident path;
- record whether Phase 10 is a private research pilot or a product capability.

Exit gate: a dated owner decision exists. Until then all later stages remain
design/test work with external execution disabled.

### S1 — Threat model and abuse cases

Model assets, trust boundaries, actors, and attacks for:

- SSRF, DNS rebinding, redirect chains, metadata endpoints, IPv4/IPv6 parsing;
- zip/tar bombs, path traversal, absolute paths, symlinks/hardlinks, device
  files, FIFO/socket files, nested archives, Unicode/path collisions;
- submodules, Git LFS pointers, Git hooks, notebook output, build scripts;
- fork bombs, memory bombs, disk fill, output floods, timeout evasion;
- host escape, kernel/syscall attacks, daemon/socket access;
- secret and environment discovery;
- forged `RESULT`, reused evidence, digest substitution, metric spoofing;
- license/provenance laundering and public-claim escalation.

Exit gate: every high-severity threat has a preventive control, detection,
failure code, test, and accountable owner. Uncontrolled high-severity threats
block Phase 10.

### S2 — Acquisition-only connector

Implement one connector first: immutable GitHub commit + individually selected
bounded files. Keep repository clone, archive download, redirects, submodules,
and LFS disabled.

Required controls:

- server-built `https` requests to a fixed host/operation allowlist;
- validated and pinned DNS result with private/link-local/loopback/multicast and
  metadata destinations rejected for every A/AAAA answer;
- no user-supplied headers, proxy, base URL, port, or credentials;
- strict per-file, total-byte, file-count, timeout, retry, and rate limits;
- retrieval manifest containing immutable ref, selected path, media type,
  length, SHA-256, fetcher version, policy version, and timestamp;
- logs redact credentials, signed URLs, query values, and source contents.

Implemented offline preflight contracts:

- `phase10_destination_policy` validates a complete, bounded A/AAAA answer set
  and later peer membership without performing DNS or socket I/O;
- `phase10_acquisition_contract` accepts only a known repository identity,
  immutable commit, and canonical selected paths; it fixes the connector,
  operation, `api.github.com:443` destination, policy, and canonical request
  digest, then binds the request to short-lived destination evidence;
- `phase10_github_request_plan` compiles only fixed GitHub Contents API `GET`
  operations with exact-commit `ref`, segment-wise path encoding, object JSON,
  API version, identity encoding, no redirects, and a bounded response;
- `phase10_github_response` validates already-read object JSON as one exact,
  ordinary, bounded UTF-8 selected file and never follows returned links;
- `phase10_acquisition_result` requires one validated response per selected
  operation and binds response, file, plan, manifest, and destination-window
  evidence without retaining source bytes;
- `phase10_retrieval_manifest` records bounded UTF-8 file evidence and verifies
  the exact repository, commit, selected path set, byte length, and SHA-256;
- no contract accepts a URL, header, credential, proxy, redirect, command,
  entrypoint, parser, import action, publication action, or execution action.

These contracts do not authorize or perform live acquisition. The future
transport must still prove DNS-to-peer pinning with the fixed TLS identity,
one-time job/replay state, credential separation, redacted logging, and
quarantine delivery.

Exit gate: adversarial network tests pass and the connector cannot execute or
publish.

### S3 — Private content-addressed quarantine

Store fetched bytes outside Postgres and outside the application filesystem.

Offline preflight now exists in `phase10_quarantine_contract`: it derives
workspace-scoped opaque locators and internal object keys from selected-file
SHA-256 values, binds them to the complete acquisition-result digest, and
verifies already-read bytes by length and digest. It performs no storage I/O
and does not select or configure a provider. See
`PHASE10_S3_QUARANTINE_PREFLIGHT.md`.

Required controls:

- private bucket/object store, public access prevention, encryption, retention,
  lifecycle deletion, versioning/immutability policy as approved;
- object key derived from SHA-256, with digest rechecked on write and read;
- Postgres stores the retrieval manifest and opaque object locator, not a public
  URL or credential;
- workspace/import ownership, legal hold, deletion state, and audit event;
- malformed or partial writes are unreachable by parser/executor.

Exit gate: byte-for-byte round trip, tamper detection, cleanup, retention, and
cross-workspace denial tests pass.

### S4 — Fetcher identity and deployment separation

Deploy the fetcher with a dedicated workload identity.

An offline, provider-neutral preflight now exists in
`phase10_fetcher_identity_contract`. It fixes the fetcher's three permitted
capabilities and three destination classes, requires distinct digest-only
references for every sensitive peer identity, and rejects secret environment
bindings or mounted control-plane paths. It performs no deployment or IAM I/O
and is not live qualification evidence. See
`PHASE10_S4_FETCHER_IDENTITY_PREFLIGHT.md`.

It may have:

- allowlisted outbound source access;
- write-only quarantine upload where feasible;
- job status update capability through a narrow authenticated interface.

It must not have:

- application/Neon/Cloud SQL credentials;
- WorkOS, QPU, LLM, GitHub write, signing, registry push, or publication keys;
- executor or Docker/Kubernetes control-plane access.

Exit gate: credential inventory and live negative tests prove forbidden
credentials/routes are absent.

### S5 — Bounded source normalizer

Convert selected files into a canonical read-only manifest without executing
source.

An offline initial-release contract now exists in
`phase10_source_normalizer`. It accepts only an exact S3 selected-file set,
rechecks the quarantine byte identity, rejects archives, Git LFS pointers,
common credential-file names, BOMs, and unsafe control bytes, and emits a
digest-only read-only manifest without materializing source. See
`PHASE10_S5_SOURCE_NORMALIZER_PREFLIGHT.md`.

Initial release rejects archives. If archive support is later approved, it must
pre-scan and reject traversal, links, special files, nested archives, excessive
ratio/count/depth/path length, conflicting normalized paths, and partial
cleanup failures before materialization.

Exit gate: normalized output is deterministic and every rejected item retains a
stable failure code and evidence.

### S6 — Static manifest and entrypoint review

Deterministically extract metadata only. Produce a candidate execution
manifest containing:

- selected source files/digests;
- candidate language/framework and package evidence;
- requested entrypoint as data;
- required input/output schema;
- license/provenance status;
- proposed prebuilt runtime profile.

An offline structured-only contract now exists in
`phase10_static_candidate`. It binds selected-file digests, explicit evidence
paths, a requested Python entrypoint as data, rights/provenance states, and a
fixed Atlas-owned framework-to-runtime candidate mapping. Candidate commands,
arguments, package installation and execution are not accepted. Every output
remains `structured_only`; see
`PHASE10_S6_STATIC_CANDIDATE_PREFLIGHT.md`.

No candidate-supplied command is executed. An approved mapping—not source
contents—selects the runtime and fixed launcher.

Exit gate: unsupported command, path, package, version, native extension,
network need, or unknown entrypoint remains `structured_only`.

### S7 — Execution policy and qualification identity

Define a versioned policy object and its SHA-256. It includes:

- runtime OCI index digest and required `linux/amd64` platform;
- fixed launcher/arguments and allowed file roots;
- CPU, memory, PID, disk, file, wall-time, output and result-schema limits;
- network and credential policy;
- deterministic seed and locale/timezone controls where applicable;
- source/input/result binding requirements;
- failure taxonomy and retry policy.

An offline fail-closed contract now exists in `phase10_execution_policy`.  It
canonically binds a digest-only OCI index reference, required `linux/amd64`
platform, fixed Atlas launcher/protocol surface, proposed sandbox class, the
complete limit set, deny-all network/no-credential policies, deterministic
controls, binding rules, failure taxonomy and retry policy.  It also derives a
source-specific qualification-identity candidate from the exact repository
commit, S2/S5/S6 evidence and policy digest.  Both objects remain explicitly
`unqualified`; the client selection schema exposes no individual enforcement
parameter.  See `PHASE10_S7_EXECUTION_POLICY_PREFLIGHT.md`.

Exit gate: clients can choose only an approved qualification identity, never
individual enforcement parameters.

### S8 — Hardened ephemeral executor

Implement a dedicated executor separate from the fetcher and API. The preferred
production isolation class must be chosen during S0/S1 (for example a reviewed
gVisor-based workload boundary or an equivalently qualified service).

Minimum live proof:

- digest and platform verified before start; no runtime pull during execution;
- deny-all egress independently probed for IPv4, IPv6, DNS, Unix sockets, and
  metadata endpoints;
- non-root UID/GID, read-only root, dropped capabilities,
  `no-new-privileges`, no host mounts/socket, bounded scratch;
- no inherited environment except an exact allowlist;
- graceful timeout followed by forced termination and cleanup;
- stdout/stderr and result captured separately with hard byte limits.

An offline observation contract now exists in `phase10_executor_probe`.  It
requires an exact ordered result for every runtime, network, identity,
filesystem, privilege, mount, environment, resource, timeout, cleanup and
output probe; binds those results to the S7 identity/policy/runtime and a unique
attempt; and rejects missing, duplicate, reordered, generic or integrity-invalid
evidence.  A completely passing observation still remains `unqualified`; see
`PHASE10_S8_EXECUTOR_PROBE_PREFLIGHT.md`.

Exit gate: hostile corpus passes on the exact deployment class. Docker Desktop
or an unrestricted shared Docker daemon is not production qualification.

### S9 — Independent result verifier

Treat source output as hostile. The verifier runs outside the source sandbox and
accepts only a bounded schema.

It must:

- bind source manifest, workflow, component configuration, runtime, policy,
  seed/input, observation, and result digests;
- reject NaN/Inf, duplicate keys, ambiguous units, missing protocol IDs,
  out-of-domain values, extra executable content, and oversized structures;
- recompute format-independent fingerprints and cheap scientific invariants;
- distinguish source-reported metrics from Atlas-observed metrics;
- append a verifier observation without mutating source evidence.

Exit gate: forged success/result/metric fixtures cannot become verified or
public evidence.

### S10 — Dedicated hostile repository corpus

Build versioned fixtures for every S1 attack, including benign controls. Run
them on every policy/runtime/executor change.

Required reporting:

- prevention/detection result per fixture;
- stable failure code and stage;
- wall time and resource ceiling;
- absence of network/credential leakage;
- cleanup and retry behavior;
- false-positive/false-negative review.

Exit gate: all required attacks are rejected, benign controls succeed, and no
unexplained nondeterminism remains.

### S11 — Private canary

Run one owner-approved, small, immutable, permissively usable repository with a
reviewed manifest and no dynamic dependencies.

The canary remains:

```text
private
unreviewed or explicitly owner-reviewed
not public evidence
not a performance claim
not general repository compatibility
```

Repeat the exact qualification identity and verify append-only evidence,
idempotency, cancellation, cleanup, and cost ceilings.

Exit gate: the canary succeeds on two clean runs and one intentional failure,
with all evidence and failure semantics preserved.

### S12 — Release audit and owner go/no-go

Produce:

- accepted ADRs and owner decisions;
- threat/control/test matrix;
- runtime image digests, SBOM, signatures/attestations, and vulnerability scan;
- connector/fetcher/quarantine/executor identity inventory;
- hostile-corpus report and private-canary evidence;
- recovery, rotation, retention, incident, and shutdown runbooks;
- explicit residual risks and scientific non-claims.

Possible decisions:

- `NO-GO`: external execution remains disabled;
- `PRIVATE PILOT`: exact approved source qualifications only;
- `LIMITED RELEASE`: allowlisted qualifications only, never arbitrary source;
- `REVISE`: return to a named stage.

There is no automatic transition to public execution.

## 7. Required failure taxonomy additions

At minimum:

```text
source_not_allowlisted
immutable_ref_required
destination_blocked
redirect_rejected
fetch_limit_exceeded
content_digest_mismatch
quarantine_write_failed
quarantine_read_mismatch
rights_unknown
rights_conflict
source_shape_rejected
entrypoint_not_approved
runtime_mapping_missing
runtime_digest_mismatch
runtime_platform_mismatch
network_isolation_failed
credential_isolation_failed
resource_limit_exceeded
execution_timeout
result_schema_invalid
result_binding_mismatch
scientific_invariant_failed
cleanup_failed
```

Unknown failures must remain distinguishable from known scientific failures.

## 8. CI and branch safety

- Phase 10 work stays additive on `feature/vqe`.
- Migrations remain linear after the current single Alembic head.
- Security-sensitive migrations, auth, sandbox, runtime, and publication changes
  require owner/security review.
- Unit tests cannot replace live isolation tests on the selected deployment
  class.
- CI must not fetch or execute untrusted public source by default. Hostile tests
  use checked-in inert fixtures or an explicitly isolated private workflow.
- Test credentials are synthetic and scoped; logs and uploaded evidence are
  redacted and retention-bounded.
- Any failed isolation probe blocks the relevant execution job and cannot be
  waived by changing an expected result.

## 9. Evidence and success metrics

Progress is measured by controls, not repository count:

- percentage of S1 threats with passing preventive/detective tests;
- immutable fetch manifest round-trip and tamper-detection rate;
- hostile corpus rejection and benign-control acceptance;
- cleanup success after timeout/kill/partial write;
- zero forbidden credential/network observations;
- result-binding/verifier rejection coverage;
- reproducibility of the exact private canary qualification;
- number and age of unresolved high-severity residual risks.

## 10. Immediate next action

The S1 design baseline is now recorded in
`PHASE10_S1_THREAT_MODEL.md`, with a machine-checked threat/control/test matrix
at `evidence/phase10/threat_control_matrix_v1.json`. It identifies 26
release-blocking threats, but is **designed, not accepted**: responsible people
have not been named and Phase 10-specific live controls are not qualified.

The S2 constructor-boundary preflight is recorded in
`PHASE10_S2_ACQUISITION_PREFLIGHT.md`. It makes recorded-response mode the
default and requires the existing official-provider metadata scripts to state
their narrow live-network mode explicitly. This does not enable Phase 10 live
acquisition or satisfy the DNS/quarantine/fetcher-identity gates.

The same preflight now includes a pure selected-file retrieval-manifest
contract with canonical SHA-256 evidence, immutable-ref enforcement, strict
text/path/size bounds, and adversarial round-trip tests. The contract performs
no I/O and does not satisfy the S2 network or deployment exit gates by itself.

An offline destination policy also rejects any A/AAAA set containing a
non-global or ambiguous address and binds peer authorization to the canonical
answer set for 60 seconds. It does not perform DNS or socket I/O; connection
pinning and TLS-identity preservation remain unqualified live controls.

Request the S0 owner security decision and review the S1 baseline. Until those
are recorded, only recorded-response acquisition design, inert hostile-fixture
specification, schema, and documentation work may continue. Fetching or
executing external source remains blocked by design.
