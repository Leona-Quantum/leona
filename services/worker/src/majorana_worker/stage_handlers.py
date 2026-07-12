"""Real pipeline stage handlers — the seam where the pure state machine
(majorana-pipeline) meets the LLM, sandbox, verification, baseline, and IR
packages. These live in the WORKER, not the pipeline package, so the pipeline
stays pure (contracts only). The orchestrator still owns transitions; each handler
only does its stage's work, writes to ctx.state, and emits events.

Data threaded through ctx.state within a run:
  plan (Plan) → code (str) → screen/resource evidence → result (dict) + circuit (IR)
  + qasm (str) → verifier_decision → compiled circuit/resource evidence → finalized
  code → final result → baseline/analysis → export/writeback metadata

Providers are injected: production builds AnthropicLLM + VercelSandbox from env;
tests/offline E2E inject FakeLLM + LocalSubprocessSandbox.
"""

from __future__ import annotations

import ast
import json
import re
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
    ArtifactType,
    BaselineKind,
    ExportStatus,
    Framework,
    Stage,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
)
from majorana_contracts.models import ResourceMetrics
from majorana_contracts.plan import Plan
from majorana_ir import (
    IR_VERSION_TAG,
    canonical_dict,
    circuit_fingerprint,
    compile_circuit,
    resource_metrics,
)
from majorana_ir.connectors import OpenQASMError, from_openqasm, to_openqasm
from majorana_llm import (
    FINAL_QASM_BEGIN,
    FINAL_QASM_END,
    FINAL_QASM_ERROR,
    STAGE_PROMPTS,
    LLMClient,
    LLMRequest,
    extract_code,
    extract_qasm_with_provenance,
    model_for,
    parse_plan,
    research_for_prompt,
)
from majorana_pipeline import RunContext, StageHandler, StageOutcome
from majorana_sandbox import ExecutionSpec, GuardRejection, QubitCeilingExceeded, Sandbox
from majorana_sandbox import run as sandbox_run
from majorana_sandbox.guard import check_python_code
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


def _qiskit_qasm_epilogue(code: str) -> str:
    """Append Majorana-owned serialization of a generated ``FINAL_CIRCUIT``.

    The epilogue deliberately does not replace user code, inspect result JSON, or
    attempt to repair a model program. It observes the completed Qiskit circuit after
    the program runs and emits a marked QASM payload. Missing/unsupported final circuits
    leave the program result intact; model stdout remains the documented fallback.
    """
    return f'''{code}

# Majorana-owned deterministic QASM emission. The line markers are parsed by the
# control plane and must remain separate from the model's result JSON contract.
_majorana_final_circuit = globals().get("FINAL_CIRCUIT")
if _majorana_final_circuit is not None:
    try:
        from qiskit.qasm2 import dumps as _majorana_qasm_dumps

        # Serialize through the narrow IR-compatible basis when Qiskit can do so.
        # This keeps simulator/backend-specific composites (u2/u3/rxx/rzx/...) from
        # being mistaken for canonical IR gates by the verifier. Dynamic circuits
        # that cannot be lowered remain an explicit export/verification limitation.
        try:
            from qiskit import transpile as _majorana_transpile
        except Exception:
            _majorana_transpile = None
        if _majorana_transpile is not None:
            _majorana_final_circuit = _majorana_transpile(
                _majorana_final_circuit,
                basis_gates=["u", "cx"],
                optimization_level=0,
            )

        _majorana_final_qasm = _majorana_qasm_dumps(_majorana_final_circuit)
    except Exception as _majorana_qasm_exc:
        print("{FINAL_QASM_ERROR}:" + type(_majorana_qasm_exc).__name__)
    else:
        print("{FINAL_QASM_BEGIN}")
        print(_majorana_final_qasm)
        print("{FINAL_QASM_END}")
'''


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
        research = await research_for_prompt(ctx.task_prompt)
        research_context = research.as_prompt() if research else ""
        ctx.state["research_context"] = research_context
        user = ctx.task_prompt
        if research_context:
            user = f"{ctx.task_prompt}\n\n{research_context}"
        t0 = time.monotonic()
        resp = await llm.complete(
            LLMRequest(
                model=model,
                system=STAGE_PROMPTS["plan"],
                user=user,
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
        feedback = ctx.state.get("repair_feedback")
        research_context = ctx.state.get("research_context", "")
        user = f"Plan:\n{plan.model_dump_json(indent=2)}\n\nGenerate the code."
        if research_context:
            user = f"{research_context}\n\n{user}"
        if feedback:
            user += (
                "\n\nThe previous attempt failed a deterministic screen or verification check. "
                f"Diagnose and fix only this issue before regenerating:\n{feedback}"
            )
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
        revision = int(ctx.state.get("code_revision", 0)) + 1
        ctx.state["code_revision"] = revision
        ctx.state["code"] = code
        await ctx.sink.emit(
            "code.generated", {"language": plan.framework, "code": code, "revision": revision}
        )
        return StageOutcome(ok=True)

    async def simulate_stage(ctx: RunContext, *, phase: str = "verification") -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        code_key = "final_code" if phase == "final" else "code"
        result_key = "final_result" if phase == "final" else "result"
        qasm_key = "final_qasm" if phase == "final" else "qasm"
        circuit_key = "final_circuit" if phase == "final" else "circuit"
        # A failed final simulation is still a generated-program failure: feed the
        # concrete runtime diagnostic back to generation, then re-screen/re-estimate
        # before trying compilation/finalization again.
        retry_from = Stage.GENERATE
        epilogue_applied = Framework(plan.framework) is Framework.QISKIT and _circuit_expected(plan)
        spec = ExecutionSpec(
            code=(
                _qiskit_qasm_epilogue(ctx.state[code_key])
                if epilogue_applied
                else ctx.state[code_key]
            ),
            timeout_s=min(plan.expected_runtime_sec, 120),
            qubits_estimate=plan.qubits_estimate,
        )
        try:
            result = await sandbox_run(sandbox, spec)
        except GuardRejection as exc:
            return StageOutcome(
                ok=False,
                error_code="guard_rejected",
                error_message=str(exc),
                retry_from=retry_from,
                diagnosis=str(exc),
            )
        except QubitCeilingExceeded as exc:
            return StageOutcome(
                ok=False,
                error_code="qubit_ceiling",
                error_message=str(exc),
                retry_from=retry_from,
                diagnosis=str(exc),
            )

        qasm_extraction = extract_qasm_with_provenance(result.stdout)
        await ctx.sink.emit(
            "sandbox.result",
            {
                "phase": phase,
                "exit_code": result.exit_code,
                "duration_ms": result.duration_ms,
                "memory_mb": result.memory_mb,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "truncated": result.truncated,
                "qasm_emission": {
                    "epilogue_applied": epilogue_applied,
                    "source": qasm_extraction.source,
                    "available": qasm_extraction.qasm is not None,
                    "epilogue_error": qasm_extraction.epilogue_error,
                },
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
                ok=False,
                error_code="sandbox_failed",
                error_message=result.stderr[:500],
                retry_from=retry_from,
                diagnosis=result.stderr[:500],
            )

        parsed = _parse_result_dict(result.stdout)
        if parsed is None:
            return StageOutcome(
                ok=False,
                error_code="no_result",
                error_message="generated code printed no JSON result object",
                retry_from=retry_from,
                diagnosis="generated code printed no JSON result object",
            )
        ctx.state[result_key] = parsed
        qasm = qasm_extraction.qasm
        if qasm:
            # Preserve a syntactically invalid payload for qasm_parse so the verifier
            # can report the real parse error rather than mislabeling it as missing.
            ctx.state[qasm_key] = qasm
            try:
                ctx.state[circuit_key] = from_openqasm(qasm)
            except OpenQASMError:
                pass  # verify's qasm_parse will record the failure
        return StageOutcome(ok=True)

    async def verify_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        simulation = await simulate_stage(ctx)
        if not simulation.ok:
            return simulation
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
        if decision is VerifierDecision.FAIL:
            details_text = json.dumps(
                [outcome.details for outcome in outcomes], sort_keys=True, default=str
            )
            # An IR capability limitation is an honest terminal result, not a
            # prompt-repair loop. Ordinary contract/statistical failures restart
            # generation with the concrete evidence as feedback.
            non_repairable = any(
                marker in details_text.lower()
                for marker in ("terminal-measurement", "ir limitation", "mid-circuit")
            )
            if not non_repairable:
                return StageOutcome(
                    ok=False,
                    error_code="verification_failed",
                    error_message="verification failed",
                    retry_from=Stage.GENERATE,
                    diagnosis=details_text,
                )
        return StageOutcome(ok=True)  # failure is retained for honest analysis

    async def screen_stage(ctx: RunContext) -> StageOutcome:
        """Lint and type/safety-screen generated code without executing it."""

        plan: Plan = ctx.state["plan"]
        code = ctx.state["code"]
        diagnostics: list[str] = []
        syntax_ok = True
        try:
            ast.parse(code)
        except SyntaxError as exc:
            syntax_ok = False
            diagnostics.append(f"syntax:{exc.msg} at line {exc.lineno}")

        guard = check_python_code(code)
        if not guard.ok:
            diagnostics.extend(guard.violations)

        circuit_expected = _circuit_expected(plan)
        final_binding = bool(re.search(r"(?m)^\s*FINAL_CIRCUIT\s*=", code))
        legacy_qasm = bool(re.search(r"\.\s*qasm\s*\(", code))
        if circuit_expected and Framework(plan.framework) is Framework.QISKIT and not final_binding:
            diagnostics.append("contract:Qiskit circuit code must bind FINAL_CIRCUIT")
        if legacy_qasm:
            diagnostics.append("compatibility:QuantumCircuit.qasm() is removed in Qiskit 2.x")

        lint_ok = guard.ok and not legacy_qasm
        typecheck_ok = syntax_ok and (not circuit_expected or final_binding)
        ctx.state["screen"] = {
            "lint_ok": lint_ok,
            "typecheck_ok": typecheck_ok,
            "diagnostics": diagnostics,
        }
        await ctx.sink.emit(
            "screen.result",
            {"lint_ok": lint_ok, "typecheck_ok": typecheck_ok, "diagnostics": diagnostics},
        )
        if not lint_ok or not typecheck_ok:
            if (
                circuit_expected
                and Framework(plan.framework) is Framework.QISKIT
                and not final_binding
            ):
                diagnostics.append(
                    "repair invariant: preserve or add a module-level FINAL_CIRCUIT = <final bound "
                    "circuit> assignment immediately before printing the result JSON"
                )
            message = "; ".join(diagnostics) or "generated code failed the screen"
            return StageOutcome(
                ok=False,
                error_code="screen_failed",
                error_message=message,
                retry_from=Stage.GENERATE,
                diagnosis=message,
            )
        return StageOutcome(ok=True)

    async def resource_estimate_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        metrics = _static_resource_metrics(plan, ctx.state["code"])
        ctx.state["pre_resource_estimate"] = metrics
        await ctx.sink.emit(
            "resource.estimate",
            {
                "phase": "pre_verify",
                "source": "plan_static",
                "metrics": metrics.model_dump(mode="json"),
                "notes": ["Static estimate only; the circuit has not executed yet."],
            },
        )
        return StageOutcome(ok=True)

    async def compile_stage(ctx: RunContext) -> StageOutcome:
        circuit = ctx.state.get("circuit")
        if circuit is None:
            ctx.state["compiled_circuit"] = None
            await ctx.sink.emit(
                "compilation.result",
                {
                    "accepted": False,
                    "mode": "not_applicable",
                    "reason": "no verified circuit was available for compilation",
                    "compatibility": {},
                },
            )
            return StageOutcome(ok=True)

        outcome = compile_circuit(circuit)
        ctx.state["compiled_circuit"] = outcome.selected
        ctx.state["compilation"] = outcome
        compatibility: dict[str, Any] = {}
        from majorana_ir import classify_export

        for target in ("openqasm2", "qiskit", "pennylane"):
            try:
                classification = classify_export(outcome.selected, target)
                compatibility[target] = {
                    "status": classification.status,
                    "reason": classification.reason,
                }
            except Exception as exc:
                compatibility[target] = {"status": "unsupported", "reason": type(exc).__name__}

        await ctx.sink.emit(
            "compilation.result",
            {
                "accepted": outcome.accepted,
                "mode": outcome.mode,
                "target": "canonical_ir",
                "source_fingerprint": circuit_fingerprint(outcome.source),
                "compiled_fingerprint": circuit_fingerprint(outcome.selected),
                "before": outcome.before.model_dump(mode="json"),
                "after": outcome.candidate.model_dump(mode="json"),
                "compatibility": compatibility,
                "reason": outcome.reason,
            },
        )
        return StageOutcome(ok=True)

    async def compiled_resource_estimate_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        circuit = ctx.state.get("compiled_circuit")
        if circuit is None:
            metrics = _static_resource_metrics(plan, ctx.state["code"])
            source = "plan_static"
            notes = ["No parsed circuit; compiled estimate is unavailable."]
        else:
            metrics = resource_metrics(circuit)
            source = "compiler"
            notes = ["Estimate reflects the selected compiler candidate."]
        ctx.state["compiled_resource_estimate"] = metrics
        await ctx.sink.emit(
            "resource.estimate",
            {
                "phase": "compiled",
                "source": source,
                "metrics": metrics.model_dump(mode="json"),
                "notes": notes,
            },
        )
        return StageOutcome(ok=True)

    async def finalize_stage(ctx: RunContext) -> StageOutcome:
        plan: Plan = ctx.state["plan"]
        source_circuit = ctx.state.get("circuit")
        compilation = ctx.state.get("compilation")
        circuit = source_circuit
        final_code = ctx.state["code"]
        compilation_applied = False
        finalization_reason = None
        if (
            source_circuit is not None
            and compilation is not None
            and compilation.accepted
            and Framework(plan.framework) is Framework.QISKIT
        ):
            rewritten = _rewrite_qiskit_final_circuit(ctx.state["code"], compilation.selected)
            if rewritten is not None:
                final_code = rewritten
                circuit = compilation.selected
                compilation_applied = True
            else:
                finalization_reason = (
                    "compiler candidate was retained for evidence, but the result-producing "
                    "source had no safe Qiskit final-run rewrite point; original circuit kept"
                )
        elif compilation is not None and not compilation.accepted:
            finalization_reason = compilation.reason

        if circuit is None:
            classification_status = ExportStatus.UNSUPPORTED
            classification_reason = "no circuit produced"
            qasm_available = False
        else:
            from majorana_ir import classify_export

            target = _EXPORT_TARGET.get(Framework(plan.framework), "openqasm2")
            classification = classify_export(circuit, target)
            classification_status = classification.status
            classification_reason = classification.reason
            qasm_available = classification.qasm_available
            ctx.state["export"] = classification

        await ctx.sink.emit(
            "export.classified",
            {
                "status": classification_status,
                "reason": classification_reason,
                "qasm_available": qasm_available,
            },
        )

        ctx.state["final_code"] = final_code
        ctx.state["compilation_applied"] = compilation_applied
        ctx.state["finalization_reason"] = finalization_reason
        simulation_plausible = (
            ctx.state.get("verifier_decision") is VerifierDecision.PASS and circuit is not None
        )
        ctx.state["simulation_plausible"] = simulation_plausible
        conversion_options = ["openqasm2", "qiskit", "pennylane"] if circuit else []
        execution_options = ["simulate"] if simulation_plausible else []
        await ctx.sink.emit(
            "code.finalized",
            {
                "language": plan.framework,
                "code": final_code,
                "revision": int(ctx.state.get("code_revision", 1)),
                "compilation_applied": compilation_applied,
                "simulation_plausible": simulation_plausible,
                "qpu_available": False,
                "conversion_options": conversion_options,
                "execution_options": execution_options,
                "export_status": classification_status,
                "export_reason": classification_reason,
                "finalization_reason": finalization_reason,
            },
        )
        return StageOutcome(ok=True)

    async def final_execute_stage(ctx: RunContext) -> StageOutcome:
        if not ctx.state.get("simulation_plausible", False):
            return StageOutcome(ok=True)
        return await simulate_stage(ctx, phase="final")

    async def analyze_stage(ctx: RunContext) -> StageOutcome:
        decision = ctx.state.get("verifier_decision", VerifierDecision.INCONCLUSIVE)
        baseline = ctx.state.get("baseline")
        compilation = ctx.state.get("compilation")
        if decision is VerifierDecision.PASS:
            summary = "Finalized code executed and passed the configured verification checks."
            interpretation = (
                "The result is reproducible within the recorded simulator and verification limits."
            )
        elif decision is VerifierDecision.FAIL:
            summary = (
                "The run completed with a verification failure; no verified artifact was saved."
            )
            interpretation = "The recorded diagnostics identify whether the failure was repairable or an unsupported capability."
        else:
            summary = "The run completed without enough evidence for a verification verdict."
            interpretation = "Treat the result as inconclusive until a stronger check is available."
        residual_risks = "Compilation was analyzed conservatively; target-specific transpilation/QPU execution is not available in this run."
        comparison = {
            "baseline": baseline,
            "final_result": ctx.state.get("final_result", ctx.state.get("result")),
            "compilation": (
                {"mode": compilation.mode, "accepted": compilation.accepted}
                if compilation is not None
                else None
            ),
        }
        ctx.state["analysis"] = {"summary": summary, "interpretation": interpretation}
        ctx.state["residual_risks"] = residual_risks
        await runs_repo.update_run_status(
            scope,
            session,
            run_id,
            (await runs_repo.get_run(scope, session, run_id)).status,
            residual_risks=residual_risks,
        )
        await session.commit()
        await ctx.sink.emit(
            "run.analysis",
            {
                "summary": summary,
                "interpretation": interpretation,
                "results": ctx.state.get("final_result", ctx.state.get("result", {})),
                "comparison": comparison,
                "residual_risks": residual_risks,
            },
        )
        return StageOutcome(ok=True)

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

        instance = _baseline_instance(ctx.state.get("final_result", ctx.state.get("result", {})))
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

    async def save_stage(ctx: RunContext) -> StageOutcome:
        # Only a verified run becomes a durable artifact (never save a failed
        # verification as "verified" — 05-security.md, writeback prompt).
        if ctx.state.get("verifier_decision") is not VerifierDecision.PASS:
            return StageOutcome(ok=True)
        source_circuit = ctx.state.get("circuit")
        circuit = ctx.state.get("final_circuit") or (
            ctx.state.get("compiled_circuit")
            if ctx.state.get("compilation_applied")
            else source_circuit
        )
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
            code=ctx.state.get("final_code", ctx.state["code"]),
            code_lang=plan.framework,
            fingerprint=circuit_fingerprint(circuit),
            export_status=export.status if export else ExportStatus.UNSUPPORTED,
            export_reason=export.reason if export else None,
            qasm=ctx.state.get("final_qasm", ctx.state.get("qasm")),
            resource_estimates={
                "qubits": circuit.qubits,
                "operations": len(circuit.operations),
                "pre_verify": (
                    ctx.state["pre_resource_estimate"].model_dump(mode="json")
                    if isinstance(ctx.state.get("pre_resource_estimate"), ResourceMetrics)
                    else None
                ),
                "compiled": (
                    ctx.state["compiled_resource_estimate"].model_dump(mode="json")
                    if isinstance(ctx.state.get("compiled_resource_estimate"), ResourceMetrics)
                    else None
                ),
            },
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
        Stage.SCREEN: screen_stage,
        Stage.RESOURCE_ESTIMATE: resource_estimate_stage,
        Stage.VERIFY: verify_stage,
        Stage.COMPILE: compile_stage,
        Stage.COMPILED_RESOURCE_ESTIMATE: compiled_resource_estimate_stage,
        Stage.FINALIZE: finalize_stage,
        Stage.FINAL_EXECUTE: final_execute_stage,
        Stage.BASELINE: baseline_stage,
        Stage.ANALYZE: analyze_stage,
        Stage.SAVE: save_stage,
    }


def _rewrite_qiskit_final_circuit(code: str, circuit) -> str | None:
    """Replace a safe ``FINAL_CIRCUIT = variable`` binding with compiled QASM.

    This deliberately rewrites only the binding used by a later ``.run(variable)``
    call. If the generated program has a more complicated result contract, the
    compiler candidate remains evidence-only and the original source is retained.
    """

    try:
        tree = ast.parse(code)
        qasm = to_openqasm(circuit)
    except Exception:
        return None

    binding = None
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if (
            isinstance(target, ast.Name)
            and target.id == "FINAL_CIRCUIT"
            and isinstance(node.value, ast.Name)
        ):
            binding = node
            break
    if binding is None or binding.end_lineno is None:
        return None

    source_name = binding.value.id
    if not any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "run"
        and node.args
        and isinstance(node.args[0], ast.Name)
        and node.args[0].id == source_name
        and node.lineno > binding.lineno
        for node in ast.walk(tree)
    ):
        return None

    lines = code.splitlines()
    start = binding.lineno - 1
    end = binding.end_lineno
    indent = re.match(r"\s*", lines[start]).group(0) if start < len(lines) else ""
    replacement = [
        f"{indent}{source_name} = QuantumCircuit.from_qasm_str({qasm!r})",
        f"{indent}FINAL_CIRCUIT = {source_name}",
    ]
    rewritten = [*lines[:start], *replacement, *lines[end:]]
    return "\n".join(rewritten) + "\n"


def _static_resource_metrics(plan: Plan, code: str) -> ResourceMetrics:
    """Estimate resource counts without executing generated code."""

    gate_names = "x|y|z|h|s|t|rx|ry|rz|u|reset|cx|cz|swap|cp|ccx|cswap|measure|measure_all"
    calls = re.findall(rf"\.({gate_names})\s*\(", code)
    two_qubit = {"cx", "cz", "swap", "cp"}
    return ResourceMetrics(
        qubits=plan.qubits_estimate,
        depth=None,
        gate_count=sum(call != "measure_all" for call in calls),
        two_qubit_gate_count=sum(call in two_qubit for call in calls),
        measurement_count=sum(call in {"measure", "measure_all"} for call in calls),
        estimated_runtime_ms=plan.expected_runtime_sec * 1000,
    )


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


def _circuit_expected(plan: Plan) -> bool:
    """Whether the plan promises a circuit artifact (and therefore QASM on
    stdout). Unknown contract defaults to True — this is a quantum-circuit
    product; only an explicitly non-circuit artifact type opts out."""
    if plan.artifact_contract is None:
        return True
    return plan.artifact_contract.artifact_type is not ArtifactType.OTHER


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
        if not _circuit_expected(plan):
            return None  # non-circuit run; nothing was promised, skip honestly
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
        if thresholds:  # explicit membership checks — a plan-set 0.0 must survive
            for key in ("tvd_max", "total_variation_max"):
                if thresholds.get(key) is not None:
                    threshold = thresholds[key]
                    break
        # Counts convention follows the generating framework: Qiskit reports
        # little-endian; the engine (and cirq/pennylane orderings) are big-endian.
        bit_order = "little" if Framework(plan.framework) is Framework.QISKIT else "big"
        return verify_statistical_counts(circuit, counts, threshold=threshold, bit_order=bit_order)
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
