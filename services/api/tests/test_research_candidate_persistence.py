"""DB-free integrity tests for Phase 9 S8 candidate persistence."""

from __future__ import annotations

import copy
import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import Role

from majorana_api.repos import AuthzError, research_candidates

from repo_test_helpers import Row, SequencedSession, compiled, make_scope


def _envelope() -> dict:
    return {
        "envelope_version": "atlas.research-candidate-envelope.v1",
        "prompt_version": "atlas.research-extraction.prompt.v1",
        "policy_version": "atlas.research-candidate-policy.v1",
        "response_schema_version": "atlas.research-candidate-response.v1",
        "repository_id": 858157,
        "commit_sha": "a" * 40,
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
                    "local_id": "candidate_qiskit_mapper",
                    "candidate_type": "implementation",
                    "fields": [
                        {
                            "field": "name",
                            "value": "JordanWignerMapper",
                            "evidence_ids": ["ev_mapper_symbol"],
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


def test_persistence_validation_recomputes_deterministic_digest() -> None:
    validated, digest = research_candidates.validate_persisted_envelope(_envelope())

    assert validated == _envelope()
    assert digest == research_candidates._sha256_json(_envelope())


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (lambda value: value.update(human_review_state="accepted"), "lifecycle"),
        (lambda value: value.update(publication_eligible=True), "lifecycle"),
        (lambda value: value.update(materialization_eligible=True), "lifecycle"),
        (lambda value: value.update(extra="invented"), "shape"),
        (
            lambda value: value["response"]["candidates"][0]["fields"][0].update(evidence_ids=[]),
            "evidence",
        ),
    ],
)
def test_persistence_validation_fails_closed(mutation, code: str) -> None:
    envelope = copy.deepcopy(_envelope())
    mutation(envelope)

    with pytest.raises(research_candidates.ResearchCandidatePersistenceError, match=code):
        research_candidates.validate_persisted_envelope(envelope)


async def test_scoped_lookup_contains_workspace_predicate() -> None:
    scope = make_scope()
    session = SequencedSession([Row(None)])

    await research_candidates._find_envelope(
        scope,
        session,
        envelope_sha256="a" * 64,
    )

    sql, params = compiled(session.statements[0])
    assert "vqe_research_candidate_envelopes.workspace_id" in sql
    assert scope.workspace_id in params.values()


async def test_readonly_role_cannot_persist() -> None:
    scope = make_scope(Role.VIEWER)

    with pytest.raises(AuthzError):
        await research_candidates.persist_research_candidate_envelope(
            scope,
            SequencedSession([]),
            source_snapshot_id=uuid.uuid4(),
            envelope=_envelope(),
            idempotency_key="readonly",
        )


async def test_replay_returns_existing_request_without_new_insert() -> None:
    scope = make_scope()
    source_snapshot_id = uuid.uuid4()
    envelope = _envelope()
    envelope_sha256 = research_candidates._sha256_json(envelope)
    envelope_id = uuid.uuid4()
    request_id = uuid.uuid4()
    descriptor = research_candidates._request_descriptor(
        source_snapshot_id=source_snapshot_id,
        envelope_sha256=envelope_sha256,
    )
    request = SimpleNamespace(
        id=request_id,
        envelope_id=envelope_id,
        request_descriptor_json=descriptor,
        request_descriptor_sha256=research_candidates._sha256_json(descriptor),
    )
    envelope_row = SimpleNamespace(
        id=envelope_id,
        source_snapshot_id=source_snapshot_id,
        envelope_sha256=envelope_sha256,
        envelope_json=envelope,
        repository_id=envelope["repository_id"],
        commit_sha=envelope["commit_sha"],
        snapshot_sha256=envelope["snapshot_sha256"],
        input_bundle_sha256=envelope["input_bundle_sha256"],
        response_sha256=envelope["response_sha256"],
    )
    session = SequencedSession([Row(request), Row(envelope_row)])

    result = await research_candidates.persist_research_candidate_envelope(
        scope,
        session,
        source_snapshot_id=source_snapshot_id,
        envelope=envelope,
        idempotency_key="replay-key",
    )

    assert result.replayed_request is True
    assert result.replayed_envelope is True
    assert result.envelope_id == envelope_id
    assert len(session.statements) == 2


async def test_reused_key_with_different_envelope_fails_closed() -> None:
    scope = make_scope()
    source_snapshot_id = uuid.uuid4()
    existing = SimpleNamespace(
        request_descriptor_json={"different": True},
        request_descriptor_sha256="f" * 64,
    )
    session = SequencedSession([Row(existing)])

    with pytest.raises(
        research_candidates.ResearchCandidateIdempotencyConflictError,
        match="different research candidate",
    ):
        await research_candidates.persist_research_candidate_envelope(
            scope,
            session,
            source_snapshot_id=source_snapshot_id,
            envelope=_envelope(),
            idempotency_key="reused-key",
        )


class _InsertSession(SequencedSession):
    def __init__(self, results, source):
        super().__init__(results)
        self.source = source

    async def get(self, model, identifier):
        return self.source


async def test_new_persistence_binds_source_and_writes_two_append_only_rows() -> None:
    scope = make_scope()
    source_snapshot_id = uuid.uuid4()
    envelope = _envelope()
    source_manifest = {"source": "immutable-test-snapshot"}
    envelope["snapshot_sha256"] = research_candidates._sha256_json(source_manifest)
    envelope_sha256 = research_candidates._sha256_json(envelope)
    envelope_id = uuid.uuid4()
    request_id = uuid.uuid4()
    envelope_row = SimpleNamespace(
        id=envelope_id,
        source_snapshot_id=source_snapshot_id,
        envelope_sha256=envelope_sha256,
        envelope_json=envelope,
        repository_id=envelope["repository_id"],
        commit_sha=envelope["commit_sha"],
        snapshot_sha256=envelope["snapshot_sha256"],
        input_bundle_sha256=envelope["input_bundle_sha256"],
        response_sha256=envelope["response_sha256"],
    )
    descriptor = research_candidates._request_descriptor(
        source_snapshot_id=source_snapshot_id,
        envelope_sha256=envelope_sha256,
    )
    request_row = SimpleNamespace(
        id=request_id,
        envelope_id=envelope_id,
        request_descriptor_json=descriptor,
        request_descriptor_sha256=research_candidates._sha256_json(descriptor),
    )
    session = _InsertSession(
        [Row(None), Row(None), Row(envelope_row), Row(None), Row(request_row)],
        source=SimpleNamespace(
            repository_id=envelope["repository_id"],
            commit_sha=envelope["commit_sha"],
            audit_manifest_json=source_manifest,
        ),
    )

    result = await research_candidates.persist_research_candidate_envelope(
        scope,
        session,
        source_snapshot_id=source_snapshot_id,
        envelope=envelope,
        idempotency_key="new-key",
    )

    assert result.envelope_id == envelope_id
    assert result.persist_request_id == request_id
    assert len(session.statements) == 5
    assert "ON CONFLICT" in compiled(session.statements[1])[0]
    assert "ON CONFLICT" in compiled(session.statements[3])[0]


async def test_new_persistence_rejects_snapshot_manifest_digest_mismatch() -> None:
    scope = make_scope()
    envelope = _envelope()
    session = _InsertSession(
        [Row(None)],
        source=SimpleNamespace(
            repository_id=envelope["repository_id"],
            commit_sha=envelope["commit_sha"],
            audit_manifest_json={"different": "snapshot"},
        ),
    )

    with pytest.raises(
        research_candidates.ResearchCandidatePersistenceError,
        match="source_snapshot_identity_mismatch",
    ):
        await research_candidates.persist_research_candidate_envelope(
            scope,
            session,
            source_snapshot_id=uuid.uuid4(),
            envelope=envelope,
            idempotency_key="snapshot-mismatch",
        )
