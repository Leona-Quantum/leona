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
import shutil
import struct
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol

from majorana_vqe.models import ExecutionBinding, FailureCode
from majorana_vqe.result import (
    OptimizerWork,
    ParameterValue,
    ResourceObservation,
    VqeOptimizationSuccessResult,
)

from majorana_api.vqe_runtime_profiles import (
    CandidateRuntimeProfile,
    ProductionRuntimeProfile,
    candidate_runtime_profile,
    production_runtime_profile,
    profile_for_binding,
)

_MAX_STDOUT_BYTES = 1_000_000
_MAX_STDERR_BYTES = 64_000
_H2_HAMILTONIAN_DIGEST = "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"
_PARAMETER_SLOT = "theta.double.occ0_occ2.to.virt1_virt3"


class VqeRuntimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        failure_code: FailureCode,
        retryable: bool,
    ) -> None:
        super().__init__(message)
        self.failure_code = failure_code
        self.retryable = retryable


class VqeRuntimeCancelled(RuntimeError):
    """The durable Run was cancelled; partial runtime output is discarded."""


@dataclass(frozen=True)
class VqeRuntimeOutput:
    payload: dict[str, Any]
    bounded_stderr: str


CancelProbe = Callable[[], Awaitable[bool]]


class VqeRuntimeExecutor(Protocol):
    async def run(
        self,
        binding: ExecutionBinding,
        *,
        timeout_s: float = 300.0,
        cancel_requested: CancelProbe | None = None,
    ) -> VqeRuntimeOutput: ...


def _docker_binary() -> str:
    for candidate in ("/usr/local/bin/docker", "/usr/bin/docker"):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    resolved = shutil.which("docker", path="/usr/local/bin:/usr/bin:/bin")
    if resolved is None:
        raise VqeRuntimeError(
            "Docker CLI is unavailable",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=True,
        )
    return resolved


async def _read_bounded(
    stream: asyncio.StreamReader,
    *,
    limit: int,
    label: str,
) -> bytes:
    output = bytearray()
    while True:
        chunk = await stream.read(min(65_536, limit + 1 - len(output)))
        if not chunk:
            return bytes(output)
        output.extend(chunk)
        if len(output) > limit:
            raise VqeRuntimeError(
                f"VQE candidate runtime {label} exceeded {limit} bytes",
                failure_code=FailureCode.OUTPUT_LIMIT_EXCEEDED,
                retryable=False,
            )


async def _force_remove_container(docker: str, container_name: str) -> None:
    process = await asyncio.create_subprocess_exec(
        docker,
        "rm",
        "-f",
        container_name,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "DOCKER_CLI_HINTS": "false"},
    )
    try:
        await asyncio.wait_for(process.wait(), timeout=15)
    except TimeoutError:
        process.kill()
        await process.wait()
    inspect = await asyncio.create_subprocess_exec(
        docker,
        "container",
        "inspect",
        container_name,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "DOCKER_CLI_HINTS": "false"},
    )
    try:
        inspect_returncode = await asyncio.wait_for(inspect.wait(), timeout=15)
    except TimeoutError:
        inspect.kill()
        await inspect.wait()
        inspect_returncode = 0
    if inspect_returncode == 0:
        raise VqeRuntimeError(
            "VQE candidate container cleanup could not be verified",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=True,
        )


def _parse_report(stdout: bytes) -> dict[str, Any]:
    try:
        report = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VqeRuntimeError(
            "VQE candidate runtime emitted invalid JSON",
            failure_code=FailureCode.RESULT_CONTRACT_FAILED,
            retryable=False,
        ) from exc
    if not isinstance(report, dict):
        raise VqeRuntimeError(
            "VQE candidate runtime result must be a JSON object",
            failure_code=FailureCode.RESULT_CONTRACT_FAILED,
            retryable=False,
        )
    return report


_DOCKER_CLIENT_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "DOCKER_CLI_HINTS": "false",
}


async def _verify_preprovisioned_image(
    docker: str,
    profile: ProductionRuntimeProfile,
) -> None:
    """Fail closed unless the exact registry digest is already present locally."""
    try:
        process = await asyncio.create_subprocess_exec(
            docker,
            "image",
            "inspect",
            "--format",
            "{{json .RepoDigests}}",
            profile.image_reference,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_DOCKER_CLIENT_ENV,
        )
        stdout, _stderr = await asyncio.wait_for(process.communicate(), timeout=30)
    except (OSError, TimeoutError) as exc:
        raise VqeRuntimeError(
            "pre-provisioned OCI runtime image could not be inspected",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=True,
        ) from exc
    if process.returncode != 0:
        raise VqeRuntimeError(
            "exact OCI runtime image is not pre-provisioned",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=True,
        )
    try:
        repo_digests = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VqeRuntimeError(
            "Docker returned invalid OCI image identity",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=False,
        ) from exc
    if not isinstance(repo_digests, list) or profile.image_reference not in repo_digests:
        raise VqeRuntimeError(
            "pre-provisioned image does not match the approved OCI registry digest",
            failure_code=FailureCode.RUNTIME_UNAVAILABLE,
            retryable=False,
        )


class LocalDockerVqeRuntimeExecutor:
    """Development transport with bounded streaming and daemon-side cleanup."""

    def _profile(
        self,
        binding: ExecutionBinding,
    ) -> CandidateRuntimeProfile | ProductionRuntimeProfile:
        profile = candidate_runtime_profile(binding.framework)
        if profile.binding != binding:
            raise VqeRuntimeError(
                "binding is not an exact local candidate profile",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=False,
            )
        return profile

    def _validate_environment(self) -> None:
        if os.environ.get("MAJORANA_ENV", "").strip().lower() != "development" or any(
            os.environ.get(name)
            for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI")
        ):
            raise VqeRuntimeError(
                "candidate Docker transport is development-only",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=False,
            )

    async def _image_arguments(
        self,
        docker: str,
        profile: CandidateRuntimeProfile | ProductionRuntimeProfile,
    ) -> list[str]:
        assert isinstance(profile, CandidateRuntimeProfile)
        return [profile.local_image_digest]

    async def run(
        self,
        binding: ExecutionBinding,
        *,
        timeout_s: float = 300.0,
        cancel_requested: CancelProbe | None = None,
    ) -> VqeRuntimeOutput:
        self._validate_environment()
        profile = self._profile(binding)
        docker = _docker_binary()
        image_arguments = await self._image_arguments(docker, profile)
        container_name = f"majorana-vqe-{uuid.uuid4().hex}"
        command = [
            docker,
            "run",
            "--rm",
            "--name",
            container_name,
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
            *image_arguments,
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=_DOCKER_CLIENT_ENV,
            )
        except OSError as exc:
            raise VqeRuntimeError(
                "Docker CLI could not be started",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=True,
            ) from exc
        assert process.stdout is not None
        assert process.stderr is not None
        stdout_task = asyncio.create_task(
            _read_bounded(process.stdout, limit=_MAX_STDOUT_BYTES, label="stdout")
        )
        stderr_task = asyncio.create_task(
            _read_bounded(process.stderr, limit=_MAX_STDERR_BYTES, label="stderr")
        )
        wait_task = asyncio.create_task(process.wait())
        tasks = {stdout_task, stderr_task, wait_task}
        deadline = asyncio.get_running_loop().time() + timeout_s
        abnormal = False
        try:
            while not all(task.done() for task in tasks):
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise VqeRuntimeError(
                        "VQE candidate runtime timed out",
                        failure_code=FailureCode.RUNTIME_TIMEOUT,
                        retryable=True,
                    )
                await asyncio.wait(
                    tasks,
                    timeout=min(0.25, remaining),
                    return_when=asyncio.FIRST_EXCEPTION,
                )
                for task in (stdout_task, stderr_task):
                    if task.done() and task.exception() is not None:
                        raise task.exception()  # type: ignore[misc]
                if cancel_requested is not None and await cancel_requested():
                    raise VqeRuntimeCancelled("VQE candidate runtime was cancelled")
            stdout = stdout_task.result()
            stderr = stderr_task.result()
        except (VqeRuntimeError, VqeRuntimeCancelled):
            abnormal = True
            if process.returncode is None:
                process.kill()
            await process.wait()
            await _force_remove_container(docker, container_name)
            raise
        finally:
            if abnormal:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

        if process.returncode != 0:
            if stdout:
                report = _parse_report(stdout)
                if report.get("status") == "failed":
                    raise VqeRuntimeError(
                        str(report.get("failure_detail", "runtime reported failure"))[:500],
                        failure_code=FailureCode.EXECUTION_FAILED,
                        retryable=False,
                    )
            detail = stderr.decode(errors="replace")[:2_000]
            if process.returncode == 125:
                raise VqeRuntimeError(
                    f"Docker runtime unavailable: {detail}",
                    failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                    retryable=True,
                )
            if process.returncode in {137, -9}:
                raise VqeRuntimeError(
                    "VQE candidate runtime exceeded its memory limit",
                    failure_code=FailureCode.RUNTIME_OOM,
                    retryable=False,
                )
            raise VqeRuntimeError(
                f"VQE candidate runtime failed: {detail}",
                failure_code=FailureCode.EXECUTION_FAILED,
                retryable=False,
            )
        return VqeRuntimeOutput(
            payload=_parse_report(stdout),
            bounded_stderr=stderr.decode(errors="replace"),
        )


class OciDockerVqeRuntimeExecutor(LocalDockerVqeRuntimeExecutor):
    """Dedicated-host transport for a pre-provisioned, exact OCI digest."""

    def _profile(
        self,
        binding: ExecutionBinding,
    ) -> CandidateRuntimeProfile | ProductionRuntimeProfile:
        profile = production_runtime_profile(binding.framework)
        if profile.binding != binding:
            raise VqeRuntimeError(
                "binding is not an exact production OCI profile",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=False,
            )
        return profile

    def _validate_environment(self) -> None:
        if os.environ.get("MAJORANA_ENV", "").strip().lower() != "production":
            raise VqeRuntimeError(
                "OCI runtime transport requires MAJORANA_ENV=production",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=False,
            )
        if os.environ.get("MAJORANA_VQE_RUNTIME_HOST", "").strip().lower() != "dedicated":
            raise VqeRuntimeError(
                "OCI runtime transport requires a dedicated runtime host",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=False,
            )
        if any(os.environ.get(name) for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION")):
            raise VqeRuntimeError(
                "OCI Docker transport cannot run inside Cloud Run",
                failure_code=FailureCode.RUNTIME_UNAVAILABLE,
                retryable=False,
            )

    async def _image_arguments(
        self,
        docker: str,
        profile: CandidateRuntimeProfile | ProductionRuntimeProfile,
    ) -> list[str]:
        assert isinstance(profile, ProductionRuntimeProfile)
        await _verify_preprovisioned_image(docker, profile)
        return ["--pull", "never", profile.image_reference]


_LOCAL_DOCKER_EXECUTOR = LocalDockerVqeRuntimeExecutor()
_OCI_DOCKER_EXECUTOR = OciDockerVqeRuntimeExecutor()


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
    output = await _LOCAL_DOCKER_EXECUTOR.run(binding, timeout_s=timeout_s)
    return output.payload


async def execute_candidate_image(
    profile: CandidateRuntimeProfile | ProductionRuntimeProfile,
    *,
    cancel_requested: CancelProbe | None = None,
) -> VqeRuntimeOutput:
    executor = (
        _OCI_DOCKER_EXECUTOR
        if isinstance(profile, ProductionRuntimeProfile)
        else _LOCAL_DOCKER_EXECUTOR
    )
    return await executor.run(
        profile.binding,
        cancel_requested=cancel_requested,
    )


def _build_success_evidence(
    report: dict[str, Any],
    *,
    binding: ExecutionBinding,
    scientific_spec_sha256: str,
    registry_resolution_sha256: str,
    ansatz_semantic_digest: str,
    seed: int,
) -> VqeOptimizationSuccessResult:
    profile = profile_for_binding(binding)
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
    if canonical_input.get("manifest_sha256") != profile.fixture_manifest_sha256:
        raise ValueError("runtime fixture manifest digest does not match the runtime profile")
    if canonical_input.get("canonical_circuit_sha256") != profile.canonical_circuit_sha256:
        raise ValueError("runtime canonical circuit digest does not match the runtime profile")
    if canonical_input.get("compilation_protocol_sha256") != profile.compilation_protocol_sha256:
        raise ValueError("runtime compilation protocol digest does not match the runtime profile")

    initial_parameters = [_parameter(0.0)]
    final_parameters = [_parameter(float(optimization["final_parameter"]))]
    trajectory = [float(item["energy_ha"]) for item in optimization["trajectory"]]
    common = resources["common_basis_compiled"]
    if common.get("operation_sequence_sha256") != (profile.common_basis_operation_sequence_sha256):
        raise ValueError("runtime operation sequence does not match the runtime profile")
    if common.get("adapter_verification") != "passed":
        raise ValueError("runtime adapter did not independently verify the common-basis circuit")
    if common.get("metric_scope") != "ansatz_only":
        raise ValueError("common-basis resources must be ansatz-only")
    if any(
        common.get(field) is not False
        for field in (
            "includes_reference_state",
            "includes_measurement",
            "includes_hardware_optimization_or_routing",
        )
    ):
        raise ValueError("common-basis resources include an excluded metric scope")
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
                compiler_version="0.2.0",
                compiler_seed=0,
                metric_scope="ansatz_only",
                reference_state_included=False,
                measurement_included=False,
                hardware_optimization_or_routing_included=False,
                adapter_verification="passed",
                operation_sequence_sha256=common["operation_sequence_sha256"],
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
            "production_runtime_status": binding.production_runtime_status,
            "public_execution": "blocked",
            "runtime_provenance_complete": profile.provenance_complete,
            "runtime_container_digest_kind": binding.container_digest_kind,
            "runtime_oci_manifest_digest": binding.oci_manifest_digest,
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
        raise VqeRuntimeError(
            str(exc),
            failure_code=FailureCode.RESULT_CONTRACT_FAILED,
            retryable=False,
        ) from exc
