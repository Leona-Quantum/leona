import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_contracts import (
    EvidenceStrength,
    ExportStatus,
    Framework,
    RunFinished,
    RunMode,
    RunQueued,
    RunStatus,
    Stage,
    VerificationMethod,
    VerificationResultKind,
    VerificationSummary,
    run_event_adapter,
)

ENVELOPE = {"run_id": str(uuid4()), "seq": 0, "ts": "2026-07-10T00:00:00Z"}


def test_discriminator_dispatch():
    event = run_event_adapter.validate_python(
        {**ENVELOPE, "type": "run.queued", "mode": "execute", "framework": "qiskit"}
    )
    assert isinstance(event, RunQueued)
    assert event.mode is RunMode.EXECUTE
    assert event.framework is Framework.QISKIT


def test_unknown_type_rejected():
    with pytest.raises(ValidationError):
        run_event_adapter.validate_python({**ENVELOPE, "type": "run.exploded"})


def test_negative_seq_rejected():
    with pytest.raises(ValidationError):
        run_event_adapter.validate_python({**ENVELOPE, "seq": -1, "type": "run.started"})


def test_extra_fields_rejected():
    with pytest.raises(ValidationError):
        run_event_adapter.validate_python({**ENVELOPE, "type": "run.started", "surprise": True})


def test_json_round_trip():
    original = RunFinished(
        run_id=uuid4(),
        seq=14,
        ts=datetime.now(UTC),
        status=RunStatus.SUCCEEDED,
        verifier_decision="pass",
    )
    wire = original.model_dump_json()
    revived = run_event_adapter.validate_json(wire)
    assert revived == original


def test_run_finished_carries_what_the_verdict_was_proved_by():
    """The worker emits this key on every published run; the sink validates against
    this schema, so a missing field here means the emit raises in production."""
    wire = RunFinished(
        run_id=uuid4(),
        seq=14,
        ts=datetime.now(UTC),
        status=RunStatus.SUCCEEDED,
        verifier_decision="pass",
        evidence_strength="structural",
    ).model_dump_json()
    revived = run_event_adapter.validate_json(wire)
    assert revived.evidence_strength is EvidenceStrength.STRUCTURAL


def test_run_finished_evidence_strength_is_optional_for_replayed_history():
    """Runs finished before 2026-07-20 have no such key in the events table."""
    revived = run_event_adapter.validate_python(
        {**ENVELOPE, "type": "run.finished", "status": "succeeded", "verifier_decision": "pass"}
    )
    assert revived.evidence_strength is None


def test_run_finished_typed_summary_round_trips():
    summary = VerificationSummary(
        decision="inconclusive",
        evidence_strength="structural",
        reason_code="required_check_unavailable",
        candidate_defect_observed=False,
        failure_class="capability_limit",
        retry_target="none",
        unverified_claims=["dynamic-circuit behavior"],
    )
    original = RunFinished(
        run_id=uuid4(),
        seq=15,
        ts=datetime.now(UTC),
        status="succeeded",
        verifier_decision="inconclusive",
        verification_summary=summary,
    )
    revived = run_event_adapter.validate_json(original.model_dump_json())
    assert revived == original


def test_chat_completed_readiness_gate_clarification_payload_validates():
    """Regression for the 2026-08-15 production incident: the worker's readiness
    gate (`_finish_missing_inputs_clarification`) emits exactly this shape when a
    task-specific input is missing from the prompt, and `apps/web`'s live-run view
    already reads both extra fields to render the bullet list and the "proceed
    anyway" action (added by #485). The contract was never updated to match, so
    `extra="forbid"` on `_EventBase` rejected the payload with `2 validation
    errors ... extra_forbidden` on every real occurrence, and the worker's own
    test for this path used a fake sink that never called this validator, so
    nothing caught it before it reached a live run."""
    event = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "chat.completed",
            "text": "I need the following task-specific inputs before generating "
            "the quantum circuit:\n\n- Molecule identity",
            "missing_inputs": ["Molecule identity", "basis set", "acceptable accuracy"],
            "allow_ai_assumptions_available": True,
            "model": "majorana-readiness-gate",
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_ms": 0,
        }
    )
    assert event.missing_inputs == ["Molecule identity", "basis set", "acceptable accuracy"]
    assert event.allow_ai_assumptions_available is True


def test_chat_completed_missing_inputs_fields_are_optional_for_ordinary_chat():
    """An ordinary chat turn carries neither field; both must default rather than
    become required, or every non-clarification `chat.completed` breaks instead."""
    event = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "chat.completed",
            "text": "Sure, here's how Execute mode works.",
            "model": "deepseek-chat",
            "input_tokens": 12,
            "output_tokens": 40,
            "duration_ms": 900,
        }
    )
    assert event.missing_inputs is None
    assert event.allow_ai_assumptions_available is False


def test_historical_exact_event_remains_parseable():
    event = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "verification.result",
            "method": "exact",
            "result": "pass",
        }
    )
    assert event.method is VerificationMethod.EXACT


@pytest.mark.parametrize("result", ["unavailable", "error"])
def test_new_check_outcomes_round_trip(result):
    event = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "verification.result",
            "method": "statistical",
            "result": result,
        }
    )
    revived = run_event_adapter.validate_json(event.model_dump_json())
    assert revived.result is VerificationResultKind(result)


def test_semantic_and_strict_audit_events_round_trip():
    candidate_id = uuid4()
    execution_id = uuid4()
    review_id = uuid4()
    semantic = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "verification.semantic_review",
            "review_id": str(review_id),
            "candidate_id": str(candidate_id),
            "execution_id": str(execution_id),
            "attempt_seq": 1,
            "source_fingerprint": "a" * 64,
            "decision": "inconclusive",
            "reason_code": "semantic_evidence_gap",
            "failure_class": "evidence_gap",
            "retry_target": "verification",
        }
    )
    strict = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "verification.strict_attempt",
            "attempt_id": str(uuid4()),
            "candidate_id": str(candidate_id),
            "execution_id": str(execution_id),
            "semantic_review_id": str(review_id),
            "attempt_seq": 2,
            "source_fingerprint": "a" * 64,
            "decision": "inconclusive",
            "evidence_strength": "structural",
            "reason_code": "strict_verifier_error",
            "candidate_defect_observed": False,
            "failure_class": "verifier_failure",
            "retry_target": "verification",
            "verifier_version": "verification-v2",
        }
    )
    assert run_event_adapter.validate_json(semantic.model_dump_json()) == semantic
    assert run_event_adapter.validate_json(strict.model_dump_json()) == strict


def test_unknown_verification_method_is_rejected_instead_of_dropped():
    with pytest.raises(ValidationError):
        run_event_adapter.validate_python(
            {
                **ENVELOPE,
                "type": "verification.result",
                "method": "unregistered_check",
                "result": "error",
            }
        )


def test_failed_terminal_event_carries_machine_readable_reason():
    event = run_event_adapter.validate_python(
        {
            **ENVELOPE,
            "type": "run.finished",
            "status": "failed",
            "reason_code": "candidate_budget_exhausted",
        }
    )
    assert event.reason_code == "candidate_budget_exhausted"


def test_every_event_type_round_trips():
    samples = [
        {"type": "run.queued", "mode": "execute", "framework": "qiskit"},
        {"type": "run.started"},
        {"type": "stage.started", "stage": "plan"},
        {"type": "stage.finished", "stage": "plan", "ok": True, "duration_ms": 120},
        {
            "type": "research.completed",
            "query": "H2 ground state energy",
            "sources": [
                {
                    "title": "Reference note",
                    "url": "https://example.com/h2",
                    "excerpt": "A bounded source excerpt.",
                }
            ],
        },
        {
            "type": "llm.call",
            "stage": "generate",
            "model": "example-model",
            "input_tokens": 100,
            "output_tokens": 50,
            "duration_ms": 900,
        },
        {"type": "llm.delta", "stage": "generate", "text": "qc = QuantumCircuit(2)"},
        {"type": "code.generated", "language": "python", "code": "print(1)", "revision": 1},
        {"type": "screen.result", "lint_ok": True, "typecheck_ok": True},
        {
            "type": "resource.estimate",
            "phase": "pre_verify",
            "source": "plan_static",
            "metrics": {"qubits": 2},
        },
        {
            "type": "sandbox.result",
            "phase": "verification",
            "exit_code": 0,
            "duration_ms": 1500,
            "stdout": "{}",
            "stderr": "",
        },
        {
            "type": "verification.result",
            "method": VerificationMethod.EXACT.value,
            "result": VerificationResultKind.PASS.value,
        },
        {
            "type": "compilation.result",
            "accepted": False,
            "mode": "unchanged",
            "compatibility": {},
        },
        {
            "type": "resource.estimate",
            "phase": "compiled",
            "source": "compiler",
            "metrics": {"qubits": 2, "depth": 1},
        },
        {
            "type": "code.finalized",
            "language": "qiskit",
            "code": "print(1)",
            "revision": 1,
            "compilation_applied": False,
            "simulation_plausible": True,
            "qpu_available": False,
            "execution_options": ["simulate"],
            "export_status": "lossless",
        },
        {"type": "baseline.result", "kind": "maxcut", "result": {"cut": 4}},
        {
            "type": "run.analysis",
            "summary": "summary",
            "interpretation": "interpretation",
            "results": {"counts": {"00": 1}},
        },
        {
            "type": "run.diagnosed",
            "failed_stage": "verify",
            "restart_from": "generate",
            "code": "verification_failed",
            "message": "retry",
            "attempt": 1,
        },
        {"type": "run.restarted", "from_stage": "generate", "attempt": 1, "reason": "retry"},
        {
            "type": "export.classified",
            "status": ExportStatus.LOSSLESS.value,
            "qasm_available": True,
        },
        {
            "type": "artifact.saved",
            "artifact_id": str(uuid4()),
            "version_id": str(uuid4()),
            "version_seq": 1,
        },
        {"type": "run.error", "code": "sandbox_timeout", "message": "exceeded 120s"},
        {"type": "run.finished", "status": "failed"},
    ]
    for i, payload in enumerate(samples):
        event = run_event_adapter.validate_python({**ENVELOPE, "seq": i, **payload})
        wire = json.loads(event.model_dump_json())
        assert run_event_adapter.validate_python(wire) == event


def test_lossy_export_requires_reason():
    lossy = {
        **ENVELOPE,
        "type": "export.classified",
        "status": "lossy_with_reason",
        "qasm_available": False,
    }
    with pytest.raises(ValidationError):
        run_event_adapter.validate_python(lossy)
    event = run_event_adapter.validate_python({**lossy, "reason": "mid-circuit reset dropped"})
    assert event.reason == "mid-circuit reset dropped"


def test_legacy_stage_values_remain_parseable_for_stored_events():
    for raw in ("plan", "save", "simulate", "export"):
        assert Stage(raw).value == raw
