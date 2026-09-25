"""`CircuitCheckRequest`/`CircuitCheckResponse`: the body and answer of POST /v1/checks/circuit."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from majorana_contracts import (
    MAX_CIRCUIT_CHECK_QASM_CHARS,
    CheckVerdict,
    CircuitCheckRequest,
    CircuitCheckResponse,
)

_BELL = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n'


def test_a_request_carries_a_circuit_and_a_property_with_its_default_tolerance() -> None:
    request = CircuitCheckRequest.model_validate(
        {"qasm": _BELL, "property": {"kind": "state", "subject": "circuit", "reference": "bell"}}
    )
    assert request.property.kind == "state"
    # The property's own validation still runs inside the request: the default is filled.
    assert request.property.tolerance == 1e-6


def test_the_circuit_is_bounded_at_the_notebook_capture_ceiling() -> None:
    prop = {"kind": "state", "subject": "circuit", "reference": "bell"}
    at_cap = "x" * MAX_CIRCUIT_CHECK_QASM_CHARS
    assert CircuitCheckRequest(qasm=at_cap, property=prop).qasm == at_cap
    with pytest.raises(ValidationError):
        CircuitCheckRequest(qasm=at_cap + "x", property=prop)
    with pytest.raises(ValidationError):
        CircuitCheckRequest(qasm="", property=prop)


def test_a_malformed_property_is_refused_by_the_property_rules() -> None:
    # Two expectations for a state check: CheckProperty's own rule, reached through the body.
    with pytest.raises(ValidationError, match="exactly one of"):
        CircuitCheckRequest.model_validate(
            {
                "qasm": _BELL,
                "property": {
                    "kind": "state",
                    "subject": "circuit",
                    "reference": "bell",
                    "amplitudes": {"00": 1},
                },
            }
        )


def test_unknown_fields_are_refused() -> None:
    with pytest.raises(ValidationError):
        CircuitCheckRequest.model_validate(
            {
                "qasm": _BELL,
                "property": {"kind": "state", "subject": "circuit", "reference": "bell"},
                "shots": 100,
            }
        )


def test_the_response_wraps_one_verdict() -> None:
    verdict = CheckVerdict(status="inconclusive", basis="circuit", detail="too wide")
    assert CircuitCheckResponse(verdict=verdict).verdict.status == "inconclusive"
