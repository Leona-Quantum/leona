"""Real pipeline stage handlers — the seam where the pure state machine
(majorana-pipeline) meets the LLM, sandbox, verification, baseline, and IR
packages. These live in the WORKER, not the pipeline package, so the pipeline
stays pure (contracts only). The orchestrator still owns transitions; each handler
only does its stage's work, writes to ctx.state, and emits events.

Data threaded through ctx.state within a run:
  plan (Plan) → code (str) → result (dict) + circuit (IR) + qasm (str)
  → verifier_decision (VerifierDecision) → export (ExportClassification)

Providers are injected: production builds AnthropicLLM + VercelSandbox from env;
tests/offline E2E inject FakeLLM + LocalSubprocessSandbox.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from majorana_baselines import (
    BaselineInstance,
    CapError,
    HamiltonianInstance,
    MaxCutInstance,
    PortfolioInstance,
    QuboInstance,
    solve,
)
from majorana_contracts.enums import (
    Algorithm,
    BaselineKind,
    ExportStatus,
    Framework,
    Stage,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
)
from majorana_contracts.plan import Plan
from majorana_ir import IR_VERSION_TAG, canonical_dict, circuit_fingerprint
from majorana_ir.connectors import OpenQASMError, from_openqasm
from majorana_llm import (
    STAGE_PROMPTS,
    LLMClient,
    LLMRequest,
    extract_code,
    extract_qasm,
    model_for,
    parse_plan,
)
from majorana_pipeline import RunContext, StageHandler, StageOutcome
from majorana_sandbox import ExecutionSpec, GuardRejection, QubitCeilingExceeded, Sandbox
from majorana_sandbox import run as sandbox_run
from majorana_verification import (
    VerificationOutcome,
    extract_counts,
    verify_brute_force,
    verify_exact_diag,
    verify_qasm_parse,
    verify_return_contract,
    verify_statistical_counts,
)

from majorana_api.db import AsyncSession
from majorana_contracts import Scope
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import runs as runs_repo

# Export target per framework (the classifier's target vocabulary).
_EXPORT_TARGET = {
    Framework.QISKIT: "qiskit",
    Framework.PENNYLANE: "pennylane",
    Framework.CIRQ: "openqasm2",  # no native cirq generator; QASM 2 is downloadable
}

_BASELINE_INSTANCE_TYPES = {
    "maxcut": MaxCutInstance,
    "qubo": QuboInstance,
    "portfolio": PortfolioInstance,
    "hamiltonian": HamiltonianInstance,
}


async def _emit_llm_call(ctx: RunContext, stage: Stage, model: str, resp: Any, dt_ms: int) -> None:
    await ctx.sink.emit(
        "llm.call",
        {
            "stage": stage,
            "model": model,
            "input_tokens": resp.input_tokens,
            "output_tokens": resp.output_tokens,
            "duration_ms": dt_ms,
        },
    )


def build_stage_handlers(
    scope: Scope,
    session: AsyncSession,
    run_id: uuid.UUID,
    llm: LLMClient,
    sandbox: Sandbox,
) -> dict[Stage, StageHandler]:
    """Construct the real handler dict for one run, closing over its scope/session
    and the injected providers."""

    async def plan_stage(ctx: RunContext) -> StageOutcome:
        model = model_for(Stage.PLAN)
        t0 = time.monotonic()
        resp = await llm.complete(
            LLMRequest(
                model=model,
                system=STAGE_PROMPTS["plan"],
                user=ctx.task_prompt,
                # Structured decoding pins the exact Plan field names/enums —
                # prompt-only schema injection is proven unreliable (plan_invalid).
                response_schema=Plan.model_json_schema(),
                schema_name="request_plan",
            )
        )
        await _emit_llm_call(ctx, Stage.PLAN, model, resp, int((time.monotonic() - t0) * 1000))
        try:
            plan = parse_plan(resp.text)
        except Exception as exc:
            return StageOutcome(ok=False, error_code="plan_invalid", error_message=str(exc))
        ctx.state["plan"] = plan
        await ctx.sink.emit("plan.produced", {"plan": plan.model_dump(mode="json")})
        return StageOutcome(ok=True)

    async def generate_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        model = model_for(Stage.GENERATE)
        user = f"Plan:\n{plan.model_dump_json(indent=2)}\n\nGenerate the code."
        t0 = time.monotonic()
        resp = await llm.complete(
            # 8192: real algorithm implementations (VQE/QAOA + QASM emission) overflow
            # the 4096 default — DeepSeek then returns an empty completion, which
            # surfaced as generate_invalid in the 2026-07-11 baseline.
            LLMRequest(model=model, system=STAGE_PROMPTS["generate"], user=user, max_tokens=8192)
        )
        await _emit_llm_call(ctx, Stage.GENERATE, model, resp, int((time.monotonic() - t0) * 1000))
        try:
            code = extract_code(resp.text)
        except Exception as exc:
            return StageOutcome(ok=False, error_code="generate_invalid", error_message=str(exc))
        ctx.state["code"] = code
        await ctx.sink.emit(
            "code.generated", {"language": plan.framework, "code": code, "revision": 1}
        )
        return StageOutcome(ok=True)

    async def simulate_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        spec = ExecutionSpec(
            code=ctx.state["code"],
            timeout_s=min(plan.expected_runtime_sec, 120),
            qubits_estimate=plan.qubits_estimate,
        )
        try:
            result = await sandbox_run(sandbox, spec)
        except GuardRejection as exc:
            return StageOutcome(ok=False, error_code="guard_rejected", error_message=str(exc))
        except QubitCeilingExceeded as exc:
            return StageOutcome(ok=False, error_code="qubit_ceiling", error_message=str(exc))

        await ctx.sink.emit(
            "sandbox.result",
            {
                "exit_code": result.exit_code,
                "duration_ms": result.duration_ms,
                "memory_mb": result.memory_mb,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "truncated": result.truncated,
            },
        )
        await runs_repo.update_run_status(
            scope,
            session,
            run_id,
            (await runs_repo.get_run(scope, session, run_id)).status,  # unchanged status
            sandbox_provider=result.provider,
            sandbox_meta={
                "exit_code": result.exit_code,
                "duration_ms": result.duration_ms,
            },
        )
        await session.commit()
        if not result.ok:
            return StageOutcome(
                ok=False, error_code="sandbox_failed", error_message=result.stderr[:500]
            )

        parsed = _parse_result_dict(result.stdout)
        if parsed is None:
            return StageOutcome(
                ok=False,
                error_code="no_result",
                error_message="generated code printed no JSON result object",
            )
        ctx.state["result"] = parsed
        qasm = extract_qasm(result.stdout)
        if qasm:
            try:
                ctx.state["circuit"] = from_openqasm(qasm)
                ctx.state["qasm"] = qasm
            except OpenQASMError:
                pass  # verify's qasm_parse will record the failure
        return StageOutcome(ok=True)

    async def verify_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        result: dict[str, Any] = ctx.state["result"]
        methods = list(plan.verification_plan.methods) if plan.verification_plan else []
        # Contract checks ALWAYS run, in addition to plan-chosen methods. A plan
        # that picks only headless-unavailable methods must never starve the
        # verdict into INCONCLUSIVE (baseline-2026-07-11 "verifier method
        # starvation" — the dominant 0/6 cause).
        for required in (VerificationMethod.RETURN_CONTRACT, VerificationMethod.QASM_PARSE):
            if required not in methods:
                methods.append(required)

        outcomes = []
        for method in methods:
            outcome = _run_verification(method, plan, result, ctx.state)
            if outcome is None:
                continue  # method needs data this run doesn't have; skip honestly
            outcomes.append(outcome)
            await ctx.sink.emit(
                "verification.result",
                {"method": outcome.method, "result": outcome.result, "details": outcome.details},
            )
            await runs_repo.add_verification_record(
                scope,
                session,
                run_id,
                method=outcome.method,
                result=outcome.result.value,
                details=outcome.details,
            )
        await session.commit()

        if not outcomes:
            decision = VerifierDecision.INCONCLUSIVE
        elif all(o.passed for o in outcomes):
            decision = VerifierDecision.PASS
        else:
            decision = VerifierDecision.FAIL
        ctx.state["verifier_decision"] = decision
        await runs_repo.update_run_status(
            scope,
            session,
            run_id,
            (await runs_repo.get_run(scope, session, run_id)).status,
            verifier_decision=decision,
        )
        await session.commit()
        return StageOutcome(ok=True)  # a failed verification sets the decision, not run status

    async def baseline_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        kind = plan.baseline_plan.kind if plan.baseline_plan else BaselineKind.NONE
        if kind is BaselineKind.NONE:
            await ctx.sink.emit(
                "baseline.result",
                {
                    "kind": BaselineKind.NONE,
                    "not_applicable_reason": (
                        plan.baseline_plan.reason if plan.baseline_plan else "no baseline applies"
                    ),
                },
            )
            return StageOutcome(ok=True)

        instance = _baseline_instance(ctx.state.get("result", {}))
        if instance is None:
            await ctx.sink.emit(
                "baseline.result",
                {
                    "kind": kind,
                    "not_applicable_reason": "no structured baseline instance in the result",
                },
            )
            return StageOutcome(ok=True)
        try:
            solution = solve(instance)
        except CapError as exc:
            await ctx.sink.emit(
                "baseline.result", {"kind": kind, "not_applicable_reason": str(exc)}
            )
            return StageOutcome(ok=True)
        baseline_payload = solution.model_dump(mode="json")
        ctx.state["baseline"] = baseline_payload
        await ctx.sink.emit("baseline.result", {"kind": kind, "result": baseline_payload})
        await runs_repo.update_run_status(
            scope,
            session,
            run_id,
            (await runs_repo.get_run(scope, session, run_id)).status,
            baseline=baseline_payload,
        )
        await session.commit()
        return StageOutcome(ok=True)

    async def export_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        circuit = ctx.state.get("circuit")
        if circuit is None:  # non-circuit task
            await ctx.sink.emit(
                "export.classified",
                {
                    "status": ExportStatus.UNSUPPORTED,
                    "reason": "no circuit produced",
                    "qasm_available": False,
                },
            )
            return StageOutcome(ok=True)
        from majorana_ir import classify_export

        target = _EXPORT_TARGET.get(Framework(plan.framework), "openqasm2")
        classification = classify_export(circuit, target)
        ctx.state["export"] = classification
        await ctx.sink.emit(
            "export.classified",
            {
                "status": classification.status,
                "reason": classification.reason,
                "qasm_available": classification.qasm_available,
            },
        )
        return StageOutcome(ok=True)

    async def save_stage(ctx: RunContext) -> StageOutcome:
        # Only a verified run becomes a durable artifact (never save a failed
        # verification as "verified" — 05-security.md, writeback prompt).
        if ctx.state.get("verifier_decision") is not VerifierDecision.PASS:
            return StageOutcome(ok=True)
        circuit = ctx.state.get("circuit")
        if circuit is None:
            return StageOutcome(ok=True)
        plan: Plan = ctx.state["plan"]
        export = ctx.state.get("export")
        artifact = await artifacts_repo.create_artifact(
            scope,
            session,
            slug=f"run-{run_id.hex[:12]}",
            title=plan.problem_summary[:200],
            family=Algorithm(plan.algorithm),
            framework=Framework(plan.framework),
        )
        version = await artifacts_repo.create_version(
            scope,
            session,
            artifact.id,
            ir_version=IR_VERSION_TAG,
            ir=canonical_dict(circuit),
            code=ctx.state["code"],
            code_lang=plan.framework,
            fingerprint=circuit_fingerprint(circuit),
            export_status=export.status if export else ExportStatus.UNSUPPORTED,
            export_reason=export.reason if export else None,
            qasm=ctx.state.get("qasm"),
            resource_estimates={"qubits": circuit.qubits, "operations": len(circuit.operations)},
            limitations=export.reason if export else None,
        )
        await runs_repo.set_run_artifact_version(scope, session, run_id, version.id)
        await session.commit()
        await ctx.sink.emit(
            "artifact.saved",
            {"artifact_id": artifact.id, "version_id": version.id, "version_seq": version.seq},
        )
        return StageOutcome(ok=True)

    return {
        Stage.PLAN: plan_stage,
        Stage.GENERATE: generate_stage,
        Stage.SIMULATE: simulate_stage,
        Stage.VERIFY: verify_stage,
        Stage.BASELINE: baseline_stage,
        Stage.EXPORT: export_stage,
        Stage.SAVE: save_stage,
    }


def _parse_result_dict(stdout: str) -> dict[str, Any] | None:
    """The generated code prints a JSON object on its last stdout line."""
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                return obj
    return None


def _baseline_instance(result: dict[str, Any]) -> BaselineInstance | None:
    """Build a structured baseline instance if the result carries one under
    `baseline_instance` (the model supplies structure, never code)."""
    raw = result.get("baseline_instance")
    if not isinstance(raw, dict):
        return None
    cls = _BASELINE_INSTANCE_TYPES.get(raw.get("kind"))
    if cls is None:
        return None
    try:
        return cls.model_validate(raw)
    except Exception:
        return None


def _run_verification(method: VerificationMethod, plan: Plan, result: dict[str, Any], state: dict):
    """Dispatch one verification method with the data available this run; return
    None when the method needs data we don't have (skip honestly, never fake)."""
    if method is VerificationMethod.RETURN_CONTRACT:
        expected = plan.expected_output_keys
        rtype = plan.artifact_contract.expected_return_type if plan.artifact_contract else None
        return verify_return_contract(result, expected, rtype)
    if method is VerificationMethod.QASM_PARSE:
        qasm = state.get("qasm")
        if qasm:
            return verify_qasm_parse(qasm)
        # The generate contract requires circuit-bearing runs to print their
        # FINAL_CIRCUIT QASM on stdout. Missing QASM is a broken promise, not
        # missing data — FAIL, never skip (this is the bench-28 honesty case).
        return VerificationOutcome(
            method=VerificationMethod.QASM_PARSE,
            result=VerificationResultKind.FAIL,
            details={
                "error": "no parseable OpenQASM 2 on stdout; the generate contract "
                "requires circuit-bearing runs to emit FINAL_CIRCUIT as QASM"
            },
        )
    if method is VerificationMethod.STATISTICAL:
        circuit = state.get("circuit")
        counts = extract_counts(result, plan.expected_output_keys)
        if circuit is None or counts is None:
            return None  # no parsed circuit or no counts to test; skip honestly
        thresholds = plan.verification_plan.thresholds if plan.verification_plan else None
        threshold = None
        if thresholds:
            threshold = thresholds.get("tvd_max") or thresholds.get("total_variation_max")
        return verify_statistical_counts(circuit, counts, threshold=threshold)
    if method is VerificationMethod.EXACT_DIAG:
        instance = _baseline_instance(result)
        metric = plan.success_criteria.primary_metric
        if instance is None or metric not in result:
            return None
        return verify_exact_diag(instance, float(result[metric]))
    if method is VerificationMethod.BRUTE_FORCE:
        instance = _baseline_instance(result)
        metric = plan.success_criteria.primary_metric
        if instance is None or metric not in result:
            return None
        return verify_brute_force(instance, float(result[metric]))
    # EXACT needs an independent reference circuit the headless path doesn't
    # have; skip rather than fabricate. (The plan prompt now excludes it.)
    return None
