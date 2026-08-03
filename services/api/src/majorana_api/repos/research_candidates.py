"""Private append-only persistence for validated Phase 9 LLM candidates.

The repository stores already-validated structured envelopes. It rechecks the
canonical digest, source identity, bounded schema shape, and fail-closed
lifecycle fields before writing. Review and materialization live in separate
append-only records. Materialization remains private, structured-only, and
cannot publish or qualify execution.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import uuid
from collections.abc import Mapping
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus
from majorana_contracts.enums import Framework as ContractFramework
from majorana_llm import DeclaredEvidenceInput, assemble_research_evidence_bundle
from majorana_vqe.models import ComponentType
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from ..orm import (
    GitHubRepositorySnapshotFileRow,
    GitHubRepositorySnapshotRow,
    VqeResearchCandidateEnvelopeRow,
    VqeResearchCandidateMaterializationRequestRow,
    VqeResearchCandidateMaterializationRow,
    VqeResearchCandidatePersistRequestRow,
    VqeResearchCandidateReviewRequestRow,
    VqeResearchCandidateReviewRow,
)
from ..vqe_metadata_assertions import EXTRACTOR_VERSION, extract_metadata_assertions
from ..vqe_standard_sources import require_approved_github_source
from . import artifacts as artifacts_repo
from ._base import NotFoundError, RepoError, require_admin, require_write

MAX_ENVELOPE_BYTES = 256 * 1024
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_PROVIDER_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
_EVIDENCE_ID_RE = re.compile(r"^ev_[a-z0-9][a-z0-9_.-]{0,63}$")
_CANDIDATE_ID_RE = re.compile(r"^candidate_[a-z0-9][a-z0-9_.-]{0,63}$")
_PRIVATE_METADATA_SPDX = frozenset({"Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "MIT"})
_MATERIALIZATION_REQUIRED_FIELDS = {
    "implementation": frozenset(
        {
            "name",
            "component_type",
            "provider",
            "package",
            "module",
            "symbol",
            "version",
            "license_expression",
            "repository_url",
            "commit_sha",
        }
    ),
    "component": frozenset({"name", "component_type", "license_expression"}),
    "problem": frozenset({"name", "problem_family", "license_expression"}),
    "dataset": frozenset({"name", "dataset_name", "license_expression"}),
    "experiment": frozenset({"name", "workflow_roles", "license_expression"}),
}
_TOP_LEVEL_KEYS = frozenset(
    {
        "envelope_version",
        "prompt_version",
        "policy_version",
        "response_schema_version",
        "repository_id",
        "commit_sha",
        "snapshot_sha256",
        "input_bundle_sha256",
        "response_sha256",
        "provider",
        "requested_model",
        "served_model",
        "input_tokens",
        "output_tokens",
        "response",
        "machine_validation_state",
        "human_review_state",
        "publication_eligible",
        "materialization_eligible",
    }
)
_CANDIDATE_TYPES = frozenset({"implementation", "component", "problem", "dataset", "experiment"})
_CANDIDATE_FIELD_KEYS = frozenset(
    {
        "name",
        "description",
        "component_type",
        "provider",
        "package",
        "module",
        "symbol",
        "version",
        "license_expression",
        "repository_url",
        "commit_sha",
        "problem_family",
        "molecule",
        "geometry",
        "basis_set",
        "active_space",
        "charge",
        "multiplicity",
        "dataset_name",
        "workflow_roles",
        "optimizer",
        "measurement",
        "evaluation_protocol",
    }
)


class ResearchCandidatePersistenceError(RepoError):
    """The envelope or its immutable source binding is invalid."""


class ResearchCandidateIdempotencyConflictError(RepoError):
    """An idempotency key was reused for a different candidate envelope."""


class ResearchCandidateReviewError(RepoError):
    """A review was incomplete, stale, unsupported, or not evidence-bound."""


class ResearchCandidateReviewIdempotencyConflictError(RepoError):
    """A review request key was reused for materially different content."""


class ResearchCandidateMaterializationError(RepoError):
    """An accepted review failed a transactional materialization gate."""


class ResearchCandidateMaterializationIdempotencyConflictError(RepoError):
    """A materialization key was reused for a different accepted review."""


@dataclasses.dataclass(frozen=True)
class PersistedResearchCandidateEnvelope:
    envelope_id: uuid.UUID
    persist_request_id: uuid.UUID
    envelope_sha256: str
    replayed_envelope: bool
    replayed_request: bool


@dataclasses.dataclass(frozen=True)
class ResearchCandidateReviewView:
    envelope_id: uuid.UUID
    envelope_sha256: str
    candidate: dict[str, Any]
    candidate_sha256: str
    source_snapshot_sha256: str
    evidence_bundle_sha256: str
    evidence: tuple[dict[str, Any], ...]
    latest_review: VqeResearchCandidateReviewRow | None


@dataclasses.dataclass(frozen=True)
class PersistedResearchCandidateReview:
    review: VqeResearchCandidateReviewRow
    request_id: uuid.UUID
    replayed_review: bool
    replayed_request: bool


@dataclasses.dataclass(frozen=True)
class PersistedResearchCandidateMaterialization:
    materialization: VqeResearchCandidateMaterializationRow
    request_id: uuid.UUID
    replayed_materialization: bool
    replayed_request: bool


def _canonical_json(value: object) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ResearchCandidatePersistenceError("envelope_not_canonical_json") from exc


def _sha256_json(value: object) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _require_exact_keys(value: object, expected: frozenset[str], *, code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ResearchCandidatePersistenceError(code)
    return value


def _require_nonempty_string(value: object, *, maximum: int, code: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        raise ResearchCandidatePersistenceError(code)
    return value


def _validate_evidence_ids(
    value: object,
    *,
    minimum: int,
    code: str,
) -> None:
    if (
        not isinstance(value, list)
        or not minimum <= len(value) <= 8
        or any(not isinstance(item, str) or not _EVIDENCE_ID_RE.fullmatch(item) for item in value)
        or len(set(value)) != len(value)
    ):
        raise ResearchCandidatePersistenceError(code)


def _validate_candidate_shape(candidate: object) -> None:
    row = _require_exact_keys(
        candidate,
        frozenset({"local_id", "candidate_type", "fields", "unknowns", "conflicts"}),
        code="invalid_candidate_shape",
    )
    if row["candidate_type"] not in _CANDIDATE_TYPES:
        raise ResearchCandidatePersistenceError("invalid_candidate_type")
    candidate_id = _require_nonempty_string(
        row["local_id"], maximum=74, code="invalid_candidate_id"
    )
    if not _CANDIDATE_ID_RE.fullmatch(candidate_id):
        raise ResearchCandidatePersistenceError("invalid_candidate_id")

    fields = row["fields"]
    unknowns = row["unknowns"]
    conflicts = row["conflicts"]
    if not isinstance(fields, list) or not 1 <= len(fields) <= 40:
        raise ResearchCandidatePersistenceError("invalid_candidate_fields")
    if not isinstance(unknowns, list) or len(unknowns) > 40:
        raise ResearchCandidatePersistenceError("invalid_candidate_unknowns")
    if not isinstance(conflicts, list) or len(conflicts) > 40:
        raise ResearchCandidatePersistenceError("invalid_candidate_conflicts")

    field_names: set[str] = set()
    for field in fields:
        item = _require_exact_keys(
            field,
            frozenset({"field", "value", "evidence_ids"}),
            code="invalid_candidate_field_shape",
        )
        name = _require_nonempty_string(
            item["field"], maximum=128, code="invalid_candidate_field_name"
        )
        if name not in _CANDIDATE_FIELD_KEYS:
            raise ResearchCandidatePersistenceError("invalid_candidate_field_name")
        if name in field_names:
            raise ResearchCandidatePersistenceError("duplicate_candidate_field")
        field_names.add(name)
        _validate_evidence_ids(
            item["evidence_ids"],
            minimum=1,
            code="invalid_candidate_evidence_refs",
        )

    for unknown in unknowns:
        item = _require_exact_keys(
            unknown,
            frozenset({"topic", "reason", "evidence_ids"}),
            code="invalid_candidate_unknown_shape",
        )
        _require_nonempty_string(item["topic"], maximum=128, code="invalid_unknown_topic")
        _require_nonempty_string(item["reason"], maximum=512, code="invalid_unknown_reason")
        _validate_evidence_ids(
            item["evidence_ids"],
            minimum=0,
            code="invalid_unknown_evidence_refs",
        )

    for conflict in conflicts:
        item = _require_exact_keys(
            conflict,
            frozenset({"topic", "description", "evidence_ids"}),
            code="invalid_candidate_conflict_shape",
        )
        _require_nonempty_string(item["topic"], maximum=128, code="invalid_conflict_topic")
        _require_nonempty_string(
            item["description"], maximum=512, code="invalid_conflict_description"
        )
        _validate_evidence_ids(
            item["evidence_ids"],
            minimum=2,
            code="invalid_conflict_evidence_refs",
        )


def validate_persisted_envelope(envelope: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    """Recheck the strict, private persistence subset and canonical digest."""

    data = dict(envelope)
    _require_exact_keys(data, _TOP_LEVEL_KEYS, code="invalid_envelope_shape")
    encoded = _canonical_json(data)
    if len(encoded) > MAX_ENVELOPE_BYTES:
        raise ResearchCandidatePersistenceError("envelope_too_large")

    exact_values = {
        "envelope_version": "atlas.research-candidate-envelope.v1",
        "prompt_version": "atlas.research-extraction.prompt.v1",
        "policy_version": "atlas.research-candidate-policy.v1",
        "response_schema_version": "atlas.research-candidate-response.v1",
        "machine_validation_state": "schema_and_evidence_validated",
        "human_review_state": "unreviewed",
        "publication_eligible": False,
        "materialization_eligible": False,
    }
    if any(data[key] != value for key, value in exact_values.items()):
        raise ResearchCandidatePersistenceError("invalid_private_lifecycle_state")
    if not isinstance(data["repository_id"], int) or isinstance(data["repository_id"], bool):
        raise ResearchCandidatePersistenceError("invalid_repository_id")
    if data["repository_id"] <= 0:
        raise ResearchCandidatePersistenceError("invalid_repository_id")
    if not isinstance(data["commit_sha"], str) or not _COMMIT_RE.fullmatch(data["commit_sha"]):
        raise ResearchCandidatePersistenceError("invalid_commit_sha")
    for key in ("snapshot_sha256", "input_bundle_sha256", "response_sha256"):
        if not isinstance(data[key], str) or not _SHA256_RE.fullmatch(data[key]):
            raise ResearchCandidatePersistenceError(f"invalid_{key}")
    if not isinstance(data["provider"], str) or not _PROVIDER_RE.fullmatch(data["provider"]):
        raise ResearchCandidatePersistenceError("invalid_provider")
    for key in ("requested_model", "served_model"):
        _require_nonempty_string(data[key], maximum=128, code=f"invalid_{key}")
    for key in ("input_tokens", "output_tokens"):
        if not isinstance(data[key], int) or isinstance(data[key], bool) or data[key] < 0:
            raise ResearchCandidatePersistenceError(f"invalid_{key}")

    response = _require_exact_keys(
        data["response"],
        frozenset({"schema_version", "candidates"}),
        code="invalid_response_shape",
    )
    if response["schema_version"] != data["response_schema_version"]:
        raise ResearchCandidatePersistenceError("response_schema_version_mismatch")
    candidates = response["candidates"]
    if not isinstance(candidates, list) or len(candidates) > 20:
        raise ResearchCandidatePersistenceError("invalid_candidate_count")
    candidate_ids: set[str] = set()
    for candidate in candidates:
        _validate_candidate_shape(candidate)
        candidate_id = candidate["local_id"]
        if candidate_id in candidate_ids:
            raise ResearchCandidatePersistenceError("duplicate_candidate_id")
        candidate_ids.add(candidate_id)

    return data, hashlib.sha256(encoded).hexdigest()


def _request_descriptor(*, source_snapshot_id: uuid.UUID, envelope_sha256: str) -> dict[str, str]:
    return {
        "operation": "persist_validated_research_candidate_envelope",
        "source_snapshot_id": str(source_snapshot_id),
        "envelope_sha256": envelope_sha256,
    }


async def _find_envelope(
    scope: Scope,
    session: AsyncSession,
    *,
    envelope_sha256: str,
) -> VqeResearchCandidateEnvelopeRow | None:
    return (
        (
            await session.execute(
                select(VqeResearchCandidateEnvelopeRow).where(
                    VqeResearchCandidateEnvelopeRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidateEnvelopeRow.envelope_sha256 == envelope_sha256,
                )
            )
        )
        .scalars()
        .first()
    )


async def _find_request(
    scope: Scope,
    session: AsyncSession,
    *,
    idempotency_key: str,
) -> VqeResearchCandidatePersistRequestRow | None:
    return (
        (
            await session.execute(
                select(VqeResearchCandidatePersistRequestRow).where(
                    VqeResearchCandidatePersistRequestRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidatePersistRequestRow.idempotency_key == idempotency_key,
                )
            )
        )
        .scalars()
        .first()
    )


def _assert_envelope_matches(
    row: VqeResearchCandidateEnvelopeRow,
    *,
    source_snapshot_id: uuid.UUID,
    envelope: dict[str, Any],
    envelope_sha256: str,
) -> None:
    expected = {
        "source_snapshot_id": source_snapshot_id,
        "envelope_sha256": envelope_sha256,
        "envelope_json": envelope,
        "repository_id": envelope["repository_id"],
        "commit_sha": envelope["commit_sha"],
        "snapshot_sha256": envelope["snapshot_sha256"],
        "input_bundle_sha256": envelope["input_bundle_sha256"],
        "response_sha256": envelope["response_sha256"],
    }
    if any(getattr(row, key) != value for key, value in expected.items()):
        raise ResearchCandidatePersistenceError("immutable_envelope_digest_conflict")


async def persist_research_candidate_envelope(
    scope: Scope,
    session: AsyncSession,
    *,
    source_snapshot_id: uuid.UUID,
    envelope: Mapping[str, Any],
    idempotency_key: str,
) -> PersistedResearchCandidateEnvelope:
    """Persist a validated private envelope and an idempotent request binding.

    The caller owns commit/rollback. Concurrent inserts converge through
    PostgreSQL uniqueness and ``ON CONFLICT DO NOTHING``; materially different
    requests using the same key fail closed.
    """

    require_write(scope)
    if not 1 <= len(idempotency_key) <= 255:
        raise ResearchCandidatePersistenceError("invalid_idempotency_key")
    validated, envelope_sha256 = validate_persisted_envelope(envelope)
    descriptor = _request_descriptor(
        source_snapshot_id=source_snapshot_id,
        envelope_sha256=envelope_sha256,
    )
    descriptor_sha256 = _sha256_json(descriptor)

    existing_request = await _find_request(scope, session, idempotency_key=idempotency_key)
    if existing_request is not None:
        if (
            existing_request.request_descriptor_sha256 != descriptor_sha256
            or existing_request.request_descriptor_json != descriptor
        ):
            raise ResearchCandidateIdempotencyConflictError(
                "idempotency key was already used for a different research candidate"
            )
        envelope_row = await _find_envelope(scope, session, envelope_sha256=envelope_sha256)
        if envelope_row is None or envelope_row.id != existing_request.envelope_id:
            raise ResearchCandidatePersistenceError("persist_request_envelope_missing")
        _assert_envelope_matches(
            envelope_row,
            source_snapshot_id=source_snapshot_id,
            envelope=validated,
            envelope_sha256=envelope_sha256,
        )
        return PersistedResearchCandidateEnvelope(
            envelope_id=envelope_row.id,
            persist_request_id=existing_request.id,
            envelope_sha256=envelope_sha256,
            replayed_envelope=True,
            replayed_request=True,
        )

    source = await session.get(GitHubRepositorySnapshotRow, source_snapshot_id)
    if source is None:
        raise NotFoundError("GitHub repository snapshot")
    if (
        source.repository_id != validated["repository_id"]
        or source.commit_sha != validated["commit_sha"]
        or _sha256_json(source.audit_manifest_json) != validated["snapshot_sha256"]
    ):
        raise ResearchCandidatePersistenceError("source_snapshot_identity_mismatch")

    proposed_envelope_id = uuid7()
    candidates = validated["response"]["candidates"]
    await session.execute(
        pg_insert(VqeResearchCandidateEnvelopeRow)
        .values(
            id=proposed_envelope_id,
            workspace_id=scope.workspace_id,
            created_by_user_id=scope.user_id,
            source_snapshot_id=source_snapshot_id,
            envelope_version=validated["envelope_version"],
            prompt_version=validated["prompt_version"],
            policy_version=validated["policy_version"],
            response_schema_version=validated["response_schema_version"],
            repository_id=validated["repository_id"],
            commit_sha=validated["commit_sha"],
            snapshot_sha256=validated["snapshot_sha256"],
            input_bundle_sha256=validated["input_bundle_sha256"],
            response_sha256=validated["response_sha256"],
            provider=validated["provider"],
            requested_model=validated["requested_model"],
            served_model=validated["served_model"],
            input_tokens=validated["input_tokens"],
            output_tokens=validated["output_tokens"],
            candidate_count=len(candidates),
            machine_validation_state=validated["machine_validation_state"],
            human_review_state=validated["human_review_state"],
            publication_eligible=validated["publication_eligible"],
            materialization_eligible=validated["materialization_eligible"],
            envelope_json=validated,
            envelope_sha256=envelope_sha256,
        )
        .on_conflict_do_nothing(index_elements=["workspace_id", "envelope_sha256"])
    )
    envelope_row = await _find_envelope(scope, session, envelope_sha256=envelope_sha256)
    if envelope_row is None:
        raise ResearchCandidatePersistenceError("envelope_insert_not_observable")
    _assert_envelope_matches(
        envelope_row,
        source_snapshot_id=source_snapshot_id,
        envelope=validated,
        envelope_sha256=envelope_sha256,
    )

    proposed_request_id = uuid7()
    await session.execute(
        pg_insert(VqeResearchCandidatePersistRequestRow)
        .values(
            id=proposed_request_id,
            workspace_id=scope.workspace_id,
            envelope_id=envelope_row.id,
            created_by_user_id=scope.user_id,
            idempotency_key=idempotency_key,
            request_descriptor_json=descriptor,
            request_descriptor_sha256=descriptor_sha256,
        )
        .on_conflict_do_nothing(index_elements=["workspace_id", "idempotency_key"])
    )
    request_row = await _find_request(scope, session, idempotency_key=idempotency_key)
    if request_row is None:
        raise ResearchCandidatePersistenceError("persist_request_insert_not_observable")
    if (
        request_row.envelope_id != envelope_row.id
        or request_row.request_descriptor_sha256 != descriptor_sha256
        or request_row.request_descriptor_json != descriptor
    ):
        raise ResearchCandidateIdempotencyConflictError(
            "idempotency key raced with a different research candidate"
        )

    return PersistedResearchCandidateEnvelope(
        envelope_id=envelope_row.id,
        persist_request_id=request_row.id,
        envelope_sha256=envelope_sha256,
        replayed_envelope=envelope_row.id != proposed_envelope_id,
        replayed_request=request_row.id != proposed_request_id,
    )


async def get_research_candidate_envelope(
    scope: Scope,
    session: AsyncSession,
    envelope_id: uuid.UUID,
) -> VqeResearchCandidateEnvelopeRow:
    """Load one in-scope private candidate without changing review state."""

    row = (
        (
            await session.execute(
                select(VqeResearchCandidateEnvelopeRow).where(
                    VqeResearchCandidateEnvelopeRow.id == envelope_id,
                    VqeResearchCandidateEnvelopeRow.workspace_id == scope.workspace_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise NotFoundError("VQE research candidate envelope")
    return row


async def list_research_candidate_envelopes(
    scope: Scope,
    session: AsyncSession,
    *,
    cursor: uuid.UUID | None = None,
    limit: int = 50,
) -> list[VqeResearchCandidateEnvelopeRow]:
    """List only private candidate envelopes inside the active workspace."""

    if not 1 <= limit <= 100:
        raise ResearchCandidatePersistenceError("invalid_list_limit")
    query = (
        select(VqeResearchCandidateEnvelopeRow)
        .where(VqeResearchCandidateEnvelopeRow.workspace_id == scope.workspace_id)
        .order_by(VqeResearchCandidateEnvelopeRow.id.desc())
        .limit(limit)
    )
    if cursor is not None:
        query = query.where(VqeResearchCandidateEnvelopeRow.id < cursor)
    return list((await session.execute(query)).scalars().all())


def _declared_evidence(snapshot: GitHubRepositorySnapshot) -> tuple[DeclaredEvidenceInput, ...]:
    source = require_approved_github_source(snapshot.canonical_repository_url)
    assertions = extract_metadata_assertions(source, snapshot)
    if assertions != extract_metadata_assertions(source, snapshot):
        raise ResearchCandidateReviewError("phase8_extraction_non_deterministic")
    unique: dict[bytes, DeclaredEvidenceInput] = {}
    for assertion in assertions:
        for fact in assertion.declared_facts:
            value: object = list(fact.value) if isinstance(fact.value, tuple) else fact.value
            evidence = DeclaredEvidenceInput(
                field=fact.field,
                value=value,
                path=fact.locator.path,
                pointer=fact.locator.pointer,
                source_sha256=fact.locator.content_sha256,
            )
            unique[_canonical_json(evidence.model_dump(mode="json"))] = evidence
    return tuple(unique[key] for key in sorted(unique))


async def _reconstruct_review_evidence(
    session: AsyncSession,
    envelope: VqeResearchCandidateEnvelopeRow,
) -> tuple[str, tuple[dict[str, Any], ...]]:
    source = await session.get(GitHubRepositorySnapshotRow, envelope.source_snapshot_id)
    if source is None:
        raise ResearchCandidateReviewError("source_snapshot_missing")
    try:
        require_approved_github_source(source.canonical_repository_url)
    except ValueError as exc:
        raise ResearchCandidateReviewError("source_not_owner_approved") from exc
    file_rows = (
        (
            await session.execute(
                select(GitHubRepositorySnapshotFileRow)
                .where(GitHubRepositorySnapshotFileRow.snapshot_id == source.id)
                .order_by(GitHubRepositorySnapshotFileRow.path)
            )
        )
        .scalars()
        .all()
    )
    for item in file_rows:
        if hashlib.sha256(item.content).hexdigest() != item.content_sha256:
            raise ResearchCandidateReviewError("source_file_digest_mismatch")
    snapshot = GitHubRepositorySnapshot(
        api_version=source.api_version,
        repository_id=source.repository_id,
        repository_node_id=source.repository_node_id,
        full_name=source.full_name,
        canonical_repository_url=source.canonical_repository_url,
        requested_ref=source.requested_ref,
        default_branch=source.default_branch,
        archived=source.archived,
        disabled=source.disabled,
        commit_sha=source.commit_sha,
        tree_sha=source.tree_sha,
        tree_entry_count=source.tree_entry_count,
        tree_manifest_sha256=source.tree_manifest_sha256,
        selected_metadata_bytes=source.selected_metadata_bytes,
        skipped_oversized_paths=tuple(source.skipped_oversized_paths),
        metadata_files=tuple(
            GitHubMetadataFile(
                path=item.path,
                mode=item.mode,
                blob_sha=item.blob_sha,
                size=item.size,
                content_sha256=item.content_sha256,
                content=item.content,
            )
            for item in file_rows
        ),
        metadata_manifest_sha256=source.metadata_manifest_sha256,
    )
    if snapshot.audit_manifest() != source.audit_manifest_json:
        raise ResearchCandidateReviewError("source_audit_manifest_mismatch")
    source_snapshot_sha256 = _sha256_json(source.audit_manifest_json)
    if (
        source_snapshot_sha256 != envelope.snapshot_sha256
        or snapshot.repository_id != envelope.repository_id
        or snapshot.commit_sha != envelope.commit_sha
    ):
        raise ResearchCandidateReviewError("source_envelope_identity_mismatch")
    try:
        bundle = assemble_research_evidence_bundle(
            repository_id=snapshot.repository_id,
            commit_sha=snapshot.commit_sha,
            snapshot_sha256=source_snapshot_sha256,
            phase8_extractor_version=EXTRACTOR_VERSION,
            declared_facts=_declared_evidence(snapshot),
        )
    except (TypeError, ValueError) as exc:
        raise ResearchCandidateReviewError("evidence_bundle_reconstruction_failed") from exc
    if bundle.deterministic_digest != envelope.input_bundle_sha256:
        raise ResearchCandidateReviewError("evidence_bundle_digest_mismatch")
    return source_snapshot_sha256, tuple(item.model_dump(mode="json") for item in bundle.items)


def _candidate_from_envelope(
    envelope: VqeResearchCandidateEnvelopeRow,
    candidate_local_id: str,
) -> dict[str, Any]:
    candidates = envelope.envelope_json["response"]["candidates"]
    matches = [item for item in candidates if item["local_id"] == candidate_local_id]
    if len(matches) != 1:
        raise NotFoundError("VQE research candidate")
    return matches[0]


async def _latest_review(
    scope: Scope,
    session: AsyncSession,
    *,
    envelope_id: uuid.UUID,
    candidate_local_id: str,
) -> VqeResearchCandidateReviewRow | None:
    return (
        (
            await session.execute(
                select(VqeResearchCandidateReviewRow)
                .where(
                    VqeResearchCandidateReviewRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidateReviewRow.envelope_id == envelope_id,
                    VqeResearchCandidateReviewRow.candidate_local_id == candidate_local_id,
                )
                .order_by(
                    VqeResearchCandidateReviewRow.created_at.desc(),
                    VqeResearchCandidateReviewRow.id.desc(),
                )
                .limit(1)
            )
        )
        .scalars()
        .first()
    )


async def get_research_candidate_review_view(
    scope: Scope,
    session: AsyncSession,
    *,
    envelope_id: uuid.UUID,
    candidate_local_id: str,
) -> ResearchCandidateReviewView:
    """Resolve one candidate and place immutable evidence next to its fields."""

    envelope = await get_research_candidate_envelope(scope, session, envelope_id)
    candidate = _candidate_from_envelope(envelope, candidate_local_id)
    source_sha256, evidence = await _reconstruct_review_evidence(session, envelope)
    if source_sha256 != envelope.snapshot_sha256:
        raise ResearchCandidateReviewError("source_snapshot_digest_mismatch")
    evidence_by_id = {item["evidence_id"]: item for item in evidence}
    cited_ids = {
        evidence_id
        for section in ("fields", "unknowns", "conflicts")
        for item in candidate[section]
        for evidence_id in item["evidence_ids"]
    }
    if not cited_ids.issubset(evidence_by_id):
        raise ResearchCandidateReviewError("candidate_evidence_reference_unresolved")
    return ResearchCandidateReviewView(
        envelope_id=envelope.id,
        envelope_sha256=envelope.envelope_sha256,
        candidate=candidate,
        candidate_sha256=_sha256_json(candidate),
        source_snapshot_sha256=source_sha256,
        evidence_bundle_sha256=envelope.input_bundle_sha256,
        evidence=tuple(evidence_by_id[key] for key in sorted(cited_ids)),
        latest_review=await _latest_review(
            scope,
            session,
            envelope_id=envelope.id,
            candidate_local_id=candidate_local_id,
        ),
    )


def _validate_review_decisions(
    candidate: dict[str, Any],
    decisions: list[dict[str, Any]],
    *,
    disposition: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    expected: dict[str, tuple[str, dict[str, Any]]] = {}
    for item in candidate["fields"]:
        expected[f"field:{item['field']}"] = ("field", item)
    for index, item in enumerate(candidate["unknowns"]):
        expected[f"unknown:{index}"] = ("unknown", item)
    for index, item in enumerate(candidate["conflicts"]):
        expected[f"conflict:{index}"] = ("conflict", item)
    if len(decisions) != len(expected):
        raise ResearchCandidateReviewError("review_decisions_incomplete")

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    edits: dict[str, object] = {}
    for raw in decisions:
        if not isinstance(raw, dict) or set(raw) != {
            "subject_id",
            "decision",
            "edited_value",
            "rationale",
        }:
            raise ResearchCandidateReviewError("invalid_review_decision_shape")
        subject_id = raw["subject_id"]
        if not isinstance(subject_id, str) or subject_id not in expected or subject_id in seen:
            raise ResearchCandidateReviewError("invalid_review_subject")
        seen.add(subject_id)
        kind, original = expected[subject_id]
        allowed = {
            "field": {"accept", "reject", "edit"},
            "unknown": {"acknowledge"},
            "conflict": {"acknowledge"},
        }[kind]
        decision = raw["decision"]
        if decision not in allowed:
            raise ResearchCandidateReviewError("invalid_review_decision")
        rationale = raw["rationale"]
        if not isinstance(rationale, str) or not 1 <= len(rationale) <= 1000:
            raise ResearchCandidateReviewError("invalid_review_rationale")
        if decision == "edit":
            encoded = _canonical_json(raw["edited_value"])
            if len(encoded) > 16_384:
                raise ResearchCandidateReviewError("review_edit_too_large")
            edits[original["field"]] = raw["edited_value"]
        elif raw["edited_value"] is not None:
            raise ResearchCandidateReviewError("unexpected_review_edit")
        normalized.append(
            {
                "subject_id": subject_id,
                "decision": decision,
                "edited_value": raw["edited_value"],
                "rationale": rationale,
                "evidence_ids": list(original["evidence_ids"]),
            }
        )

    if disposition not in {"accepted", "rejected", "needs_resolution"}:
        raise ResearchCandidateReviewError("invalid_review_disposition")
    field_decisions = [
        item["decision"] for item in normalized if item["subject_id"].startswith("field:")
    ]
    has_open_scientific_issue = bool(candidate["unknowns"] or candidate["conflicts"])
    if disposition == "accepted" and (
        has_open_scientific_issue or any(item not in {"accept", "edit"} for item in field_decisions)
    ):
        raise ResearchCandidateReviewError("candidate_not_acceptable_with_open_issues")
    if disposition == "needs_resolution" and not (
        has_open_scientific_issue or any(item == "reject" for item in field_decisions)
    ):
        raise ResearchCandidateReviewError("needs_resolution_without_open_issue")

    reviewed = json.loads(json.dumps(candidate))
    for field in reviewed["fields"]:
        if field["field"] in edits:
            field["value"] = edits[field["field"]]
            field["review_provenance"] = "workspace_human_edit"
    return sorted(normalized, key=lambda item: item["subject_id"]), reviewed


async def _find_review_request(
    scope: Scope,
    session: AsyncSession,
    idempotency_key: str,
) -> VqeResearchCandidateReviewRequestRow | None:
    return (
        (
            await session.execute(
                select(VqeResearchCandidateReviewRequestRow).where(
                    VqeResearchCandidateReviewRequestRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidateReviewRequestRow.idempotency_key == idempotency_key,
                )
            )
        )
        .scalars()
        .first()
    )


async def create_research_candidate_review(
    scope: Scope,
    session: AsyncSession,
    *,
    envelope_id: uuid.UUID,
    candidate_local_id: str,
    expected_envelope_sha256: str,
    expected_candidate_sha256: str,
    expected_evidence_bundle_sha256: str,
    disposition: str,
    decisions: list[dict[str, Any]],
    rationale: str,
    idempotency_key: str,
) -> PersistedResearchCandidateReview:
    """Append an evidence-bound workspace review without claiming independence."""

    require_admin(scope)
    if not 1 <= len(idempotency_key) <= 255:
        raise ResearchCandidateReviewError("invalid_idempotency_key")
    if not isinstance(rationale, str) or not 1 <= len(rationale) <= 2000:
        raise ResearchCandidateReviewError("invalid_review_rationale")
    view = await get_research_candidate_review_view(
        scope,
        session,
        envelope_id=envelope_id,
        candidate_local_id=candidate_local_id,
    )
    if (
        view.envelope_sha256 != expected_envelope_sha256
        or view.candidate_sha256 != expected_candidate_sha256
        or view.evidence_bundle_sha256 != expected_evidence_bundle_sha256
    ):
        raise ResearchCandidateReviewError("stale_review_input")
    normalized, reviewed_candidate = _validate_review_decisions(
        view.candidate,
        decisions,
        disposition=disposition,
    )
    reviewed_candidate_sha256 = _sha256_json(reviewed_candidate)
    previous_review_id = view.latest_review.id if view.latest_review is not None else None
    review_payload = {
        "review_schema_version": "atlas.research-candidate-review.v1",
        "envelope_id": str(envelope_id),
        "candidate_local_id": candidate_local_id,
        "previous_review_id": str(previous_review_id) if previous_review_id else None,
        "review_kind": "workspace_human_review",
        "independence_state": "not_asserted",
        "disposition": disposition,
        "source_snapshot_sha256": view.source_snapshot_sha256,
        "evidence_bundle_sha256": view.evidence_bundle_sha256,
        "base_candidate_sha256": view.candidate_sha256,
        "reviewed_candidate_sha256": reviewed_candidate_sha256,
        "decisions": normalized,
        "rationale": rationale,
    }
    review_sha256 = _sha256_json(review_payload)
    descriptor = {
        "operation": "create_vqe_research_candidate_review",
        "review_sha256": review_sha256,
    }
    descriptor_sha256 = _sha256_json(descriptor)
    existing_request = await _find_review_request(scope, session, idempotency_key)
    if existing_request is not None:
        if (
            existing_request.request_descriptor_json != descriptor
            or existing_request.request_descriptor_sha256 != descriptor_sha256
        ):
            raise ResearchCandidateReviewIdempotencyConflictError(
                "idempotency key was already used for a different review"
            )
        review = await session.get(VqeResearchCandidateReviewRow, existing_request.review_id)
        if review is None or review.workspace_id != scope.workspace_id:
            raise ResearchCandidateReviewError("review_request_target_missing")
        return PersistedResearchCandidateReview(
            review=review,
            request_id=existing_request.id,
            replayed_review=True,
            replayed_request=True,
        )

    proposed_review_id = uuid7()
    await session.execute(
        pg_insert(VqeResearchCandidateReviewRow)
        .values(
            id=proposed_review_id,
            workspace_id=scope.workspace_id,
            envelope_id=envelope_id,
            previous_review_id=previous_review_id,
            reviewer_user_id=scope.user_id,
            candidate_local_id=candidate_local_id,
            review_kind="workspace_human_review",
            independence_state="not_asserted",
            disposition=disposition,
            source_snapshot_sha256=view.source_snapshot_sha256,
            evidence_bundle_sha256=view.evidence_bundle_sha256,
            base_candidate_sha256=view.candidate_sha256,
            reviewed_candidate_json=reviewed_candidate,
            reviewed_candidate_sha256=reviewed_candidate_sha256,
            decisions_json=normalized,
            rationale=rationale,
            review_sha256=review_sha256,
        )
        .on_conflict_do_nothing(
            index_elements=[
                "workspace_id",
                "envelope_id",
                "candidate_local_id",
                "review_sha256",
            ]
        )
    )
    review = (
        (
            await session.execute(
                select(VqeResearchCandidateReviewRow).where(
                    VqeResearchCandidateReviewRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidateReviewRow.envelope_id == envelope_id,
                    VqeResearchCandidateReviewRow.candidate_local_id == candidate_local_id,
                    VqeResearchCandidateReviewRow.review_sha256 == review_sha256,
                )
            )
        )
        .scalars()
        .one()
    )
    proposed_request_id = uuid7()
    await session.execute(
        pg_insert(VqeResearchCandidateReviewRequestRow)
        .values(
            id=proposed_request_id,
            workspace_id=scope.workspace_id,
            review_id=review.id,
            requested_by_user_id=scope.user_id,
            idempotency_key=idempotency_key,
            request_descriptor_json=descriptor,
            request_descriptor_sha256=descriptor_sha256,
        )
        .on_conflict_do_nothing(index_elements=["workspace_id", "idempotency_key"])
    )
    request = await _find_review_request(scope, session, idempotency_key)
    if request is None:
        raise ResearchCandidateReviewError("review_request_insert_not_observable")
    if (
        request.review_id != review.id
        or request.request_descriptor_json != descriptor
        or request.request_descriptor_sha256 != descriptor_sha256
    ):
        raise ResearchCandidateReviewIdempotencyConflictError(
            "idempotency key raced with a different review"
        )
    return PersistedResearchCandidateReview(
        review=review,
        request_id=request.id,
        replayed_review=review.id != proposed_review_id,
        replayed_request=request.id != proposed_request_id,
    )


def _review_identity_payload(review: VqeResearchCandidateReviewRow) -> dict[str, Any]:
    return {
        "review_schema_version": "atlas.research-candidate-review.v1",
        "envelope_id": str(review.envelope_id),
        "candidate_local_id": review.candidate_local_id,
        "previous_review_id": str(review.previous_review_id) if review.previous_review_id else None,
        "review_kind": review.review_kind,
        "independence_state": review.independence_state,
        "disposition": review.disposition,
        "source_snapshot_sha256": review.source_snapshot_sha256,
        "evidence_bundle_sha256": review.evidence_bundle_sha256,
        "base_candidate_sha256": review.base_candidate_sha256,
        "reviewed_candidate_sha256": review.reviewed_candidate_sha256,
        "decisions": review.decisions_json,
        "rationale": review.rationale,
    }


def _field_map(candidate: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    fields = candidate.get("fields")
    if not isinstance(fields, list):
        raise ResearchCandidateMaterializationError("reviewed_candidate_fields_invalid")
    result: dict[str, dict[str, Any]] = {}
    for raw in fields:
        if not isinstance(raw, dict) or not isinstance(raw.get("field"), str):
            raise ResearchCandidateMaterializationError("reviewed_candidate_fields_invalid")
        key = raw["field"]
        if key in result:
            raise ResearchCandidateMaterializationError("reviewed_candidate_field_duplicate")
        result[key] = raw
    return result


def _build_private_materialization_contract(
    review: VqeResearchCandidateReviewRow,
    *,
    evidence: tuple[dict[str, Any], ...],
    source_repository_url: str,
    source_commit_sha: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """Validate accepted content and return license, contract, and bundle.

    This intentionally supports only structured private metadata.  It does not
    create a canonical component definition, copy source code, authorize
    publication, or qualify an execution implementation.
    """

    candidate = review.reviewed_candidate_json
    if not isinstance(candidate, dict):
        raise ResearchCandidateMaterializationError("reviewed_candidate_invalid")
    if candidate.get("unknowns") or candidate.get("conflicts"):
        raise ResearchCandidateMaterializationError("reviewed_candidate_has_open_issues")
    candidate_type = candidate.get("candidate_type")
    if candidate_type not in _MATERIALIZATION_REQUIRED_FIELDS:
        raise ResearchCandidateMaterializationError("reviewed_candidate_type_unsupported")
    fields = _field_map(candidate)
    missing = _MATERIALIZATION_REQUIRED_FIELDS[candidate_type] - fields.keys()
    if missing:
        raise ResearchCandidateMaterializationError("reviewed_candidate_required_fields_missing")

    decision_by_subject = {
        item.get("subject_id"): item
        for item in review.decisions_json
        if isinstance(item, dict) and isinstance(item.get("subject_id"), str)
    }
    if len(decision_by_subject) != len(review.decisions_json):
        raise ResearchCandidateMaterializationError("review_decisions_invalid")
    for field_name in fields:
        decision = decision_by_subject.get(f"field:{field_name}")
        if not isinstance(decision, dict) or decision.get("decision") not in {"accept", "edit"}:
            raise ResearchCandidateMaterializationError("review_field_not_accepted")

    license_field = fields["license_expression"]
    license_decision = decision_by_subject.get("field:license_expression")
    license_expression = license_field.get("value")
    if (
        not isinstance(license_expression, str)
        or license_expression not in _PRIVATE_METADATA_SPDX
        or not isinstance(license_decision, dict)
        or license_decision.get("decision") != "accept"
    ):
        raise ResearchCandidateMaterializationError("license_gate_not_satisfied")
    evidence_by_id = {item.get("evidence_id"): item for item in evidence}
    license_evidence = [
        evidence_by_id.get(evidence_id) for evidence_id in license_field.get("evidence_ids", [])
    ]
    if not license_evidence or not any(
        isinstance(item, dict)
        and isinstance(item.get("declared_value"), dict)
        and item["declared_value"].get("field") == "citation.license"
        and item["declared_value"].get("value") == license_expression
        for item in license_evidence
    ):
        raise ResearchCandidateMaterializationError("license_evidence_not_exact")

    if candidate_type == "implementation":
        for identity_field, expected in (
            ("repository_url", source_repository_url),
            ("commit_sha", source_commit_sha),
        ):
            decision = decision_by_subject.get(f"field:{identity_field}")
            if (
                fields[identity_field].get("value") != expected
                or not isinstance(decision, dict)
                or decision.get("decision") != "accept"
            ):
                raise ResearchCandidateMaterializationError("source_identity_field_mismatch")

    component_type = fields.get("component_type", {}).get("value")
    if candidate_type in {"implementation", "component"}:
        try:
            component_type = ComponentType(component_type).value
        except (TypeError, ValueError) as exc:
            raise ResearchCandidateMaterializationError(
                "compatibility_component_type_unsupported"
            ) from exc
    else:
        component_type = None

    contract = {
        "schema_version": "atlas.research-candidate-compatibility.v1",
        "candidate_type": candidate_type,
        "component_type": component_type,
        "representation": "structured_private_metadata_only",
        "registry_promotion": "blocked",
        "execution_eligible": False,
        "publication_eligible": False,
        "source_code_included": False,
    }
    bundle = {
        "schema_version": "atlas.research-candidate-materialization.v1",
        "candidate": candidate,
        "source": {
            "repository_url": source_repository_url,
            "commit_sha": source_commit_sha,
            "snapshot_sha256": review.source_snapshot_sha256,
            "evidence_bundle_sha256": review.evidence_bundle_sha256,
        },
        "review": {
            "id": str(review.id),
            "kind": review.review_kind,
            "independence_state": review.independence_state,
            "review_sha256": review.review_sha256,
            "reviewed_candidate_sha256": review.reviewed_candidate_sha256,
        },
        "license": {
            "expression": license_expression,
            "gate": "source_declared_spdx_private_metadata_only_v1",
            "publication_authority": False,
        },
        "compatibility": contract,
        "publication_eligible": False,
        "execution_eligible": False,
    }
    return license_expression, contract, bundle


async def _find_materialization_request(
    scope: Scope,
    session: AsyncSession,
    idempotency_key: str,
) -> VqeResearchCandidateMaterializationRequestRow | None:
    return (
        (
            await session.execute(
                select(VqeResearchCandidateMaterializationRequestRow).where(
                    VqeResearchCandidateMaterializationRequestRow.workspace_id
                    == scope.workspace_id,
                    VqeResearchCandidateMaterializationRequestRow.idempotency_key
                    == idempotency_key,
                )
            )
        )
        .scalars()
        .first()
    )


async def materialize_research_candidate_review(
    scope: Scope,
    session: AsyncSession,
    *,
    envelope_id: uuid.UUID,
    review_id: uuid.UUID,
    expected_review_sha256: str,
    expected_reviewed_candidate_sha256: str,
    expected_evidence_bundle_sha256: str,
    idempotency_key: str,
) -> PersistedResearchCandidateMaterialization:
    """Materialize one accepted reviewed version in the caller transaction."""

    require_admin(scope)
    if not 1 <= len(idempotency_key) <= 255:
        raise ResearchCandidateMaterializationError("invalid_idempotency_key")
    descriptor = {
        "operation": "materialize_vqe_research_candidate_review",
        "envelope_id": str(envelope_id),
        "review_id": str(review_id),
        "expected_review_sha256": expected_review_sha256,
        "expected_reviewed_candidate_sha256": expected_reviewed_candidate_sha256,
        "expected_evidence_bundle_sha256": expected_evidence_bundle_sha256,
    }
    descriptor_sha256 = _sha256_json(descriptor)
    existing_request = await _find_materialization_request(scope, session, idempotency_key)
    if existing_request is not None:
        if (
            existing_request.request_descriptor_json != descriptor
            or existing_request.request_descriptor_sha256 != descriptor_sha256
        ):
            raise ResearchCandidateMaterializationIdempotencyConflictError(
                "idempotency key was already used for a different materialization"
            )
        existing = await session.get(
            VqeResearchCandidateMaterializationRow,
            existing_request.materialization_id,
        )
        if existing is None or existing.workspace_id != scope.workspace_id:
            raise ResearchCandidateMaterializationError("materialization_request_target_missing")
        return PersistedResearchCandidateMaterialization(
            materialization=existing,
            request_id=existing_request.id,
            replayed_materialization=True,
            replayed_request=True,
        )

    review = (
        (
            await session.execute(
                select(VqeResearchCandidateReviewRow)
                .where(
                    VqeResearchCandidateReviewRow.id == review_id,
                    VqeResearchCandidateReviewRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidateReviewRow.envelope_id == envelope_id,
                )
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if review is None:
        raise NotFoundError("research candidate review")
    if review.disposition != "accepted":
        raise ResearchCandidateMaterializationError("review_not_accepted")
    if (
        review.review_sha256 != expected_review_sha256
        or review.reviewed_candidate_sha256 != expected_reviewed_candidate_sha256
        or review.evidence_bundle_sha256 != expected_evidence_bundle_sha256
    ):
        raise ResearchCandidateMaterializationError("stale_materialization_input")
    if _sha256_json(review.reviewed_candidate_json) != review.reviewed_candidate_sha256:
        raise ResearchCandidateMaterializationError("reviewed_candidate_digest_mismatch")
    if _sha256_json(_review_identity_payload(review)) != review.review_sha256:
        raise ResearchCandidateMaterializationError("review_digest_mismatch")

    latest = await _latest_review(
        scope,
        session,
        envelope_id=envelope_id,
        candidate_local_id=review.candidate_local_id,
    )
    if latest is None or latest.id != review.id:
        raise ResearchCandidateMaterializationError("review_is_not_latest")
    view = await get_research_candidate_review_view(
        scope,
        session,
        envelope_id=envelope_id,
        candidate_local_id=review.candidate_local_id,
    )
    if (
        view.candidate_sha256 != review.base_candidate_sha256
        or view.source_snapshot_sha256 != review.source_snapshot_sha256
        or view.evidence_bundle_sha256 != review.evidence_bundle_sha256
    ):
        raise ResearchCandidateMaterializationError("review_evidence_binding_mismatch")
    envelope = await get_research_candidate_envelope(scope, session, envelope_id)
    source = await session.get(GitHubRepositorySnapshotRow, envelope.source_snapshot_id)
    if source is None:
        raise ResearchCandidateMaterializationError("source_snapshot_missing")
    license_expression, compatibility, bundle = _build_private_materialization_contract(
        review,
        evidence=view.evidence,
        source_repository_url=source.canonical_repository_url,
        source_commit_sha=source.commit_sha,
    )
    compatibility_sha256 = _sha256_json(compatibility)
    bundle_sha256 = _sha256_json(bundle)

    existing = (
        (
            await session.execute(
                select(VqeResearchCandidateMaterializationRow).where(
                    VqeResearchCandidateMaterializationRow.workspace_id == scope.workspace_id,
                    VqeResearchCandidateMaterializationRow.review_id == review.id,
                )
            )
        )
        .scalars()
        .first()
    )
    replayed_materialization = existing is not None
    if existing is not None and (
        existing.envelope_id != envelope_id
        or existing.review_sha256 != review.review_sha256
        or existing.reviewed_candidate_sha256 != review.reviewed_candidate_sha256
        or existing.source_snapshot_sha256 != review.source_snapshot_sha256
        or existing.evidence_bundle_sha256 != review.evidence_bundle_sha256
        or existing.license_expression != license_expression
        or existing.compatibility_contract_sha256 != compatibility_sha256
        or existing.materialized_bundle_sha256 != bundle_sha256
        or existing.publication_eligible
        or existing.execution_eligible
    ):
        raise ResearchCandidateMaterializationError("stored_materialization_identity_mismatch")
    if existing is None:
        workspace_suffix = hashlib.sha256(str(scope.workspace_id).encode()).hexdigest()[:12]
        slug = f"vqe-research-{review.review_sha256[:20]}-{workspace_suffix}"
        artifact = await artifacts_repo.get_artifact_by_slug(scope, session, slug)
        if artifact is not None:
            raise ResearchCandidateMaterializationError("materialization_artifact_slug_collision")
        title_field = _field_map(review.reviewed_candidate_json).get("name", {})
        title = title_field.get("value")
        if not isinstance(title, str) or not title.strip():
            title = review.candidate_local_id
        artifact = await artifacts_repo.create_artifact(
            scope,
            session,
            slug=slug,
            title=f"Reviewed VQE research candidate: {title.strip()[:160]}",
            family=Algorithm.VQE,
            # Legacy storage field only; the compatibility contract is
            # explicitly framework-neutral and non-executable.
            framework=ContractFramework.QISKIT,
        )
        version = await artifacts_repo.create_version(
            scope,
            session,
            artifact.id,
            qasm_version=None,
            qasm=None,
            metadata={
                "source": "atlas_reviewed_vqe_research_candidate",
                "materialization_schema_version": "atlas.research-candidate-materialization.v1",
                "review_sha256": review.review_sha256,
                "source_snapshot_sha256": review.source_snapshot_sha256,
                "evidence_bundle_sha256": review.evidence_bundle_sha256,
                "license_expression": license_expression,
                "license_gate": "source_declared_spdx_private_metadata_only_v1",
                "semantic_framework": "neutral",
                "legacy_framework_field": "qiskit_non_semantic",
                "publication": "blocked",
                "execution": "blocked",
            },
            code=_canonical_json(bundle).decode(),
            code_lang="json",
            fingerprint=bundle_sha256,
            export_status=ExportStatus.UNSUPPORTED,
            export_reason="reviewed structured metadata is not a circuit export",
            limitations=(
                "Private reviewed metadata candidate only. Not a canonical component, "
                "execution qualification, independent review, or publication approval."
            ),
        )
        materialization_id = uuid7()
        existing = VqeResearchCandidateMaterializationRow(
            id=materialization_id,
            workspace_id=scope.workspace_id,
            envelope_id=envelope_id,
            review_id=review.id,
            created_by_user_id=scope.user_id,
            artifact_id=artifact.id,
            artifact_version_id=version.id,
            materialization_schema_version="atlas.research-candidate-materialization.v1",
            source_snapshot_sha256=review.source_snapshot_sha256,
            evidence_bundle_sha256=review.evidence_bundle_sha256,
            review_sha256=review.review_sha256,
            reviewed_candidate_sha256=review.reviewed_candidate_sha256,
            license_expression=license_expression,
            license_gate="source_declared_spdx_private_metadata_only_v1",
            compatibility_contract_json=compatibility,
            compatibility_contract_sha256=compatibility_sha256,
            materialized_bundle_json=bundle,
            materialized_bundle_sha256=bundle_sha256,
            publication_eligible=False,
            execution_eligible=False,
        )
        session.add(existing)
        await session.flush()

    proposed_request_id = uuid7()
    await session.execute(
        pg_insert(VqeResearchCandidateMaterializationRequestRow)
        .values(
            id=proposed_request_id,
            workspace_id=scope.workspace_id,
            materialization_id=existing.id,
            requested_by_user_id=scope.user_id,
            idempotency_key=idempotency_key,
            request_descriptor_json=descriptor,
            request_descriptor_sha256=descriptor_sha256,
        )
        .on_conflict_do_nothing(index_elements=["workspace_id", "idempotency_key"])
    )
    request = await _find_materialization_request(scope, session, idempotency_key)
    if request is None:
        raise ResearchCandidateMaterializationError("materialization_request_insert_not_observable")
    if (
        request.materialization_id != existing.id
        or request.request_descriptor_json != descriptor
        or request.request_descriptor_sha256 != descriptor_sha256
    ):
        raise ResearchCandidateMaterializationIdempotencyConflictError(
            "idempotency key raced with a different materialization"
        )
    return PersistedResearchCandidateMaterialization(
        materialization=existing,
        request_id=request.id,
        replayed_materialization=replayed_materialization,
        replayed_request=request.id != proposed_request_id,
    )
