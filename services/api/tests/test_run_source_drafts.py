import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import ExportStatus, Framework
from pydantic import ValidationError

from majorana_api.orm import User, Workspace
from majorana_api.routes import runs
from majorana_api.settings import Settings


def _request(*, version_id: uuid.UUID, source: str) -> runs.CreateRunRequest:
    return runs.CreateRunRequest(
        task_prompt="Revise this circuit",
        framework=Framework.QISKIT,
        artifact_version_id=version_id,
        source_code=source,
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("shots", 20_001),
        ("seed", -1),
        ("seed", 2**31),
    ],
)
def test_run_request_rejects_values_the_executor_cannot_preserve(field, value):
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(task_prompt="Build a Bell circuit", **{field: value})


def test_run_request_accepts_only_supported_response_locales():
    assert runs.CreateRunRequest(task_prompt="Bell").response_locale == "en"
    assert runs.CreateRunRequest(task_prompt="Bell", response_locale="ja").response_locale == "ja"
    with pytest.raises(ValidationError):
        runs.CreateRunRequest(task_prompt="Bell", response_locale="fr")


async def test_edited_source_creates_explicitly_unverified_immutable_draft(scope, monkeypatch):
    base_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    draft_id = uuid.uuid4()
    captured = {}

    async def get_version(*_args):
        return SimpleNamespace(id=base_id, artifact_id=artifact_id, code="old source")

    async def create_version(_scope, _session, supplied_artifact_id, **values):
        captured.update(values)
        captured["artifact_id"] = supplied_artifact_id
        return SimpleNamespace(id=draft_id)

    monkeypatch.setattr(runs.artifacts_repo, "get_version", get_version)
    monkeypatch.setattr(runs.artifacts_repo, "create_version", create_version)

    result = await runs._create_stale_source_draft(
        _request(version_id=base_id, source="edited source"), scope, object()
    )

    assert result == draft_id
    assert captured["artifact_id"] == artifact_id
    assert captured["qasm"] is None
    assert captured["export_status"] is ExportStatus.UNSUPPORTED
    assert captured["metadata"]["based_on_version_id"] == str(base_id)
    assert captured["metadata"]["verification_summary"] == {
        "verified": False,
        "decision": None,
        "evidence_strength": None,
        "reason_code": "source_changed_pending_verification",
        "stale": True,
    }


async def test_unchanged_source_reuses_the_existing_version_without_a_draft(scope, monkeypatch):
    base_id = uuid.uuid4()

    async def get_version(*_args):
        return SimpleNamespace(id=base_id, artifact_id=uuid.uuid4(), code="same source")

    async def unexpected_create(*_args, **_kwargs):
        raise AssertionError("unchanged source must not create a draft")

    monkeypatch.setattr(runs.artifacts_repo, "get_version", get_version)
    monkeypatch.setattr(runs.artifacts_repo, "create_version", unexpected_create)

    result = await runs._create_stale_source_draft(
        _request(version_id=base_id, source="same source"), scope, object()
    )

    assert result == base_id


async def test_run_and_job_are_bound_to_the_new_draft_version(scope, monkeypatch):
    base_id = uuid.uuid4()
    draft_id = uuid.uuid4()
    run_id = uuid.uuid4()
    captured = {}
    body = _request(version_id=base_id, source="edited source")

    async def create_draft(*_args):
        return draft_id

    async def create_run(_scope, _session, **values):
        captured["run"] = values
        return SimpleNamespace(id=run_id)

    async def append_event(*_args, **_kwargs):
        return None

    async def enqueue_job(_session, **values):
        captured["job"] = values

    # This request carries the default mode (AUTO), which the admission backstop
    # now counts — see `_enforce_execute_backstop`. Stub the count so this test
    # keeps testing draft binding rather than quotas; `object()` is not a real
    # session and cannot answer a query.
    async def no_runs_yet(*_args, **_kwargs):
        return {}

    # Same reason, for the same `object()`: the 201 now carries the run's queue
    # position, which is a real query. This test is about draft binding.
    async def no_queue(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(runs.runs_repo, "queue_positions", no_queue)
    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", no_runs_yet)
    monkeypatch.setattr(runs, "_create_stale_source_draft", create_draft)
    monkeypatch.setattr(runs.runs_repo, "create_run", create_run)
    monkeypatch.setattr(runs.runs_repo, "append_run_event", append_event)
    monkeypatch.setattr(runs.system, "enqueue_job", enqueue_job)
    monkeypatch.setattr(runs, "_to_resource", lambda row, queue_position=None: row.id)

    # A DEVELOPER identity so the per-tier gate is a no-op here; this test is
    # about draft binding, not allowances (see test_run_tier_allowance.py).
    identity = (User(email="local-dev@majorana.test", plan=None), Workspace())
    settings = Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
    )
    result = await runs.create_run(body, scope, object(), identity, settings)

    assert result == run_id
    assert captured["run"]["artifact_version_id"] == draft_id
    assert captured["job"]["payload"]["source_code"] == "edited source"
    assert captured["job"]["payload"]["response_locale"] == "en"
