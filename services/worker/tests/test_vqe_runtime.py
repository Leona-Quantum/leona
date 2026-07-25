import json
import asyncio
from pathlib import Path

import pytest

from majorana_api.vqe_runtime_profiles import candidate_runtime_profile
from majorana_vqe.models import Framework
from majorana_worker.vqe_runtime import (
    _OutputLimitExceeded,
    _read_bounded,
    VqeRuntimeError,
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
        "a95f4a8e8749e361c85df00b9bf42d9cea407a048840bc8e58f7e5c9920be3b1"
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


@pytest.mark.asyncio
async def test_launcher_uses_exact_digest_and_does_not_inherit_environment(monkeypatch):
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())
    captured = {}

    class Process:
        returncode = 0

        def __init__(self):
            self.stdout = asyncio.StreamReader()
            self.stderr = asyncio.StreamReader()
            self.stdout.feed_data(json.dumps(report).encode())
            self.stdout.feed_eof()
            self.stderr.feed_eof()

        async def wait(self):
            return self.returncode

    async def fake_create(*command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return Process()

    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "must-not-reach-child")
    monkeypatch.setattr(
        "majorana_worker.vqe_runtime.asyncio.create_subprocess_exec",
        fake_create,
    )

    result = await run_candidate_container(profile.binding)

    assert result["framework"] == "qiskit"
    command = captured["command"]
    assert profile.binding.container_digest in command
    assert profile.local_image_tag not in command
    assert ("--network", "none") == command[
        command.index("--network") : command.index("--network") + 2
    ]
    assert "--read-only" in command
    assert ("--cap-drop", "ALL") == command[
        command.index("--cap-drop") : command.index("--cap-drop") + 2
    ]
    assert captured["kwargs"]["env"] == {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "DOCKER_CLI_HINTS": "false",
    }


def test_candidate_profiles_pin_the_executed_digest():
    for framework in Framework:
        profile = candidate_runtime_profile(framework)
        assert profile.local_image_digest == profile.binding.container_digest
        assert profile.binding.production_runtime_status == "unqualified"


@pytest.mark.asyncio
async def test_candidate_transport_rejects_cloud_markers(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("CI", "true")
    with pytest.raises(RuntimeError, match="development-only"):
        await run_candidate_container(
            candidate_runtime_profile(Framework.QISKIT).binding,
        )


@pytest.mark.asyncio
async def test_bounded_reader_stops_before_unbounded_memory_growth():
    stream = asyncio.StreamReader()
    stream.feed_data(b"12345")
    stream.feed_eof()
    with pytest.raises(_OutputLimitExceeded):
        await _read_bounded(stream, 4)
