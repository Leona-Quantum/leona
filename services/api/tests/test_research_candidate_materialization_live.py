"""Live PostgreSQL transaction invariants for Phase 9 S10 materialization."""

from __future__ import annotations

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import func, select, update
from sqlalchemy.exc import DBAPIError

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import (
    Artifact,
    GitHubRepositorySnapshotRow,
    VqeResearchCandidateEnvelopeRow,
    VqeResearchCandidateMaterializationRow,
    VqeResearchCandidateReviewRow,
)
from majorana_api.repos import NotFoundError, research_candidates, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="research candidate materialization live tests need DATABASE_URL",
)

SOURCE_URL = "https://github.com/Qiskit/qiskit-nature"
SOURCE_COMMIT = "a" * 40


@pytest.fixture
async def db():
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _new_scope(session, label: str) -> Scope:
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"phase9-s10-{label}-{uuid.uuid4()}",
        email=f"phase9-s10-{uuid.uuid4().hex[:8]}@live.test",
    )
    await session.flush()
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


def _candidate() -> dict:
    values = {
        "name": "UCCSD implementation",
        "component_type": "ansatz",
        "provider": "qiskit",
        "package": "qiskit-nature",
        "module": "qiskit_nature.second_q.circuit.library",
        "symbol": "UCCSD",
        "version": "0.8.0",
        "license_expression": "Apache-2.0",
        "repository_url": SOURCE_URL,
        "commit_sha": SOURCE_COMMIT,
    }
    return {
        "local_id": "candidate_uccsd",
        "candidate_type": "implementation",
        "fields": [
            {
                "field": key,
                "value": value,
                "evidence_ids": ["ev_license" if key == "license_expression" else "ev_identity"],
            }
            for key, value in values.items()
        ],
        "unknowns": [],
        "conflicts": [],
    }


def _decisions(candidate: dict) -> list[dict]:
    return [
        {
            "subject_id": f"field:{field['field']}",
            "decision": "accept",
            "edited_value": None,
            "rationale": "Checked against immutable source evidence.",
            "evidence_ids": field["evidence_ids"],
        }
        for field in candidate["fields"]
    ]


@requires_db
async def test_materialization_is_private_atomic_scoped_and_append_only(db, monkeypatch):
    snapshot_id = uuid.uuid4()
    envelope_id = uuid.uuid4()
    review_id = uuid.uuid4()
    candidate = _candidate()
    candidate_sha = research_candidates._sha256_json(candidate)
    evidence_bundle_sha = "c" * 64
    snapshot_sha = research_candidates._sha256_json({"scope": "phase9-s10-live"})

    async with db() as session:
        owner = await _new_scope(session, "owner")
        intruder = await _new_scope(session, "intruder")
        session.add(
            GitHubRepositorySnapshotRow(
                id=snapshot_id,
                repository_id=123456789,
                repository_node_id=f"R_{uuid.uuid4().hex}",
                full_name="Qiskit/qiskit-nature",
                canonical_repository_url=SOURCE_URL,
                requested_ref=SOURCE_COMMIT,
                default_branch="main",
                archived=False,
                disabled=False,
                api_version="2022-11-28",
                commit_sha=SOURCE_COMMIT,
                tree_sha="b" * 40,
                tree_entry_count=1,
                tree_manifest_sha256="d" * 64,
                selected_metadata_bytes=0,
                metadata_manifest_sha256="e" * 64,
                skipped_oversized_paths=[],
                importer_policy_version="phase9-s10-live-v1",
                audit_manifest_json={"scope": "phase9-s10-live"},
            )
        )
        session.add(
            VqeResearchCandidateEnvelopeRow(
                id=envelope_id,
                workspace_id=owner.workspace_id,
                created_by_user_id=owner.user_id,
                source_snapshot_id=snapshot_id,
                envelope_version="atlas.research-candidate-envelope.v1",
                prompt_version="atlas.research-extraction.prompt.v1",
                policy_version="atlas.research-candidate-policy.v1",
                response_schema_version="atlas.research-candidate-response.v1",
                repository_id=123456789,
                commit_sha=SOURCE_COMMIT,
                snapshot_sha256=snapshot_sha,
                input_bundle_sha256=evidence_bundle_sha,
                response_sha256="f" * 64,
                provider="test",
                requested_model="test-model",
                served_model="test-model",
                input_tokens=1,
                output_tokens=1,
                candidate_count=1,
                machine_validation_state="schema_and_evidence_validated",
                human_review_state="unreviewed",
                publication_eligible=False,
                materialization_eligible=False,
                envelope_json={
                    "response": {"candidates": [candidate]},
                },
                envelope_sha256="1" * 64,
            )
        )
        review = VqeResearchCandidateReviewRow(
            id=review_id,
            workspace_id=owner.workspace_id,
            envelope_id=envelope_id,
            previous_review_id=None,
            reviewer_user_id=owner.user_id,
            candidate_local_id="candidate_uccsd",
            review_kind="workspace_human_review",
            independence_state="not_asserted",
            disposition="accepted",
            source_snapshot_sha256=snapshot_sha,
            evidence_bundle_sha256=evidence_bundle_sha,
            base_candidate_sha256=candidate_sha,
            reviewed_candidate_json=candidate,
            reviewed_candidate_sha256=candidate_sha,
            decisions_json=_decisions(candidate),
            rationale="Every required field is directly supported by the pinned source.",
            review_sha256="0" * 64,
        )
        review.review_sha256 = research_candidates._sha256_json(
            research_candidates._review_identity_payload(review)
        )
        expected_review_sha = review.review_sha256
        session.add(review)
        await session.commit()

    evidence = (
        {"evidence_id": "ev_license", "declared_value": "Apache-2.0"},
        {"evidence_id": "ev_identity", "declared_value": "identity evidence"},
    )

    async def fake_review_view(scope, session, *, envelope_id, candidate_local_id):
        return research_candidates.ResearchCandidateReviewView(
            envelope_id=envelope_id,
            envelope_sha256="1" * 64,
            candidate=candidate,
            candidate_sha256=candidate_sha,
            source_snapshot_sha256=snapshot_sha,
            evidence_bundle_sha256=evidence_bundle_sha,
            evidence=evidence,
            latest_review=None,
        )

    monkeypatch.setattr(
        research_candidates,
        "get_research_candidate_review_view",
        fake_review_view,
    )

    async with db() as session:
        baseline_artifact_count = await session.scalar(select(func.count()).select_from(Artifact))
        with pytest.raises(
            research_candidates.ResearchCandidateMaterializationError,
            match="stale_materialization_input",
        ):
            await research_candidates.materialize_research_candidate_review(
                owner,
                session,
                envelope_id=envelope_id,
                review_id=review_id,
                expected_review_sha256="9" * 64,
                expected_reviewed_candidate_sha256=candidate_sha,
                expected_evidence_bundle_sha256=evidence_bundle_sha,
                idempotency_key=f"stale-{uuid.uuid4()}",
            )
        await session.rollback()
        assert (
            await session.scalar(select(func.count()).select_from(Artifact))
            == baseline_artifact_count
        )
        assert (
            await session.scalar(
                select(func.count()).select_from(VqeResearchCandidateMaterializationRow)
            )
            == 0
        )

    key = f"materialize-{uuid.uuid4()}"
    async with db() as session:
        first = await research_candidates.materialize_research_candidate_review(
            owner,
            session,
            envelope_id=envelope_id,
            review_id=review_id,
            expected_review_sha256=expected_review_sha,
            expected_reviewed_candidate_sha256=candidate_sha,
            expected_evidence_bundle_sha256=evidence_bundle_sha,
            idempotency_key=key,
        )
        await session.commit()
        assert first.materialization.publication_eligible is False
        assert first.materialization.execution_eligible is False

    async with db() as session:
        replay = await research_candidates.materialize_research_candidate_review(
            owner,
            session,
            envelope_id=envelope_id,
            review_id=review_id,
            expected_review_sha256=expected_review_sha,
            expected_reviewed_candidate_sha256=candidate_sha,
            expected_evidence_bundle_sha256=evidence_bundle_sha,
            idempotency_key=key,
        )
        assert replay.materialization.id == first.materialization.id
        assert replay.replayed_request is True
        artifact = await session.get(Artifact, replay.materialization.artifact_id)
        assert artifact is not None
        assert artifact.workspace_id == owner.workspace_id
        assert artifact.visibility == "private"

        with pytest.raises(NotFoundError):
            await research_candidates.materialize_research_candidate_review(
                intruder,
                session,
                envelope_id=envelope_id,
                review_id=review_id,
                expected_review_sha256=expected_review_sha,
                expected_reviewed_candidate_sha256=candidate_sha,
                expected_evidence_bundle_sha256=evidence_bundle_sha,
                idempotency_key=f"intruder-{uuid.uuid4()}",
            )

        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(VqeResearchCandidateMaterializationRow)
                .where(VqeResearchCandidateMaterializationRow.id == first.materialization.id)
                .values(publication_eligible=True)
            )
            await session.commit()
        await session.rollback()
