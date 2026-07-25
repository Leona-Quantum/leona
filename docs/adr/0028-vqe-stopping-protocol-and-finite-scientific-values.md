# ADR-0028: Stopping protocols are versioned components and scientific floats are finite

**Date:** 2026-07-25 · **Status:** accepted for MVP remediation

## Context

`ScientificExperimentSpec v0.1` already identifies
`stopping_protocol_version_id` independently from
`evaluation_protocol_version_id`, but the original 16-value `ComponentType`
ontology had no `stopping_protocol` value. Phase 1 recorded this as an owner/ADR
decision required before Phase 3 repository wiring, yet Phase 3 proceeded without
resolving it.

Stopping semantics are scientifically material. A different gradient threshold,
energy tolerance, or iteration cap can change accuracy, operator count,
measurement cost, and wall time even when every ansatz/operator/optimizer
component is otherwise identical. Nesting an unversioned stopping rule inside a
generic evaluation payload would weaken the strict/controlled comparison model.

The remediation audit also found that Pydantic accepted NaN and Infinity in
Hamiltonian coefficients, energies, trajectories, times, and initial parameters.
Those values do not have a stable JSON representation: the validated in-memory
object, serialized JSON, and digest input can disagree.

## Decision

1. Add `stopping_protocol` as the 17th `ComponentType`.
2. Keep `stopping_protocol_version_id` as an independent immutable
   `ArtifactVersion` reference in `ScientificExperimentSpec`.
3. Validate stopping component payloads with the typed `StoppingProtocol` model,
   including a component-type guard equivalent to `EvaluationProtocol`.
4. Reject NaN and positive/negative Infinity in every VQE contract model.
   Numerical failure is represented by terminal status and a closed failure code,
   never by an IEEE-754 sentinel.
5. `hamiltonian_digest()` canonicalizes internally before hashing. A public
   scientific identity must not depend on whether a caller remembered to
   sort/round terms first.

## Consequences

- Strict comparison can hold stopping semantics fixed independently of
  measurement/evaluation semantics.
- The DB component enum/check constraint and server-side role resolver must accept
  and require `stopping_protocol`.
- Existing corpus records remain valid because the enum change is additive.
- Existing canonical H2 digest remains stable because its stored Hamiltonian is
  already canonical.
- Callers that previously used NaN/Infinity must emit a failed/inconclusive result
  instead; this is an intentional fail-closed compatibility break.

## Rejected alternatives

- **Nest stopping inside evaluation protocol:** rejected because it prevents
  independent versioning and makes changes to resource/accuracy stopping
  conditions harder to detect in comparison.
- **Keep caller-managed canonicalization:** rejected because accidental
  noncanonical identity is more harmful than losing a raw-representation hash.
  A future diagnostic raw hash must use a separately named API.

## Reversal trigger

If real curated workflows demonstrate that a stopping rule cannot be represented
independently from a multi-criterion evaluation protocol, introduce an explicit
composite protocol schema in a superseding ADR. Do not silently alias the two
ArtifactVersions.
