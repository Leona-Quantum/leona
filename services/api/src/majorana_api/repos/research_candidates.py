"""Private append-only persistence for validated Phase 9 LLM candidates.

The repository stores already-validated structured envelopes. It rechecks the
canonical digest, source identity, bounded schema shape, and fail-closed
lifecycle fields before writing. Review and materialization live in later,
separate append-only records; this module cannot publish a candidate.
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
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import (
    GitHubRepositorySnapshotRow,
    VqeResearchCandidateEnvelopeRow,
    VqeResearchCandidatePersistRequestRow,
)
from ._base import NotFoundError, RepoError, require_write

MAX_ENVELOPE_BYTES = 256 * 1024
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_PROVIDER_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
_EVIDENCE_ID_RE = re.compile(r"^ev_[a-z0-9][a-z0-9_.-]{0,63}$")
_CANDIDATE_ID_RE = re.compile(r"^candidate_[a-z0-9][a-z0-9_.-]{0,63}$")
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


@dataclasses.dataclass(frozen=True)
class PersistedResearchCandidateEnvelope:
    envelope_id: uuid.UUID
    persist_request_id: uuid.UUID
    envelope_sha256: str
    replayed_envelope: bool
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
