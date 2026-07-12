import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_contracts import (
    ExportStatus,
    Framework,
    RunFinished,
    RunMode,
    RunQueued,
    RunStatus,
    Stage,
    VerificationMethod,
    VerificationResultKind,
    run_event_adapter,
)
from majorana_pipeline import STAGE_ORDER

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


def test_every_event_type_round_trips():
    samples = [
        {"type": "run.queued", "mode": "execute", "framework": "qiskit"},
        {"type": "run.started"},
        {"type": "stage.started", "stage": "plan"},
        {"type": "stage.finished", "stage": "plan", "ok": True, "duration_ms": 120},
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


def test_stage_enum_covers_pipeline_order():
    assert [s.value for s in STAGE_ORDER] == [
        "plan",
        "generate",
        "screen",
        "resource_estimate",
        "verify",
        "compile",
        "compiled_resource_estimate",
        "finalize",
        "final_execute",
        "baseline",
        "analyze",
        "save",
    ]
    assert Stage.SIMULATE.value == "simulate"
    assert Stage.EXPORT.value == "export"
