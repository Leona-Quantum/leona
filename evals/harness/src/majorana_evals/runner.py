"""Harness v1: run each corpus case through the real pipeline and score it against
its honest expectations. Providers are injected, but every harness run must use the
configured real LLM and sandbox. The harness deliberately drives the handler
directly and never enqueues a job, so a background worker cannot claim the same case.

Scoring is structural, never a golden number: terminal status/reason, optional strict
verifier decision for legacy-specific cases, export status (when pinned), promised
output keys, and whether an artifact was saved.
Value checks read only the protected RESULT stored in execution evidence. Captured
stdout/stderr are untrusted diagnostics and never affect a score."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from majorana_contracts import Scope
from majorana_contracts.enums import RunMode
from majorana_llm import LLMClient
from majorana_sandbox import Sandbox

from majorana_api.repos import runs as runs_repo
from majorana_worker.agent_store import RepoAgentStore
from majorana_worker.handlers import handle_run_execute

from majorana_evals.schema import CaseEvidence, CaseResult, CorpusCase, Expect, Report


def _looks_like_counts(value: object) -> bool:
    """A measurement-counts dict: bitstring keys (0/1, spaces allowed for registers)
    mapping to integer counts. Spaces are Qiskit's register separators."""
    if not isinstance(value, dict) or not value:
        return False
    return all(
        isinstance(k, str)
        and k != ""
        and set(k) <= {"0", "1", " "}
        and isinstance(v, int)
        and not isinstance(v, bool)
        for k, v in value.items()
    )


def top_measured_bitstring(result: Mapping[str, object] | None) -> str | None:
    """Return the dominant measured bitstring from protected RESULT evidence.

    RESULT is captured by the trusted sandbox epilogue and stored on
    ``ExecutionEvidence``. Captured stdout may contain arbitrary model-controlled
    text and is intentionally not accepted by this helper.
    """
    if result is None:
        return None
    counts = next((value for value in result.values() if _looks_like_counts(value)), None)
    if counts is None:
        return None
    # Max count, tie-broken by bitstring for determinism.
    top = max(counts.items(), key=lambda kv: (kv[1], [-ord(c) for c in kv[0]]))[0]
    return top.replace(" ", "")


def _latest_sandbox_event(events):
    """Return the terminal sandbox event for diagnostic/QASM provenance only."""
    return next((event for event in reversed(events) if event.type == "sandbox.result"), None)


def _latest_export_event(events):
    """Return export evidence from the current or legacy event projection.

    The fixed pipeline projects conversion evidence on ``code.finalized``. Older
    tool-loop runs emitted a separate ``export.classified`` event, so the harness
    accepts both while preferring the current durable event.
    """

    return next(
        (
            event
            for event in reversed(events)
            if event.type in {"code.finalized", "export.classified"}
        ),
        None,
    )


async def _latest_trusted_result(
    store: RepoAgentStore, run_id: UUID
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Load RESULT from the latest Candidate's fingerprint-bound execution.

    The repository is the authority. A missing execution is an honest absence; a
    stale/mismatched execution is an integrity error and must not be scored.
    """
    candidates = await store.list_candidates(run_id)
    if not candidates:
        return None, None, None
    candidate = candidates[-1]
    execution = await store.execution_for(run_id, candidate.candidate_id)
    if execution is None:
        return None, str(candidate.candidate_id), None
    if (
        execution.candidate_id != candidate.candidate_id
        or execution.source_fingerprint != candidate.source_fingerprint
    ):
        raise ValueError("latest execution evidence is not bound to the latest candidate")
    return (
        execution.result,
        str(candidate.candidate_id),
        str(execution.execution_id),
    )


def _score_result_expectations(expect: Expect, result: Mapping[str, object] | None) -> list[str]:
    """Score value and key expectations against protected RESULT only."""
    reasons: list[str] = []
    if expect.expected_top_bitstring is not None:
        want = expect.expected_top_bitstring.replace(" ", "")
        got = top_measured_bitstring(result)
        if got is None:
            reasons.append(
                f"expected top bitstring {want!r} but no measurement counts were found in RESULT"
            )
        elif got != want:
            reasons.append(f"top measured bitstring {got!r} != expected {want!r}")
    if expect.expected_values:
        for key, want in expect.expected_values.items():
            actual = result.get(key) if result is not None else None
            if not isinstance(actual, int | float) or isinstance(actual, bool):
                reasons.append(f"expected numeric RESULT field {key!r} was not found")
            elif abs(float(actual) - want) > expect.expected_value_tolerance:
                reasons.append(
                    f"RESULT field {key!r} {actual!r} is outside expected {want!r} ± "
                    f"{expect.expected_value_tolerance}"
                )
    if expect.output_keys:
        for key in expect.output_keys:
            if result is None or key not in result:
                reasons.append(f"RESULT missing promised key {key!r}")
    return reasons


def _score_terminal_expectations(
    expect: Expect,
    *,
    run_status: str,
    terminal_reason: str | None,
    verifier_decision: str | None,
) -> list[str]:
    """Score product terminal semantics without inventing a strict verdict."""
    reasons: list[str] = []
    if run_status != expect.run_status.value:
        reasons.append(f"run_status {run_status!r} != expected {expect.run_status.value!r}")
    if expect.terminal_reason is not None and terminal_reason != expect.terminal_reason:
        reasons.append(
            f"terminal_reason {terminal_reason!r} != expected {expect.terminal_reason!r}"
        )
    if expect.verifier_decision is not None and verifier_decision != expect.verifier_decision.value:
        reasons.append(
            f"verifier_decision {verifier_decision!r} != expected "
            f"{expect.verifier_decision.value!r}"
        )
    return reasons


async def run_case(
    case: CorpusCase,
    *,
    factory,
    scope: Scope,
    llm: LLMClient,
    sandbox: Sandbox,
) -> CaseResult:
    # Direct-handler ownership is intentional: this standalone harness creates the
    # run and drives it itself, without creating a queue row for a worker to claim.
    async with factory() as session:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt=case.prompt,
            mode=RunMode.EXECUTE,
            framework=case.framework,
        )
        await runs_repo.append_run_event(
            scope,
            session,
            run.id,
            type="run.queued",
            payload={"mode": str(RunMode.EXECUTE), "framework": str(case.framework)},
        )
        run_id = run.id
        payload = {
            "run_id": str(run_id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
        }
        await session.commit()

    reasons: list[str] = []
    try:
        async with factory() as session:
            await handle_run_execute(session, payload, llm=llm, sandbox=sandbox)
    except Exception as exc:  # a crash is a failed case, not a harness abort
        reasons.append(f"handler error: {exc}")

    trusted_result: dict[str, Any] | None = None
    candidate_id: str | None = None
    execution_id: str | None = None
    result_evidence_error: str | None = None
    async with factory() as session:
        run = await runs_repo.get_run(scope, session, run_id)
        events = await runs_repo.list_run_events(scope, session, run_id)
        try:
            trusted_result, candidate_id, execution_id = await _latest_trusted_result(
                RepoAgentStore(scope, session), run_id
            )
        except Exception as exc:  # integrity failure is a failed score, not a harness abort
            result_evidence_error = f"{type(exc).__name__}: {exc}"
            reasons.append(f"trusted RESULT unavailable: {result_evidence_error}")
    types = {e.type for e in events}
    verifier = run.verifier_decision
    terminal_event = next(
        (event for event in reversed(events) if event.type == "run.finished"), None
    )
    terminal_reason = (
        terminal_event.payload.get("reason_code") if terminal_event is not None else None
    )
    export_event = _latest_export_event(events)
    error_event = next((e for e in events if e.type == "run.error"), None)
    # A repair loop can emit several sandbox results. Score the terminal/latest
    # attempt; the first attempt may have failed before the repaired program printed
    # its promised result (bench-14 exposed this by omitting a key that the final
    # attempt did print).
    sandbox_event = _latest_sandbox_event(events)
    export_status = (
        export_event.payload.get(
            "export_status" if export_event.type == "code.finalized" else "status"
        )
        if export_event
        else None
    )
    saved = "artifact.saved" in types
    qasm_emission = (sandbox_event.payload.get("qasm_emission") if sandbox_event else None) or {}
    evidence = CaseEvidence(
        failed_stage=error_event.payload.get("stage") if error_event else None,
        error_code=error_event.payload.get("code") if error_event else None,
        qasm_source=qasm_emission.get("source"),
        qasm_epilogue_applied=qasm_emission.get("epilogue_applied"),
        qasm_available=qasm_emission.get("available"),
        qasm_epilogue_error=qasm_emission.get("epilogue_error"),
        trusted_result_available=trusted_result is not None,
        candidate_id=candidate_id,
        execution_id=execution_id,
        result_evidence_error=result_evidence_error,
    )

    expect = case.expect
    # Value-level correctness FIRST: a search/oracle case that recovers a well-formed
    # but wrong bitstring can pass structural checks, so pin the answer before trusting
    # the terminal decision. Only protected RESULT evidence is allowed to influence it.
    reasons.extend(_score_result_expectations(expect, trusted_result))
    reasons.extend(
        _score_terminal_expectations(
            expect,
            run_status=run.status,
            terminal_reason=terminal_reason,
            verifier_decision=verifier,
        )
    )
    if expect.export_status is not None and export_status != expect.export_status.value:
        reasons.append(
            f"export_status {export_status!r} != expected {expect.export_status.value!r}"
        )
    if expect.saves_artifact and not saved:
        reasons.append("expected a saved artifact, none was written")

    return CaseResult(
        id=case.id,
        category=case.category,
        passed=not reasons,
        run_status=run.status,
        terminal_reason=terminal_reason,
        verifier_decision=verifier,
        export_status=export_status,
        saved=saved,
        reasons=reasons,
        evidence=evidence,
    )


async def run_corpus(
    cases: list[CorpusCase],
    *,
    factory,
    scope: Scope,
    llm: LLMClient,
    sandbox: Sandbox,
    note: str | None = None,
) -> Report:
    results = [
        await run_case(case, factory=factory, scope=scope, llm=llm, sandbox=sandbox)
        for case in cases
    ]
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    return Report(
        total=total,
        passed=passed,
        pass_rate=(passed / total if total else 0.0),
        cases=results,
        note=note,
    )
