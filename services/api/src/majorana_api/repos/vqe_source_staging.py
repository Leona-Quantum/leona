"""Persist Phase 7 standard-provider evidence without publishing it."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import uuid

from majorana_contracts import Scope
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..ids import uuid7
from ..orm import GitHubMetadataAssertionRow, VqeComponentImplementationCandidateRow
from ..vqe_metadata_assertions import EXTRACTOR_VERSION, extract_metadata_assertions
from ..vqe_standard_sources import get_standard_source, require_approved_github_source
from .github_import import load_github_snapshot

CANDIDATE_ADAPTER_VERSION = "atlas.standard-provider-candidate.v2"


@dataclasses.dataclass(frozen=True)
class StagedVqeSourceEvidence:
    snapshot_id: uuid.UUID
    assertion_ids: tuple[uuid.UUID, ...]
    candidate_id: uuid.UUID
    replayed_assertions: int
    replayed_candidate: bool


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


async def stage_standard_vqe_source_evidence(
    scope: Scope,
    session: AsyncSession,
    snapshot_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    source_key: str,
) -> StagedVqeSourceEvidence:
    """Stage direct metadata observations and one deliberately unmatched candidate.

    The candidate identifies a provider source snapshot only. It intentionally
    carries no Component Definition match and cannot be used for execution or
    publication until Phase 7.5 supplies a reviewed, versioned binding.
    """

    source = get_standard_source(source_key)
    approved = require_approved_github_source(source.canonical_locator)
    if approved != source:
        raise ValueError("source registry is internally inconsistent")
    snapshot = await load_github_snapshot(
        scope,
        session,
        snapshot_id,
        authority=authority,
    )
    assertions = extract_metadata_assertions(source, snapshot)

    assertion_ids: list[uuid.UUID] = []
    replayed_assertions = 0
    for assertion in assertions:
        proposed_id = uuid7()
        await session.execute(
            pg_insert(GitHubMetadataAssertionRow)
            .values(
                id=proposed_id,
                snapshot_id=snapshot_id,
                assertion_key=assertion.assertion_key,
                extractor_version=assertion.extractor_version,
                source_key=assertion.source_key,
                predicate=assertion.predicate.value,
                observed=assertion.observed,
                evidence_paths=list(assertion.evidence_paths),
                evidence_content_sha256=list(assertion.evidence_content_sha256),
                assertion_json=assertion.as_dict(),
                assertion_sha256=assertion.assertion_sha256,
            )
            .on_conflict_do_nothing(index_elements=["snapshot_id", "assertion_key"])
        )
        row = (
            (
                await session.execute(
                    select(GitHubMetadataAssertionRow).where(
                        GitHubMetadataAssertionRow.snapshot_id == snapshot_id,
                        GitHubMetadataAssertionRow.assertion_key == assertion.assertion_key,
                    )
                )
            )
            .scalars()
            .one()
        )
        if (
            row.assertion_sha256 != assertion.assertion_sha256
            or row.assertion_json != assertion.as_dict()
        ):
            raise ValueError("immutable metadata assertion conflict")
        assertion_ids.append(row.id)
        replayed_assertions += int(row.id != proposed_id)

    candidate_payload = {
        "adapter_version": CANDIDATE_ADAPTER_VERSION,
        "source_key": source.source_key,
        "provider_key": source.provider_key,
        "source_role": source.role.value,
        "maintenance_state": source.maintenance_state.value,
        "snapshot_id": str(snapshot_id),
        "repository_id": snapshot.repository_id,
        "commit_sha": snapshot.commit_sha,
        "metadata_extractor_version": EXTRACTOR_VERSION,
        "metadata_assertion_sha256": sorted(item.assertion_sha256 for item in assertions),
        "component_semantic_key": None,
        "match_state": "unmatched",
        "publication_eligible": False,
    }
    candidate_sha256 = _canonical_sha256(candidate_payload)
    candidate_key = (
        f"{source.source_key}:{snapshot.commit_sha}:{CANDIDATE_ADAPTER_VERSION}:provider-source"
    )
    proposed_candidate_id = uuid7()
    await session.execute(
        pg_insert(VqeComponentImplementationCandidateRow)
        .values(
            id=proposed_candidate_id,
            snapshot_id=snapshot_id,
            candidate_key=candidate_key,
            adapter_version=CANDIDATE_ADAPTER_VERSION,
            source_key=source.source_key,
            provider_key=source.provider_key,
            component_semantic_key=None,
            match_state="unmatched",
            candidate_json=candidate_payload,
            candidate_sha256=candidate_sha256,
        )
        .on_conflict_do_nothing(index_elements=["snapshot_id", "candidate_key"])
    )
    candidate = (
        (
            await session.execute(
                select(VqeComponentImplementationCandidateRow).where(
                    VqeComponentImplementationCandidateRow.snapshot_id == snapshot_id,
                    VqeComponentImplementationCandidateRow.candidate_key == candidate_key,
                )
            )
        )
        .scalars()
        .one()
    )
    if (
        candidate.candidate_sha256 != candidate_sha256
        or candidate.candidate_json != candidate_payload
        or candidate.match_state != "unmatched"
        or candidate.component_semantic_key is not None
    ):
        raise ValueError("immutable implementation candidate conflict")

    return StagedVqeSourceEvidence(
        snapshot_id=snapshot_id,
        assertion_ids=tuple(assertion_ids),
        candidate_id=candidate.id,
        replayed_assertions=replayed_assertions,
        replayed_candidate=candidate.id != proposed_candidate_id,
    )
