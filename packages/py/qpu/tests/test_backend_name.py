"""The adapter reports which physical machine a job went to, and never guesses.

`device_id` is Leona's catalog entry (`ibm.open_plan`); IBM picks the processor
itself with `least_busy`. Increment 2 of proposal 5 records that choice on the
durable row (migration 0065), and this file pins the two halves the worker
depends on: the name is the backend the job was actually run on, and anything
that is not a usable name becomes None rather than an exception on a submit the
provider has already accepted.
"""

import sys
import types

import pytest

from majorana_qpu import (
    MAX_BACKEND_NAME_CHARS,
    IbmRuntimeProvider,
    QpuJobRequest,
    reported_backend_name,
)

REQUEST = QpuJobRequest(
    device_id="ibm.open_plan",
    shots=256,
    qasm='OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c = measure q;',
    source_fingerprint="fnv1a-deadbeef",
)


def test_a_plain_name_is_kept_as_the_provider_sent_it():
    assert reported_backend_name("ibm_brisbane") == "ibm_brisbane"
    assert reported_backend_name("  ibm_torino \n") == "ibm_torino"


@pytest.mark.parametrize(
    "value",
    [None, "", "   ", 42, object(), "x" * (MAX_BACKEND_NAME_CHARS + 1)],
)
def test_anything_that_is_not_a_usable_name_is_not_reported(value):
    """None, not an exception and not a truncation. This runs after IBM has
    accepted the job, so raising here would lose the job id the same transition
    writes, and a truncated name would be a name IBM never used."""
    assert reported_backend_name(value) is None


def test_the_bound_matches_the_column_check():
    """Migration 0065's CHECK and this constant must agree, or a name the
    adapter keeps could fail the worker's transition."""
    from pathlib import Path

    migration = (
        Path(__file__).resolve().parents[4]
        / "db"
        / "migrations"
        / "versions"
        / "0065_qpu_run_backend_name.py"
    ).read_text()
    assert f"char_length(backend_name) between 1 and {MAX_BACKEND_NAME_CHARS}" in migration


class _FakeBackend:
    def __init__(self, name):
        self.name = name


class _FakeJob:
    def job_id(self):
        return "job-abc"

    def status(self):
        return "QUEUED"


def _install_fake_runtime(monkeypatch, backend):
    """Replace the three IBM calls submit makes, and record what ran where.

    Everything else in `submit` runs for real. The sampler records the backend
    it was built with, so the test can check the reported name belongs to the
    machine the job was actually sent to, not just to some backend object.
    """
    seen: dict[str, object] = {}

    class FakeService:
        def __init__(self, **kwargs):
            seen["service_kwargs"] = kwargs

        def least_busy(self, *, operational, simulator):
            assert operational is True and simulator is False
            return backend

    class FakeSampler:
        def __init__(self, *, mode):
            seen["sampler_backend"] = mode
            self.options = types.SimpleNamespace(default_shots=None)

        def run(self, pubs):
            seen["shots"] = self.options.default_shots
            return _FakeJob()

    class FakePassManager:
        def run(self, circuit):
            return circuit

    runtime = types.ModuleType("qiskit_ibm_runtime")
    runtime.QiskitRuntimeService = FakeService
    runtime.SamplerV2 = FakeSampler
    monkeypatch.setitem(sys.modules, "qiskit_ibm_runtime", runtime)

    import qiskit.qasm3
    import qiskit.transpiler.preset_passmanagers as presets

    monkeypatch.setattr(qiskit.qasm3, "loads", lambda text: ("circuit", text))
    monkeypatch.setattr(presets, "generate_preset_pass_manager", lambda **kwargs: FakePassManager())
    return seen


OPEN = {"MAJORANA_QPU_SUBMIT_ENABLED": "true"}


def test_submit_reports_the_backend_the_job_was_run_on(monkeypatch):
    backend = _FakeBackend("ibm_brisbane")
    seen = _install_fake_runtime(monkeypatch, backend)

    record = IbmRuntimeProvider("tok-abc", environ=OPEN).submit(REQUEST)

    assert seen["sampler_backend"] is backend
    assert record.backend_name == "ibm_brisbane"
    # The catalog key is unchanged: the machine is a separate fact.
    assert record.device_id == "ibm.open_plan"
    assert record.provider_job_id == "job-abc"
    assert seen["shots"] == 256


def test_a_backend_with_no_usable_name_submits_and_reports_none(monkeypatch):
    """The job still goes through and its id is still returned. Only the name
    is absent, because the provider did not give one."""
    _install_fake_runtime(monkeypatch, _FakeBackend(None))

    record = IbmRuntimeProvider("tok-abc", environ=OPEN).submit(REQUEST)

    assert record.provider_job_id == "job-abc"
    assert record.backend_name is None
