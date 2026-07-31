"""What a stored artifact version can actually do, and what restoring one costs.

Versions are not interchangeable. Four producers write them and they populate
different columns:

  * the worker's `RepoReviewArtifactSaver` — QASM only when conversion succeeded,
    resource estimates from the execution, a full verification_summary; it never
    writes framework_variants.
  * Studio's edited-source draft (`routes/runs.py:_create_stale_source_draft`) —
    qasm=None, no estimates, no variants, export_status=UNSUPPORTED, and a
    verification_summary that exists only to say the evidence is stale.
  * `POST /artifacts/import-public` — whatever the public reference carried,
    including the only framework_variants anything writes.
  * the starter Bell artifact in `repos/system.py` — QASM and estimates but no
    verification_summary at all.

So "restore this version" is not symmetric: restoring the version a user typed
themselves silently drops QASM, exports, and every verdict. The point of this
module is that the drop is never silent — the list resource states what each
version holds, and a restore that would lose something has to be acknowledged.

Losses are returned as stable codes, not sentences: the web renders them from
its own locale tables, so a Japanese user does not get an English refusal.
"""

from dataclasses import dataclass
from typing import Any

from majorana_contracts.enums import ExportStatus, VerifierDecision

from .verification_summary import parse_verification_summary

#: Which of the four writers a version came from. `unknown` is a real answer for
#: legacy rows and is never guessed into one of the others.
ORIGIN_AGENT_RUN = "agent_run"
ORIGIN_STUDIO_DRAFT = "studio_draft"
ORIGIN_IMPORTED_REFERENCE = "imported_reference"
ORIGIN_STARTER_EXAMPLE = "starter_example"
ORIGIN_UNKNOWN = "unknown"

#: Loss codes, in the order the UI should read them out.
LOSS_QASM = "qasm"
LOSS_EXPORT = "export"
LOSS_RESOURCE_ESTIMATES = "resource_estimates"
LOSS_FRAMEWORK_VARIANTS = "framework_variants"
LOSS_VERIFICATION = "verification"


@dataclass(frozen=True)
class VersionCapabilities:
    origin: str
    has_qasm: bool
    has_resource_estimates: bool
    has_framework_variants: bool
    exportable: bool
    verified: bool


def _origin(metadata: Any) -> str:
    if not isinstance(metadata, dict):
        return ORIGIN_UNKNOWN
    if metadata.get("starter") is True:
        return ORIGIN_STARTER_EXAMPLE
    source = metadata.get("source")
    if isinstance(source, dict):
        return (
            ORIGIN_IMPORTED_REFERENCE
            if source.get("kind") == "public_repository"
            else ORIGIN_UNKNOWN
        )
    if source == "studio_draft":
        return ORIGIN_STUDIO_DRAFT
    if source in ("simple_pipeline_candidate", "agent_candidate"):
        return ORIGIN_AGENT_RUN
    return ORIGIN_UNKNOWN


def capabilities_of(version: Any) -> VersionCapabilities:
    """Read a version row's capabilities off the row itself.

    Everything here is a property of stored columns. Nothing is inferred from
    the origin: an agent run whose conversion failed has no QASM either, and
    saying otherwise because it came from the worker is how a canvas ends up
    asked to render nothing.
    """
    metadata = version.artifact_metadata
    summary = parse_verification_summary(
        metadata.get("verification_summary") if isinstance(metadata, dict) else None
    )
    return VersionCapabilities(
        origin=_origin(metadata),
        has_qasm=bool(version.qasm),
        has_resource_estimates=bool(version.resource_estimates),
        has_framework_variants=bool(version.framework_variants),
        exportable=ExportStatus(version.export_status) is not ExportStatus.UNSUPPORTED,
        verified=summary is not None and summary.decision is VerifierDecision.PASS,
    )


def restore_losses(current: VersionCapabilities, target: VersionCapabilities) -> list[str]:
    """Capabilities the artifact would stop having if `target` became current.

    Only losses. A restore that GAINS something needs no acknowledgement, and a
    restore between two equally bare versions is not worth interrupting anyone
    for.
    """
    pairs = (
        (LOSS_QASM, current.has_qasm, target.has_qasm),
        (LOSS_EXPORT, current.exportable, target.exportable),
        (
            LOSS_RESOURCE_ESTIMATES,
            current.has_resource_estimates,
            target.has_resource_estimates,
        ),
        (
            LOSS_FRAMEWORK_VARIANTS,
            current.has_framework_variants,
            target.has_framework_variants,
        ),
        (LOSS_VERIFICATION, current.verified, target.verified),
    )
    return [code for code, held, kept in pairs if held and not kept]
