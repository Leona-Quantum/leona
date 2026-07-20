"""Translate durable agent progress to the versioned run-event stream."""

from __future__ import annotations

from uuid import UUID, uuid5

from majorana_agent import AgentState, ToolCall, ToolName, ToolResult
from majorana_contracts.enums import ExportStatus, VerificationMethod

from .agent_store import RepoAgentStore


def _qasm_emission(observation: dict) -> dict | None:
    """Provenance for the OpenQASM interchange the sandbox observer tried to emit.

    Until 2026-07-20 this was `null` on every `sandbox.result` — the field existed,
    nothing ever populated it, and a reader comparing it against a later `lossless`
    export classification saw a contradiction that was not real. The conversion was
    always fine; the event under-reported it.

    Read entirely off the observation, so it describes what the sandbox actually
    produced rather than what the emitter assumed:

    - `native_optimization` is stamped unconditionally by the trusted observer for
      every circuit-bearing run, so its presence is the honest signal that the
      epilogue ran at all. A non-circuit artifact has no observer and gets None
      here, not a fabricated "missing".
    - `interchange_error` carries the exception *type* only; the field's contract
      forbids raw sandbox exception text and the adapters already only store the
      type name.
    """
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


class AgentEventObserver:
    def __init__(self, *, store: RepoAgentStore, sink) -> None:
        self._store = store
        self._sink = sink

    async def tool_started(self, _run_id: UUID, _state: AgentState, _call: ToolCall) -> None:
        # Tool arguments can contain generated source and are deliberately not
        # duplicated into the public event stream before execution succeeds.
        return None

    async def recover(self, run_id: UUID) -> None:
        """Replay every completed step; deterministic event IDs make this idempotent."""
        for result in await self._store.list_tool_results(run_id):
            await self.tool_finished(run_id, result)

    async def _emit(
        self,
        run_id: UUID,
        result: ToolResult,
        key: str,
        event_type: str,
        payload: dict,
    ) -> None:
        event_id = uuid5(run_id, f"tool:{result.tool_call_id}:{key}")
        await self._sink.emit(event_type, payload, event_id=event_id)

    async def tool_finished(self, run_id: UUID, result: ToolResult) -> None:
        if not result.ok:
            return
        if result.name is ToolName.REQUEST_PLAN:
            plan = await self._store.latest_plan(run_id)
            if plan is not None:
                await self._emit(
                    run_id,
                    result,
                    "plan",
                    "plan.produced",
                    {"plan": plan.plan.model_dump(mode="json")},
                )
            return
        if result.name in {
            ToolName.SIMULATE_QISKIT,
            ToolName.SIMULATE_CIRQ,
            ToolName.SIMULATE_PENNYLANE,
        }:
            candidate_id = result.payload.get("candidate_id")
            if candidate_id is None:
                return
            candidate = await self._store.candidate(run_id, UUID(str(candidate_id)))
            await self._emit(
                run_id,
                result,
                "code",
                "code.generated",
                {
                    "language": candidate.framework.value,
                    "code": candidate.source,
                    "revision": candidate.revision,
                },
            )
            execution = await self._store.execution_for(run_id, candidate.candidate_id)
            if execution is not None:
                await self._emit(
                    run_id,
                    result,
                    "sandbox",
                    "sandbox.result",
                    {
                        "phase": "verification",
                        "exit_code": execution.exit_code,
                        "duration_ms": execution.duration_ms,
                        # Real program output as of 2026-07-20. Untrusted and capped
                        # at the executor; render it as text, never parse it for values.
                        "stdout": str(execution.observation.get("sandbox_stdout", "")),
                        "stderr": str(execution.observation.get("sandbox_stderr", "")),
                        "truncated": bool(
                            execution.observation.get("sandbox_output_truncated", False)
                        ),
                        "qasm_emission": _qasm_emission(execution.observation),
                    },
                )
            return
        if result.name is ToolName.VERIFY_INTENT_ALIGNMENT:
            candidate_id = result.payload.get("candidate_id")
            if candidate_id is None:
                return
            candidate = await self._store.candidate(run_id, UUID(str(candidate_id)))
            verification = await self._store.verification_for(run_id, candidate.candidate_id)
            if verification is None:
                return
            supported = {method.value: method for method in VerificationMethod}
            for index, check in enumerate(verification.deterministic_checks):
                method = supported.get(str(check.get("method")))
                if method is None:
                    continue
                await self._emit(
                    run_id,
                    result,
                    f"verification:{index}",
                    "verification.result",
                    {
                        "method": method,
                        "result": check.get("result", "fail"),
                        "details": check.get("details", {}),
                    },
                )
            return
        if result.name is ToolName.PUBLISH_ARTIFACT:
            candidate_id = result.payload.get("candidate_id")
            if candidate_id is None:
                return
            candidate = await self._store.candidate(run_id, UUID(str(candidate_id)))
            conversion = await self._store.conversion_for(run_id, candidate.candidate_id)
            qasm_available = bool(conversion and conversion.status == "available")
            # A failed export downgrades the EXPORT, never the verdict — and until
            # 2026-07-20 this event said `lossless` even when no QASM existed.
            export_status = ExportStatus.LOSSLESS if qasm_available else ExportStatus.UNSUPPORTED
            export_reason = (
                None
                if qasm_available
                else (conversion.reason if conversion else "framework export unavailable")
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
                    # The selected-framework source already lives in `code`.
                    # Variants are reserved for genuinely different frameworks.
                    "framework_variants": {},
                    "conversion_options": ["openqasm"] if qasm_available else [],
                    "execution_options": ["simulate"],
                    "export_status": export_status,
                    "export_reason": export_reason,
                    "finalization_reason": "latest candidate passed bound verification",
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
