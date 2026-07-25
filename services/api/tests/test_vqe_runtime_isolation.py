from pathlib import Path

import pytest
from majorana_vqe.models import ExecutionBinding, ExecutionRequest
from pydantic import ValidationError

from majorana_api.vqe_runtime_isolation import (
    PHASE5A_RUNTIME_CONSTRAINTS,
    runtime_environment,
)


def _binding(**updates) -> ExecutionBinding:
    values = {
        "framework": "qiskit",
        "provider_versions": {"qiskit": "1.4.6"},
        "runtime_profile_id": "qiskit-local-candidate",
        "adapter_release_id": "majorana-vqe-qiskit-adapter-0.1.0",
        "container_digest": "sha256:" + "1" * 64,
        "architecture": "local-candidate",
        "protocol_version": "0.2.0",
    }
    values.update(updates)
    return ExecutionBinding(**values)


def test_client_execution_request_cannot_choose_network_or_credentials():
    with pytest.raises(ValidationError):
        ExecutionRequest(
            experiment_id="019f0000-0000-7000-8000-000000000001",
            requested_capability="h2_sto3g_exact_energy",
            network_policy="allow",
        )


def test_binding_cannot_represent_network_enabled_or_dynamic_install_runtime():
    with pytest.raises(ValidationError):
        _binding(isolation_policy={"network_policy": "allow"})
    with pytest.raises(ValidationError):
        _binding(
            isolation_policy={
                "dynamic_package_installation": "allowed",
            }
        )


def test_runtime_environment_is_fixed_offline_and_contains_no_secret_channels():
    binding = _binding()
    environment = dict(runtime_environment(binding))
    assert binding.production_runtime_status == "unqualified"
    assert environment["PIP_NO_INDEX"] == "1"
    assert environment["UV_OFFLINE"] == "1"
    forbidden_fragments = (
        "database",
        "neon",
        "token",
        "secret",
        "password",
        "credential",
        "proxy_url",
    )
    assert not any(
        fragment in key.lower() for key in environment for fragment in forbidden_fragments
    )
    assert PHASE5A_RUNTIME_CONSTRAINTS.network_mode == "none"
    assert PHASE5A_RUNTIME_CONSTRAINTS.credential_mounts == ()
    assert PHASE5A_RUNTIME_CONSTRAINTS.inherited_environment == ()


def test_candidate_runtime_scripts_have_no_network_or_dynamic_install_surface():
    root = Path(__file__).resolve().parents[3]
    scripts = (
        root / "runtimes/vqe/qiskit-current/spike/h2_actual_vqe_v02.py",
        root / "runtimes/vqe/pennylane-current/spike/h2_actual_vqe_v02.py",
    )
    forbidden = (
        "requests.",
        "urllib.request",
        "httpx.",
        "socket.",
        "subprocess.",
        "pip install",
        "uv add",
        "uv pip",
        "DATABASE_URL",
        "NEON_",
    )
    for script in scripts:
        source = script.read_text()
        assert not any(token in source for token in forbidden), script
