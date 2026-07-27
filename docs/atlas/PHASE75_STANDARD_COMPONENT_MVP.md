# Atlas VQE Phase 7.5 — Standard Component MVP

Date: 2026-07-27 JST  
Branch: `feature/vqe`  
Authority: ADR-0033  
State: **S0-S5 implemented and locally verified; live Registry/Neon E2E and
public publication remain operator-gated**

## 1. Objective

Researchers browse standard VQE components by scientific role, compose a
versioned Workflow, receive a deterministic compatibility result, replace one
component under controlled conditions, and execute only combinations with a
qualified provider binding.

Papers and repositories are provenance/evidence. They are not primary browse
entities.

## 2. Non-negotiable identity model

```text
Component Definition
  scientific meaning and semantic version

Component Implementation
  provider package, version, source snapshot, capability, runtime, evidence

Component Configuration
  experiment-local bounded parameter values

Workflow Template
  immutable versioned component-role bindings

Workflow Instance
  template plus validated configurations
```

An external Python class or README phrase cannot serve as a Component
Definition. A paper annotation is a `ComponentMention` until matched to an
existing definition or reviewed as a new candidate.

## 3. UI grouping over the existing internal enum

| UI group | Internal types |
|---|---|
| Problems & Datasets | `problem`, `problem_preparation` and dataset metadata |
| Representation | `representation` plus active-space/tapering configuration |
| States & Ansätze | `reference_state`, `ansatz` |
| Operator Pools | `operator_pool` |
| Search & Growth | `search_selection`, `growth_batching` |
| Optimizers | `parameter_optimizer` |
| Compression | `compression` |
| Measurement | `measurement`, `error_mitigation` |
| Evaluation & Execution | `evaluation_protocol`, `stopping_protocol`, `compilation_backend` |

The database enum is not widened merely to create UI labels.

## 4. Slices

### 7.5-S0 — Product contracts

- ADR-0033 accepted.
- Fix Definition / Implementation / Configuration / Compatibility / Workflow
  terminology.
- Keep identity on `ArtifactVersion`.
- Define compatibility reason codes and controlled-comparison invariants.
- Explicitly separate documented, structured, executable, and qualified.

Done when contract fixtures reject unknown fields, provider-class identity,
ambiguous version ranges, and comparisons that change zero or multiple
components.

### 7.5-S1 — Canonical seed

Seed a bounded standard catalog from official provider documentation and
neutral Atlas protocols. The current seed contains 29 definitions; future
growth still requires explicit Owner review. Minimum initial set:

- H2/STO-3G and LiH/STO-3G problems;
- Jordan–Wigner, Parity, Bravyi–Kitaev;
- Hartree–Fock, UCCSD, hardware-efficient RY–CX;
- UCCSD singles/doubles and generalized singles/doubles pools;
- fixed/no-search and gradient top-1/standard ADAPT growth;
- SLSQP and COBYLA;
- no compression;
- exact statevector and no mitigation;
- energy convergence, chemical-accuracy/reference evaluation, maximum
  iteration, and canonical logical resource protocol.

HamLib entries start as structured benchmark problems unless an approved
adapter and exact fixture make them executable.

Done when every seed has a semantic definition, schema version, immutable
digest, status, source/evidence locator, and explicit unknowns.

### 7.5-S2 — Provider bindings

Initial providers:

- Qiskit/Qiskit Nature/Qiskit Algorithms;
- PennyLane;
- OpenFermion as canonical operator/chemistry adapter;
- HamLib as Problem/Dataset provider;
- Atlas neutral execution/metric protocols.

Each binding fixes package, exact version, capability, source commit/release,
runtime profile, evidence level, and supported configuration subset. Official
documentation yields `documented`, not `executed`.

Done when at least 12 bindings are executable and one core Workflow is
qualified in both Qiskit and PennyLane.

### 7.5-S3 — Component-first UI

- Remove Papers, Repositories, and Comparisons primary tabs.
- Page title is `VQE Methods`.
- Add nine component-group selectors.
- Render canonical Component cards and implementation/source details.
- Add Current Workflow panel/drawer and deterministic compatibility result.
- Rename the primary action to `Build a VQE Workflow`.
- Preserve legacy paper/repository detail routes only as evidence links.

Mobile order: Component Type → Component List → Current Workflow drawer.

### 7.5-S4 — Workflow templates

Minimum:

1. H2 UCCSD VQE;
2. H2 hardware-efficient VQE;
3. H2 standard ADAPT-VQE;
4. LiH UCCSD VQE.

Unavailable combinations remain visible as `structured_only` with exact
blocking reason; they are never silently marked executable.

### 7.5-S5 — Controlled comparison

Minimum comparisons:

1. fixed-excitation vs UCCSD ansatz;
2. SLSQP vs COBYLA;
3. UCCSD vs hardware-efficient ansatz.

A comparison is controlled only when exactly one declared component binding
changes and the Problem, representation, other components, configuration,
measurement, evaluation, runtime metric protocol, and budget remain fixed.

`fixed ansatz vs standard ADAPT` is intentionally not labelled controlled in
this MVP: standard ADAPT changes both `search_selection` and
`growth_batching`. Calling it a one-component comparison would be
scientifically false unless those two roles were first defined and reviewed as
one composite component.

## 5.1 Current implementation result

```text
canonical Component Definitions: 29
executable provider bindings: 28
Workflow templates: 7
Problems/Datasets: 4
controlled one-component comparisons: 3
qualified core Workflow providers: Qiskit 1.4.6 and PennyLane 0.45.1
```

Only `H₂ fixed-excitation VQE` is marked executable. UCCSD,
hardware-efficient, ADAPT, LiH, SLSQP, and COBYLA templates remain
`structured` until their exact adapters and runtime evidence are qualified.

The component-first UI now:

- exposes the nine research-facing groups;
- separates catalog provider filtering from execution-provider selection;
- recomputes compatibility client-side from the generated canonical bundle;
- reports exactly which role changed;
- disables Studio execution after an incompatible or unregistered swap;
- resolves the executable template's Registry semantic key to a Registry UUID
  before experiment creation;
- carries the selected Qiskit/PennyLane framework into the execution evidence
  panel;
- preserves papers and repositories only in source/provenance details.

Browser verification covered the initial compatible H₂ workflow, a LiH-only
problem swap rejected for the missing `electrons:2` contract, disabled
execution after that rejection, and a 390 × 844 single-column layout without
horizontal overflow.

## 6. Public success criteria

```text
canonical definitions >= 18
executable provider bindings >= 12
Workflow templates >= 4
Problems/Datasets >= 2
controlled one-component swaps >= 3
Qiskit + PennyLane qualified binding for one core Workflow
compose → compatibility → run → compare → save demonstrable
```

## 7. Academic and engineering gates

- Legacy paper observations never auto-materialize.
- Official documentation proves documentation only.
- Every executable badge names exact package/runtime/evidence.
- Unknown and structured-only states remain visible.
- No dynamic install or GitHub source execution.
- Compatibility is deterministic, versioned, and evidence-producing.
- Workflow execution continues through the existing server-resolved,
  digest-pinned, deny-all OCI boundary.
- Public execution and verified scientific badges remain separately gated.

## 8. Remaining operator-gated evidence

- Apply migrations `0037` and `0038` to the disposable Neon test branch and
  execute the four live persistence tests with an injected `DATABASE_URL`.
- Confirm the provisioned H₂ Registry Workflow is present under
  `h2.sto3g.actual_vqe.workflow.v0_2`.
- Perform authenticated compose → Registry resolution → experiment creation →
  Qiskit/PennyLane execution → private candidate save in the deployed test
  environment.
- Do not call this public execution or a verified scientific result; the
  existing production/public gates remain unchanged.

## 9. Rollback

The UI may fall back to a read-only canonical component list while retaining
the legacy corpus as internal evidence. Rollback never deletes source records,
rewrites immutable component versions, or converts failed compatibility into
unknown/success.
