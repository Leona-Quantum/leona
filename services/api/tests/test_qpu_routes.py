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


async def test_submission_gate_defaults_to_blocked(monkeypatch):
    """No deployment submits to hardware unless the owner opens every gate."""
    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    response = await qpu_routes.qpu_submission_gate(scope=object())
    assert response.submission_available is False
    assert response.blocked_reason == "submission_disabled"


def _submission(device_id: str = "braket.ionq.forte") -> QpuSubmissionRequest:
    return QpuSubmissionRequest(
        device_id=device_id,
        shots=128,
        qasm='OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];',
        source_fingerprint="fnv1a-deadbeef",
    )


def test_submission_route_is_reachable_and_scoped():
    assert ("/qpu/submissions", "POST") in _routes()
    assert "scope" in qpu_routes.qpu_submit.__annotations__


async def test_submission_rejects_unknown_devices_with_404():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(
            _submission("braket.acme.imaginary"), scope=object(), session=object()
        )
    assert excinfo.value.status_code == 404


async def test_submission_refuses_with_the_gate_reason(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(_submission(), scope=object(), session=object())
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == {"blocked_reason": "submission_disabled"}


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

    monkeypatch.setattr(qpu_routes, "submission_block_reason", lambda: None)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", fake_create_record)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", fake_enqueue_job)

    result = await qpu_routes.qpu_submit(_submission(), scope=scope, session=object())

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
