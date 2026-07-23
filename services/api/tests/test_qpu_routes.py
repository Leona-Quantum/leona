"""The QPU surface is stateless in this slice: catalog + estimate + gate.

What matters here: the routes exist over HTTP, every estimate response carries
its provenance, the submission gate defaults to blocked, and nothing accepts a
device or shot count outside the typed bounds.
"""

from majorana_api.routes import qpu as qpu_routes
from majorana_api.routes.qpu import (
    DURABLE_RECORD_UNAVAILABLE,
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
        await qpu_routes.qpu_submit(_submission("braket.acme.imaginary"), scope=object())
    assert excinfo.value.status_code == 404


async def test_submission_refuses_with_the_gate_reason(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(_submission(), scope=object())
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == {"blocked_reason": "submission_disabled"}


async def test_submission_fails_closed_even_with_every_provider_gate_open(monkeypatch):
    """A hardware job with nowhere to attest its provider job id must not
    start: until the qpu_run record migration lands, an all-gates-open
    deployment still refuses with a reason the UI can show."""
    from fastapi import HTTPException

    monkeypatch.setattr(qpu_routes, "submission_block_reason", lambda: None)
    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(_submission(), scope=object())
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == {"blocked_reason": DURABLE_RECORD_UNAVAILABLE}


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
