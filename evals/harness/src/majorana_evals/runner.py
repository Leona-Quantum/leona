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

import math
import re
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

from majorana_evals.schema import (
    CaseAggregate,
    CaseEvidence,
    CaseResult,
    CorpusCase,
    Expect,
    MetamorphicAggregate,
    Report,
    SliceAggregate,
)


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
        and v >= 0
        for k, v in value.items()
    ) and any(count > 0 for count in value.values())


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


def _recorded_llm_usage(events) -> tuple[int, int, int]:
    """Return calls/input/output recorded on durable ``llm.call`` events.

    This is deliberately named *recorded* usage. Conversation title, routing, or a
    provider request that failed before its response was persisted may still consume
    tokens without producing one of these events, so the result is never presented as
    a provider billing total.
    """

    calls = input_tokens = output_tokens = 0
    for event in events:
        if event.type != "llm.call":
            continue
        calls += 1
        raw_input = event.payload.get("input_tokens")
        raw_output = event.payload.get("output_tokens")
        if isinstance(raw_input, int) and not isinstance(raw_input, bool) and raw_input >= 0:
            input_tokens += raw_input
        if isinstance(raw_output, int) and not isinstance(raw_output, bool) and raw_output >= 0:
            output_tokens += raw_output
    return calls, input_tokens, output_tokens


async def _latest_trusted_execution(
    store: RepoAgentStore,
    run_id: UUID,
    *,
    finalized_source: str | None = None,
    finalized_revision: int | None = None,
):
    """Load the delivered Candidate and its fingerprint-bound execution once.

    A budget-exhausted pipeline may intentionally finalize an earlier, stronger
    candidate after a later repair candidate failed before execution. In that case
    the newest candidate row is not the saved artifact. ``code.finalized`` records
    the delivered source and revision, so eval scoring must follow that durable
    projection instead of silently grading the unfinished tail of the repair loop.
    """

    candidates = await store.list_candidates(run_id)
    if not candidates:
        return None, None
    if finalized_source is None:
        candidate = candidates[-1]
    else:
        matches = [
            candidate
            for candidate in candidates
            if candidate.source == finalized_source
            and (finalized_revision is None or candidate.revision == finalized_revision)
        ]
        if len(matches) != 1:
            raise ValueError("finalized source/revision does not identify exactly one candidate")
        candidate = matches[0]
    execution = await store.execution_for(run_id, candidate.candidate_id)
    if execution is not None and (
        execution.candidate_id != candidate.candidate_id
        or execution.source_fingerprint != candidate.source_fingerprint
    ):
        raise ValueError("latest execution evidence is not bound to the latest candidate")
    return candidate, execution


async def _latest_trusted_result(
    store: RepoAgentStore,
    run_id: UUID,
    *,
    finalized_source: str | None = None,
    finalized_revision: int | None = None,
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Load RESULT from the latest Candidate's fingerprint-bound execution.

    The repository is the authority. A missing execution is an honest absence; a
    stale/mismatched execution is an integrity error and must not be scored.
    """
    candidate, execution = await _latest_trusted_execution(
        store,
        run_id,
        finalized_source=finalized_source,
        finalized_revision=finalized_revision,
    )
    if candidate is None:
        return None, None, None
    if execution is None:
        return None, str(candidate.candidate_id), None
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
            elif not math.isfinite(float(actual)):
                reasons.append(f"RESULT field {key!r} is not finite")
            elif abs(float(actual) - want) > expect.expected_value_tolerance:
                reasons.append(
                    f"RESULT field {key!r} {actual!r} is outside expected {want!r} ± "
                    f"{expect.expected_value_tolerance}"
                )
    if expect.expected_value_ranges:
        for key, expected_range in expect.expected_value_ranges.items():
            actual = result.get(key) if result is not None else None
            if not isinstance(actual, int | float) or isinstance(actual, bool):
                reasons.append(f"expected numeric RESULT field {key!r} was not found")
            elif not math.isfinite(float(actual)):
                reasons.append(f"RESULT field {key!r} is not finite")
            elif not expected_range.minimum <= float(actual) <= expected_range.maximum:
                reasons.append(
                    f"RESULT field {key!r} {actual!r} is outside expected inclusive range "
                    f"[{expected_range.minimum!r}, {expected_range.maximum!r}]"
                )
    for marginal in expect.expected_count_marginals:
        counts = result.get(marginal.result_key) if result is not None else None
        if not _looks_like_counts(counts):
            reasons.append(
                f"expected nonnegative nonempty counts RESULT field {marginal.result_key!r} "
                "was not found"
            )
            continue
        normalized: dict[str, int] = {}
        for key, count in counts.items():
            normalized[key.replace(" ", "")] = normalized.get(key.replace(" ", ""), 0) + count
        widths = {len(key) for key in normalized}
        if len(widths) != 1:
            reasons.append(
                f"counts RESULT field {marginal.result_key!r} has inconsistent key widths"
            )
            continue
        width = widths.pop()
        if any(index >= width for index in marginal.bit_indices):
            reasons.append(
                f"count marginal indices {marginal.bit_indices!r} exceed displayed key width "
                f"{width} in RESULT field {marginal.result_key!r}"
            )
            continue
        total = sum(normalized.values())
        matching = sum(
            count
            for key, count in normalized.items()
            if "".join(key[index] for index in marginal.bit_indices) == marginal.expected_bits
        )
        probability = matching / total
        expected_range = marginal.probability_range
        if not expected_range.minimum <= probability <= expected_range.maximum:
            reasons.append(
                f"counts marginal {marginal.result_key!r}{marginal.bit_indices!r}="
                f"{marginal.expected_bits!r} has probability {probability!r}, outside "
                f"expected inclusive range [{expected_range.minimum!r}, "
                f"{expected_range.maximum!r}]"
            )
    if expect.expected_result_subset:
        reasons.extend(
            _compare_result_subset(
                expect.expected_result_subset,
                result,
                path="RESULT",
                tolerance=expect.expected_value_tolerance,
            )
        )
    if expect.output_keys:
        for key in expect.output_keys:
            if result is None or key not in result:
                reasons.append(f"RESULT missing promised key {key!r}")
    return reasons


_QASM_NON_GATE_STATEMENTS = {
    "openqasm",
    "include",
    "input",
    "output",
    "const",
    "bit",
    "qubit",
    "let",
    "measure",
    "reset",
    "barrier",
    "delay",
    "gphase",
}


def _qasm_gate_names(qasm: str) -> list[str]:
    """Extract executable operation names from simple trusted QASM 3 exports."""

    names: list[str] = []
    for raw_line in qasm.splitlines():
        line = raw_line.split("//", 1)[0].strip()
        if not line:
            continue
        match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\b", line)
        if match is None:
            continue
        name = match.group(1).lower()
        if name not in _QASM_NON_GATE_STATEMENTS:
            names.append(name)
    return names


def _statevector_amplitudes_from_trusted_qasm(
    observation: Mapping[str, object] | None,
) -> list[float] | None:
    """Independently simulate a trusted unitary export for eval scoring only.

    Production verification remains framework-native. The eval harness has a
    different job: determine whether the saved artifact is correct even when the
    bounded execution path intentionally omitted its extra native snapshot. The QASM
    here comes from the fingerprint-bound sandbox epilogue, never from model-authored
    RESULT data. Unsupported or non-unitary exports simply provide no fallback.
    """

    qasm = observation.get("interchange_qasm") if observation is not None else None
    if not isinstance(qasm, str) or not qasm.strip():
        return None
    try:
        from qiskit import qasm3
        from qiskit.quantum_info import Statevector

        circuit = qasm3.loads(qasm)
        circuit = circuit.remove_final_measurements(inplace=False)
        amplitudes: list[float] = []
        for amplitude in Statevector.from_instruction(circuit).data:
            amplitudes.extend((float(amplitude.real), float(amplitude.imag)))
        return amplitudes
    except Exception:
        return None


def _score_artifact_expectations(
    expect: Expect, observation: Mapping[str, object] | None
) -> list[str]:
    """Score fingerprint-bound FINAL_CIRCUIT evidence, never model-authored RESULT claims."""

    reasons: list[str] = []
    if expect.expected_native_statevector is not None:
        payload = observation.get("native_statevector") if observation is not None else None
        amplitudes = payload.get("amplitudes") if isinstance(payload, Mapping) else None
        if not isinstance(amplitudes, list):
            amplitudes = _statevector_amplitudes_from_trusted_qasm(observation)
        expected = [
            complex(real, imaginary) for real, imaginary in expect.expected_native_statevector
        ]
        if not isinstance(amplitudes, list) or len(amplitudes) != 2 * len(expected):
            reasons.append(
                "trusted native statevector evidence is missing or has the wrong dimension"
            )
        elif not all(
            isinstance(value, int | float)
            and not isinstance(value, bool)
            and math.isfinite(float(value))
            for value in amplitudes
        ):
            reasons.append("trusted native statevector contains a non-finite amplitude")
        else:
            observed = [
                complex(float(amplitudes[2 * index]), float(amplitudes[2 * index + 1]))
                for index in range(len(expected))
            ]
            pivot = max(range(len(expected)), key=lambda index: abs(expected[index]))
            if abs(observed[pivot]) <= 1e-15:
                max_error = max(abs(value) for value in expected)
            else:
                phase = observed[pivot] / expected[pivot]
                phase /= abs(phase)
                max_error = max(
                    abs(observed_value - phase * expected_value)
                    for observed_value, expected_value in zip(observed, expected, strict=True)
                )
            if max_error > expect.native_statevector_tolerance:
                reasons.append(
                    "trusted FINAL_CIRCUIT native statevector differs from the independent "
                    f"target by {max_error:.6g} (tolerance "
                    f"{expect.native_statevector_tolerance:.6g}, global phase ignored)"
                )

    if expect.allowed_qasm_gate_names is not None:
        qasm = observation.get("interchange_qasm") if observation is not None else None
        if not isinstance(qasm, str) or not qasm.strip():
            reasons.append("trusted interchange QASM is missing for the gate-basis expectation")
        else:
            allowed = set(expect.allowed_qasm_gate_names)
            observed_names = _qasm_gate_names(qasm)
            forbidden = sorted(set(observed_names) - allowed)
            if forbidden:
                reasons.append(
                    "trusted FINAL_CIRCUIT QASM contains gates outside the allowed basis: "
                    + ", ".join(forbidden)
                )

    if expect.requires_native_optimization is not None:
        optimization = observation.get("native_optimization") if observation is not None else None
        applied = optimization.get("applied") if isinstance(optimization, Mapping) else None
        if type(applied) is not bool:
            reasons.append("trusted native optimization evidence is missing")
        elif applied is not expect.requires_native_optimization:
            reasons.append(
                f"native optimization applied={applied} != expected "
                f"{expect.requires_native_optimization}"
            )
    return reasons


def _compare_result_subset(
    expected: object,
    actual: object,
    *,
    path: str,
    tolerance: float,
) -> list[str]:
    """Recursively compare one JSON-compatible expected subset.

    Expected mappings intentionally allow additional observed keys. Lists remain
    ordered and exact-length because assignments, selected indices, and trajectories
    lose meaning if the scorer silently ignores an item. Boolean values are kept
    separate from Python's integer hierarchy.
    """

    if isinstance(expected, Mapping):
        if not isinstance(actual, Mapping):
            return [f"{path} expected an object, observed {type(actual).__name__}"]
        reasons: list[str] = []
        for key, expected_value in expected.items():
            child_path = f"{path}.{key}"
            if key not in actual:
                reasons.append(f"{child_path} was not found")
                continue
            reasons.extend(
                _compare_result_subset(
                    expected_value,
                    actual[key],
                    path=child_path,
                    tolerance=tolerance,
                )
            )
        return reasons

    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{path} expected a list, observed {type(actual).__name__}"]
        if len(actual) != len(expected):
            return [f"{path} list length {len(actual)} != expected {len(expected)}"]
        reasons = []
        for index, (expected_value, actual_value) in enumerate(zip(expected, actual, strict=True)):
            reasons.extend(
                _compare_result_subset(
                    expected_value,
                    actual_value,
                    path=f"{path}[{index}]",
                    tolerance=tolerance,
                )
            )
        return reasons

    if (
        isinstance(expected, int | float)
        and not isinstance(expected, bool)
        and isinstance(actual, int | float)
        and not isinstance(actual, bool)
    ):
        if abs(float(actual) - float(expected)) <= tolerance:
            return []
        return [f"{path} {actual!r} is outside expected {expected!r} ± {tolerance}"]

    if type(actual) is not type(expected) or actual != expected:
        return [f"{path} {actual!r} != expected {expected!r}"]
    return []


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
    stronger_reference_alignment = (
        expect.terminal_reason == "ai_review_aligned"
        and terminal_reason == "ai_review_aligned_with_reference_check"
    )
    if (
        expect.terminal_reason is not None
        and terminal_reason != expect.terminal_reason
        and not stronger_reference_alignment
    ):
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
    trial: int = 1,
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
    trusted_observation: dict[str, Any] | None = None
    candidate_id: str | None = None
    execution_id: str | None = None
    result_evidence_error: str | None = None
    candidates_considered = 0
    async with factory() as session:
        run = await runs_repo.get_run(scope, session, run_id)
        events = await runs_repo.list_run_events(scope, session, run_id)
        export_event = _latest_export_event(events)
        finalized_source = (
            export_event.payload.get("code")
            if export_event is not None and export_event.type == "code.finalized"
            else None
        )
        finalized_revision = (
            export_event.payload.get("revision")
            if export_event is not None and export_event.type == "code.finalized"
            else None
        )
        store = RepoAgentStore(scope, session)
        candidates_considered = len(await store.list_candidates(run_id))
        try:
            bound_candidate, bound_execution = await _latest_trusted_execution(
                store,
                run_id,
                finalized_source=finalized_source,
                finalized_revision=finalized_revision,
            )
            if bound_candidate is not None:
                candidate_id = str(bound_candidate.candidate_id)
            if bound_execution is not None:
                trusted_result = bound_execution.result
                trusted_observation = bound_execution.observation
                execution_id = str(bound_execution.execution_id)
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
    recorded_llm_calls, recorded_input_tokens, recorded_output_tokens = _recorded_llm_usage(events)
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
        candidates_considered=candidates_considered,
        plans_produced=sum(event.type == "plan.produced" for event in events),
        sandbox_attempts=sum(event.type == "sandbox.result" for event in events),
        semantic_review_attempts=sum(
            event.type == "verification.semantic_review" for event in events
        ),
        recorded_llm_calls=recorded_llm_calls,
        recorded_input_tokens=recorded_input_tokens,
        recorded_output_tokens=recorded_output_tokens,
    )

    expect = case.expect
    # Value-level correctness FIRST: a search/oracle case that recovers a well-formed
    # but wrong bitstring can pass structural checks, so pin the answer before trusting
    # the terminal decision. Only protected RESULT evidence is allowed to influence it.
    result_reasons = _score_result_expectations(expect, trusted_result)
    artifact_reasons = _score_artifact_expectations(expect, trusted_observation)
    reasons.extend(result_reasons)
    reasons.extend(artifact_reasons)
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

    has_oracle = bool(
        expect.expected_values
        or expect.expected_value_ranges
        or expect.expected_count_marginals
        or expect.expected_result_subset
        or expect.expected_native_statevector is not None
        or expect.allowed_qasm_gate_names is not None
        or expect.requires_native_optimization is not None
        or expect.expected_top_bitstring is not None
    )
    oracle_passed = not (result_reasons or artifact_reasons) if has_oracle else None
    product_accepted = run.status == "succeeded" and saved
    passed = not reasons
    observed_values = {
        key: float(value)
        for key in (*expect.expected_values, *expect.expected_value_ranges)
        if trusted_result is not None
        and isinstance((value := trusted_result.get(key)), int | float)
        and not isinstance(value, bool)
    }

    return CaseResult(
        id=case.id,
        category=case.category,
        split=case.split,
        difficulty=case.difficulty,
        workload=case.workload,
        semantic_group_id=case.semantic_group_id,
        prompt_variant=case.prompt_variant,
        trial=trial,
        passed=passed,
        run_status=run.status,
        terminal_reason=terminal_reason,
        verifier_decision=verifier,
        export_status=export_status,
        saved=saved,
        product_accepted=product_accepted,
        oracle_passed=oracle_passed,
        false_positive=product_accepted and oracle_passed is False,
        false_negative=not product_accepted and oracle_passed is True,
        first_candidate_passed=passed and candidates_considered == 1,
        observed_values=observed_values,
        observed_top_bitstring=top_measured_bitstring(trusted_result),
        reasons=reasons,
        evidence=evidence,
    )


def _wilson_interval(successes: int, total: int) -> tuple[float, float]:
    """Two-sided 95% Wilson score interval for a Bernoulli pass rate."""

    if total == 0:
        return 0.0, 0.0
    z = 1.959963984540054
    proportion = successes / total
    denominator = 1 + z**2 / total
    center = (proportion + z**2 / (2 * total)) / denominator
    margin = (
        z * math.sqrt(proportion * (1 - proportion) / total + z**2 / (4 * total**2)) / denominator
    )
    return max(0.0, center - margin), min(1.0, center + margin)


def _slice_aggregates(results: list[CaseResult], attribute: str) -> list[SliceAggregate]:
    grouped: dict[str, list[CaseResult]] = {}
    for result in results:
        grouped.setdefault(str(getattr(result, attribute)), []).append(result)

    aggregates = []
    for name, trials in sorted(grouped.items()):
        candidates = sum(item.evidence.candidates_considered for item in trials)
        passed = sum(item.passed for item in trials)
        aggregates.append(
            SliceAggregate(
                name=name,
                trials=len(trials),
                passed=passed,
                pass_rate=passed / len(trials),
                false_positives=sum(item.false_positive for item in trials),
                false_negatives=sum(item.false_negative for item in trials),
                first_candidate_passed=sum(item.first_candidate_passed for item in trials),
                mean_candidates=candidates / len(trials),
            )
        )
    return aggregates


def _metamorphic_aggregates(
    results: list[CaseResult], *, repetitions: int
) -> list[MetamorphicAggregate]:
    """Pair variants by semantic instance and compare trial-aligned outcomes."""

    grouped: dict[str, list[CaseResult]] = {}
    for result in results:
        if result.semantic_group_id is not None:
            grouped.setdefault(result.semantic_group_id, []).append(result)

    aggregates: list[MetamorphicAggregate] = []
    expected_trials = set(range(1, repetitions + 1))
    for semantic_group_id, observations in sorted(grouped.items()):
        variants = sorted({item.prompt_variant for item in observations if item.prompt_variant})
        if len(variants) < 2:
            continue

        by_variant = {
            variant: [item for item in observations if item.prompt_variant == variant]
            for variant in variants
        }
        observed_pairs = [(item.prompt_variant, item.trial) for item in observations]
        trial_matrix_complete = len(observed_pairs) == len(set(observed_pairs)) and all(
            {item.trial for item in variant_observations} == expected_trials
            for variant_observations in by_variant.values()
        )
        passed = sum(item.passed for item in observations)
        outcome_consistent = trial_matrix_complete and all(
            len(
                {
                    item.passed
                    for item in observations
                    if item.trial == trial and item.prompt_variant in variants
                }
            )
            == 1
            for trial in expected_trials
        )
        aggregates.append(
            MetamorphicAggregate(
                semantic_group_id=semantic_group_id,
                variants=len(variants),
                observations=len(observations),
                passed=passed,
                pass_rate=passed / len(observations),
                trial_matrix_complete=trial_matrix_complete,
                all_variants_passed=trial_matrix_complete
                and all(item.passed for item in observations),
                outcome_consistent=outcome_consistent,
                variant_pass_rates={
                    variant: sum(item.passed for item in variant_observations)
                    / len(variant_observations)
                    for variant, variant_observations in by_variant.items()
                },
                mean_candidates=sum(item.evidence.candidates_considered for item in observations)
                / len(observations),
            )
        )
    return aggregates


def summarize_results(
    results: list[CaseResult],
    *,
    unique_cases: int,
    repetitions: int,
    note: str | None = None,
) -> Report:
    """Aggregate trial-level results without hiding stochastic instability."""

    by_id: dict[str, list[CaseResult]] = {}
    for result in results:
        by_id.setdefault(result.id, []).append(result)

    by_case: list[CaseAggregate] = []
    for case_id, trials in sorted(by_id.items()):
        candidate_revisions = sum(item.evidence.candidates_considered for item in trials)
        oracle_trials = sum(item.oracle_passed is not None for item in trials)
        by_case.append(
            CaseAggregate(
                id=case_id,
                category=trials[0].category,
                split=trials[0].split,
                difficulty=trials[0].difficulty,
                workload=trials[0].workload,
                trials=len(trials),
                passed=sum(item.passed for item in trials),
                pass_rate=sum(item.passed for item in trials) / len(trials),
                product_accepted=sum(item.product_accepted for item in trials),
                oracle_trials=oracle_trials,
                oracle_passed=sum(item.oracle_passed is True for item in trials),
                false_positives=sum(item.false_positive for item in trials),
                false_negatives=sum(item.false_negative for item in trials),
                first_candidate_passed=sum(item.first_candidate_passed for item in trials),
                mean_candidates=candidate_revisions / len(trials),
            )
        )

    total = len(results)
    passed = sum(result.passed for result in results)
    candidate_revisions = sum(result.evidence.candidates_considered for result in results)
    ci_low, ci_high = _wilson_interval(passed, total)
    by_semantic_group = _metamorphic_aggregates(results, repetitions=repetitions)
    robust_groups = sum(item.all_variants_passed for item in by_semantic_group)
    consistent_groups = sum(item.outcome_consistent for item in by_semantic_group)
    metamorphic_groups = len(by_semantic_group)
    variant_results = [result for result in results if result.prompt_variant is not None]
    return Report(
        total=total,
        passed=passed,
        pass_rate=(passed / total if total else 0.0),
        pass_rate_ci95_low=ci_low,
        pass_rate_ci95_high=ci_high,
        unique_cases=unique_cases,
        stable_passed_cases=sum(item.passed == item.trials for item in by_case),
        repetitions=repetitions,
        product_accepted=sum(result.product_accepted for result in results),
        oracle_cases=sum(result.oracle_passed is not None for result in results),
        oracle_passed=sum(result.oracle_passed is True for result in results),
        false_positives=sum(result.false_positive for result in results),
        false_negatives=sum(result.false_negative for result in results),
        first_candidate_passed=sum(result.first_candidate_passed for result in results),
        candidate_revisions=candidate_revisions,
        mean_candidates=(candidate_revisions / total if total else 0.0),
        recorded_llm_calls=sum(result.evidence.recorded_llm_calls for result in results),
        recorded_input_tokens=sum(result.evidence.recorded_input_tokens for result in results),
        recorded_output_tokens=sum(result.evidence.recorded_output_tokens for result in results),
        cases=results,
        by_case=by_case,
        by_difficulty=_slice_aggregates(results, "difficulty"),
        by_workload=_slice_aggregates(results, "workload"),
        metamorphic_groups=metamorphic_groups,
        metamorphic_robust_groups=robust_groups,
        metamorphic_consistent_groups=consistent_groups,
        metamorphic_robustness=(robust_groups / metamorphic_groups if metamorphic_groups else 0.0),
        metamorphic_consistency=(
            consistent_groups / metamorphic_groups if metamorphic_groups else 0.0
        ),
        by_semantic_group=by_semantic_group,
        by_prompt_variant=_slice_aggregates(variant_results, "prompt_variant"),
        note=note,
    )


async def run_corpus(
    cases: list[CorpusCase],
    *,
    factory,
    scope: Scope,
    llm: LLMClient,
    sandbox: Sandbox,
    repetitions: int = 1,
    note: str | None = None,
) -> Report:
    if repetitions < 1:
        raise ValueError("repetitions must be at least 1")
    results = []
    for trial in range(1, repetitions + 1):
        for case in cases:
            results.append(
                await run_case(
                    case,
                    factory=factory,
                    scope=scope,
                    llm=llm,
                    sandbox=sandbox,
                    trial=trial,
                )
            )
    return summarize_results(
        results,
        unique_cases=len(cases),
        repetitions=repetitions,
        note=note,
    )
