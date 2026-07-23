"""The QPU surface is stateless in this slice: catalog + estimate + gate.

What matters here: the routes exist over HTTP, every estimate response carries
its provenance, the submission gate defaults to blocked, and nothing accepts a
device or shot count outside the typed bounds.
"""

from majorana_api.routes import qpu as qpu_routes
from majorana_api.routes.qpu import MAX_ESTIMATE_SHOTS, QpuEstimateRequest

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
