"""Harness v1: run each corpus case through the real pipeline and score it against
its honest expectations. Providers are injected — a real run uses AnthropicLLM +
VercelSandbox (the honest baseline number); the self-test uses fakes.

Scoring is structural, never a golden number: verifier_decision, export status
(when the case pins one), promised output keys, and whether a verified artifact
was saved. This measures whether the pipeline is honest and end-to-end correct,
which is exactly what the ≥60% calibration target in 08-phases.md is about."""

from __future__ import annotations

import json
import re

from majorana_contracts import Scope
from majorana_contracts.enums import RunMode
from majorana_llm import LLMClient
from majorana_sandbox import Sandbox

from majorana_api.jobs import RUN_EXECUTE_JOB_KIND
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_worker.handlers import handle_run_execute

from majorana_evals.schema import CaseEvidence, CaseResult, CorpusCase, Report


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


def _last_json_object(stdout: str) -> dict | None:
    """Recover the terminal JSON result even when it was pretty-printed."""
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", stdout):
        try:
            candidate, _ = decoder.raw_decode(stdout[match.start() :])
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict):
            return candidate
    return None


def top_measured_bitstring(stdout: str) -> str | None:
    """The most-probable measured bitstring from a run's stdout, or None if no
    counts dict is present. The generated program prints one JSON object, while
    the sandbox may append a non-JSON QASM epilogue afterwards; scan backward for
    the last JSON object that actually carries measurement counts. Register-separator
    spaces are stripped so the result compares to a plain target. Ties resolve
    deterministically to the lexicographically smallest bitstring."""
    counts = None
    for line in reversed(stdout.splitlines()):
        if not line.strip():
            continue
        try:
            result = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(result, dict):
            continue
        counts = next((v for v in result.values() if _looks_like_counts(v)), None)
        if counts is not None:
            break
    if counts is None:
        return None
    # Max count, tie-broken by bitstring for determinism.
    top = max(counts.items(), key=lambda kv: (kv[1], [-ord(c) for c in kv[0]]))[0]
    return top.replace(" ", "")


def _latest_sandbox_event(events):
    """Return the terminal sandbox attempt from a retrying pipeline."""
    return next((event for event in reversed(events) if event.type == "sandbox.result"), None)


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
    # A repair loop can emit several sandbox results. Score the terminal/latest
    # attempt; the first attempt may have failed before the repaired program printed
    # its promised result (bench-14 exposed this by omitting a key that the final
    # attempt did print).
    sandbox_event = _latest_sandbox_event(events)
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
    stdout = sandbox_event.payload.get("stdout", "") if sandbox_event else ""
    # Value-level correctness FIRST: a search/oracle case that recovers a well-formed
    # but wrong bitstring (e.g. the endianness bit-reversal) passes the deterministic
    # verifier, so pin the answer here before trusting verifier_decision. Without this,
    # a case with expect.verifier_decision=pass gives false comfort on a wrong answer.
    if expect.expected_top_bitstring is not None:
        want = expect.expected_top_bitstring.replace(" ", "")
        got = top_measured_bitstring(stdout)
        if got is None:
            reasons.append(
                f"expected top bitstring {want!r} but no measurement counts were found in the result"
            )
        elif got != want:
            reasons.append(f"top measured bitstring {got!r} != expected {want!r}")
    if expect.expected_values:
        result_json = _last_json_object(stdout)
        for key, want in expect.expected_values.items():
            actual = result_json.get(key) if result_json else None
            if not isinstance(actual, int | float) or isinstance(actual, bool):
                reasons.append(f"expected numeric result {key!r} was not found")
            elif abs(float(actual) - want) > expect.expected_value_tolerance:
                reasons.append(
                    f"result {key!r} {actual!r} is outside expected {want!r} ± "
                    f"{expect.expected_value_tolerance}"
                )
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
