"""Small production adapters for execution and optional OpenQASM export."""

from __future__ import annotations

import ast
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
from majorana_frameworks.roles import ProgramRole
from majorana_openqasm import OpenQASMError, normalize
from majorana_sandbox import DEFAULT_QUBIT_CEILING, ExecutionSpec, GuardRejection, Sandbox
from majorana_sandbox import run as sandbox_run


class SandboxCandidateExecutor:
    """Run one generated candidate inside the configured security boundary."""

    _OUTPUT_LIMIT = 4_000
    _STATEVECTOR_BYTES_PER_AMPLITUDE = 32
    _LOCAL_STATEVECTOR_QUBIT_CEILING = 25
    #: The entry point the generator prompt promises for work above the local
    #: lane: "a `run(backend)` entry point that returns the promised RESULT
    #: dictionary when a compatible GPU/QPU backend is later supplied."
    _ARTIFACT_ENTRY_POINT = "run"

    def __init__(self, sandbox: Sandbox) -> None:
        self._sandbox = sandbox

    async def run_candidate(self, candidate: CandidateRevision, plan: Plan) -> ExecutionOutput:
        program = FrameworkProgram(candidate.framework, candidate.source)
        circuit_expected = (
            plan.artifact_contract is None
            or plan.artifact_contract.artifact_type is not ArtifactType.OTHER
        )
        # Artifact-only delivery relaxes only the module-scope execution contract.
        # Syntax and selected-framework boundaries remain mandatory even when the
        # connected lane cannot execute the authored scale.
        authoring_diagnostics = program.contract_diagnostics(circuit_expected=False)
        if authoring_diagnostics:
            return self._failure(
                candidate,
                plan,
                exit_code=2,
                kind=ExecutionFailureKind.CODE_ERROR,
                observation={"contract_diagnostics": authoring_diagnostics},
            )
        # A CIRCUIT reports nothing, so the trusted evidence is the only thing that
        # can become its result. Native collection is off by default here for
        # budget reasons (58118a1, "bounded budgets") and stays off for programs —
        # but for a circuit the alternative is not "cheaper", it is a `RESULT
        # missing key` failure whose retry target is GENERATION: one seeded
        # 2048-shot sample of a circuit already capped at 27 qubits, against a
        # model call plus a full re-execution, repeated until the budget runs out.
        # Enabling it exactly here spends less, not more.
        lower_circuit = circuit_expected and program.role is ProgramRole.CIRCUIT
        spec = ExecutionSpec(
            code=program.normalized_source,
            # A lowered circuit does strictly more work than it used to: the
            # native sampler runs 2048 shots on top of the circuit's own
            # execution. Without headroom a slow-but-passing circuit can cross the
            # deadline and come back TIMEOUT, which is a worse answer than the
            # contract failure it replaced. Still bounded by MAX_TIMEOUT_S.
            timeout_s=min(plan.expected_runtime_sec + (60 if lower_circuit else 30), 120),
            qubits_estimate=plan.qubits_estimate,
            trusted_setup=program.trusted_setup(
                circuit_expected=circuit_expected,
                collect_native_evidence=lower_circuit,
            ),
            trusted_observer=program.trusted_observer(
                circuit_expected=circuit_expected,
                collect_native_evidence=lower_circuit,
                derive_result=lower_circuit,
            ),
            protected_result_path=f"/tmp/majorana-result-{uuid4().hex}.json",
            source_fingerprint=candidate.source_fingerprint,
        )
        exceeds_statevector = (
            circuit_expected and plan.qubits_estimate > self._LOCAL_STATEVECTOR_QUBIT_CEILING
        )
        exceeds_lane = plan.qubits_estimate > DEFAULT_QUBIT_CEILING
        if exceeds_statevector or exceeds_lane:
            undeliverable = self._undeliverable_artifact_diagnostics(program)
            if undeliverable:
                return self._failure(
                    candidate,
                    plan,
                    exit_code=2,
                    kind=ExecutionFailureKind.CODE_ERROR,
                    observation={"contract_diagnostics": undeliverable},
                )
            # Keep the exact estimate while it remains a practical JSON integer.
            # Beyond that, qubits plus the logarithmic model are the bounded,
            # actionable representation; constructing an enormous decimal only to
            # explain that it cannot fit would itself become a resource bug.
            estimated_memory_mb = (
                self._statevector_memory_mb(plan.qubits_estimate)
                if circuit_expected and plan.qubits_estimate <= 10_000
                else None
            )
            local_ceiling = (
                self._LOCAL_STATEVECTOR_QUBIT_CEILING if circuit_expected else DEFAULT_QUBIT_CEILING
            )
            reason_code = (
                "local_statevector_capacity_exceeded"
                if exceeds_statevector
                else "local_qubit_lane_capacity_exceeded"
            )
            return self._failure(
                candidate,
                plan,
                exit_code=75,
                kind=ExecutionFailureKind.RESOURCE_LIMIT,
                observation={
                    "evidence_error": reason_code,
                    **(
                        {"estimated_memory_mb": estimated_memory_mb}
                        if estimated_memory_mb is not None
                        else {}
                    ),
                    "memory_limit_mb": spec.memory_mb,
                    **(
                        {"estimate_model": "32_bytes_per_complex_amplitude"}
                        if circuit_expected
                        else {}
                    ),
                    "qubits": plan.qubits_estimate,
                    "local_execution_ceiling_qubits": local_ceiling,
                    "execution_status": "not_run",
                    "execution_reason_code": reason_code,
                    "target_backend": "unassigned_external",
                    "sandbox_runs": 0,
                },
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

    @classmethod
    def _undeliverable_artifact_diagnostics(cls, program: FrameworkProgram) -> list[str]:
        """Refuse to publish, unexecuted, source this product cannot pick up.

        Artifact-only delivery skips the module-scope execution contract because
        nothing here can execute the authored scale. That relaxation must not
        extend to whether the source is *anything*: `roles.classify_source` calls
        source binding neither FINAL_CIRCUIT nor RESULT `UNKNOWN` — "something
        this product cannot execute", and roles.py is explicit that UNKNOWN is
        never guessed into one of the others. Delivering one as a backend-ready
        artifact would publish exactly the row that module exists to refuse to
        invent: no interchange QASM can be lifted from it (the epilogue
        serializes FINAL_CIRCUIT), so it cannot be exported, submitted, or
        re-executed when a backend that fits it does connect.

        The generator prompt offers two shapes above the local lane, and this
        accepts either: bind FINAL_CIRCUIT "when constructing it is itself
        bounded", or expose a `run(backend)` entry point returning the promised
        RESULT. Requiring FINAL_CIRCUIT alone would be wrong for the case that
        relaxation was written for — a circuit too large to build at import.

        It runs before the preflight's early return and costs one `ast.parse`.
        That ordering is the whole point: this is a static check, so the
        candidates it catches are precisely the ones no execution will ever
        catch instead, and the only other thing looking at them is a language
        model's opinion in the static review.
        """
        if program.role is not ProgramRole.UNKNOWN:
            return []
        if cls._defines_entry_point(program.source, cls._ARTIFACT_ENTRY_POINT):
            return []
        return [
            f"contract:{program.framework.value} source delivered without execution must bind "
            f"FINAL_CIRCUIT or define a module-scope "
            f"{cls._ARTIFACT_ENTRY_POINT}(backend) entry point"
        ]

    @staticmethod
    def _defines_entry_point(source: str, name: str) -> bool:
        """Whether the module defines `name` as a function at module scope.

        Module scope only, unlike `roles._bound_names`: that one walks the whole
        tree because a circuit built inside `if __name__ == "__main__":` really
        is bound when the sandbox executes the module. Nothing executes this
        source, so the question is what a caller can import and hand a backend —
        and a `run` nested inside another function is not that.
        """
        try:
            tree = ast.parse(source)
        except SyntaxError:  # pragma: no cover - authoring diagnostics catch this first
            return False
        return any(
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
            for node in tree.body
        )

    @staticmethod
    def _classify_failure(exit_code: int, stderr: str) -> ExecutionFailureKind:
        message = stderr.lower()
        if "timeout" in message or "timed out" in message:
            return ExecutionFailureKind.TIMEOUT
        # LocalSubprocessSandbox applies RLIMIT_CPU. On macOS a NumPy/BLAS-heavy
        # VQE can exhaust aggregate CPU time well before the wall clock and exits
        # via SIGXCPU with no stderr. Treating that as a code error regenerated the
        # same expensive program until the candidate budget was gone; timeout
        # correctly routes it to a cheaper Plan.
        if exit_code in {-signal.SIGXCPU, 128 + signal.SIGXCPU}:
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
