"""Replay-safe event projection for the fixed circuit pipeline only."""

from __future__ import annotations

from uuid import UUID, uuid5

from majorana_agent import CandidateRevision, ToolName, ToolResult
from majorana_contracts.enums import ExportStatus

from .agent_store import RepoAgentStore


def _qasm_emission(observation: dict) -> dict | None:
    if "native_optimization" not in observation:
        return None
    qasm = observation.get("interchange_qasm")
    available = isinstance(qasm, str) and bool(qasm.strip())
    error = observation.get("interchange_error")
    return {
        "epilogue_applied": True,
        "source": "sandbox_epilogue" if available else "missing",
        "available": available,
        "epilogue_error": str(error) if error else None,
    }


class SimpleEventObserver:
    """Project durable simple steps into the small public event vocabulary."""

    def __init__(self, *, store: RepoAgentStore, sink) -> None:
        self._store = store
        self._sink = sink

    async def recover(self, run_id: UUID) -> None:
        for candidate in await self._store.list_candidates(run_id):
            await self.candidate_generated(run_id, candidate)
        for result in await self._store.list_tool_results(run_id):
            if result.tool_call_id.startswith("simple:"):
                await self.tool_finished(run_id, result)

    async def _emit(
        self,
        run_id: UUID,
        result: ToolResult,
        key: str,
        event_type: str,
        payload: dict,
    ) -> None:
        await self._sink.emit(
            event_type,
            payload,
            event_id=uuid5(run_id, f"tool:{result.tool_call_id}:{key}"),
        )

    async def tool_finished(self, run_id: UUID, result: ToolResult) -> None:
        if not result.ok or not result.tool_call_id.startswith("simple:"):
            return
        if result.name in {ToolName.REQUEST_PLAN, ToolName.REPLAN}:
            await self._plan(run_id, result)
            return
        if result.name in {
            ToolName.SIMULATE_QISKIT,
            ToolName.SIMULATE_CIRQ,
            ToolName.SIMULATE_PENNYLANE,
            ToolName.SIMULATE_BRAKET,
            ToolName.SIMULATE_QIBO,
            ToolName.SIMULATE_QULACS,
        }:
            await self._execution(run_id, result)
            return
        if result.name is ToolName.REVIEW_CANDIDATE:
            await self._review(run_id, result)
            return
        if result.name is ToolName.MATERIALIZE_ARTIFACT:
            await self._artifact(run_id, result)

    async def candidate_generated(
        self,
        run_id: UUID,
        candidate: CandidateRevision,
    ) -> None:
        """Expose generated source before the sandbox begins.

        The event id matches historical execution-step projection, so crash
        recovery and older completed rows cannot duplicate it.
        """

        await self._sink.emit(
            "code.generated",
            {
                "language": candidate.framework.value,
                "code": candidate.source,
                "revision": candidate.revision,
            },
            event_id=uuid5(run_id, f"tool:{candidate.tool_call_id}:code"),
        )

    async def _plan(self, run_id: UUID, result: ToolResult) -> None:
        plan = result.payload.get("plan")
        if not isinstance(plan, dict):
            return
        await self._emit(
            run_id,
            result,
            f"plan:{result.payload.get('plan_id', result.tool_call_id)}",
            "plan.produced",
            {"plan": plan},
        )

    async def _execution(self, run_id: UUID, result: ToolResult) -> None:
        candidate_id = result.payload.get("candidate_id")
        if candidate_id is None:
            return
        candidate = await self._store.candidate(run_id, UUID(str(candidate_id)))
        await self.candidate_generated(run_id, candidate)
        execution = await self._store.execution_for(run_id, candidate.candidate_id)
        if execution is None:
            return
        await self._emit(
            run_id,
            result,
            "sandbox",
            "sandbox.result",
            {
                "phase": "verification",
                "exit_code": execution.exit_code,
                "duration_ms": execution.duration_ms,
                "result": execution.result,
                "stdout": str(execution.observation.get("sandbox_stdout", "")),
                "stderr": str(execution.observation.get("sandbox_stderr", "")),
                "truncated": bool(execution.observation.get("sandbox_output_truncated", False)),
                "qasm_emission": _qasm_emission(execution.observation),
            },
        )

    async def _review(self, run_id: UUID, result: ToolResult) -> None:
        candidate_id = UUID(str(result.payload["candidate_id"]))
        review_id = UUID(str(result.payload["review_id"]))
        review = await self._store.semantic_review(run_id, candidate_id, review_id)
        if review is None:
            raise RuntimeError("semantic review evidence missing during event replay")
        await self._emit(
            run_id,
            result,
            f"semantic:{review.review_id}",
            "verification.semantic_review",
            {
                "review_id": str(review.review_id),
                "candidate_id": str(review.candidate_id),
                "execution_id": str(review.execution_id),
                "attempt_seq": review.attempt_seq,
                "source_fingerprint": review.source_fingerprint,
                "decision": review.decision.value,
                "reason_code": review.reason_code,
                "failure_class": review.failure_class.value if review.failure_class else None,
                "retry_target": review.retry_target.value,
                "confidence": review.confidence,
                "severity": review.severity,
                "feedback": review.feedback,
            },
        )

    async def _artifact(self, run_id: UUID, result: ToolResult) -> None:
        candidate_id = result.payload.get("candidate_id")
        if candidate_id is None:
            return
        candidate = await self._store.candidate(run_id, UUID(str(candidate_id)))
        conversion = await self._store.conversion_for(run_id, candidate.candidate_id)
        qasm_available = bool(conversion and conversion.status == "available")
        export_status = ExportStatus.LOSSLESS if qasm_available else ExportStatus.UNSUPPORTED
        export_reason = (
            None
            if qasm_available
            else conversion.reason
            if conversion
            else "framework export unavailable"
        )
        await self._emit(
            run_id,
            result,
            "finalized",
            "code.finalized",
            {
                "language": candidate.framework.value,
                "code": candidate.source,
                "revision": candidate.revision,
                "compilation_applied": False,
                "simulation_plausible": True,
                "qpu_available": False,
                "framework_variants": {},
                "conversion_options": ["openqasm"] if qasm_available else [],
                "execution_options": ["simulate"],
                "export_status": export_status,
                "export_reason": export_reason,
                "finalization_reason": (
                    "Executed candidate aligned with the request in the bounded AI review."
                ),
            },
        )
        await self._emit(
            run_id,
            result,
            "artifact",
            "artifact.saved",
            {
                "artifact_id": result.payload["artifact_id"],
                "version_id": result.payload["version_id"],
                "version_seq": result.payload["version_seq"],
            },
        )
