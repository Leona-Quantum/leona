"""Phase 5A VQE candidate runtime launcher and evidence adapter.

The Docker transport is development-only and always selects the server-owned
image by immutable config digest. The child receives no credentials or host
environment and is launched with network none, a read-only root filesystem,
all capabilities dropped, non-root UID, and bounded resources.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import struct
from dataclasses import dataclass
from typing import Any

from majorana_vqe.models import ExecutionBinding
from majorana_vqe.result import (
    OptimizerWork,
    ParameterValue,
    ResourceObservation,
    VqeOptimizationSuccessResult,
)

from majorana_api.vqe_runtime_profiles import CandidateRuntimeProfile, profile_for_binding

_MAX_STDOUT_BYTES = 1_000_000
_MAX_STDERR_BYTES = 64_000
_H2_HAMILTONIAN_DIGEST = "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
_PARAMETER_SLOT = "theta.double.occ0_occ2.to.virt1_virt3"


class VqeRuntimeError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class VqeRuntimeOutput:
    payload: dict[str, Any]
    bounded_stderr: str


def _parameter(theta: float) -> ParameterValue:
    return ParameterValue(
        slot_id=_PARAMETER_SLOT,
        float64_hex=struct.pack(">d", theta).hex(),
    )


def _parameter_digest(values: list[ParameterValue]) -> str:
    payload = [value.model_dump(mode="json") for value in values]
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


async def run_candidate_container(
    binding: ExecutionBinding,
    *,
    timeout_s: float = 300.0,
) -> dict[str, Any]:
    if os.environ.get("MAJORANA_ENV", "").strip().lower() != "development":
        raise RuntimeError("candidate Docker transport is development-only")
    profile = profile_for_binding(binding)
    command = [
        "/usr/local/bin/docker",
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "2g",
        "--cpus",
        "2",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=64m",
        "--user",
        "65532:65532",
        profile.local_image_digest,
    ]
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "DOCKER_CLI_HINTS": "false",
        },
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_s)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError("VQE candidate runtime timed out") from None
    if len(stdout) > _MAX_STDOUT_BYTES or len(stderr) > _MAX_STDERR_BYTES:
        raise RuntimeError("VQE candidate runtime exceeded bounded output")
    if process.returncode != 0:
        detail = stderr.decode(errors="replace")[:2_000]
        raise RuntimeError(f"VQE candidate runtime failed: {detail}")
    try:
        report = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("VQE candidate runtime emitted invalid JSON") from exc
    if not isinstance(report, dict):
        raise RuntimeError("VQE candidate runtime result must be a JSON object")
    return report


async def execute_candidate_image(
    profile: CandidateRuntimeProfile,
) -> VqeRuntimeOutput:
    try:
        payload = await run_candidate_container(profile.binding)
    except Exception as exc:
        raise VqeRuntimeError(str(exc), retryable=True) from exc
    return VqeRuntimeOutput(payload=payload, bounded_stderr="")


def _build_success_evidence(
    report: dict[str, Any],
    *,
    binding: ExecutionBinding,
    scientific_spec_sha256: str,
    registry_resolution_sha256: str,
    ansatz_semantic_digest: str,
    seed: int,
) -> VqeOptimizationSuccessResult:
    profile_for_binding(binding)
    optimization = report["optimization"]
    canonical_input = report["canonical_input"]
    resources = report["resources"]
    if report.get("status") != "succeeded":
        raise ValueError("runtime report is not successful")
    if report.get("framework") != binding.framework.value:
        raise ValueError("runtime framework does not match execution binding")
    if report.get("provider_versions") != binding.provider_versions:
        raise ValueError("runtime provider versions do not match execution binding")
    if canonical_input.get("hamiltonian_digest_legacy") != _H2_HAMILTONIAN_DIGEST:
        raise ValueError("runtime Hamiltonian digest does not match frozen H2 fixture")
    if canonical_input.get("parameter_slot_id") != _PARAMETER_SLOT:
        raise ValueError("runtime parameter slot does not match frozen H2 fixture")

    initial_parameters = [_parameter(0.0)]
    final_parameters = [_parameter(float(optimization["final_parameter"]))]
    trajectory = [float(item["energy_ha"]) for item in optimization["trajectory"]]
    common = resources["common_basis_compiled"]
    diagnostic = resources["provider_native_diagnostic"]
    diagnostic_two_qubit = diagnostic.get(
        "two_qubit_gate_count",
        diagnostic.get("gate_types", {}).get("CNOT"),
    )
    result = VqeOptimizationSuccessResult(
        scientific_spec_sha256=scientific_spec_sha256,
        registry_resolution_sha256=registry_resolution_sha256,
        framework=binding.framework,
        runtime_profile_id=binding.runtime_profile_id,
        runtime_image_digest=binding.container_digest,
        adapter_release_id=binding.adapter_release_id,
        provider_versions=binding.provider_versions,
        hamiltonian_exact_digest=_H2_HAMILTONIAN_DIGEST,
        seed=seed,
        status="succeeded",
        capability="h2_sto3g_actual_vqe_v1",
        best_energy_ha=float(optimization["best_energy_ha"]),
        exact_energy_ha=float(optimization["exact_energy_ha"]),
        absolute_error_ha=float(optimization["absolute_error_ha"]),
        final_state_fidelity=float(optimization["final_state_fidelity"]),
        iterations=int(optimization["iterations"]),
        converged=bool(optimization["success"]),
        optimizer_work=OptimizerWork(
            iterations=int(optimization["iterations"]),
            energy_evaluations=int(optimization["function_evaluations"]),
            gradient_evaluations=0,
            hessian_evaluations=0,
        ),
        parameter_count=1,
        initial_parameters=initial_parameters,
        final_parameters=final_parameters,
        initial_parameters_sha256=_parameter_digest(initial_parameters),
        final_parameters_sha256=_parameter_digest(final_parameters),
        ansatz_semantic_digest=ansatz_semantic_digest,
        canonical_circuit_sha256=canonical_input["canonical_circuit_sha256"],
        compilation_protocol_sha256=canonical_input["compilation_protocol_sha256"],
        energy_trajectory=trajectory,
        resources=[
            ResourceObservation(
                stage="canonical_logical",
                metric_protocol_sha256=canonical_input["canonical_circuit_sha256"],
                qubits=int(resources["canonical_logical"]["qubits"]),
                parameter_count=int(resources["canonical_logical"]["parameter_count"]),
            ),
            ResourceObservation(
                stage="common_basis_compiled",
                metric_protocol_sha256=canonical_input["compilation_protocol_sha256"],
                qubits=int(resources["canonical_logical"]["qubits"]),
                depth=int(common["depth"]),
                gate_count=int(common["gate_count"]),
                two_qubit_gate_count=int(common["cnot_count"]),
                parameter_count=int(common["parameter_count"]),
                basis_gates=list(common["basis_gates"]),
                compiler="majorana_deterministic_pauli_rotation_compiler",
                compiler_version="0.1.0",
                compiler_seed=0,
            ),
            ResourceObservation(
                stage="provider_native_diagnostic",
                metric_protocol_sha256=canonical_input["compilation_protocol_sha256"],
                qubits=int(resources["canonical_logical"]["qubits"]),
                depth=int(diagnostic["depth"]),
                gate_count=int(diagnostic["gate_count"]),
                two_qubit_gate_count=(
                    int(diagnostic_two_qubit) if diagnostic_two_qubit is not None else None
                ),
                parameter_count=1,
            ),
        ],
        supplementary_evidence={
            "production_runtime_status": "unqualified",
            "public_execution": "blocked",
            "platform": str(report["platform"]),
            "wall_time_s": float(report["wall_time_s"]),
        },
    )
    if result.absolute_error_ha > 1e-10:
        raise ValueError("runtime result exceeds the frozen H2 numerical gate")
    if 1.0 - result.final_state_fidelity > 1e-10:
        raise ValueError("runtime state fidelity exceeds the frozen H2 gate")
    return result


def build_success_evidence(
    report: dict[str, Any],
    *,
    binding: ExecutionBinding,
    scientific_spec_sha256: str,
    registry_resolution_sha256: str,
    ansatz_semantic_digest: str,
    seed: int,
) -> VqeOptimizationSuccessResult:
    try:
        return _build_success_evidence(
            report,
            binding=binding,
            scientific_spec_sha256=scientific_spec_sha256,
            registry_resolution_sha256=registry_resolution_sha256,
            ansatz_semantic_digest=ansatz_semantic_digest,
            seed=seed,
        )
    except VqeRuntimeError:
        raise
    except Exception as exc:
        raise VqeRuntimeError(str(exc), retryable=False) from exc
