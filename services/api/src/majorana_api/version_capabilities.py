"""What a stored artifact version can actually do, and what restoring one costs.

Versions are not interchangeable. Five producers write them and they populate
different columns:

  * the worker's `RepoReviewArtifactSaver` — QASM only when conversion succeeded,
    resource estimates from the execution, a full verification_summary; it never
    writes framework_variants.
  * Studio's edited-source draft (`routes/runs.py:_create_stale_source_draft`) —
    qasm=None, no estimates, no variants, export_status=UNSUPPORTED, and a
    verification_summary that exists only to say the evidence is stale.
  * `POST /artifacts/import-public` — whatever the public reference carried,
    including the only framework_variants anything writes.
  * `POST /artifacts/import-source` — a circuit the user wrote and brought in
    themselves: code only, no QASM, no estimates, no variants, and a summary
    that says nothing has been executed.
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
from majorana_frameworks.roles import ProgramRole, classify_source

from .verification_summary import parse_verification_summary

#: Which of the five writers a version came from. `unknown` is a real answer for
#: legacy rows and is never guessed into one of the others.
#:
#: A new writer that does not add itself here does not read as new — it reads as
#: `unknown`, which is indistinguishable from a legacy row, next to a restore
#: button. `test_every_origin_is_reachable_and_named` walks these constants.
ORIGIN_AGENT_RUN = "agent_run"
ORIGIN_STUDIO_DRAFT = "studio_draft"
ORIGIN_IMPORTED_REFERENCE = "imported_reference"
ORIGIN_USER_IMPORT = "user_import"
ORIGIN_STARTER_EXAMPLE = "starter_example"
ORIGIN_UNKNOWN = "unknown"

#: The `metadata["source"]` value `POST /artifacts/import-source` writes.
#: Imported by the route so the writer and the reader cannot drift apart on a
#: string literal.
USER_IMPORT_SOURCE = "user_import"

#: Re-exported so a caller reading a capability does not have to import from two
#: packages to compare it against anything.
CIRCUIT_ROLE = ProgramRole.CIRCUIT.value
PROGRAM_ROLE = ProgramRole.PROGRAM.value

#: Loss codes, in the order the UI should read them out.
LOSS_QASM = "qasm"
LOSS_EXPORT = "export"
LOSS_RESOURCE_ESTIMATES = "resource_estimates"
LOSS_FRAMEWORK_VARIANTS = "framework_variants"
LOSS_VERIFICATION = "verification"


@dataclass(frozen=True)
class VersionCapabilities:
    origin: str
    #: Circuit, program, or neither — read from `code` every time it is asked for.
    #:
    #: Deliberately NOT a stored column, and that is the whole point of putting it
    #: here rather than in a migration: the role is a pure function of the source,
    #: so deriving it needs no backfill, is automatically right for every row
    #: written before the concept existed, and cannot drift away from the bytes it
    #: describes the way a column would after an edit that forgot to update it.
    #:
    #: It is also a different question from `origin` beside it. `origin` says which
    #: of four writers produced the row; this says what the row IS. An agent whose
    #: generation failed halfway is `agent_run` and not a program, and a circuit a
    #: user pasted into Studio has no meaningful producer at all.
    program_role: str
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
    if source == USER_IMPORT_SOURCE:
        return ORIGIN_USER_IMPORT
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
        program_role=classify_source(version.code or "").value,
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
