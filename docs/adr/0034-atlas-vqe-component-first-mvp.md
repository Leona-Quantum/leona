# ADR-0034: Atlas VQE MVP is component-first; literature and repositories are provenance

**Date:** 2026-07-27 · **Status:** accepted by owner

## Context

Majorana already persists versioned VQE component specifications and Workflow
composition through `ArtifactVersion`, separates scientific identity from
execution binding, records append-only execution evidence, and can construct a
bounded immutable GitHub snapshot. The public Atlas VQE surface nevertheless
starts from a machine-validated literature corpus and exposes peer tabs named
Papers, Components, Repositories, and Comparisons.

The Components tab is currently a projection of component mentions inside
paper annotations. Those observations have no canonical component identity and
must not be promoted into `vqe_component_specs` merely because a name appears
in a paper. The three existing comparison reports are machine-generated and
are not manual gold. This presentation therefore looks like a literature
catalog and makes corpus size a misleading proxy for product value.

The intended product is closer to a package/model registry for VQE research:
researchers choose reusable scientific components, inspect implementations and
compatibility, compose a Workflow, replace one component under controlled
conditions, and execute the result where an approved binding exists.

## Decision

1. The MVP public subject is:

   ```text
   Component Definition
   + Component Implementation
   + Component Configuration
   + Workflow
   ```

2. Papers, repositories, DOI/arXiv records, README/CITATION metadata, licenses,
   commit SHAs, and source locators remain stored as source/evidence. They do
   not have peer primary tabs in the VQE Methods UI.
3. Legacy paper component annotations remain `ComponentMention` /
   `SourceEvidence`. They never become canonical definitions automatically.
4. Canonical definitions remain immutable versioned `ArtifactVersion`-backed
   `vqe_component_specs`. Provider implementations are separate versioned
   records/bindings; library classes are not scientific definitions.
5. The researcher-facing navigation groups the internal component types into:
   Problems & Datasets, Representation, States & Ansätze, Operator Pools,
   Search & Growth, Optimizers, Compression, Measurement, and Evaluation &
   Execution. The closed internal component enum remains unchanged.
6. Comparison becomes a Workflow operation. A controlled comparison clones a
   Workflow and changes exactly one component while all other scientific
   component bindings and evaluation conditions remain fixed.
7. Initial public seed data is restricted to maintained standard providers:
   Qiskit/Qiskit Nature/Qiskit Algorithms, PennyLane, OpenFermion, HamLib, and
   approved Atlas-native neutral protocols. Provider support is expressed as
   `package × version × capability × runtime × evidence`, never by framework
   name alone.
8. Advanced paper-specific ADAPT variants, compression/pruning methods, LLM or
   transformer selection, custom GitHub code, and implementation-free papers
   are deferred to Advanced Component Intake.
9. Phase 7 remains the metadata acquisition layer. S4 durable persistence
   continues; S5–S7 initially accept only official standard-provider sources
   and stage `RepositorySnapshot`, `MetadataAssertion`, and
   `ComponentImplementationCandidate`. No automatic publication or code
   execution is added.
10. Phase 7.5 is inserted for the Standard Component MVP: product contracts,
    canonical seeds, provider bindings, component-first UI, Workflow templates,
    compatibility checks, and controlled component-swap comparisons.

## Success criteria

- at least 18 canonical standard component definitions;
- at least 12 executable implementation bindings;
- at least 4 Workflow templates across at least 2 Problem/Dataset entries;
- at least 3 controlled one-component-swap comparisons;
- one core Workflow with qualified Qiskit and PennyLane implementations;
- a visible compose → compatibility → run → compare → save path;
- no primary Papers, Repositories, or Comparisons tab;
- provenance remains inspectable without being presented as scientific
  verification.

Paper count, repository count, and GitHub stars are not MVP success metrics.

## Consequences

The existing corpus and its routes may remain for internal/source lookup and
backward-compatible evidence links, but they are removed from primary VQE
navigation. Existing Phase 5/6 execution and Phase 7 snapshot work remains
useful and is not rewritten.

Canonical seed records require explicit semantic definitions, configuration
boundaries, provenance, version/evidence state, and unknowns. A provider's
official documentation is evidence that a capability is documented; it is not
evidence that Majorana executed or scientifically validated that capability.

## Reversal trigger

Revisit this decision only if researcher testing shows that component
composition cannot represent a material class of standard VQE experiments
without loss. Do not reverse it merely because literature records are easier
to collect or produce larger counts.
