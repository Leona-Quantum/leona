# Atlas VQE Phase 7.6 progress

Date: 2026-07-28 JST  
Branch: `feature/vqe`  
Starting commit: `ef62a005479e9a141715406d02e65ecff442c79f`  
Starting Alembic head: `0038`  
State: **S0–S4 verified locally; S5 pending**

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

## Current safety boundary

- No public publication.
- No verified scientific badge.
- No production/main Neon migration.
- No external Repository code execution.
- No new Component catalog expansion.
- Evidence is additive and the canonical H2 fixture remains unchanged.
