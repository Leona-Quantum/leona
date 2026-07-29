# Atlas VQE Phase 4.5 — implementation and audit record

Date: 2026-07-25  
Branch: `feature/vqe`  
Decision authority: ADR-0031 and ADR-0032  
State: **ready for Phase 5A product integration; not qualified for public
execution, publication, or scientific release**

## 1. Scientific identity and persistence

Phase 4.5 replaces database-bound scientific identity with
`PortableScientificExperimentSpec v0.2`. It hashes stable semantic component
keys and content digests, exact parameter bytes, the dataset snapshot, and
the approved seed. Registry UUIDs remain separate provenance.

One immutable experiment may have multiple framework executions. Component
specs, workflow links, experiments, and observations are immutable at the
database layer; only execution lifecycle state may change. A populated
migration downgrade fails closed.

Machine validation and human review are separate states. Generated evidence
remains `human_review_state=unreviewed`; no test or owner deferral converts it
into human review.

## 2. Canonical H2 excitation and comparison protocol

The H2 ansatz is now an explicitly decomposed circuit for

`exp(theta/2 * (a†1 a†3 a2 a0 - a†0 a†2 a3 a1))`

under frozen Jordan–Wigner, occupied/virtual, parameter-sign, and
qubit-0-first conventions. Eight commuting Pauli rotations compile
deterministically to `h/s/sdg/rz/cx`; neither adapter uses a generic
`UnitaryGate` or `QubitUnitary`.

- canonical circuit SHA-256:
  `a95f4a8e8749e361c85df00b9bf42d9cea407a048840bc8e58f7e5c9920be3b1`
- compilation protocol SHA-256:
  `4e949fdc81f6e4c0416b95eee2bb71d521216db8705bcd948320ddd83ae52acb`
- topology: four-qubit all-to-all
- layout: `[0,1,2,3]`
- routing/optimization: none / level 0
- measurements: excluded
- depth: ASAP dependency layers with unit gate duration
- CNOT: count of `cx`

Resource stages are:

1. `semantic_block`
2. `canonical_logical`
3. `common_basis_compiled`
4. `provider_native_diagnostic`

Only stages 2 and 3 are comparison-eligible. Provider-native output is
diagnostic because framework/compiler transformations differ.

## 3. Actual H2 VQE evidence

Both adapters were re-run with `uv run --frozen` from independent lockfiles
and consume the same canonical circuit JSON.

| Evidence | Qiskit | PennyLane |
|---|---:|---:|
| Best energy (Ha) | -1.137306035753356 | -1.137306035753356 |
| Exact energy (Ha) | -1.1373060357533737 | -1.1373060357533737 |
| Absolute error (Ha) | 1.776e-14 | 1.776e-14 |
| Final parameter | -0.22353697909001485 | -0.22353698760213844 |
| Parameter difference | — | 8.51e-9 |
| Canonical/common-basis CNOT | 48 | 48 |
| Canonical/common-basis depth | 83 | 83 |
| Canonical/common-basis gates | 152 | 152 |

The decomposed circuit was also compared against the former exact two-level
unitary at multiple parameter values, up to global phase, with maximum
matrix deviation below `1e-12`.

This is local noiseless H2 validation, not a claim about production runtime
quality, compiler superiority, hardware performance, or broader VQE
reproducibility.

## 4. Contracts completed before Phase 5A

- Comparison dimensions independently represent operator pool/order,
  search/selection, growth, compression, gradients, grouping, shots,
  measurement cost, and compilation.
- Successful actual-VQE results require energy/exact/error, convergence,
  optimizer work, initial/final parameter vectors and digests, trajectory,
  ansatz/circuit/protocol digests, and stage-labelled resources.
- Experiment identity is one-to-many with execution identity.
- Scientific evidence is database-immutable.
- A server-owned isolation contract fixes deny-all network, no credentials
  or database URL, no dynamic installation, read-only root, bounded
  ephemeral output, and non-root execution.
- Runtime environment construction uses constants only and never merges the
  host or caller environment.

## 5. Verification

Completed before the final Phase 5A decision:

- deterministic canonical-circuit generator and digest checks;
- cross-provider circuit equivalence tests;
- adapter source scan rejecting generic unitary use;
- result/executable/comparison/isolation contract tests;
- corpus regeneration and validation;
- local and temporary-Neon PostgreSQL migration/immutability tests.

- full Python suite: `1103 passed, 73 skipped`;
- web lint/typecheck/test: passed (`92` web tests);
- Ruff lint and format checks: passed;
- import architecture contracts: `4 kept, 0 broken`;
- raw-query boundary check: passed;
- OpenAPI, canonical-circuit, registry-manifest, comparison, and corpus
  generated-file checks: passed.

Not completed and not represented as passed:

- independent human scientific review of H2;
- Linux/x86_64 digest-pinned OCI image qualification and SBOM;
- live deny-all egress proof in a promoted runtime;
- public execution, publication, or scientific release.

These are owner-approved deferrals to Phase 5B/pre-public release, not
waivers of the requirements.

## 6. Phase 5A handoff

Phase 5A starts with durable `ExecutionBinding` and job-worker integration
using fixed candidate profiles. The public capability remains unavailable
and materialization remains fail-closed. Phase 5B must qualify the runtime
and obtain independent scientific review before any public promotion.
