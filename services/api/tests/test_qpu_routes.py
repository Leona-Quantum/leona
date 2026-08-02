"""The QPU surface is stateless in this slice: catalog + estimate + gate.

What matters here: the routes exist over HTTP, every estimate response carries
its provenance, the submission gate defaults to blocked, and nothing accepts a
device or shot count outside the typed bounds.
"""

from majorana_api.routes import qpu as qpu_routes
from majorana_api.routes.qpu import (
    MAX_ESTIMATE_SHOTS,
    QpuEstimateRequest,
    QpuSubmissionRequest,
)
from repo_test_helpers import empty_tier_sources

import pytest
from pydantic import ValidationError


def _routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in qpu_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_catalog_estimate_and_gate_are_reachable_over_http():
    assert ("/qpu/backends", "GET") in _routes()
    assert ("/qpu/estimates", "POST") in _routes()
    assert ("/qpu/submission-gate", "GET") in _routes()


def test_every_route_requires_a_scope():
    for handler in (
        qpu_routes.qpu_backends,
        qpu_routes.qpu_estimate,
        qpu_routes.qpu_submission_gate,
        qpu_routes.qpu_credential_status,
        qpu_routes.qpu_connect_credential,
        qpu_routes.qpu_disconnect_credential,
    ):
        assert "scope" in handler.__annotations__


async def test_estimate_handler_rejects_unknown_devices_with_404():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_estimate(
            QpuEstimateRequest(device_id="braket.acme.imaginary", shots=10), scope=object()
        )
    assert excinfo.value.status_code == 404


async def test_estimate_handler_returns_sourced_numbers():
    result = await qpu_routes.qpu_estimate(
        QpuEstimateRequest(device_id="braket.iqm.garnet", shots=2048), scope=object()
    )
    assert result.total_usd == pytest.approx(0.30 + 2048 * 0.00145)
    assert result.rate_source.startswith("https://")
    assert result.rate_confirmed_on


def test_estimate_request_bounds_shots():
    with pytest.raises(ValidationError):
        QpuEstimateRequest(device_id="braket.iqm.garnet", shots=0)
    with pytest.raises(ValidationError):
        QpuEstimateRequest(device_id="braket.iqm.garnet", shots=MAX_ESTIMATE_SHOTS + 1)


class _NoCredentialSession:
    """A session whose only answer is "this caller has connected nothing"."""

    async def execute(self, statement):  # noqa: D102 - a double, not a repository
        class _Result:
            @staticmethod
            def scalar_one_or_none():
                return None

        return _Result()


async def test_submission_gate_defaults_to_blocked(monkeypatch):
    """No deployment submits to hardware unless the owner opens every gate."""
    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    response = await qpu_routes.qpu_submission_gate(scope=_scope(), session=_NoCredentialSession())
    assert response.submission_available is False
    assert response.blocked_reason == "submission_disabled"


async def test_submission_gate_is_caller_aware(monkeypatch):
    """Open deployment gates plus a caller with no key is `credentials_unconfigured`.

    The reason this is not `submission_available: true`: the gate is what the
    Studio reads to decide whether to offer hardware at all, and offering it to
    somebody with no IBM account connected produces a 409 at the moment they
    press the button, with no explanation of what to do about it.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", _a_key())
    response = await qpu_routes.qpu_submission_gate(scope=_scope(), session=_NoCredentialSession())
    assert response.submission_available is False
    assert response.blocked_reason == "credentials_unconfigured"


async def test_the_gate_is_closed_when_credential_storage_is_unavailable(monkeypatch):
    """An operator who never set MAJORANA_CREDENTIAL_KEYS cannot submit either.

    A stored row nothing can decrypt is not a usable credential, and reporting
    the caller as able to submit would enqueue a job that dies in the worker.
    Fail closed; `storage_available: false` on the status route is where an
    operator sees the actual cause.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.delenv("MAJORANA_CREDENTIAL_KEYS", raising=False)

    class _WouldAnswerYes:
        async def execute(self, statement):
            raise AssertionError("storage is unavailable; the row must not be read at all")

    response = await qpu_routes.qpu_submission_gate(scope=_scope(), session=_WouldAnswerYes())
    assert response.submission_available is False
    assert response.blocked_reason == "credentials_unconfigured"


def _a_key() -> str:
    from majorana_api.credential_crypto import generate_key

    return generate_key()


def _scope():
    import uuid as uuid_module
    from types import SimpleNamespace

    return SimpleNamespace(user_id=uuid_module.uuid4(), workspace_id=uuid_module.uuid4())


def _submission(device_id: str = "braket.ionq.forte") -> QpuSubmissionRequest:
    return QpuSubmissionRequest(
        device_id=device_id,
        shots=128,
        qasm='OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];',
        source_fingerprint="fnv1a-deadbeef",
    )


def _unmetered_identity():
    """An identity on the unmetered tier, for tests about everything else.

    The spend allowance has its own file. What this has to be is UNMETERED, not
    merely present: a developer-tier caller reaches `reserve_qpu_spend_slot` and
    returns from its first line, so these tests exercise the paths they are
    about without a session that can answer a lock.
    """
    from types import SimpleNamespace

    return (SimpleNamespace(email="dev@majorana.test", plan="developer"), object())


def _sources():
    return empty_tier_sources()


def test_submission_route_is_reachable_and_scoped():
    assert ("/qpu/submissions", "POST") in _routes()
    assert "scope" in qpu_routes.qpu_submit.__annotations__


def test_submission_takes_an_identity():
    """The handler had none, and a handler with no tier cannot check an allowance.

    That is not a style point: it is how `POST /qpu/submissions` came to accept
    $96,006.30 from a free account. Pinned here rather than only in the
    allowance suite so that removing the parameter fails the file that is about
    the route's shape.
    """
    assert "identity" in qpu_routes.qpu_submit.__annotations__
    assert "settings" in qpu_routes.qpu_submit.__annotations__


async def test_submission_rejects_unknown_devices_with_404():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(
            _submission("braket.acme.imaginary"),
            scope=object(),
            session=object(),
            identity=_unmetered_identity(),
            settings=_sources(),
        )
    assert excinfo.value.status_code == 404


async def test_submission_refuses_with_the_gate_reason(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(
            _submission(),
            scope=_scope(),
            session=_NoCredentialSession(),
            identity=_unmetered_identity(),
            settings=_sources(),
        )
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == {"blocked_reason": "submission_disabled"}


async def test_submission_refuses_a_caller_with_no_credential_before_writing_anything(
    monkeypatch,
):
    """The per-user gate, refused where a refusal costs nothing.

    Placed before `create_record` and `enqueue_job` on purpose. Letting it
    through would write a durable `qpu_runs` attestation row and a `qpu.run` job
    for a submission that cannot be made, and the worker would then close it as
    an errored hardware run — a failure record for something that never reached
    a provider, on the table whose entire purpose is attesting to things that
    did. Both repository functions are replaced with doubles that FAIL if called,
    so this proves the ordering rather than the return code.
    """
    from fastapi import HTTPException

    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", _a_key())

    async def must_not_run(*args, **kwargs):
        raise AssertionError("a caller with no credential must not reach this")

    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", must_not_run)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "reserve_qpu_spend_slot", must_not_run)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", must_not_run)

    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(
            _submission(),
            scope=_scope(),
            session=_NoCredentialSession(),
            identity=_unmetered_identity(),
            settings=_sources(),
        )
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == {"blocked_reason": "credentials_unconfigured"}


async def test_submission_with_open_gates_writes_the_record_and_enqueues(monkeypatch):
    """The durable row and the qpu.run job are created together, and the
    response is the attestation record — estimate snapshotted, status queued."""
    import datetime as dt
    import uuid as uuid_module
    from types import SimpleNamespace

    captured: dict[str, object] = {}
    record_id = uuid_module.uuid4()
    scope = SimpleNamespace(workspace_id=uuid_module.uuid4(), user_id=uuid_module.uuid4())

    async def fake_create_record(scope_arg, session_arg, **kwargs):
        captured["record"] = kwargs
        return SimpleNamespace(
            id=record_id,
            workspace_id=scope.workspace_id,
            user_id=scope.user_id,
            artifact_version_id=None,
            provider=kwargs["provider"],
            device_id=kwargs["device_id"],
            provider_job_id=None,
            shots=kwargs["shots"],
            status="queued",
            source_fingerprint=kwargs["source_fingerprint"],
            estimate_basis=kwargs["estimate_basis"],
            estimated_total_usd=kwargs["estimated_total_usd"],
            rate_source=kwargs["rate_source"],
            rate_confirmed_on=kwargs["rate_confirmed_on"],
            raw_counts=None,
            error=None,
            submitted_at=None,
            completed_at=None,
            created_at=dt.datetime.now(dt.UTC),
        )

    async def fake_enqueue_job(session_arg, *, kind, payload, **kwargs):
        captured["job"] = {"kind": kind, "payload": payload}

    async def connected(scope_arg, session_arg) -> bool:
        return True

    monkeypatch.setattr(qpu_routes, "submission_block_reason", lambda **_: None)
    monkeypatch.setattr(qpu_routes, "_caller_can_submit", connected)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", fake_create_record)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", fake_enqueue_job)

    result = await qpu_routes.qpu_submit(
        _submission(),
        scope=scope,
        session=object(),
        identity=_unmetered_identity(),
        settings=_sources(),
    )

    assert result.status.value == "queued"
    assert result.id == record_id
    assert result.estimated_total_usd is not None
    assert result.rate_source.startswith("https://")
    record = captured["record"]
    assert record["provider"] == "braket"
    assert record["qasm"].startswith("OPENQASM 3.0")
    job = captured["job"]
    assert job["kind"] == "qpu.run"
    assert job["payload"]["qpu_run_id"] == str(record_id)
    assert job["payload"]["workspace_id"] == str(scope.workspace_id)


def test_submission_request_bounds_inputs():
    with pytest.raises(ValidationError):
        QpuSubmissionRequest(
            device_id="braket.ionq.forte", shots=0, qasm="x", source_fingerprint="f"
        )
    with pytest.raises(ValidationError):
        QpuSubmissionRequest(
            device_id="braket.ionq.forte", shots=1, qasm="", source_fingerprint="f"
        )


def test_contract_enums_stay_in_lockstep_with_the_provider_package():
    """majorana_contracts pins the /v1 vocabulary; majorana_qpu owns the
    provider boundary. The values must never drift — the follow-up migration
    writes the contract values into a CHECK constraint."""
    from majorana_contracts import QpuEstimateBasis, QpuProvider, QpuRunStatus
    from majorana_qpu import EstimateBasis, QpuJobStatus, QpuProviderKey

    assert {m.value for m in QpuRunStatus} == {m.value for m in QpuJobStatus}
    assert {m.value for m in QpuProvider} == {m.value for m in QpuProviderKey}
    assert {m.value for m in QpuEstimateBasis} == {m.value for m in EstimateBasis}


async def test_the_gate_is_closed_when_the_rows_key_has_been_rotated_away(monkeypatch):
    """A key rotated by REPLACEMENT closes the gate, rather than opening it.

    The failure this pins was open in review and is worth stating exactly. The
    gate used to ask two questions — is *a* key configured, and does a row exist
    — and both are TRUE in the one case that matters. `credential_crypto` warns
    that replacing `MAJORANA_CREDENTIAL_KEYS` instead of prepending to it makes
    every stored credential undecryptable at once; when that happens
    `storage_available()` still returns True, because some valid Fernet key is
    configured. It is just not the one the row needs.

    So the gate opened, `POST /v1/qpu/submissions` wrote the durable qpu_runs
    attestation row, the job was enqueued, and the worker closed it as an errored
    hardware run — the exact outcome the check is documented to prevent, arrived
    at through the check.

    Note what this test does NOT do: it never decrypts anything. It stages a row
    whose `key_id` names a key that is no longer configured, which is the state
    the gate has to recognise without holding the ciphertext.
    """
    from majorana_api.credential_crypto import key_id_for

    retired, current = _a_key(), _a_key()
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", current)

    class _RowFromTheRetiredKey:
        async def execute(self, statement):
            from types import SimpleNamespace

            return SimpleNamespace(scalar_one_or_none=lambda: key_id_for(retired))

    response = await qpu_routes.qpu_submission_gate(scope=_scope(), session=_RowFromTheRetiredKey())
    assert response.submission_available is False
    assert response.blocked_reason == "credentials_unconfigured"

    # And the control: prepending instead of replacing keeps that same row
    # usable, which is the whole point of rotating that way round.
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", f"{current},{retired}")
    response = await qpu_routes.qpu_submission_gate(scope=_scope(), session=_RowFromTheRetiredKey())
    assert response.submission_available is True
    assert response.blocked_reason is None
