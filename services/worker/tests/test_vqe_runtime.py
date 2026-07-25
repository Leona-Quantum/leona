import asyncio
import json
from pathlib import Path

import pytest

from majorana_api.vqe_runtime_profiles import candidate_runtime_profile
from majorana_vqe.models import Framework
from majorana_worker.vqe_runtime import (
    LocalDockerVqeRuntimeExecutor,
    VqeRuntimeCancelled,
    VqeRuntimeError,
    _MAX_STDOUT_BYTES,
    build_success_evidence,
    run_candidate_container,
)

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"


@pytest.mark.parametrize(
    ("framework", "filename"),
    [
        (Framework.QISKIT, "qiskit_vqe_v0.2.json"),
        (Framework.PENNYLANE, "pennylane_vqe_v0.2.json"),
    ],
)
def test_raw_runtime_report_translates_to_complete_evidence(framework, filename):
    profile = candidate_runtime_profile(framework)
    report = json.loads((RAW / filename).read_text())

    evidence = build_success_evidence(
        report,
        binding=profile.binding,
        scientific_spec_sha256="1" * 64,
        registry_resolution_sha256="2" * 64,
        ansatz_semantic_digest="3" * 64,
        seed=0,
    )

    assert evidence.framework is framework
    assert evidence.absolute_error_ha <= 1e-10
    assert evidence.canonical_circuit_sha256 == (
        "f4fdb1ac3f041185fff63f6a7acb9d3ab1e9742131ed5bd3bb9ba2d99081a58c"
    )
    assert [resource.stage for resource in evidence.resources] == [
        "canonical_logical",
        "common_basis_compiled",
        "provider_native_diagnostic",
    ]
    common = evidence.resources[1]
    assert (common.two_qubit_gate_count, common.depth, common.gate_count) == (
        48,
        83,
        152,
    )
    assert common.metric_scope == "ansatz_only"
    assert common.adapter_verification == "passed"


def test_runtime_report_rejects_framework_drift():
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())
    report["framework"] = "pennylane"

    with pytest.raises(VqeRuntimeError, match="framework"):
        build_success_evidence(
            report,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
        )


def test_runtime_report_rejects_numerical_gate_regression():
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())
    report["optimization"]["best_energy_ha"] = report["optimization"]["exact_energy_ha"] + 1e-3
    report["optimization"]["absolute_error_ha"] = 1e-3

    with pytest.raises(VqeRuntimeError, match="numerical gate"):
        build_success_evidence(
            report,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
        )


class _BlockedProcess:
    def __init__(self, *, stdout: bytes = b"", stderr: bytes = b"") -> None:
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.stdout.feed_data(stdout)
        self.stderr.feed_data(stderr)
        self.returncode = None
        self._finished = asyncio.Event()
        self.killed = False

    async def wait(self):
        await self._finished.wait()
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9
        self.stdout.feed_eof()
        self.stderr.feed_eof()
        self._finished.set()


class _SuccessfulProcess:
    def __init__(self, stdout: bytes) -> None:
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.stdout.feed_data(stdout)
        self.stdout.feed_eof()
        self.stderr.feed_eof()
        self.returncode = 0

    async def wait(self):
        return 0

    def kill(self):
        self.returncode = -9


async def test_launcher_uses_exact_digest_and_does_not_inherit_environment(monkeypatch):
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = (RAW / "qiskit_vqe_v0.2.json").read_bytes()
    captured = {}

    async def create(*command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return _SuccessfulProcess(report)

    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "must-not-reach-child")
    monkeypatch.setattr("majorana_worker.vqe_runtime._docker_binary", lambda: "/docker")
    monkeypatch.setattr("majorana_worker.vqe_runtime.asyncio.create_subprocess_exec", create)

    result = await run_candidate_container(profile.binding)

    assert result["framework"] == "qiskit"
    assert profile.local_image_digest in captured["command"]
    assert profile.local_image_tag not in captured["command"]
    assert captured["kwargs"]["env"] == {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "DOCKER_CLI_HINTS": "false",
    }


async def test_candidate_transport_rejects_cloud_markers(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("CI", "true")
    with pytest.raises(VqeRuntimeError, match="development-only"):
        await run_candidate_container(candidate_runtime_profile(Framework.QISKIT).binding)


async def _executor_with_process(monkeypatch, process):
    removed = []

    async def create(*args, **kwargs):
        return process

    async def remove(docker, name):
        removed.append(name)

    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setattr("majorana_worker.vqe_runtime._docker_binary", lambda: "/docker")
    monkeypatch.setattr("majorana_worker.vqe_runtime.asyncio.create_subprocess_exec", create)
    monkeypatch.setattr("majorana_worker.vqe_runtime._force_remove_container", remove)
    return LocalDockerVqeRuntimeExecutor(), removed


async def test_runtime_timeout_removes_daemon_container(monkeypatch):
    process = _BlockedProcess()
    executor, removed = await _executor_with_process(monkeypatch, process)
    profile = candidate_runtime_profile(Framework.QISKIT)

    with pytest.raises(VqeRuntimeError) as excinfo:
        await executor.run(profile.binding, timeout_s=0.001)

    assert excinfo.value.failure_code.value == "runtime_timeout"
    assert excinfo.value.retryable is True
    assert process.killed is True
    assert len(removed) == 1


async def test_runtime_cancellation_removes_container_and_discards_output(monkeypatch):
    process = _BlockedProcess(stdout=b'{"partial":')
    executor, removed = await _executor_with_process(monkeypatch, process)
    profile = candidate_runtime_profile(Framework.QISKIT)

    async def cancelled():
        return True

    with pytest.raises(VqeRuntimeCancelled):
        await executor.run(
            profile.binding,
            timeout_s=1,
            cancel_requested=cancelled,
        )

    assert process.killed is True
    assert len(removed) == 1


async def test_runtime_output_limit_kills_before_unbounded_buffering(monkeypatch):
    process = _BlockedProcess(stdout=b"x" * (_MAX_STDOUT_BYTES + 1))
    executor, removed = await _executor_with_process(monkeypatch, process)
    profile = candidate_runtime_profile(Framework.QISKIT)

    with pytest.raises(VqeRuntimeError) as excinfo:
        await executor.run(profile.binding, timeout_s=1)

    assert excinfo.value.failure_code.value == "output_limit_exceeded"
    assert excinfo.value.retryable is False
    assert process.killed is True
    assert len(removed) == 1
