from uuid import uuid4

import pytest
from majorana_agent import CandidateRevision
from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram
from pydantic import ValidationError


def test_candidate_binds_framework_source_to_fingerprint():
    run_id, plan_id = uuid4(), uuid4()
    source = "from qiskit import QuantumCircuit\nFINAL_CIRCUIT = QuantumCircuit(1)\n"
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="simulate-1",
        revision=1,
        plan_id=plan_id,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )
    assert candidate.source_fingerprint == FrameworkProgram(Framework.QISKIT, source).fingerprint


def test_candidate_rejects_fingerprint_from_different_source():
    source = "FINAL_CIRCUIT = object()\n"
    with pytest.raises(ValidationError, match="fingerprint"):
        CandidateRevision(
            candidate_id=uuid4(),
            run_id=uuid4(),
            tool_call_id="simulate-1",
            revision=1,
            plan_id=uuid4(),
            framework=Framework.CIRQ,
            source=source,
            source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
        )
