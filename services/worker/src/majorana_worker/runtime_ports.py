"""Small production adapters for execution and optional OpenQASM export."""

from __future__ import annotations

import hashlib
import json
import signal
from typing import Any
from uuid import uuid4

from majorana_agent import (
    CandidateRevision,
    ExecutionEvidence,
    ExecutionFailureKind,
    ExecutionOutput,
)
from majorana_contracts.enums import ArtifactType
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram, extract_interchange_qasm
from majorana_openqasm import OpenQASMError, normalize
from majorana_sandbox import ExecutionSpec, GuardRejection, Sandbox
from majorana_sandbox import run as sandbox_run


class SandboxCandidateExecutor:
    """Run one generated candidate inside the configured security boundary."""

    _OUTPUT_LIMIT = 4_000
    _STATEVECTOR_BYTES_PER_AMPLITUDE = 32

    def __init__(self, sandbox: Sandbox) -> None:
        self._sandbox = sandbox

    async def run_candidate(self, candidate: CandidateRevision, plan: Plan) -> ExecutionOutput:
        program = FrameworkProgram(candidate.framework, candidate.source)
        circuit_expected = (
            plan.artifact_contract is None
            or plan.artifact_contract.artifact_type is not ArtifactType.OTHER
        )
        diagnostics = program.contract_diagnostics(circuit_expected=circuit_expected)
        if diagnostics:
            return self._failure(
                candidate,
                plan,
                exit_code=2,
                kind=ExecutionFailureKind.CODE_ERROR,
                observation={"contract_diagnostics": diagnostics},
            )

        spec = ExecutionSpec(
            code=program.normalized_source,
            timeout_s=min(plan.expected_runtime_sec + 30, 120),
            qubits_estimate=plan.qubits_estimate,
            trusted_setup=program.trusted_setup(circuit_expected=circuit_expected),
            trusted_observer=program.trusted_observer(circuit_expected=circuit_expected),
            protected_result_path=f"/tmp/majorana-result-{uuid4().hex}.json",
            source_fingerprint=candidate.source_fingerprint,
        )
        estimated_memory_mb = self._statevector_memory_mb(plan.qubits_estimate)
        if circuit_expected and estimated_memory_mb >= spec.memory_mb:
            return self._failure(
                candidate,
                plan,
                exit_code=75,
                kind=ExecutionFailureKind.RESOURCE_LIMIT,
                observation={
                    "evidence_error": "statevector_memory_preflight_exceeded",
                    "estimated_memory_mb": estimated_memory_mb,
                    "memory_limit_mb": spec.memory_mb,
                    "estimate_model": "32_bytes_per_complex_amplitude",
                    "qubits": plan.qubits_estimate,
                    "sandbox_runs": 0,
                },
            )

        try:
            result = await sandbox_run(self._sandbox, spec)
        except GuardRejection as rejection:
            return self._failure(
                candidate,
                plan,
                exit_code=1,
                kind=ExecutionFailureKind.CODE_ERROR,
                observation={
                    "evidence_error": "guard_rejected",
                    "guard_violations": list(rejection.violations),
                    "sandbox_error": str(rejection),
                    "sandbox_runs": 0,
                },
            )

        observation = (result.protected_result or {}) | self._captured_output(result)
        if not result.ok:
            kind = self._classify_failure(result.exit_code, result.stderr)
            return ExecutionOutput(
                environment_fingerprint=self._environment_fingerprint(candidate, plan),
                sandbox_provider=result.provider,
                exit_code=result.exit_code or 1,
                failure_kind=kind,
                duration_ms=result.duration_ms,
                result={},
                observation=observation
                | {
                    "evidence_error": kind.value,
                    "sandbox_error": result.stderr[-self._OUTPUT_LIMIT :],
                    "sandbox_runs": 1,
                },
            )

        if observation.get("source_fingerprint") != candidate.source_fingerprint:
            return self._failure(
                candidate,
                plan,
                exit_code=result.exit_code or 3,
                kind=ExecutionFailureKind.CODE_ERROR,
                duration_ms=result.duration_ms,
                provider=result.provider,
                observation={"evidence_error": "source_fingerprint_mismatch"},
            )

        structured_result = observation.get("result")
        if not isinstance(structured_result, dict):
            serialization_error = observation.get("result_error")
            return self._failure(
                candidate,
                plan,
                exit_code=3,
                kind=ExecutionFailureKind.CODE_ERROR,
                duration_ms=result.duration_ms,
                provider=result.provider,
                observation=observation
                | {
                    "evidence_error": (
                        "RESULT_not_json_serializable"
                        if serialization_error is not None
                        else "RESULT_missing"
                    ),
                    "evidence_hint": (
                        "Convert framework and numpy values to plain JSON-compatible "
                        "Python types before assigning RESULT."
                        if serialization_error is not None
                        else "Assign one JSON-compatible dict to RESULT at module scope."
                    ),
                },
            )

        return ExecutionOutput(
            environment_fingerprint=self._environment_fingerprint(candidate, plan),
            sandbox_provider=result.provider,
            exit_code=result.exit_code,
            duration_ms=result.duration_ms,
            result=structured_result,
            observation=observation | {"sandbox_runs": 1},
        )

    def _failure(
        self,
        candidate: CandidateRevision,
        plan: Plan,
        *,
        exit_code: int,
        kind: ExecutionFailureKind,
        observation: dict[str, Any],
        duration_ms: int = 0,
        provider: str | None = None,
    ) -> ExecutionOutput:
        return ExecutionOutput(
            environment_fingerprint=self._environment_fingerprint(candidate, plan),
            sandbox_provider=provider or self._sandbox.provider,
            exit_code=exit_code,
            failure_kind=kind,
            duration_ms=duration_ms,
            result={},
            observation=observation,
        )

    @classmethod
    def _captured_output(cls, result: Any) -> dict[str, Any]:
        stdout, stderr = result.stdout or "", result.stderr or ""
        return {
            "sandbox_stdout": stdout[-cls._OUTPUT_LIMIT :],
            "sandbox_stderr": stderr[-cls._OUTPUT_LIMIT :],
            "sandbox_output_truncated": (
                len(stdout) > cls._OUTPUT_LIMIT or len(stderr) > cls._OUTPUT_LIMIT
            ),
        }

    @classmethod
    def _statevector_memory_mb(cls, qubits: int) -> int:
        return (cls._STATEVECTOR_BYTES_PER_AMPLITUDE * (1 << qubits) + (1 << 20) - 1) // (1 << 20)

    @staticmethod
    def _classify_failure(exit_code: int, stderr: str) -> ExecutionFailureKind:
        message = stderr.lower()
        if "timeout" in message or "timed out" in message:
            return ExecutionFailureKind.TIMEOUT
        if any(
            marker in message
            for marker in ("memoryerror", "out of memory", "oom", "cannot allocate memory")
        ) or exit_code in {-signal.SIGKILL, 128 + signal.SIGKILL}:
            return ExecutionFailureKind.MEMORY_EXHAUSTED
        return ExecutionFailureKind.CODE_ERROR

    def _environment_fingerprint(self, candidate: CandidateRevision, plan: Plan) -> str:
        manifest = json.dumps(
            {
                "provider": self._sandbox.provider,
                "environment_id": getattr(
                    self._sandbox,
                    "environment_id",
                    self._sandbox.provider,
                ),
                "framework": candidate.framework.value,
                "qubits": plan.qubits_estimate,
                "timeout": min(plan.expected_runtime_sec + 30, 120),
                "runner_contract": 2,
            },
            sort_keys=True,
        )
        return hashlib.sha256(manifest.encode()).hexdigest()


class TrustedOpenQASMConverter:
    """Normalize framework-emitted QASM without asking the model to rewrite code."""

    async def convert(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> tuple[str | None, str | None]:
        if execution.source_fingerprint != candidate.source_fingerprint:
            raise ValueError("execution fingerprint does not match candidate")
        extracted = extract_interchange_qasm(execution.observation)
        if extracted.qasm is None:
            return None, extracted.epilogue_error or "framework export unavailable"
        try:
            return normalize(extracted.qasm), None
        except OpenQASMError as exc:
            return None, f"OpenQASM normalization failed: {type(exc).__name__}"
