"""Live PostgreSQL invariants for Phase 9 S8 candidate persistence."""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import func, select, update
from sqlalchemy.exc import DBAPIError

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import (
    GitHubRepositorySnapshotRow,
    VqeResearchCandidateEnvelopeRow,
    VqeResearchCandidatePersistRequestRow,
)
from majorana_api.repos import NotFoundError, research_candidates, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="research candidate live tests need DATABASE_URL",
)


@pytest.fixture
async def db():
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _new_scope(session) -> Scope:
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"phase9-s8-{uuid.uuid4()}",
        email=f"phase9-s8-{uuid.uuid4().hex[:8]}@live.test",
    )
    await session.flush()
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


def _envelope(repository_id: int, commit_sha: str) -> dict:
    return {
        "envelope_version": "atlas.research-candidate-envelope.v1",
        "prompt_version": "atlas.research-extraction.prompt.v1",
        "policy_version": "atlas.research-candidate-policy.v1",
        "response_schema_version": "atlas.research-candidate-response.v1",
        "repository_id": repository_id,
        "commit_sha": commit_sha,
        "snapshot_sha256": "b" * 64,
        "input_bundle_sha256": "c" * 64,
        "response_sha256": "d" * 64,
        "provider": "deepseek",
        "requested_model": "deepseek-v4-flash",
        "served_model": "deepseek-v4-flash",
        "input_tokens": 100,
        "output_tokens": 20,
        "response": {
            "schema_version": "atlas.research-candidate-response.v1",
            "candidates": [
                {
                    "local_id": "candidate_mapper",
                    "candidate_type": "implementation",
                    "fields": [
                        {
                            "field": "name",
                            "value": "JordanWignerMapper",
                            "evidence_ids": ["ev_mapper"],
                        }
                    ],
                    "unknowns": [],
                    "conflicts": [],
                }
            ],
        },
        "machine_validation_state": "schema_and_evidence_validated",
        "human_review_state": "unreviewed",
        "publication_eligible": False,
        "materialization_eligible": False,
    }


@requires_db
async def test_append_only_scoped_idempotent_concurrent_persistence(db):
    repository_id = int(uuid.uuid4().int % 9_000_000_000) + 1
    commit_sha = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    source_snapshot_id = uuid.uuid4()
    source_manifest = {"scope": "test"}
    async with db() as session:
        owner = await _new_scope(session)
        intruder = await _new_scope(session)
        session.add(
            GitHubRepositorySnapshotRow(
                id=source_snapshot_id,
                repository_id=repository_id,
                repository_node_id=f"R_{uuid.uuid4().hex}",
                full_name=f"atlas/phase9-{uuid.uuid4().hex}",
                canonical_repository_url="https://github.com/atlas/phase9-test",
                requested_ref="main",
                default_branch="main",
                archived=False,
                disabled=False,
                api_version="2022-11-28",
                commit_sha=commit_sha,
                tree_sha="e" * 40,
                tree_entry_count=1,
                tree_manifest_sha256="f" * 64,
                selected_metadata_bytes=0,
                metadata_manifest_sha256="0" * 64,
                skipped_oversized_paths=[],
                importer_policy_version=f"phase9-test-{uuid.uuid4().hex}",
                audit_manifest_json=source_manifest,
            )
        )
        await session.commit()

    envelope = _envelope(repository_id, commit_sha)
    envelope["snapshot_sha256"] = research_candidates._sha256_json(source_manifest)
    idempotency_key = f"phase9-s8-{uuid.uuid4()}"

    async def persist_once():
        async with db() as session:
            result = await research_candidates.persist_research_candidate_envelope(
                owner,
                session,
                source_snapshot_id=source_snapshot_id,
                envelope=envelope,
                idempotency_key=idempotency_key,
            )
            await session.commit()
            return result

    first, second = await asyncio.wait_for(
        asyncio.gather(persist_once(), persist_once()),
        timeout=10,
    )
    assert first.envelope_id == second.envelope_id
    assert first.persist_request_id == second.persist_request_id
    assert {first.replayed_request, second.replayed_request} == {False, True}

    async with db() as session:
        envelope_count = await session.scalar(
            select(func.count())
            .select_from(VqeResearchCandidateEnvelopeRow)
            .where(
                VqeResearchCandidateEnvelopeRow.workspace_id == owner.workspace_id,
                VqeResearchCandidateEnvelopeRow.envelope_sha256 == first.envelope_sha256,
            )
        )
        request_count = await session.scalar(
            select(func.count())
            .select_from(VqeResearchCandidatePersistRequestRow)
            .where(
                VqeResearchCandidatePersistRequestRow.workspace_id == owner.workspace_id,
                VqeResearchCandidatePersistRequestRow.idempotency_key == idempotency_key,
            )
        )
        assert envelope_count == 1
        assert request_count == 1

        with pytest.raises(NotFoundError):
            await research_candidates.get_research_candidate_envelope(
                intruder,
                session,
                first.envelope_id,
            )

        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(VqeResearchCandidateEnvelopeRow)
                .where(VqeResearchCandidateEnvelopeRow.id == first.envelope_id)
                .values(human_review_state="accepted")
            )
            await session.commit()
        await session.rollback()

        altered = _envelope(repository_id, commit_sha)
        altered["requested_model"] = "different-model"
        with pytest.raises(research_candidates.ResearchCandidateIdempotencyConflictError):
            await research_candidates.persist_research_candidate_envelope(
                owner,
                session,
                source_snapshot_id=source_snapshot_id,
                envelope=altered,
                idempotency_key=idempotency_key,
            )
