"""Repository authority for review-gated conversion and materialization."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from majorana_api.repos import agent as agent_repo
from majorana_api.repos._base import NotFoundError


def _scope() -> Scope:
    return Scope(user_id=uuid4(), workspace_id=uuid4(), role=Role.OWNER)


class WriteSession:
    def __init__(self, results=()):
        self.results = list(results)
        self.added = []

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        return None

    async def execute(self, _statement):
        return self.results.pop(0)


class ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class UpdateResult:
    rowcount = 1


async def test_conversion_repository_accepts_ready_review_without_strict_attempt(
    monkeypatch,
):
    run_id = uuid4()
    candidate_id = uuid4()
    execution_id = uuid4()
    fingerprint = "a" * 64
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint=fingerprint)
    execution = SimpleNamespace(id=execution_id, source_fingerprint=fingerprint)
    review = SimpleNamespace(
        decision="ready",
        execution_id=execution_id,
        source_fingerprint=fingerprint,
    )

    async def get_candidate(_scope, _session, _run_id, _candidate_id):
        return candidate

    async def get_execution(_scope, _session, _run_id, _candidate_id):
        return execution

    async def latest_review(_scope, _session, _run_id, _candidate_id):
        return review

    monkeypatch.setattr(agent_repo, "get_candidate", get_candidate)
    monkeypatch.setattr(agent_repo, "get_execution", get_execution)
    monkeypatch.setattr(agent_repo, "latest_semantic_review", latest_review)
    session = WriteSession()

    row = await agent_repo.add_conversion(
        _scope(),
        session,
        run_id,
        {
            "candidate_id": candidate_id,
            "execution_id": execution_id,
            "source_fingerprint": fingerprint,
            "status": "unavailable",
            "qasm": None,
            "reason": "unsupported",
        },
    )

    assert row.candidate_id == candidate_id
    assert session.added == [row]


async def test_conversion_repository_rejects_non_ready_review(monkeypatch):
    candidate = SimpleNamespace(id=uuid4(), source_fingerprint="a" * 64)

    async def get_candidate(_scope, _session, _run_id, _candidate_id):
        return candidate

    async def get_execution(_scope, _session, _run_id, _candidate_id):
        return SimpleNamespace(id=uuid4(), source_fingerprint="a" * 64)

    async def latest_review(_scope, _session, _run_id, _candidate_id):
        return SimpleNamespace(decision="inconclusive")

    monkeypatch.setattr(agent_repo, "get_candidate", get_candidate)
    monkeypatch.setattr(agent_repo, "get_execution", get_execution)
    monkeypatch.setattr(agent_repo, "latest_semantic_review", latest_review)

    with pytest.raises(NotFoundError, match="ready_semantic_review"):
        await agent_repo.add_conversion(
            _scope(),
            WriteSession(),
            uuid4(),
            {
                "candidate_id": candidate.id,
                "execution_id": uuid4(),
                "source_fingerprint": "a" * 64,
                "status": "unavailable",
                "qasm": None,
                "reason": "unsupported",
            },
        )


async def test_materialization_repository_requires_bound_execution_and_ready_review(
    monkeypatch,
):
    run_id = uuid4()
    candidate_id = uuid4()
    execution_id = uuid4()
    fingerprint = "a" * 64
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint=fingerprint)
    execution = SimpleNamespace(
        id=execution_id,
        source_fingerprint=fingerprint,
        exit_code=0,
    )
    review = SimpleNamespace(
        decision="ready",
        execution_id=execution_id,
        source_fingerprint=fingerprint,
    )

    async def get_candidate(_scope, _session, _run_id, _candidate_id):
        return candidate

    async def get_execution(_scope, _session, _run_id, _candidate_id):
        return execution

    async def latest_review(_scope, _session, _run_id, _candidate_id):
        return review

    monkeypatch.setattr(agent_repo, "get_candidate", get_candidate)
    monkeypatch.setattr(agent_repo, "get_execution", get_execution)
    monkeypatch.setattr(agent_repo, "latest_semantic_review", latest_review)
    version_id = uuid4()
    artifact_id = uuid4()

    async def get_version(_scope, _session, got_version_id):
        assert got_version_id == version_id
        return SimpleNamespace(
            artifact_id=artifact_id,
            fingerprint=fingerprint,
        )

    monkeypatch.setattr(agent_repo.artifacts_repo, "get_version", get_version)
    scoped_run = SimpleNamespace(id=run_id, artifact_version_id=version_id)
    agent_run = SimpleNamespace(materialization=None)
    session = WriteSession(
        [
            ScalarResult(scoped_run),
            ScalarResult(agent_run),
            UpdateResult(),
        ]
    )
    materialization = {
        "candidate_id": str(candidate_id),
        "source_fingerprint": fingerprint,
        "artifact_id": str(artifact_id),
        "version_id": str(version_id),
        "version_seq": 1,
        "framework": "qiskit",
    }

    await agent_repo.set_materialization(_scope(), session, run_id, materialization)

    assert session.results == []


async def test_materialization_repository_accepts_trusted_not_run_without_review(
    monkeypatch,
):
    run_id = uuid4()
    candidate_id = uuid4()
    execution_id = uuid4()
    fingerprint = "b" * 64
    artifact_id = uuid4()
    version_id = uuid4()
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint=fingerprint)
    execution = SimpleNamespace(
        id=execution_id,
        source_fingerprint=fingerprint,
        exit_code=75,
        failure_kind="resource_limit",
        duration_ms=0,
        result={},
        observation={
            "execution_status": "not_run",
            "execution_reason_code": "local_statevector_capacity_exceeded",
            "sandbox_runs": 0,
        },
    )

    async def get_candidate(_scope, _session, _run_id, _candidate_id):
        return candidate

    async def get_execution(_scope, _session, _run_id, _candidate_id):
        return execution

    async def latest_review(_scope, _session, _run_id, _candidate_id):
        return None

    async def get_version(_scope, _session, got_version_id):
        assert got_version_id == version_id
        return SimpleNamespace(artifact_id=artifact_id, fingerprint=fingerprint)

    monkeypatch.setattr(agent_repo, "get_candidate", get_candidate)
    monkeypatch.setattr(agent_repo, "get_execution", get_execution)
    monkeypatch.setattr(agent_repo, "latest_semantic_review", latest_review)
    monkeypatch.setattr(agent_repo.artifacts_repo, "get_version", get_version)
    session = WriteSession(
        [
            ScalarResult(SimpleNamespace(id=run_id, artifact_version_id=version_id)),
            ScalarResult(SimpleNamespace(materialization=None)),
            UpdateResult(),
        ]
    )
    materialization = {
        "candidate_id": str(candidate_id),
        "source_fingerprint": fingerprint,
        "artifact_id": str(artifact_id),
        "version_id": str(version_id),
        "version_seq": 1,
        "framework": "qiskit",
        "execution_status": "not_run",
    }

    await agent_repo.set_materialization(_scope(), session, run_id, materialization)

    assert session.results == []


@pytest.mark.parametrize(
    "execution_overrides",
    [
        {"duration_ms": 1},
        {"failure_kind": "memory_exhausted"},
        {"result": {"counts": {"0": 1}}},
        {
            "observation": {
                "execution_status": "not_run",
                "sandbox_runs": 1,
                "execution_reason_code": "resource_exhausted",
            }
        },
    ],
)
async def test_materialization_repository_rejects_untrusted_not_run(
    monkeypatch,
    execution_overrides,
):
    run_id = uuid4()
    candidate_id = uuid4()
    fingerprint = "c" * 64
    artifact_id = uuid4()
    version_id = uuid4()
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint=fingerprint)
    values = {
        "id": uuid4(),
        "source_fingerprint": fingerprint,
        "exit_code": 75,
        "failure_kind": "resource_limit",
        "duration_ms": 0,
        "result": {},
        "observation": {
            "execution_status": "not_run",
            "execution_reason_code": "local_statevector_capacity_exceeded",
            "sandbox_runs": 0,
        },
    }
    values.update(execution_overrides)
    execution = SimpleNamespace(**values)

    async def get_candidate(_scope, _session, _run_id, _candidate_id):
        return candidate

    async def get_execution(_scope, _session, _run_id, _candidate_id):
        return execution

    async def latest_review(_scope, _session, _run_id, _candidate_id):
        return None

    async def get_version(_scope, _session, got_version_id):
        assert got_version_id == version_id
        return SimpleNamespace(artifact_id=artifact_id, fingerprint=fingerprint)

    monkeypatch.setattr(agent_repo, "get_candidate", get_candidate)
    monkeypatch.setattr(agent_repo, "get_execution", get_execution)
    monkeypatch.setattr(agent_repo, "latest_semantic_review", latest_review)
    monkeypatch.setattr(agent_repo.artifacts_repo, "get_version", get_version)
    session = WriteSession(
        [ScalarResult(SimpleNamespace(id=run_id, artifact_version_id=version_id))]
    )

    with pytest.raises(NotFoundError, match="trusted_not_run_execution"):
        await agent_repo.set_materialization(
            _scope(),
            session,
            run_id,
            {
                "candidate_id": str(candidate_id),
                "source_fingerprint": fingerprint,
                "artifact_id": str(artifact_id),
                "version_id": str(version_id),
                "execution_status": "not_run",
            },
        )


async def test_materialization_repository_rejects_version_not_linked_to_run():
    run_id = uuid4()
    materialization = {
        "candidate_id": str(uuid4()),
        "source_fingerprint": "a" * 64,
        "artifact_id": str(uuid4()),
        "version_id": str(uuid4()),
        "version_seq": 1,
        "framework": "qiskit",
    }
    session = WriteSession(
        [
            ScalarResult(
                SimpleNamespace(
                    id=run_id,
                    artifact_version_id=uuid4(),
                )
            )
        ]
    )

    with pytest.raises(ValueError, match="version is not linked to the run"):
        await agent_repo.set_materialization(_scope(), session, run_id, materialization)
