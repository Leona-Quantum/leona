# Atlas VQE Phase 7.6 progress

Date: 2026-07-28 JST  
Branch: `feature/vqe`  
Starting commit: `ef62a005479e9a141715406d02e65ecff442c79f`  
Starting Alembic head: `0038`  
State: **S0–S11 implemented and verified at their stated evidence levels; S12
audited NO-GO because the current source and OCI runtimes are not continuously
deployed**

## S0 — Baseline freeze and claim inventory

### Outcome

The pre-remediation Phase 7.5 state is frozen under
`docs/atlas/evidence/phase76/`.

```text
standard component seed candidates: 29
generated implementation bindings: 28
Workflow templates: 7
comparison specifications: 3
```

The 28 bindings are explicitly recorded as a pre-remediation Cartesian
projection, not as 28 independently runtime-qualified Component
implementations.

### Scientific protocol

The first Phase 7.6 comparison is fixed to:

```text
H2 / STO-3G / 0.735 Å / neutral singlet
Jordan–Wigner / four qubits / no tapering
Hartree–Fock |1010> in canonical qubit0-first ordering
one canonical double-excitation parameter
exact statevector energy
canonical ansatz-only CNOT/depth protocol
bounded scalar baseline vs SLSQP candidate
```

Identity evidence:

```text
fixture manifest SHA-256:
  6424713c69c2b734172db47329b7deb62b67a743c80fd792f48173fdaa4e3edc
Hamiltonian legacy digest:
  d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79
canonical circuit SHA-256:
  f4fdb1ac3f041185fff63f6a7acb9d3ab1e9742131ed5bd3bb9ba2d99081a58c
compilation protocol SHA-256:
  778fe0c7f3d361c54e9c41a0240ef31cc7926dacbe8fbc33ff96a57ee104393c
```

### Fresh local observations

Both current locked environments were executed with `--stdout-only`; the
canonical fixture was not mutated.

| Framework | Energy (Ha) | Absolute error (Ha) | Objective evaluations | CNOT | Depth |
|---|---:|---:|---:|---:|---:|
| Qiskit 1.4.6 | -1.137306035753356 | 1.7763568394002505e-14 | 14 | 48 | 83 |
| PennyLane 0.45.1 | -1.137306035753356 | 1.7763568394002505e-14 | 21 | 48 | 83 |

The local host was macOS arm64. These observations confirm the current local
scientific behavior, but do not replace the recorded digest-pinned
Linux/x86_64 runtime qualification.

The different objective-evaluation counts are retained as evidence. They show
that equal final energy and equal optimizer name do not imply equal numerical
work across evaluator implementations. Phase 7.6 therefore treats objective
evaluations as a first-class comparison metric.

### Existing implementation discovered

`majorana_vqe.executable` already contains a strong typed H2 executable schema:

- exact geometry, charge, multiplicity, basis, active electrons and orbitals;
- preparation provider/version and orbital conventions;
- mapping, qubit ordering, reference state;
- generator definition, normalization convention, order, parameter slot and
  canonical circuit digest;
- SciPy bounded optimizer configuration;
- exact measurement and fixed compilation/resource protocol;
- cross-component invariants.

Phase 7.6 S2 must extend and connect this implementation. It must not create a
second competing scientific schema.

### Verification

```text
baseline generator --check: passed
targeted VQE tests: 17 passed
```

Covered tests:

- typed executable Component validation;
- current Qiskit/PennyLane scientific-input equality;
- energy/state/parameter agreement;
- canonical resource equality;
- current standard-catalog behavior.

### S0 decision

S0: **verified_local**

No scientific identity field required by the existing H2 slice is unknown.
S1 may proceed.

## S1 — Claim and provider-attribution remediation

### Outcome

The public seed model now separates four different questions that the former
single `status` field conflated:

```text
Component Definition:
  maturity = draft | structured | reviewed
  catalog_state = active | experimental | deferred

Component Implementation:
  binding_kind
  evidence_level = documented | adapter_tested | runtime_qualified

Workflow:
  status = structured | compatible | executable | executed
```

An executable Workflow no longer implies that every selected role is
implemented by the evaluator provider. Provider attribution is recorded per
role:

- PySCF owns electronic-structure preparation;
- SciPy owns the bounded scalar optimizer;
- Qiskit and PennyLane own their evaluator/circuit bindings;
- fixture snapshots and neutral protocols are explicitly attributed to Atlas.

The pre-remediation Cartesian projection of every executable component onto
both Qiskit and PennyLane has been removed. The generated catalog now contains
17 role-specific bindings with an explicit `binding_kind`; this number is a
descriptive observation, not a success threshold.

The old `controlled_comparisons` public field is now
`comparison_specs`. These records describe a planned one-component change and
must not be interpreted as measured comparison results.

### UI truthfulness

- “verified standard components” was replaced by “structured
  standard-component seed candidates”;
- Component cards show Definition maturity and catalog state separately;
- implementation rows show provider, package version, binding kind, and
  evidence level;
- the execution-provider selector is explicitly restricted to the
  Workflow's supported evaluator providers;
- comparison UI says “comparison specification”.

### Verification

```text
Python standard-catalog tests: 7 passed
Web tests: 101 passed
TypeScript: no errors
Web lint/token checks: passed
generated catalog --check: passed
git diff --check: passed
```

### S1 decision

S1: **verified_local**

The catalog no longer makes cross-provider ownership claims or presents a
comparison design as a measured result. S2 may connect the catalog selection
model to the existing typed executable schema.

## S2 — Typed H₂ scientific identity bridge

### Outcome

The existing `majorana_vqe.executable` v0.2 models remain authoritative. No
parallel Problem/Ansatz/Optimizer schema was introduced.

An additive `ExecutableH2ScientificIdentity` envelope now connects:

```text
standard Component semantic selections
→ existing typed executable Component payloads
→ provider-neutral Component content digests
→ portable Workflow semantic digest
→ canonical Hamiltonian digest
```

The bridge fails closed on missing, duplicate, unknown, or role-mismatched
legacy seed selections. It does not fill missing scientific values with
defaults.

`provider` and `provider_version` are projected out of preparation and
optimizer scientific payloads before hashing. Algorithm, bounds, tolerance,
budget, geometry, ordering, generator semantics, measurement protocol, and
compilation metric protocol remain digest-relevant. The selected runtime and
package versions remain the responsibility of the later Implementation Plan.

### Golden evidence

The deterministic generator writes:

`docs/atlas/evidence/phase76/h2_baseline_scientific_identity_v0.1.json`

It includes all 14 roles in the current executable H₂ slice, the canonical
Hamiltonian digest, the exact reference energy bytes, each scientific
Component digest, the Workflow semantic digest, and the enclosing identity
digest. Its review state is explicitly
`machine_validated_not_independent_human_reviewed`.

### Verification

```text
executable/portable/catalog tests: 25 passed
identity generator --check: passed
git diff --check: passed
```

Negative coverage includes:

- unknown fields;
- missing execution roles;
- role/payload mismatch;
- qubit/occupation mismatch;
- generator-slot mismatch;
- unsupported semantic-key substitutions.

Digest coverage confirms field-order independence, sensitivity to semantic
budget changes, and independence from provider version metadata.

### S2 decision

S2: **verified_local**

The current H₂ baseline is now reachable from catalog selections through one
typed, canonical scientific identity path. S3 may add role applicability and
server-authoritative compatibility without replacing this identity model.

## S3 — Role applicability and Compatibility v2

### Outcome

Compatibility contract `2.0.0` introduces:

- explicit `required`, `optional`, `not_applicable`, and `forbidden` role
  applicability;
- typed `{name, value}` contract ports in generated data;
- distinct fail-closed reason codes for missing roles, unknown Components,
  role/type mismatch, missing ports, and Components present on inapplicable
  roles;
- a configuration migration report that separates migrated and dropped
  fields and requires explicit acceptance when any field would be dropped.

UCCSD and hardware-efficient fixed-Ansatz templates now mark Operator Pool,
Search, and Growth as `not_applicable` with no selected Component. ADAPT keeps
those roles `required`. This removes the former misleading implication that
all fixed Ansatz workflows use an adaptive growth loop.

The former “fixed excitation versus UCCSD” comparison specification was
removed because correcting role applicability reveals that it changes four
roles, not one. The remaining specifications still satisfy the exact
one-Component-difference invariant.

The H₂ UCCSD seed remains incompatible, honestly, because its inherited
one-parameter bounded-scalar optimizer requires `parameters:1` while UCCSD
does not provide that contract. No default optimizer was invented.

### Client/server parity boundary

The generated bundle carries the Python compatibility-v2 result. The browser
recomputes the same deterministic preview and tests assert equal issues for
the fixed-Ansatz fixture. This remains a UI explanation layer; a later API
write path must recompute compatibility server-side before persistence or
execution.

### Verification

```text
Python executable/portable/catalog tests: 28 passed
Web tests: 102 passed
TypeScript: no errors
catalog and identity generators --check: passed
immutable S0 evidence generator --check: passed
Web lint/token checks: passed
git diff --check: passed
```

### S3 decision

S3: **verified_local**

No structured-only workflow was promoted to executable. S4 may now resolve
role-specific Implementation bindings into a server-owned Executable Plan.

## S4 — Role-specific Implementation Plan resolver

### Outcome

`majorana_vqe.executable_plan` now resolves a compatible Workflow into one
server-owned plan containing the exact binding selected for every applicable
role. The resolver accepts only an evaluator preference (`qiskit` or
`pennylane`); it does not accept client-selected package versions, runtime
profiles, adapters, or container identities.

For both evaluator choices, the baseline resolves as:

```text
Problem preparation → PySCF
Optimizer           → SciPy
neutral protocols   → Atlas
Reference/Ansatz/
Measurement         → selected evaluator
```

Evaluator roles must resolve to one coherent runtime profile and adapter
release. Missing, ambiguous, incompatible, insufficient-evidence, and
incoherent-runtime cases fail closed with distinct codes.

Implementation bindings now also expose their supported configuration field
subset and known incompatibilities. The SLSQP binding is recorded only as
`documented` with `no_runtime_qualified_phase76_adapter`; attempting to
resolve it currently fails with `insufficient_binding_evidence`. This is an
intentional safety gate, not an implementation claim. S6 must replace that
state only after the adapter and runtime tests exist.

### Verification

```text
Executable Plan + catalog tests: 14 passed
Web tests: 102 passed
TypeScript: no errors
generated catalog refreshed
```

The tests prove Qiskit/PennyLane are not attributed ownership of PySCF or
SciPy roles, and inject a duplicate binding to verify ambiguity is rejected.

### S4 decision

S4: **verified_local_with_expected_candidate_block**

The resolver infrastructure is safe for the qualified baseline. Candidate
execution remains unavailable until S6. S5 may implement immutable swapped
Workflow persistence while preserving that execution block.

## S5 — Immutable swapped Workflow draft

### Outcome

A scoped `POST /v1/atlas/workflows/swaps` write path now accepts only the
bounded owner choices for the first slice:

- baseline Workflow ArtifactVersion;
- the fixed baseline template key;
- `parameter_optimizer` as the only changed role;
- `optimizer.slsqp.v1` plus its expected content digest;
- bounded configuration values;
- Qiskit or PennyLane as evaluator preference;
- an HTTP idempotency key.

The repository boundary re-resolves the baseline, template, Component
Definition, candidate Component ArtifactVersion, compatibility-v2 report, and
Registry links. Clients cannot submit Registry UUIDs for leaf Components,
package versions, runtime profiles, adapter releases, or container digests.

The saved object is a private Artifact plus immutable ArtifactVersion and
`vqe_workflow_components` links. A deterministic workspace-scoped slug and a
canonical request digest make same-key/same-request replay return the existing
version; same-key/different-request returns an idempotency conflict.

The draft is explicitly stored as:

```text
machine_validation_state = unvalidated
execution_status = blocked_until_runtime_qualified
publication = blocked
scientific_release = blocked
```

It is not yet promoted to an executable scientific experiment. S6 must add
the typed SLSQP Component and qualified adapter before a new executable
Workflow version can be created.

### Verification

```text
API route + plan tests: 19 passed
Ruff: passed
git diff --check: passed
```

Route tests verify the request cannot inject runtime or package authority.
PostgreSQL replay, uniqueness, and cross-workspace behavior remain assigned
to S11 Neon verification; no database claim is made from mock tests.

### S5 decision

S5: **verified_local_db_pending**

The structured candidate can be persisted without reusing the baseline
Registry key and without overstating executability. S6 may implement and
qualify the SLSQP scientific/adapter slice.

## Current safety boundary

- No public publication.
- No verified scientific badge.
- No production/main Neon migration.
- No external Repository code execution.
- No new Component catalog expansion.
- Evidence is additive and the canonical H2 fixture remains unchanged.

## S6 — Shared bounded SLSQP adapter

Both H2 evaluator scripts now delegate optimization policy to one shared
adapter. It fixes the initial point, bounds, energy tolerance, iteration and
objective-call caps, wall-time cap, and finite-value checks. The canonical
fixture was not modified. New observations live only under
`docs/atlas/evidence/phase76/`.

The SLSQP Definition is `experimental` and its SciPy binding is
`adapter_tested`; it is deliberately not `runtime_qualified`.

```text
                         bounded calls    SLSQP calls
Qiskit                        14               8
PennyLane                     21               8

SLSQP absolute error:
Qiskit      4.13e-14 Ha
PennyLane   2.89e-14 Ha

Every run: 1 parameter, 48 CNOT, depth 83
```

This is local evidence of lower optimizer work for one fixed H2 instance. It
is not a circuit-resource or generalization claim. The scientific-identity
test proves only `parameter_optimizer` changes.

```text
majorana-vqe tests: 194 passed
shared optimizer tests: 7 passed
Ruff: passed
frozen H2 fixture diff: empty
```

A lost `math` import was detected as a structured failed run and repaired
before accepting evidence.

S6: **adapter_tested_runtime_qualification_pending**

S7 must run this exact source in the digest-pinned Linux/x86_64 Qiskit
runtime before executable promotion.

## S7 — Qiskit Linux/amd64 vertical execution

The Qiskit image was rebuilt from commit
`52a2ed9a68066201894ff001724b71ee325732b9` for `linux/amd64`. Both baseline
and SLSQP ran with no network, read-only root, non-root UID, all capabilities
dropped, no-new-privileges, and bounded CPU, memory, PID, output, and time.

```text
Qiskit / Linux amd64
bounded: 13 objective calls, |error| 1.82e-14 Ha
SLSQP:    8 objective calls, |error| 2.09e-14 Ha
both:     1 parameter, 48 CNOT, depth 83
```

The worker now derives the optimizer command from the server-owned portable
scientific selection. It rejects a runtime report whose optimizer algorithm
does not match that selection; the client cannot inject the command.

The local Buildx manifest digest is
`sha256:29502979903012722d9af45b3b361710c4e1e470693c27c5d7bbbf243c0831fd`.
This is reproducible local OCI evidence, but it is not a pushed registry
manifest. Therefore global `runtime_qualified` promotion remains pending.

```text
worker runtime/handler tests: 46 passed
Ruff: passed
mypy: unavailable in the locked root tool environment (no claim)
```

The first container build also exposed an incorrect Docker COPY path for the
shared adapter. The build failed before execution; the path was corrected and
the image rebuilt.

S7: **linux_adapter_verified_registry_digest_pending**

## S8 — Immutable ControlledComparison plan/result persistence

Migration `0039` adds two separate append-only entities:

```text
vqe_controlled_comparison_specs
vqe_controlled_comparison_runs
```

A Spec records the immutable Workflow pair, the single changed role, the
server-verified fixed component digests, both configurations, and metric and
budget protocol digests. It contains no result fields. A Run references two
existing scoped executions and records observations plus an invariant audit.

The repository re-reads both Workflow component graphs and rejects a request
unless exactly `parameter_optimizer` differs. It also verifies each execution
belongs to the corresponding Workflow before appending a result. Thus clients
cannot label an uncontrolled pair as controlled by supplying hashes.

Statuses are distinct:

```text
planned / running / comparable / comparability_failed / inconclusive / failed
```

`comparable` requires every invariant to pass. `comparability_failed` requires
both a failed invariant and an explicit reason. PostgreSQL triggers and
privilege revocation reject UPDATE/DELETE; downgrade refuses to discard
existing evidence.

```text
focused domain/API/migration tests: 19 passed
Ruff: passed
Alembic: one head at 0039
```

S8: **verified_local_db_replay_pending**

Actual PostgreSQL append-only, tenant isolation, concurrent idempotency, and
up/down/up behavior remain assigned to S11.

## S9 — PennyLane Linux/amd64 replication

The same fixed Hamiltonian, canonical circuit, parameter orientation,
optimizer policy, and hard budget were executed in the PennyLane
Linux/amd64 image.

```text
                     bounded calls    SLSQP calls
Qiskit                    13               8
PennyLane                 14               8

SLSQP energy delta across evaluators: 0.0 Ha
bounded energy delta: 8.88e-16 Ha
pre-fixed agreement tolerance: 1e-12 Ha
all runs: 1 parameter, 48 CNOT, depth 83
```

The one-call baseline difference is retained rather than averaged away. It
reflects framework/platform numerical termination behavior and illustrates
why objective work must be reported with the evaluator binding.

The PennyLane local OCI manifest digest is
`sha256:a71211a3a70757f625cd5708bbb60fb7f86e2c0fb5638f5570162c35eafeb603`.
As in S7, it has not been pushed to a registry, so public/runtime promotion
remains blocked.

S9: **replicated_linux_registry_digest_pending**

## S10 — Component swap compose, private save, and reopen

The component-first browser now distinguishes the compatibility verdict from
the Workflow lifecycle label. This fixes a pre-existing duplicate translation
key where `compatible` silently meant two different things.

For the one permitted Phase 7.6 change, the UI now supports:

```text
H2 fixed-excitation baseline
  -> replace parameter_optimizer with optimizer.slsqp.v1
  -> display the single changed role
  -> re-check compatibility in the browser
  -> resolve the pinned SLSQP Definition from the authenticated Registry
  -> ask the server to validate and save a private Workflow ArtifactVersion
  -> reopen that immutable Workflow by Registry UUID
```

The server remains authoritative for the Definition digest, baseline
composition, configuration migration, compatibility, and new Workflow
identity. The browser cannot supply a runtime image or mark the candidate
executable.

The candidate is explicitly shown as:

```text
definition: experimental
adapter: tested with Linux evidence
visibility: private
execution: blocked_until_runtime_qualified
```

No experiment or Comparison Run is created from this draft. That is deliberate:
the local Linux OCI evidence from S7/S9 is not a pushed registry qualification.
The UI therefore saves and reopens the scientific draft while keeping the Run
button disabled. Comparison persistence from S8 becomes usable only after two
qualified executions exist.

Production build testing detected and fixed a separate nullable-role bug:
duplicate `not_applicable` roles previously passed a null Component key into a
non-null error record. The error now uses an explicit role marker and has a
regression test.

```text
web tests: 103 passed
web lint/token checks: passed
Next production build: passed, 336 routes
new authenticated routes:
  /api/atlas/components
  /api/atlas/workflows/swaps
```

S10: **private_compose_save_reopen_verified_execution_blocked_by_design**

## S11 — Neon materialization, migration, and concurrency

The owner-configured disposable Neon development branch was at migration
`0035`. Before inserting Phase 7.6 records, PostgreSQL 17.10 completed:

```text
0035 -> 0039 -> 0038 -> 0039
```

An operator-only materializer now persists the authored standard catalog
through scoped repositories. It does not use raw SQL, publish records, set
human review, or set machine-validation/runtime claims. A required
`--confirm-disposable` flag and `MAJORANA_ENV=production` refusal guard the
operator entry point.

```text
first pass:  29 Component Definitions created, 7 Workflow seeds created
second pass: 29 Component Definitions reused,  7 Workflow seeds reused
catalog digest:
  1ae9a4eb41bd8b8af5b1c6d73b18330d6bf19e41cba847d27bf79279fa21d188
```

Every record is private, unreviewed, and unvalidated. Reuse verifies immutable
ArtifactVersion fingerprint, semantic key, role, normalized spec digest, and
Workflow composition. Drift stops the import rather than creating a silent
replacement.

Live Neon validation:

```text
existing VQE repository invariants: 10 passed
Phase 7.6 materialization/comparison: 2 passed
up/down/up before evidence: passed
downgrade after comparison evidence: rejected; head remained 0039
import-linter contracts: 4 kept
raw-query gate: clean
```

The live run exposed an inherited concurrency bug in `bind_execution_run`:
the losing transaction expired an ORM instance and then read its ID, causing
async `MissingGreenlet`. It now re-reads with the immutable function argument.
The comparison idempotency path was also closed with a savepoint and
unique-winner re-read. Both race paths pass against Neon.

Full structured evidence:
`docs/atlas/evidence/phase76/s11_neon_validation.json`.

S11: **verified_neon_private_unreviewed**

## S12 — Authenticated full E2E and Phase close audit

The mandatory continuous flow was audited against the exact source/runtime
identity required by the plan:

```text
WorkOS Staging
→ Vercel Web
→ Cloud Run API
→ Neon
→ durable worker
→ registry digest-pinned Qiskit/PennyLane runtimes
→ Comparison Run
→ logout/login reopen
```

It is **not complete** for the current Phase 7.6 source. The previously recorded
live control-plane proof uses Vercel source commit
`e4e0f8fce8093c7f25663f5654be4c8142cd482b` and Cloud Run revision
`majorana-api-vqe-test-00003-ttr`. Phase 7.6 source is newer and remained local
during this audit. Its Qiskit and PennyLane Linux images have local manifest
digests, but neither was promoted to an approved OCI registry. Consequently:

- the current Composer/save path was not represented as live deployed;
- the worker could not server-resolve an approved registry digest;
- baseline/candidate executions and a Comparison Run were not created through
  one authenticated live session;
- logout/login Comparison reopening was not claimed.

This is an external-promotion boundary, not a reason to weaken runtime
qualification or silently reuse historical deployment evidence. No code was
pushed or deployment mutated during S12.

### S12 verification and faults found

```text
full Python suite: 1211 passed, 87 skipped
web tests: 103 passed
web lint and TypeScript: passed
Next production build: passed, 336 routes
rollback/fail-closed tests: 2 passed
catalog generation --check: passed after regeneration
```

The full suite exposed two stale worker fixtures that omitted the newly
required Optimizer binding. The fixtures now state the Optimizer explicitly;
the runtime contract was not relaxed to an implicit default.

Catalog generation also detected stale SLSQP lifecycle evidence in the checked
bundle. It now records:

```text
Definition: experimental / draft
implementation evidence: adapter_tested
runtime incompatibility: no_runtime_qualified_phase76_adapter
```

The rollback drill confirmed that production execution remains fail-closed
without the production gate and that the development bypass cannot enable a
production VQE execution.

### Phase close decision

**NO-GO for Phase 7.6 live closure and for scientific performance claims.**
S0–S11 artifacts remain valid only at their explicitly stated evidence levels.
The following operator-controlled actions are required before reassessment:

1. explicitly approve and push the current `feature/vqe` source;
2. publish Qiskit and PennyLane images and record registry manifest digests;
3. attach provenance/attestations and qualify the exact implementation
   bindings;
4. deploy the matching Web/API source and a durable worker host;
5. execute both baseline/candidate pairs and persist raw observations;
6. persist the Comparison Run, log out/in, and reopen it under the same
   workspace scope.

Structured evidence:
`docs/atlas/evidence/phase76/s12_phase_close_audit.json`.

S12: **audited_no_go_external_promotion_required**

## S12 reassessment — private disposable staging execution

The operator subsequently approved the previously blocked private-staging
promotion work. The exact `feature/vqe` source was pushed, both Linux/amd64
runtime images were published by OCI index digest, the matching API was
deployed to an isolated Cloud Run test service, and a disposable Neon branch
was migrated to `0039`.

The authenticated private flow then produced:

```text
baseline Workflow
→ Qiskit and PennyLane executions
→ SLSQP-only Workflow swap
→ Qiskit and PennyLane candidate executions
→ two comparable ControlledComparison Runs
→ four private, non-exportable evidence Artifacts
```

Both Comparison Runs passed all 13 server-derived invariants. The fixed
resource protocol produced 48 CNOT, depth 83, and one parameter for every
execution. The candidate used four objective evaluations in both evaluators;
the bounded baseline used 13 for Qiskit and 14 for PennyLane. This is a
single-instance observation and is not evidence of general SLSQP superiority.

### Faults found during the live flow

1. Authenticated comparison routes were absent from the narrow Web proxy
   allowlist. Commit `86eb62f` added only create/read/run comparison routes;
   list, delete, and publication routes remain blocked.
2. A client could previously describe an optimizer configuration field that
   did not exist in the immutable optimizer Definition. Commit `828773e`
   binds concrete comparison claims to the immutable optimizer spec and
   rejects unknown or mismatched fields.
3. One pre-fix invalid comparison Spec was append-only persisted on the
   disposable branch. It has no Runs, Artifacts, or publication state. It is
   retained in the staging evidence record and removed only with the whole
   disposable branch.

The correct negative Workflow swap and the post-fix invalid comparison both
returned HTTP 422 without creating a new Workflow or Comparison Spec.

### Authentication boundary

Logout was observed: a subsequent `/api/me` request redirected to WorkOS
Staging. A login under a distinct WorkOS identity received an isolated
workspace and a 404 when reading the private comparison, proving negative
tenant isolation.

The intended same-workspace login/reopen was **not observed**. Although the
operator selected the intended Gmail identity, the authentication result
repeatedly resolved to a distinct WorkOS user. Repeating the same operator
action was stopped. Database durability and pre-logout comparison reads were
verified, but they do not substitute for the missing same-workspace
post-login observation.

Structured evidence:
`docs/atlas/evidence/phase76/s12_private_staging_e2e.json`.

S12 reassessment:
**partial_pass_private_staging; same_workspace_login_reopen_not_verified**.

Public MVP and scientific performance claims remain **NO-GO**.
