"""Pure publication-readiness evaluation (repository Step 4 plan §5-6).

Takes plain values, not ORM rows, so this module never imports sqlalchemy —
the repository layer (repos/catalog.py) loads state and calls this. Nothing
here mutates publication_state: Step 4 stops at evaluation, and publication
itself remains an audited human action added in a later step.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PublicationReadiness:
    ready: bool
    blockers: tuple[str, ...]


def evaluate_publication_readiness(
    *,
    review_state: str,
    has_source: bool,
    license_decision: str | None,
    source_blob_sha256: str | None,
    normalized_source_hash: str | None,
    authoritative_framework: str | None,
) -> PublicationReadiness:
    """Publication must fail closed if any required binding is missing
    (plan §6 step 15): review acceptance, a pinned source, an approved
    license decision, and the exact hash/framework binding on the version.
    """
    blockers: list[str] = []
    if review_state != "accepted":
        blockers.append(f"review_state must be accepted, got {review_state!r}")
    if not has_source:
        blockers.append("missing artifact_sources record")
    if license_decision != "approved":
        blockers.append(f"license must be approved, got {license_decision!r}")
    if not source_blob_sha256:
        blockers.append("missing source_blob_sha256")
    if not normalized_source_hash:
        blockers.append("missing normalized_source_hash")
    if not authoritative_framework:
        blockers.append("missing authoritative_framework")
    return PublicationReadiness(ready=not blockers, blockers=tuple(blockers))
