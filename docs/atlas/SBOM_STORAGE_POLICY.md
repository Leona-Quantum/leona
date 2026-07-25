# Atlas runtime SBOM storage policy

Status: active for runtime profiles created after the Phase 5 local candidate  
Scope: VQE and future executable Atlas runtime profiles

## Decision

Git stores a compact, reviewable manifest for every runtime SBOM. The full
SBOM object is stored in an access-controlled artifact or object store and is
retrieved by immutable content identity.

The compact manifest must contain:

- runtime profile ID and framework;
- SBOM format and generator;
- byte count and SHA-256;
- immutable object locator;
- runtime-payload source commit;
- generation time when known;
- retention and access classification.

An object locator must not be a mutable branch URL. Retrieval is accepted
only after byte count and SHA-256 verification. Absence or hash mismatch is a
qualification failure, never an invitation to regenerate silently.

## Phase 5 one-time exception

The four Phase 5 candidate SBOMs already committed to Git are retained as an
internal audit snapshot. Rewriting history would reduce, rather than improve,
traceability. Their compact index is
`evidence/phase5b_runtime_sbom_manifest_v1.json`.

This exception does not establish the future storage pattern. A new runtime
profile or SBOM revision must place the full object in GitHub Actions
artifacts, a private release, Atlas object storage, or an equivalently
immutable controlled store. Until such a store and retention policy are
available, a new runtime profile is not production-qualified.

## Claim boundary

An SBOM records the software inventory presented by its generator. It does
not prove that the scientific algorithm is correct, that every package was
executed, or that the image is safe. Scientific validation, build
attestation, vulnerability review, runtime isolation, and human approval are
separate evidence classes.
