# Atlas VQE Phase 4.5 — implementation and audit record

Date: 2026-07-25  
Branch: `feature/vqe`  
Decision authority: ADR-0030  
State: code-complete for the local scientific/persistence slice; **not ready
for public execution or publication**

## 1. Why Phase 4.5 exists

The Phase 3 candidate proved API and persistence shape, but its v0.1
scientific identity contained database UUIDs and assumed one experiment maps
to one run.  That cannot faithfully express the same H2 experiment executed
under Qiskit and PennyLane, and the hash would change after importing the same
scientific content into another Atlas database.

Phase 4.5 corrects identity and cardinality before Phase 5 runtime promotion.
It does not expand MVP scope to ADAPT-VQE, QPU, noise, arbitrary repository
execution, or public publication.

## 2. Implemented scientific contracts

- `PortableScientificExperimentSpec v0.2`
  - 14 explicit component roles, including chemistry preparation and
    compilation/resource protocol;
  - semantic key + normalized component digest, never registry UUID;
  - dataset content digest;
  - named parameter slots encoded as exact big-endian IEEE-754 binary64 bytes;
  - server-approved seed.
- `RegistryResolution`
  - records the workflow/component ArtifactVersion UUIDs separately;
  - has its own provenance digest and cannot affect the portable scientific
    digest.
- Typed executable H2 contracts for every role, with cross-role validation of
  qubit count, occupation, generator identity, parameter slots, and budgets.
- Exact Hamiltonian content digest includes coefficient bytes, mapping,
  qubit order, offset convention, and threshold context.  Permutation
  equivalence remains an explicit record, not an automatic equality claim.
- Capability-specific execution evidence:
  - failure;
  - exact-energy success;
  - actual-VQE optimization success with energy, fidelity, convergence,
    optimizer work, parameter-slot values/digests, trajectory, and
    stage-labelled resource observations.

## 3. Actual H2 VQE spike

Both framework scripts were re-run with `uv run --frozen` from their
independently locked runtime directories. They consume the same frozen typed
component fixture and the same canonical two-level double-excitation
convention.

| Evidence | Qiskit | PennyLane |
|---|---:|---:|
| Best energy (Ha) | -1.1373060357533742 | -1.1373060357533742 |
| Exact energy (Ha) | -1.1373060357533737 | -1.1373060357533737 |
| Absolute error (Ha) | 4.44e-16 | 4.44e-16 |
| Final parameter | -0.22353700287768571 | -0.22353701635917084 |
| Parameter difference | \- | 1.35e-8 |
| Logical qubits | 4 | 4 |
| Logical parameters | 1 | 1 |
| Canonical ansatz blocks | 1 | 1 |

The provider-native circuit uses a generic 16×16 unitary in this spike.
Consequently Qiskit's generic-unitary synthesis and PennyLane's abstract
`QubitUnitary` representation produce radically different native depth/gate
counts.  Those numbers validate neither compiler quality nor VQE resource
performance and are excluded from comparative claims.  A decomposed,
semantically equivalent excitation circuit plus a fixed compilation protocol
is required before CNOT/depth evidence can be compared.

## 4. Persistence and authorization

- One immutable `vqe_experiments` row may have multiple
  `vqe_executions`; observations belong to an execution.
- Component specs, workflow links, experiments, and observations are
  append-only/immutable at the database layer.
- Execution lifecycle alone may update.
- A populated migration downgrade fails closed rather than deleting failed or
  successful evidence.
- Public catalog reads reuse the server-owned authority from ADR-0016.  The
  workspace identifier never comes from a request.
- Public candidates must be accepted and public at the Artifact layer.
- Executable resolution additionally requires:
  - machine validation;
  - human-reviewed or author-confirmed scientific state;
  - matching recomputed content digest.
- `machine_validated` is accepted only after server-side typed parsing.
- scientific human review cannot be attached unless the owning Artifact has
  an accepted human review decision.

The literature corpus remains machine-only under ADR-0026.  The stricter
human-review requirement applies only to executable registry promotion; it
does not rewrite corpus history.

## 5. Comparison model correction

Comparison now exposes preparation/basis/active-space, pool/order,
search/selection/growth/compression, gradient estimator, grouping/shot
allocation/measurement cost, compilation, noise, dataset, training split, and
checkpoint dimensions.  `not_applicable` is distinct from `fixed`,
`unknown`, and `changed`.  ADAPT-VQE versus Qubit-ADAPT now records the
operator-pool difference explicitly instead of hiding it under ansatz.

All three MVP reports remain honest:

- `peruzzo2014_vs_shen2017`: partial
- `grimsley2019_vs_tang2021`: partial
- `omalley2016_vs_kandala2017`: invalid

No report is promoted to manual gold or human validated.

## 6. Deterministic review candidate

`registry_manifest_v0.2.json` is generated from the typed H2 components and
pins both raw framework evidence files by SHA-256.  It deliberately contains
no registry UUID and says:

- machine validation: passed;
- human review: unreviewed;
- publication: blocked pending human review.

The generator has a `--check` mode for CI.  It is not a hidden seed in a
migration and does not auto-publish.  Actual catalog materialization remains
behind the existing provenance, license, independent-human-review, and
publication gates.

## 7. Verification evidence

Completed locally:

- VQE/API domain tests: included in full suite.
- Full Python suite: `1090 passed, 73 skipped`.
- API-only suite: `320 passed, 62 skipped`.
- Web tests: `92 passed`.
- corpus validation: 26 papers, 15 repositories, 59 components, 3
  comparisons; 0 errors, 0 warnings.
- comparison generator `--check`: passed.
- temporary PostgreSQL 14:
  - migration `upgrade → downgrade 0034 → upgrade`: passed;
  - six live VQE repository tests: passed;
  - populated downgrade: refused with the expected fail-closed error.
- temporary Neon PostgreSQL 17 branch:
  - migration `0034 → 0035 → 0034 → 0035`: passed;
  - six live VQE repository tests: passed;
  - populated downgrade: refused and remained transactionally at `0035`;
  - full evidence: `docs/atlas/PHASE45_NEON_GATE.md`.

No production database, credential, QPU, or public publication state was
modified by Phase 4.5. Only the owner-confirmed temporary Neon validation
branch received migration and test-fixture writes.

## 8. Phase 5 readiness: NO-GO

The following are real blockers, not test skips to reinterpret as success:

1. H2 executable component/workflow definitions have no independent human
   scientific review yet.
2. Qiskit and PennyLane runtime images are not promoted digest-pinned
   Linux/x86_64 profiles with SBOMs and deny-all egress evidence.
3. The current spike ran on macOS arm64.
4. Comparable decomposed-circuit CNOT/depth evidence is absent.
5. Durable job execution, UI execution states, cancellation/events, and
   Artifact materialization remain Phase 5 work.

Therefore `/v1/vqe/capabilities` correctly remains unavailable and the
cancel/events/materialize endpoints continue to return an explicit 409
instead of fabricated success.
