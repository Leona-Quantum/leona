"""`IbmRuntimeProvider.queue_status` — the "before you submit" queue reading.

Mocked at `_service()`, never at the qiskit import: a fake service object
duck-types `least_busy(...).status()`, so this proves what the adapter DOES
with whatever IBM answers without ever constructing a real
`QiskitRuntimeService` or reaching the network. `test_submission_gating.py`
already proves the three gates fail closed for every other method; this file
is only the one method those tests do not cover.
"""

from __future__ import annotations

import pytest

from majorana_qpu import IbmRuntimeProvider, QpuDisabledError, QpuSubmissionBlockReason

ENABLED = {"MAJORANA_QPU_SUBMIT_ENABLED": "true"}


class _FakeStatus:
    def __init__(self, pending_jobs: object) -> None:
        self.pending_jobs = pending_jobs


class _FakeBackend:
    def __init__(self, name: str, pending_jobs: object) -> None:
        self.name = name
        self._status = _FakeStatus(pending_jobs)

    def status(self) -> _FakeStatus:
        return self._status


class _FakeService:
    def __init__(self, backend: _FakeBackend) -> None:
        self._backend = backend
        self.least_busy_calls: list[dict[str, object]] = []

    def least_busy(self, *, operational: bool, simulator: bool) -> _FakeBackend:
        self.least_busy_calls.append({"operational": operational, "simulator": simulator})
        return self._backend


def _provider_with(monkeypatch, backend: _FakeBackend, service: _FakeService) -> IbmRuntimeProvider:
    provider = IbmRuntimeProvider("tok-abc", environ=ENABLED)
    monkeypatch.setattr(provider, "_service", lambda: service)
    return provider


def test_reports_the_least_busy_backends_pending_jobs(monkeypatch):
    backend = _FakeBackend("ibm_torino", 12)
    service = _FakeService(backend)
    provider = _provider_with(monkeypatch, backend, service)

    info = provider.queue_status()

    assert info.backend_name == "ibm_torino"
    assert info.pending_jobs == 12
    # The same call `submit()` makes to choose a machine — a queue reading for
    # any other selection would answer a question a real submission is not
    # asking.
    assert service.least_busy_calls == [{"operational": True, "simulator": False}]


def test_a_non_int_pending_jobs_is_not_reported_as_a_number(monkeypatch):
    """Never a guess: a field IBM sends in an unexpected shape becomes "not
    reported", the same rule `reported_backend_name` already applies to the
    backend's name."""
    backend = _FakeBackend("ibm_brisbane", pending_jobs=None)
    service = _FakeService(backend)
    provider = _provider_with(monkeypatch, backend, service)

    info = provider.queue_status()

    assert info.pending_jobs is None
    assert info.backend_name == "ibm_brisbane"


def test_a_blank_credential_is_refused_before_any_service_call(monkeypatch):
    provider = IbmRuntimeProvider("   ", environ=ENABLED)
    calls: list[str] = []
    monkeypatch.setattr(provider, "_service", lambda: calls.append("called"))

    with pytest.raises(QpuDisabledError) as excinfo:
        provider.queue_status()

    assert excinfo.value.reason is QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED
    assert calls == []


def test_disabled_by_default_even_with_a_credential(monkeypatch):
    """The deployment flag gates this the same as every other method: a
    caller's own key does not open the gate the operator has not opened."""
    provider = IbmRuntimeProvider("tok-abc", environ={})
    calls: list[str] = []
    monkeypatch.setattr(provider, "_service", lambda: calls.append("called"))

    with pytest.raises(QpuDisabledError) as excinfo:
        provider.queue_status()

    assert excinfo.value.reason is QpuSubmissionBlockReason.SUBMISSION_DISABLED
    assert calls == []
