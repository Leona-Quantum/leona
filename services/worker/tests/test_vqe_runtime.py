import asyncio
import json
from pathlib import Path

import pytest

from majorana_api.vqe_runtime_profiles import (
    candidate_runtime_profile,
    profile_for_binding,
    production_runtime_profile,
)
from majorana_vqe.models import Framework
from majorana_worker.vqe_runtime import (
    LocalDockerVqeRuntimeExecutor,
    OciDockerVqeRuntimeExecutor,
    VqeRuntimeCancelled,
    VqeRuntimeError,
    _MAX_STDOUT_BYTES,
    build_success_evidence,
    run_candidate_container,
)

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"
_CLOUD_MARKERS = ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI")


def _enable_local_candidate(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    for name in _CLOUD_MARKERS:
        monkeypatch.delenv(name, raising=False)


def test_current_production_profile_is_versioned_without_orphaning_v1_bindings():
    current = production_runtime_profile(Framework.QISKIT)
    assert current.binding.runtime_profile_id.endswith("-production-v2")
    assert current.binding.adapter_release_id.endswith("-adapter-0.3.0")
    assert current.runtime_payload_source_commit == (
        "a4c11cf5be8d5235901f1c1399f483e381833d4a"
    )

    legacy_digest = (
        "sha256:f2d19903e323da3f60039ac81627ed466f36055b7e157959ed1afe6168e4d992"
    )
    legacy_binding = current.binding.model_copy(
        update={
            "runtime_profile_id": "h2-qiskit-linux-x86_64-production-v1",
            "adapter_release_id": "majorana-h2-qiskit-adapter-0.2.0",
            "container_digest": legacy_digest,
            "oci_manifest_digest": legacy_digest,
        }
    )

    resolved = profile_for_binding(legacy_binding)
    assert resolved.binding == legacy_binding
    assert resolved.runtime_payload_source_commit == (
        "fae2d2f4d6310a6cbc29cc0fe5ebab20b361ae07"
    )


@pytest.mark.parametrize(
    ("framework", "filename"),
    [
        (Framework.QISKIT, "qiskit_vqe_v0.2.json"),
        (Framework.PENNYLANE, "pennylane_vqe_v0.2.json"),
    ],
)
def test_raw_runtime_report_translates_to_complete_evidence(framework, filename):
    profile = candidate_runtime_profile(framework)
    assert profile.provenance_complete is True
    assert profile.binding.container_digest_kind == "local_docker_image_id"
    assert profile.binding.oci_manifest_digest is None
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


@pytest.mark.parametrize(
    ("framework", "filename"),
    [
        (Framework.QISKIT, "qiskit_slsqp_linux_amd64.json"),
        (Framework.PENNYLANE, "pennylane_slsqp_linux_amd64.json"),
    ],
)
def test_slsqp_runtime_report_requires_matching_scientific_selection(framework, filename):
    profile = candidate_runtime_profile(framework)
    report = json.loads((ROOT / "docs" / "atlas" / "evidence" / "phase76" / filename).read_text())

    evidence = build_success_evidence(
        report,
        binding=profile.binding,
        scientific_spec_sha256="1" * 64,
        registry_resolution_sha256="2" * 64,
        ansatz_semantic_digest="3" * 64,
        seed=0,
        expected_optimizer_algorithm="scipy_slsqp",
    )
    assert evidence.optimizer_work.energy_evaluations == 8
    assert evidence.optimizer_work.gradient_evaluations == 4

    with pytest.raises(VqeRuntimeError, match="optimizer algorithm"):
        build_success_evidence(
            report,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
        )


@pytest.mark.parametrize(
    ("framework", "filename", "expected_energy_evaluations"),
    [
        (Framework.QISKIT, "qiskit_cobyla_local.json", 42),
        (Framework.PENNYLANE, "pennylane_cobyla_local.json", 43),
    ],
)
def test_cobyla_runtime_report_is_machine_checked_as_private_local_evidence(
    framework,
    filename,
    expected_energy_evaluations,
):
    profile = candidate_runtime_profile(framework)
    report = json.loads(
        (ROOT / "docs" / "atlas" / "evidence" / "phase78" / filename).read_text()
    )

    evidence = build_success_evidence(
        report,
        binding=profile.binding,
        scientific_spec_sha256="1" * 64,
        registry_resolution_sha256="2" * 64,
        ansatz_semantic_digest="3" * 64,
        seed=0,
        expected_optimizer_algorithm="scipy_cobyla",
    )

    assert evidence.absolute_error_ha <= 1e-10
    assert evidence.final_state_fidelity >= 1 - 1e-10
    assert evidence.optimizer_work.energy_evaluations == expected_energy_evaluations
    assert evidence.optimizer_work.gradient_evaluations == 0
    common = evidence.resources[1]
    assert (common.two_qubit_gate_count, common.depth, common.gate_count) == (
        48,
        83,
        152,
    )

    with pytest.raises(VqeRuntimeError, match="optimizer algorithm"):
        build_success_evidence(
            report,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
            expected_optimizer_algorithm="scipy_slsqp",
        )


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


class _InspectProcess:
    def __init__(self, stdout: bytes, *, returncode: int = 0) -> None:
        self._stdout = stdout
        self.returncode = returncode

    async def communicate(self):
        return self._stdout, b""


async def test_launcher_uses_exact_digest_and_does_not_inherit_environment(monkeypatch):
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = (RAW / "qiskit_vqe_v0.2.json").read_bytes()
    captured = {}

    async def create(*command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return _SuccessfulProcess(report)

    _enable_local_candidate(monkeypatch)
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
    _enable_local_candidate(monkeypatch)
    monkeypatch.setenv("CI", "true")
    with pytest.raises(VqeRuntimeError, match="development-only"):
        await run_candidate_container(candidate_runtime_profile(Framework.QISKIT).binding)


async def test_production_launcher_requires_preprovisioned_exact_digest(monkeypatch):
    profile = production_runtime_profile(Framework.QISKIT)
    report = (RAW / "qiskit_vqe_v0.2.json").read_bytes()
    captured = []

    async def create(*command, **kwargs):
        captured.append((command, kwargs))
        if command[1:3] == ("image", "inspect"):
            return _InspectProcess(json.dumps([profile.image_reference]).encode())
        return _SuccessfulProcess(report)

    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("MAJORANA_VQE_RUNTIME_HOST", "dedicated")
    monkeypatch.setenv("DATABASE_URL", "must-not-reach-child")
    for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("majorana_worker.vqe_runtime._docker_binary", lambda: "/docker")
    monkeypatch.setattr("majorana_worker.vqe_runtime.asyncio.create_subprocess_exec", create)

    output = await OciDockerVqeRuntimeExecutor().run(profile.binding)

    assert output.payload["framework"] == "qiskit"
    run_command, run_kwargs = captured[1]
    assert ("--pull", "never") == (
        run_command[run_command.index("--pull")],
        run_command[run_command.index("--pull") + 1],
    )
    image_index = run_command.index(profile.image_reference)
    assert run_command[image_index + 1 :] == (
        "--optimizer",
        "scipy_minimize_scalar_bounded",
    )
    assert "--network" in run_command
    assert run_command[run_command.index("--network") + 1] == "none"
    assert run_kwargs["env"] == {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "DOCKER_CLI_HINTS": "false",
    }


async def test_production_launcher_refuses_missing_exact_digest(monkeypatch):
    profile = production_runtime_profile(Framework.PENNYLANE)

    async def create(*_command, **_kwargs):
        return _InspectProcess(b"[]")

    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("MAJORANA_VQE_RUNTIME_HOST", "dedicated")
    for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("majorana_worker.vqe_runtime._docker_binary", lambda: "/docker")
    monkeypatch.setattr("majorana_worker.vqe_runtime.asyncio.create_subprocess_exec", create)

    with pytest.raises(VqeRuntimeError, match="approved OCI registry digest"):
        await OciDockerVqeRuntimeExecutor().run(profile.binding)


async def _executor_with_process(monkeypatch, process):
    removed = []

    async def create(*args, **kwargs):
        return process

    async def remove(docker, name):
        removed.append(name)

    _enable_local_candidate(monkeypatch)
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
