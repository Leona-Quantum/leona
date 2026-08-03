"""Phase 9 S11 controlled private compose/review/materialize/reopen E2E.

This is a disposable-database transaction contract.  Its source snapshot and
candidate are intentionally synthetic and MUST NOT be described as a Qiskit
Nature scientific result, model-quality evidence, or a human scientific label.
No provider is contacted.  The test exists to prove that the real persistence,
evidence reconstruction, review, materialization, tenant, and reopen paths fit
together without the S10 evidence-shape mocks.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from majorana_api.db import engine_from_env, session_factory
from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_api.orm import GitHubRepositorySnapshotFileRow, GitHubRepositorySnapshotRow
from majorana_api.repos import NotFoundError, artifacts, research_candidates, system
from majorana_api.vqe_metadata_assertions import EXTRACTOR_VERSION

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="Phase 9 S11 controlled E2E needs a disposable DATABASE_URL",
)

SOURCE_URL = "https://github.com/qiskit-community/qiskit-nature"


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
        workos_user_id=f"phase9-s11-{label}-{uuid.uuid4()}",
        email=f"phase9-s11-{label}-{uuid.uuid4().hex[:8]}@live.test",
    )
    await session.flush()
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


def _fixture_snapshot(repository_id: int, commit_sha: str) -> GitHubRepositorySnapshot:
    # Synthetic metadata is used only for the systems contract.  In particular,
    # `citation.type=software` does not establish an ansatz capability.
    content_by_path = {
        "CITATION.cff": (
            "cff-version: 1.2.0\n"
            "message: Controlled S11 transaction fixture only.\n"
            "title: Atlas controlled component fixture\n"
            "type: software\n"
            "repository-code: https://github.com/qiskit-community/qiskit-nature\n"
            "license: Apache-2.0\n"
            "version: 0.0.0-test\n"
        ).encode(),
        "pyproject.toml": (
            "[project]\n"
            'name = "atlas-controlled-component-fixture"\n'
            'version = "0.0.0-test"\n'
            'requires-python = ">=3.12"\n'
        ).encode(),
    }
    files = tuple(
        GitHubMetadataFile(
            path=path,
            mode="100644",
            blob_sha=hashlib.sha1(content).hexdigest(),  # noqa: S324 - Git identity only
            size=len(content),
            content_sha256=hashlib.sha256(content).hexdigest(),
            content=content,
        )
        for path, content in sorted(content_by_path.items())
    )
    metadata_identity = [
        {
            "path": item.path,
            "mode": item.mode,
            "blob_sha": item.blob_sha,
            "size": item.size,
            "content_sha256": item.content_sha256,
        }
        for item in files
    ]
    return GitHubRepositorySnapshot(
        api_version="2022-11-28",
        repository_id=repository_id,
        repository_node_id=f"R_{uuid.uuid4().hex}",
        full_name="qiskit-community/qiskit-nature",
        canonical_repository_url=SOURCE_URL,
        requested_ref=commit_sha,
        default_branch="main",
        archived=False,
        disabled=False,
        commit_sha=commit_sha,
        tree_sha="b" * 40,
        tree_entry_count=len(files),
        tree_manifest_sha256=research_candidates._sha256_json(metadata_identity),
        selected_metadata_bytes=sum(item.size for item in files),
        skipped_oversized_paths=(),
        metadata_files=files,
        metadata_manifest_sha256=research_candidates._sha256_json(metadata_identity),
    )


def _evidence_id(bundle, field: str) -> str:
    matches = [
        item.evidence_id
        for item in bundle.items
        if isinstance(item.declared_value, dict) and item.declared_value.get("field") == field
    ]
    assert len(matches) == 1
    return matches[0]


def _candidate(bundle) -> dict:
    return {
        "local_id": "candidate_controlled_component",
        "candidate_type": "component",
        "fields": [
            {
                "field": "name",
                "value": "Atlas controlled component fixture",
                "evidence_ids": [_evidence_id(bundle, "citation.title")],
            },
            {
                # This classification is synthetic transaction input.  The
                # cited software metadata does not prove an ansatz capability.
                "field": "component_type",
                "value": "ansatz",
                "evidence_ids": [_evidence_id(bundle, "citation.type")],
            },
            {
                "field": "license_expression",
                "value": "Apache-2.0",
                "evidence_ids": [_evidence_id(bundle, "citation.license")],
            },
        ],
        "unknowns": [],
        "conflicts": [],
    }


def _decisions(candidate: dict, *, reject_component_type: bool = False) -> list[dict]:
    return [
        {
            "subject_id": f"field:{field['field']}",
            "decision": (
                "reject"
                if reject_component_type and field["field"] == "component_type"
                else "accept"
            ),
            "edited_value": None,
            "rationale": (
                "Controlled S11 transaction fixture; this is not a scientific "
                "or independent-review assertion."
            ),
        }
        for field in candidate["fields"]
    ]


async def _insert_snapshot(session, snapshot: GitHubRepositorySnapshot) -> uuid.UUID:
    snapshot_id = uuid.uuid4()
    session.add(
        GitHubRepositorySnapshotRow(
            id=snapshot_id,
            repository_id=snapshot.repository_id,
            repository_node_id=snapshot.repository_node_id,
            full_name=snapshot.full_name,
            canonical_repository_url=snapshot.canonical_repository_url,
            requested_ref=snapshot.requested_ref,
            default_branch=snapshot.default_branch,
            archived=snapshot.archived,
            disabled=snapshot.disabled,
            api_version=snapshot.api_version,
            commit_sha=snapshot.commit_sha,
            tree_sha=snapshot.tree_sha,
            tree_entry_count=snapshot.tree_entry_count,
            tree_manifest_sha256=snapshot.tree_manifest_sha256,
            selected_metadata_bytes=snapshot.selected_metadata_bytes,
            metadata_manifest_sha256=snapshot.metadata_manifest_sha256,
            skipped_oversized_paths=list(snapshot.skipped_oversized_paths),
            importer_policy_version="phase9-s11-controlled-fixture.v1",
            audit_manifest_json=snapshot.audit_manifest(),
        )
    )
    # The ORM rows intentionally have no relationship cascade; establish the
    # parent FK before batching the content-addressed files.
    await session.flush()
    for item in snapshot.metadata_files:
        session.add(
            GitHubRepositorySnapshotFileRow(
                id=uuid.uuid4(),
                snapshot_id=snapshot_id,
                path=item.path,
                mode=item.mode,
                blob_sha=item.blob_sha,
                size=item.size,
                content_sha256=item.content_sha256,
                content=item.content,
            )
        )
    await session.flush()
    return snapshot_id


@requires_db
async def test_controlled_private_compose_review_materialize_and_reopen(db):
    repository_id = int(uuid.uuid4().int % 9_000_000_000) + 1
    commit_sha = uuid.uuid4().hex + uuid.uuid4().hex[:8]
    snapshot = _fixture_snapshot(repository_id, commit_sha)
    snapshot_sha = research_candidates._sha256_json(snapshot.audit_manifest())
    bundle = research_candidates.assemble_research_evidence_bundle(
        repository_id=repository_id,
        commit_sha=commit_sha,
        snapshot_sha256=snapshot_sha,
        phase8_extractor_version=EXTRACTOR_VERSION,
        declared_facts=research_candidates._declared_evidence(snapshot),
    )
    candidate = _candidate(bundle)
    response = {
        "schema_version": "atlas.research-candidate-response.v1",
        "candidates": [candidate],
    }
    envelope = {
        "envelope_version": "atlas.research-candidate-envelope.v1",
        "prompt_version": "atlas.research-extraction.prompt.v1",
        "policy_version": "atlas.research-candidate-policy.v1",
        "response_schema_version": "atlas.research-candidate-response.v1",
        "repository_id": repository_id,
        "commit_sha": commit_sha,
        "snapshot_sha256": snapshot_sha,
        "input_bundle_sha256": bundle.deterministic_digest,
        "response_sha256": research_candidates._sha256_json(response),
        "provider": "controlled_fixture",
        "requested_model": "no-provider-call",
        "served_model": "no-provider-call",
        "input_tokens": 0,
        "output_tokens": 0,
        "response": response,
        "machine_validation_state": "schema_and_evidence_validated",
        "human_review_state": "unreviewed",
        "publication_eligible": False,
        "materialization_eligible": False,
    }

    async with db() as session:
        owner = await _new_scope(session, "owner")
        intruder = await _new_scope(session, "intruder")
        snapshot_id = await _insert_snapshot(session, snapshot)
        persisted = await research_candidates.persist_research_candidate_envelope(
            owner,
            session,
            source_snapshot_id=snapshot_id,
            envelope=envelope,
            idempotency_key=f"compose-{uuid.uuid4()}",
        )
        await session.commit()

    async with db() as session:
        view = await research_candidates.get_research_candidate_review_view(
            owner,
            session,
            envelope_id=persisted.envelope_id,
            candidate_local_id=candidate["local_id"],
        )
        assert view.evidence_bundle_sha256 == bundle.deterministic_digest
        assert view.candidate == candidate

        rejected = await research_candidates.create_research_candidate_review(
            owner,
            session,
            envelope_id=persisted.envelope_id,
            candidate_local_id=candidate["local_id"],
            expected_envelope_sha256=persisted.envelope_sha256,
            expected_candidate_sha256=view.candidate_sha256,
            expected_evidence_bundle_sha256=bundle.deterministic_digest,
            disposition="rejected",
            decisions=_decisions(candidate, reject_component_type=True),
            rationale="Controlled rejection-path test only.",
            idempotency_key=f"review-rejected-{uuid.uuid4()}",
        )
        await session.commit()

    async with db() as session:
        with pytest.raises(
            research_candidates.ResearchCandidateMaterializationError,
            match="review_not_accepted",
        ):
            await research_candidates.materialize_research_candidate_review(
                owner,
                session,
                envelope_id=persisted.envelope_id,
                review_id=rejected.review.id,
                expected_review_sha256=rejected.review.review_sha256,
                expected_reviewed_candidate_sha256=(rejected.review.reviewed_candidate_sha256),
                expected_evidence_bundle_sha256=bundle.deterministic_digest,
                idempotency_key=f"materialize-rejected-{uuid.uuid4()}",
            )
        await session.rollback()

    async with db() as session:
        accepted_v1 = await research_candidates.create_research_candidate_review(
            owner,
            session,
            envelope_id=persisted.envelope_id,
            candidate_local_id=candidate["local_id"],
            expected_envelope_sha256=persisted.envelope_sha256,
            expected_candidate_sha256=view.candidate_sha256,
            expected_evidence_bundle_sha256=bundle.deterministic_digest,
            disposition="accepted",
            decisions=_decisions(candidate),
            rationale="Controlled accepted transaction version one; not a scientific label.",
            idempotency_key=f"review-accepted-v1-{uuid.uuid4()}",
        )
        await session.commit()

    async with db() as session:
        accepted_v2 = await research_candidates.create_research_candidate_review(
            owner,
            session,
            envelope_id=persisted.envelope_id,
            candidate_local_id=candidate["local_id"],
            expected_envelope_sha256=persisted.envelope_sha256,
            expected_candidate_sha256=view.candidate_sha256,
            expected_evidence_bundle_sha256=bundle.deterministic_digest,
            disposition="accepted",
            decisions=_decisions(candidate),
            rationale="Controlled accepted transaction version two; not a scientific label.",
            idempotency_key=f"review-accepted-v2-{uuid.uuid4()}",
        )
        await session.commit()

    async with db() as session:
        with pytest.raises(
            research_candidates.ResearchCandidateMaterializationError,
            match="review_is_not_latest",
        ):
            await research_candidates.materialize_research_candidate_review(
                owner,
                session,
                envelope_id=persisted.envelope_id,
                review_id=accepted_v1.review.id,
                expected_review_sha256=accepted_v1.review.review_sha256,
                expected_reviewed_candidate_sha256=(accepted_v1.review.reviewed_candidate_sha256),
                expected_evidence_bundle_sha256=bundle.deterministic_digest,
                idempotency_key=f"materialize-stale-{uuid.uuid4()}",
            )
        await session.rollback()

    async with db() as session:
        with pytest.raises(NotFoundError):
            await research_candidates.materialize_research_candidate_review(
                intruder,
                session,
                envelope_id=persisted.envelope_id,
                review_id=accepted_v2.review.id,
                expected_review_sha256=accepted_v2.review.review_sha256,
                expected_reviewed_candidate_sha256=(accepted_v2.review.reviewed_candidate_sha256),
                expected_evidence_bundle_sha256=bundle.deterministic_digest,
                idempotency_key=f"materialize-cross-workspace-{uuid.uuid4()}",
            )
        await session.rollback()

    materialization_key = f"materialize-success-{uuid.uuid4()}"
    async with db() as session:
        result = await research_candidates.materialize_research_candidate_review(
            owner,
            session,
            envelope_id=persisted.envelope_id,
            review_id=accepted_v2.review.id,
            expected_review_sha256=accepted_v2.review.review_sha256,
            expected_reviewed_candidate_sha256=(accepted_v2.review.reviewed_candidate_sha256),
            expected_evidence_bundle_sha256=bundle.deterministic_digest,
            idempotency_key=materialization_key,
        )
        await session.commit()
        materialization_id = result.materialization.id
        artifact_id = result.materialization.artifact_id
        artifact_version_id = result.materialization.artifact_version_id

    # A separate session proves the saved object can be reopened without a
    # provider recall or process-local state.
    async with db() as session:
        reopened_artifact = await artifacts.get_artifact(owner, session, artifact_id)
        reopened_version = await artifacts.get_version(owner, session, artifact_version_id)
        reopened_bundle = json.loads(reopened_version.code)
        assert reopened_artifact.visibility == "private"
        assert reopened_version.code_lang == "json"
        assert reopened_bundle["publication_eligible"] is False
        assert reopened_bundle["execution_eligible"] is False
        assert reopened_bundle["source"]["snapshot_sha256"] == snapshot_sha
        assert reopened_bundle["review"]["review_sha256"] == accepted_v2.review.review_sha256

        replay = await research_candidates.materialize_research_candidate_review(
            owner,
            session,
            envelope_id=persisted.envelope_id,
            review_id=accepted_v2.review.id,
            expected_review_sha256=accepted_v2.review.review_sha256,
            expected_reviewed_candidate_sha256=(accepted_v2.review.reviewed_candidate_sha256),
            expected_evidence_bundle_sha256=bundle.deterministic_digest,
            idempotency_key=materialization_key,
        )
        assert replay.materialization.id == materialization_id
        assert replay.replayed_request is True
        with pytest.raises(NotFoundError):
            await artifacts.get_artifact(intruder, session, artifact_id)
