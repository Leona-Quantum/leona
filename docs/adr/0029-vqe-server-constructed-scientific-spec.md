# ADR-0029: VQE scientific specs are constructed from workflow components server-side

**Date:** 2026-07-25 · **Status:** accepted for MVP remediation

## Context

The Phase 3 candidate API accepted a complete client-supplied
`ScientificExperimentSpec`. Pydantic verified UUID shape but the server did
not prove that those ArtifactVersions existed in the workspace, had the
expected component types, or belonged to the selected workflow. This did not
meet the MVP rule that the API resolves component ArtifactVersions and builds
the scientific spec.

The same API used the standard HTTP `Idempotency-Key` header, while ADR-0023
also called a binding-dependent, server-generated hash an idempotency
identity. These are different mechanisms with different lifetimes.

## Decision

1. A create-experiment request names a Workflow ArtifactVersion and only
   non-component inputs: dataset snapshot, initial parameters, seed, and
   protocol version.
2. The repository layer resolves the Workflow and all required component
   links under `Scope`.
3. Workflow link roles equal their `ComponentType` values. The referenced
   component spec must have that exact type.
4. `ScientificExperimentSpec v0.1` requires exactly one ordinal-zero
   component for each role in `SCIENTIFIC_SPEC_ROLE_BINDINGS`.
5. A component kind that v0.1 cannot represent fails closed. It must receive
   an explicit field in a versioned future spec before execution; it is never
   silently omitted from scientific identity.
6. The HTTP replay key is stored and exposed as
   `request_idempotency_key`. It prevents duplicate request persistence.
7. The server-generated, binding-dependent execution identity remains a
   separate Phase 5 concept computed only after an approved
   `ExecutionBinding` exists.

## Consequences

- A client cannot invent component UUIDs or combine components outside the
  selected workflow.
- Cross-workspace, missing, wrong-type, duplicate-role, and unsupported-role
  workflows are rejected before an experiment row is written.
- Explicit no-op components are required for v0.1 roles that do not affect a
  particular method. This is verbose but makes comparison conditions visible.
- Adding error mitigation, learning/training, problem preparation, or another
  scientifically material role to executable workflows requires a new spec
  field/version rather than an untracked side channel.

## Reversal trigger

If curated workflows require ordered multi-component roles, introduce a
versioned list-valued scientific spec and canonical ordering rules. Do not
relax the resolver to pick one component implicitly.
