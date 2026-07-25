# ADR-0030: VQE portable scientific identity is separate from registry resolution and execution

**Date:** 2026-07-25 · **Status:** accepted for Phase 4.5 implementation

## Context

ADR-0023 and ADR-0029 v0.1 embedded `ArtifactVersion` UUIDs in the
scientific experiment specification and mapped one experiment to one run.
That made two scientifically identical workflows hash differently when
imported into different Atlas databases, and it could not represent one
scientific experiment cross-checked under both Qiskit and PennyLane without
duplicating the experiment.

The original combined annotation state also mixed two independent claims:
whether a schema was machine-valid, and whether a qualified person had
reviewed its scientific meaning.  A machine-valid corpus record must not be
presented as human-reviewed.

## Decision

1. `PortableScientificExperimentSpec v0.2` contains only stable semantic
   component keys, normalized content digests, a workflow semantic digest,
   a dataset snapshot digest, canonical IEEE-754 binary64 parameter-slot
   bytes, and a server-approved seed.  It contains no database UUID,
   framework, runtime profile, image, or provider version.
2. `RegistryResolution` separately records the workflow and component
   `ArtifactVersion` UUIDs that supplied those semantics.  Its digest is
   provenance evidence, not scientific identity.
3. HTTP clients select only a workflow.  The server resolves all components,
   dataset identity, initial parameter slots, and seed.  Exactly one
   ordinal-zero component is required for each of the 14 executable MVP
   roles.  Unknown, duplicate, untyped, digest-mismatched, machine-invalid,
   or scientifically unreviewed components fail closed.
4. One immutable `vqe_experiments` row stores the portable scientific spec
   and registry resolution.  Zero or more `vqe_executions` rows bind it to
   approved framework/runtime profiles.  Attempts and append-only
   observations belong to an execution.  Thus one experiment may have a
   Qiskit execution and a PennyLane execution without changing scientific
   identity.
5. Component rows, workflow links, experiments, and observations are
   database-immutable.  Execution lifecycle state alone may update.  A
   downgrade refuses to destroy any VQE registry or execution evidence.
6. Component review is represented by independent
   `machine_validation_state` and `review_state` columns.  This does not
   retroactively claim human review for the Phase 2 literature corpus under
   ADR-0026.  Only an executable registry component promoted for experiment
   resolution requires both axes to pass.
7. The existing server-owned system catalog authority from ADR-0016 is
   reused.  A tenant may read an accepted, public component or workflow from
   that configured workspace, but a request can never choose the catalog
   workspace ID.  Identical component content is allowed in multiple
   workspaces because provenance may differ and global uniqueness would
   leak cross-tenant existence.

## Consequences

- Scientific hashes are portable across Atlas installations and independent
  of registry UUIDs.
- Cross-framework numerical comparison has the correct cardinality and does
  not duplicate a scientific experiment.
- Machine validation and human scientific review remain truthful,
  independently auditable claims.
- Persistence requires two digests and one additional table, and public
  execution is intentionally blocked until the H2 component set receives
  real human review and runtime profiles are promoted under ADR-0024.
- The generic 16×16 unitary used by the Phase 4.5 H2 spike validates energy,
  parameter orientation, and cross-framework semantics only.  Its
  provider-native compiled CNOT/depth values are not comparable performance
  evidence.

## Reversal trigger

If a future workflow needs multiple ordered components for one role, define a
new portable schema version with explicit ordering.  Do not fall back to
registry UUIDs, implicit component selection, or client-supplied scientific
inputs.
