"""Workspace artifact reads for Studio.

The web surface is a renderer; artifact ownership and workspace scoping stay in
the control plane's repository layer.
"""

import datetime as dt
import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException
from majorana_contracts import Artifact as ArtifactResource
from majorana_contracts import ArtifactVersion as ArtifactVersionResource
from majorana_contracts import VerificationSummary
from majorana_contracts.enums import (
    Algorithm,
    EvidenceStrength,
    ExportStatus,
    Framework,
    VerifierDecision,
    Visibility,
)
from majorana_openqasm import OpenQASMError, fingerprint, normalize
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from fastapi import Depends

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..repos import artifacts as artifacts_repo
from ..repos import workspaces as workspaces_repo
from ..orm import Artifact as ArtifactRow
from ..orm import ArtifactVersion as ArtifactVersionRow
from ..settings import Settings
from ..tiers import limits_for, resolve_tier
from ..verification_summary import parse_verification_summary
from ..version_capabilities import capabilities_of, restore_losses

router = APIRouter()

#: The version list is bounded like every other artifact query, and lower: the
#: rows carry no code, so a page is small, but an artifact edited all afternoon
#: can hold hundreds of versions and the panel showing them is a sidebar.
VERSION_PAGE_DEFAULT = 25
VERSION_PAGE_MAX = 100


def _artifact_cap_refusal(used: int, limit: int) -> HTTPException:
    # This sentence has a twin in `apps/web/lib/run-allowance.ts`, which refuses
    # the same submission client-side before it is sent. Two copies of a refusal
    # is already a smell; two copies that WORD it differently tells the same
    # person two different things about one rule, so they change together or
    # not at all.
    return HTTPException(
        status_code=429,
        detail={
            "error": (
                f"Your Studio holds {used} of {limit} artifacts on this plan. "
                "Archive an artifact you no longer need and this one will file."
            ),
            "reason": "artifact_allowance_exhausted",
            "used": used,
            "limit": limit,
        },
    )


class ImportPublicArtifactRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_slug: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=240)
    family: str = Field(min_length=1, max_length=120)
    framework: Framework
    code: str = Field(min_length=1, max_length=100_000)
    code_lang: str = Field(min_length=1, max_length=40)
    qasm: str | None = Field(default=None, max_length=100_000)
    framework_variants: dict[str, str] | None = None
    resource_estimates: dict[str, Any] | None = None
    export_status: ExportStatus = ExportStatus.DOWNLOAD_ONLY
    source_url: AnyHttpUrl
    source_title: str = Field(min_length=1, max_length=400)
    source_license: str = Field(min_length=1, max_length=400)
    introduction: str = Field(min_length=1, max_length=20_000)
    explanation: str = Field(min_length=1, max_length=20_000)
    verification: str = Field(min_length=1, max_length=20_000)


def _public_family(value: str) -> Algorithm:
    normalized = value.lower()
    family_map = (
        ("qaoa", Algorithm.QAOA),
        ("vqe", Algorithm.VQE),
        ("grover", Algorithm.GROVER),
        ("bell", Algorithm.BELL),
        ("ghz", Algorithm.GHZ),
        ("qft", Algorithm.QFT),
        ("quantum fourier", Algorithm.QFT),
        ("qpe", Algorithm.QPE),
        ("amplitude estimation", Algorithm.AMPLITUDE_ESTIMATION),
        ("state preparation", Algorithm.STATE_PREPARATION),
        ("error correction", Algorithm.ERROR_CORRECTION),
    )
    return next((family for marker, family in family_map if marker in normalized), Algorithm.OTHER)


def _public_slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:120] or "reference"


def _canonical_public_qasm(source: str | None) -> tuple[str | None, str | None, str | None]:
    if source is None:
        return None, None, None
    try:
        canonical = normalize(source)
    except OpenQASMError as exc:
        raise HTTPException(status_code=422, detail=f"invalid OpenQASM: {exc}") from exc
    return canonical, "3.0", fingerprint(canonical)


def _verification_summary_fields(
    metadata: dict | None,
) -> tuple[VerifierDecision | None, EvidenceStrength | None]:
    """Read (decision, strength) out of a version's verification_summary.

    Absence and malformed values both map to None — the resource must say
    "unknown", never guess a verdict the metadata does not carry.
    """
    raw = metadata.get("verification_summary") if isinstance(metadata, dict) else None
    summary = parse_verification_summary(raw)
    return (summary.decision, summary.evidence_strength) if summary is not None else (None, None)


def _to_artifact(row: ArtifactRow, version_metadata: dict | None = None) -> ArtifactResource:
    decision, strength = _verification_summary_fields(version_metadata)
    raw = (
        version_metadata.get("verification_summary") if isinstance(version_metadata, dict) else None
    )
    return ArtifactResource(
        id=row.id,
        workspace_id=row.workspace_id,
        slug=row.slug,
        title=row.title,
        family=row.family,
        framework=Framework(row.framework),
        visibility=Visibility(row.visibility or Visibility.PRIVATE),
        parent_artifact_id=row.parent_artifact_id,
        current_version_id=row.current_version_id,
        verifier_decision=decision,
        evidence_strength=strength,
        verification_summary=parse_verification_summary(raw),
        created_at=row.created_at,
        updated_at=row.updated_at,
        kept_at=row.kept_at,
        deleted_at=row.deleted_at,
    )


def _to_version(row: ArtifactVersionRow) -> ArtifactVersionResource:
    raw = (
        row.artifact_metadata.get("verification_summary")
        if isinstance(row.artifact_metadata, dict)
        else None
    )
    return ArtifactVersionResource(
        id=row.id,
        artifact_id=row.artifact_id,
        seq=row.seq,
        qasm_version=row.qasm_version,
        qasm=row.qasm,
        metadata=row.artifact_metadata,
        code=row.code,
        code_lang=row.code_lang,
        fingerprint=row.fingerprint,
        export_status=ExportStatus(row.export_status),
        export_reason=row.export_reason,
        framework_variants=row.framework_variants,
        resource_estimates=row.resource_estimates,
        limitations=row.limitations,
        verification_summary=parse_verification_summary(raw),
        created_at=row.created_at,
    )


@router.get("/artifacts", response_model=list[ArtifactResource])
async def list_artifacts(
    scope: CurrentScope,
    session: DbSession,
    family: Algorithm | None = None,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[ArtifactResource]:
    rows = await artifacts_repo.list_artifacts(
        scope,
        session,
        family=family,
        cursor=cursor,
        limit=min(max(limit, 1), 100),
    )
    return [_to_artifact(row, metadata) for row, metadata in rows]


@router.post("/artifacts/import-public", response_model=ArtifactResource, status_code=201)
async def import_public_artifact(
    body: ImportPublicArtifactRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactResource:
    """Copy a public reference into the caller's personal Library.

    This is an import snapshot, not a new verification result. The source and
    limitations are retained on the artifact version so the private copy does not
    lose its public provenance.
    """
    slug = f"public-{_public_slug(body.source_slug)}-{scope.workspace_id.hex}"
    existing = await artifacts_repo.get_artifact_by_slug(scope, session, slug)
    if existing is not None:
        return _to_artifact(existing)

    qasm, qasm_version, qasm_fingerprint = _canonical_public_qasm(body.qasm)
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title=body.title,
        family=_public_family(body.family),
        framework=body.framework,
    )
    await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=qasm_version,
        qasm=qasm,
        metadata={
            "source": {
                "kind": "public_repository",
                "slug": body.source_slug,
                "title": body.source_title,
                "url": str(body.source_url),
                "license": body.source_license,
            },
            "introduction": body.introduction,
            "explanation": body.explanation,
            "verification": body.verification,
            "verification_summary": {
                "verified": False,
                "decision": None,
                "reason_code": "imported_reference_not_verified",
                "evidence_strength": None,
            },
        },
        code=body.code,
        code_lang=body.code_lang,
        fingerprint=qasm_fingerprint or f"public-reference:{body.source_slug}",
        export_status=body.export_status,
        framework_variants=body.framework_variants,
        resource_estimates=body.resource_estimates,
        limitations=(
            "Imported from the public research database. This private copy preserves public "
            "source context but is not a new execution or verification record. Review the "
            "source license and rerun the artifact before relying on it."
        ),
    )
    return _to_artifact(artifact)


@router.get("/artifacts/{artifact_id}", response_model=ArtifactResource)
async def get_artifact(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactResource:
    artifact = await artifacts_repo.get_artifact(scope, session, artifact_id)
    metadata = None
    if artifact.current_version_id is not None:
        version = await artifacts_repo.get_version(scope, session, artifact.current_version_id)
        metadata = version.artifact_metadata
    return _to_artifact(artifact, metadata)


@router.post("/artifacts/{artifact_id}/keep", response_model=ArtifactResource)
async def keep_artifact(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ArtifactResource:
    """Put a materialized run result into the Vault (migration 0036).

    Every successful run materializes an artifact, because the Run surface's
    conversion tabs read the saved version and the next turn in a conversation
    forks from it. What the user chooses is whether it is *filed*: unkept
    artifacts are excluded from `GET /artifacts` and from the workspace's
    artifact count.

    Idempotent — keeping something already kept returns it unchanged rather than
    re-stamping, so a double click cannot reorder the Vault.

    This is where the per-tier Vault cap is enforced, because since migration
    0036 it is the only place an artifact ENTERS the Vault by a user's choice.
    The cap is checked before the write and skipped for an artifact that is
    already kept, so re-keeping never fails at the boundary.
    """
    user, _workspace = identity
    limits = limits_for(
        resolve_tier(user.email, plan=user.plan, developer_emails=settings.developer_emails)
    )
    if limits.private_artifacts is not None:
        existing = await artifacts_repo.get_artifact(scope, session, artifact_id)
        if existing.kept_at is None:
            _workspace_row, _members, kept, _runs = await workspaces_repo.get_overview(
                scope, session
            )
            if kept >= limits.private_artifacts:
                raise _artifact_cap_refusal(kept, limits.private_artifacts)
    artifact = await artifacts_repo.keep_artifact(scope, session, artifact_id)
    metadata: dict | None = None
    if artifact.current_version_id is not None:
        version = await artifacts_repo.get_version(scope, session, artifact.current_version_id)
        metadata = version.artifact_metadata
    return _to_artifact(artifact, metadata)


@router.delete("/artifacts/{artifact_id}", status_code=204)
async def delete_artifact(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> None:
    """Soft-delete an artifact from the caller's Library.

    Until this existed the Library's Delete button only hid the row in one
    browser's localStorage: the record stayed in Postgres and reappeared on any
    other device, or after clearing site data. The repository primitive had
    been written but was never wired to a route.

    Soft, not hard: deleted_at already excludes the row from every read path,
    and versions/run provenance stay referentially intact.
    """
    await artifacts_repo.soft_delete_artifact(scope, session, artifact_id)


@router.get("/artifacts/{artifact_id}/versions/current", response_model=ArtifactVersionResource)
async def get_current_version(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactVersionResource:
    artifact = await artifacts_repo.get_artifact(scope, session, artifact_id)
    if artifact.current_version_id is None:
        raise HTTPException(status_code=404, detail="artifact version")
    return _to_version(
        await artifacts_repo.get_version(scope, session, artifact.current_version_id)
    )


# Route-local response models on purpose. These shapes are this endpoint's
# presentation of rows the shared contracts already describe; putting them in
# majorana_contracts would mean a CONTRACTS_VERSION bump, an openapi.json
# regeneration and a contracts-gen regeneration for a list nothing outside this
# service consumes.


class ArtifactVersionSummary(BaseModel):
    """One row of history. Deliberately carries no code and no QASM.

    The panel that renders this lists versions; loading one is a separate,
    explicit fetch. Sending every version's source down with the list is how a
    sidebar becomes a megabyte.
    """

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    seq: int
    is_current: bool
    code_lang: str
    fingerprint: str
    export_status: ExportStatus
    export_reason: str | None
    limitations: str | None
    verification_summary: VerificationSummary | None
    created_at: dt.datetime | None
    #: What this version actually holds. The UI states these per row rather than
    #: assuming every version can do what the current one can.
    origin: str
    has_qasm: bool
    has_resource_estimates: bool
    has_framework_variants: bool
    exportable: bool
    verified: bool
    #: Codes for what restoring THIS row would take away from the artifact as it
    #: stands right now. Empty for the current version.
    restore_losses: list[str]


class ArtifactVersionPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    versions: list[ArtifactVersionSummary]
    current_version_id: uuid.UUID | None
    #: Pass back as `before_seq` for the next page; null when the list is short
    #: enough that there is no next page.
    next_before_seq: int | None


class RestoreVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Set once the caller has been shown what the restore costs. Without it a
    #: lossy restore is refused rather than performed quietly.
    acknowledge_capability_loss: bool = False


def _to_version_summary(
    row: ArtifactVersionRow, *, current_version_id: uuid.UUID | None, losses: list[str]
) -> ArtifactVersionSummary:
    caps = capabilities_of(row)
    raw = (
        row.artifact_metadata.get("verification_summary")
        if isinstance(row.artifact_metadata, dict)
        else None
    )
    return ArtifactVersionSummary(
        id=row.id,
        seq=row.seq,
        is_current=row.id == current_version_id,
        code_lang=row.code_lang,
        fingerprint=row.fingerprint,
        export_status=ExportStatus(row.export_status),
        export_reason=row.export_reason,
        limitations=row.limitations,
        verification_summary=parse_verification_summary(raw),
        created_at=row.created_at,
        origin=caps.origin,
        has_qasm=caps.has_qasm,
        has_resource_estimates=caps.has_resource_estimates,
        has_framework_variants=caps.has_framework_variants,
        exportable=caps.exportable,
        verified=caps.verified,
        restore_losses=losses,
    )


@router.get("/artifacts/{artifact_id}/versions", response_model=ArtifactVersionPage)
async def list_artifact_versions(
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    before_seq: int | None = None,
    limit: int = VERSION_PAGE_DEFAULT,
) -> ArtifactVersionPage:
    """This artifact's history, newest authored first.

    Rows are ordered by `seq`, which is authoring order — NOT "which is
    current". Restoring moves `artifacts.current_version_id` without writing a
    row, so the current version is frequently not the highest seq. That is why
    every row carries `is_current` instead of the client inferring it from
    position.
    """
    artifact = await artifacts_repo.get_artifact(scope, session, artifact_id)
    bounded = min(max(limit, 1), VERSION_PAGE_MAX)
    rows = await artifacts_repo.list_versions(
        scope, session, artifact_id, before_seq=before_seq, limit=bounded
    )
    current = next((row for row in rows if row.id == artifact.current_version_id), None)
    if current is None and artifact.current_version_id is not None:
        # The current version can be off this page once history is paged; the
        # comparison it anchors has to be right on every page, so fetch it.
        current = await artifacts_repo.get_version(scope, session, artifact.current_version_id)
    current_caps = capabilities_of(current) if current is not None else None
    return ArtifactVersionPage(
        versions=[
            _to_version_summary(
                row,
                current_version_id=artifact.current_version_id,
                losses=(
                    []
                    if current_caps is None or row.id == artifact.current_version_id
                    else restore_losses(current_caps, capabilities_of(row))
                ),
            )
            for row in rows
        ],
        current_version_id=artifact.current_version_id,
        next_before_seq=rows[-1].seq if len(rows) == bounded else None,
    )


@router.post(
    "/artifacts/{artifact_id}/versions/{version_id}/restore",
    response_model=ArtifactVersionResource,
)
async def restore_artifact_version(
    artifact_id: uuid.UUID,
    version_id: uuid.UUID,
    body: RestoreVersionRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactVersionResource:
    """Make an earlier version current again.

    Restore is a pointer move, so the restored version arrives with exactly the
    evidence and exports IT was saved with — not the current version's. For a
    version the user typed in Studio that means no QASM, no exports and no
    verdict, because that is what a Studio draft is.

    Refused with 409 when the restore would take a capability away, unless the
    caller acknowledges it. The alternative — restoring quietly — hands the
    canvas a version it cannot render and tells the user nothing. The refusal
    names the losses as codes so the web can say it in the user's language.
    """
    # Locked here, not inside the repo call, so the capability comparison and
    # the pointer move see the same current version. Without the lock a
    # concurrent save between the two would mean the user acknowledged losses
    # that were computed against a version no longer current.
    artifact = await artifacts_repo.get_artifact(scope, session, artifact_id, for_update=True)
    target = await artifacts_repo.get_version(scope, session, version_id)
    if target.artifact_id != artifact.id:
        raise HTTPException(status_code=404, detail="artifact version")
    if not body.acknowledge_capability_loss and artifact.current_version_id is not None:
        current = await artifacts_repo.get_version(scope, session, artifact.current_version_id)
        losses = restore_losses(capabilities_of(current), capabilities_of(target))
        if losses:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": (
                        "Restoring this version would leave the artifact without "
                        + ", ".join(losses)
                        + ". Confirm to restore it anyway."
                    ),
                    "reason": "restore_loses_capabilities",
                    "losses": losses,
                },
            )
    return _to_version(
        await artifacts_repo.restore_version(scope, session, artifact_id, version_id)
    )
