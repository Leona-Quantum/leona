"""Harness v1: run each corpus case through the real pipeline and score it against
its honest expectations. Providers are injected — a real run uses AnthropicLLM +
VercelSandbox (the honest baseline number); the self-test uses fakes.

Scoring is structural, never a golden number: verifier_decision, export status
(when the case pins one), promised output keys, and whether a verified artifact
was saved. This measures whether the pipeline is honest and end-to-end correct,
which is exactly what the ≥60% calibration target in 08-phases.md is about."""

from __future__ import annotations

from majorana_contracts import Scope
from majorana_contracts.enums import RunMode
from majorana_llm import LLMClient
from majorana_sandbox import Sandbox

from majorana_api.jobs import RUN_EXECUTE_JOB_KIND
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_worker.handlers import handle_run_execute

from majorana_evals.schema import CaseEvidence, CaseResult, CorpusCase, Report


async def run_case(
    case: CorpusCase,
    *,
    factory,
    scope: Scope,
    llm: LLMClient,
    sandbox: Sandbox,
) -> CaseResult:
    # Create the run + enqueue exactly as the API route does, then drive it.
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
        await system.enqueue_job(session, kind=RUN_EXECUTE_JOB_KIND, payload=payload, run_id=run_id)
        await session.commit()

    reasons: list[str] = []
    try:
        async with factory() as session:
            await handle_run_execute(session, payload, llm=llm, sandbox=sandbox)
    except Exception as exc:  # a crash is a failed case, not a harness abort
        reasons.append(f"handler error: {exc}")

    async with factory() as session:
        run = await runs_repo.get_run(scope, session, run_id)
        events = await runs_repo.list_run_events(scope, session, run_id)
    types = {e.type for e in events}
    verifier = run.verifier_decision
    export_event = next((e for e in events if e.type == "export.classified"), None)
    error_event = next((e for e in events if e.type == "run.error"), None)
    sandbox_event = next((e for e in events if e.type == "sandbox.result"), None)
    export_status = export_event.payload.get("status") if export_event else None
    saved = "artifact.saved" in types
    qasm_emission = sandbox_event.payload.get("qasm_emission", {}) if sandbox_event else {}
    evidence = CaseEvidence(
        failed_stage=error_event.payload.get("stage") if error_event else None,
        error_code=error_event.payload.get("code") if error_event else None,
        qasm_source=qasm_emission.get("source"),
        qasm_epilogue_applied=qasm_emission.get("epilogue_applied"),
        qasm_available=qasm_emission.get("available"),
        qasm_epilogue_error=qasm_emission.get("epilogue_error"),
    )

    expect = case.expect
    if verifier != expect.verifier_decision.value:
        reasons.append(
            f"verifier_decision {verifier!r} != expected {expect.verifier_decision.value!r}"
        )
    if expect.export_status is not None and export_status != expect.export_status.value:
        reasons.append(
            f"export_status {export_status!r} != expected {expect.export_status.value!r}"
        )
    if expect.saves_artifact and not saved:
        reasons.append("expected a saved artifact, none was written")
    if expect.output_keys:
        code_event = next((e for e in events if e.type == "sandbox.result"), None)
        stdout = code_event.payload.get("stdout", "") if code_event else ""
        for key in expect.output_keys:
            if key not in stdout:
                reasons.append(f"result missing promised key {key!r}")

    return CaseResult(
        id=case.id,
        category=case.category,
        passed=not reasons,
        run_status=run.status,
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
