"""`CheckProperty` and the check-cell rules on `Cell`: each kind takes exactly its own
expectation fields, and every refusal is a message a reader can act on."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from majorana_contracts.notebooks import (
    CHECK_DEFAULT_TOLERANCE,
    Cell,
    CellResult,
    CheckProperty,
    CheckVerdict,
    ExecutionReport,
)


def test_each_kind_accepts_its_own_expectation_and_fills_the_default_tolerance() -> None:
    cases = [
        {"kind": "state", "subject": "bell", "reference": "bell"},
        {
            "kind": "state",
            "subject": "qc",
            "amplitudes": {"00": "1/sqrt(2)", "11": 0.7071067811865476},
        },
        {"kind": "state", "subject": "qc", "reference_qasm": "OPENQASM 3.0;\nqubit[1] q;\nh q[0];"},
        {"kind": "unitary", "subject": "qft", "reference": "qft(3)"},
        {"kind": "unitary", "subject": "qc", "reference": "iqft(12)"},
        {"kind": "distribution", "subject": "qc", "probabilities": {"0": 0.5, "1": "1/2"}},
        {
            "kind": "energy",
            "subject": "ansatz",
            "hamiltonian": {"ZZ": 1.0, "XI": 0.5},
            "target": "ground",
        },
        {"kind": "energy", "subject": "ansatz", "hamiltonian": {"Z": 1.0}, "target": -1},
        {"kind": "value", "subject": "p", "value": 0.5},
        {"kind": "value", "subject": "p", "value": [0.5, 0.5]},
    ]
    for case in cases:
        prop = CheckProperty.model_validate(case)
        assert prop.tolerance == CHECK_DEFAULT_TOLERANCE[prop.kind], case
        assert prop.author == "nala" and prop.accepted is False, "defaults are the least trusted"


@pytest.mark.parametrize(
    ("payload", "needle"),
    [
        ({"kind": "state", "subject": "qc"}, "exactly one of"),
        (
            {"kind": "state", "subject": "qc", "reference": "bell", "amplitudes": {"0": 1}},
            "exactly one of",
        ),
        ({"kind": "state", "subject": "qc", "reference": "bell", "value": 1}, "does not take"),
        ({"kind": "unitary", "subject": "qc", "amplitudes": {"0": 1}}, "exactly one of"),
        ({"kind": "distribution", "subject": "qc"}, "needs ['probabilities']"),
        ({"kind": "energy", "subject": "qc", "hamiltonian": {"Z": 1.0}}, "needs ['target']"),
        ({"kind": "value", "subject": "qc", "value": 1, "target": "ground"}, "does not take"),
        # the library grammar, per kind
        ({"kind": "state", "subject": "qc", "reference": "qft(3)"}, "not a library reference"),
        ({"kind": "unitary", "subject": "qc", "reference": "bell"}, "not a library reference"),
        ({"kind": "state", "subject": "qc", "reference": "ghz(25)"}, "not a library reference"),
        ({"kind": "unitary", "subject": "qc", "reference": "qft(13)"}, "not a library reference"),
        ({"kind": "state", "subject": "qc", "reference": "ghz(0)"}, "not a library reference"),
        # subject
        ({"kind": "value", "subject": "1x", "value": 1}, "Python variable name"),
        ({"kind": "value", "subject": "qc.data", "value": 1}, "Python variable name"),
        ({"kind": "value", "subject": "class", "value": 1}, "Python variable name"),
        # bitstrings
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": 1, "11": 0}}, "same length"),
        ({"kind": "state", "subject": "qc", "amplitudes": {"0a": 1}}, "0s and 1s"),
        (
            {"kind": "distribution", "subject": "qc", "probabilities": {"0": -0.5, "1": 1.5}},
            "negative",
        ),
        # expressions are refused when written, not only when evaluated
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": "__import__('os')"}}, "Call"),
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": "x.real"}}, "Attribute"),
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": "abs(1)"}}, "Call"),
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": "sqrt(2, 3)"}}, "Call"),
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": "[1][0]"}}, "Subscript"),
        ({"kind": "state", "subject": "qc", "amplitudes": {"0": "1 +"}}, "does not parse"),
        # Pauli strings
        (
            {"kind": "energy", "subject": "qc", "hamiltonian": {"ZA": 1.0}, "target": "ground"},
            "I, X, Y, Z",
        ),
        (
            {
                "kind": "energy",
                "subject": "qc",
                "hamiltonian": {"Z": 1.0, "ZZ": 1.0},
                "target": "ground",
            },
            "same number",
        ),
        (
            {"kind": "energy", "subject": "qc", "hamiltonian": {"Z" * 11: 1.0}, "target": "ground"},
            "at most 10",
        ),
        # a tolerance that makes the check unable to fail
        ({"kind": "state", "subject": "qc", "reference": "bell", "tolerance": 1.0}, "cannot fail"),
        (
            {"kind": "distribution", "subject": "qc", "probabilities": {"0": 1}, "tolerance": 1},
            "cannot fail",
        ),
        # provenance
        ({"kind": "value", "subject": "p", "value": 1, "author": "source"}, "needs a citation"),
        ({"kind": "value", "subject": "p", "value": 1, "statement": "two\nlines"}, "one line"),
    ],
)
def test_malformed_properties_are_refused_with_a_reason(payload: dict, needle: str) -> None:
    with pytest.raises(ValidationError) as caught:
        CheckProperty.model_validate(payload)
    assert needle in str(caught.value), str(caught.value)


def test_a_check_cell_needs_its_property_and_no_other_cell_may_carry_one() -> None:
    prop = CheckProperty(kind="value", subject="p", value=1)
    Cell(id="k1", kind="code", role="check", property=prop)
    with pytest.raises(ValidationError, match="needs a property"):
        Cell(id="k1", kind="code", role="check")
    with pytest.raises(ValidationError, match="only role=check cells carry a property"):
        Cell(id="k1", kind="code", role="run", property=prop)
    with pytest.raises(ValidationError, match="must be a code cell"):
        Cell(id="k1", kind="markdown", role="check", property=prop)
    with pytest.raises(ValidationError, match="no stub or grader"):
        Cell(id="k1", kind="code", role="check", property=prop, check="assert True", stub="x")


def test_cell_check_and_cell_property_are_different_fields() -> None:
    """The names collide; the fields must not. `check` is the exercise grader (Python
    that runs in the sandbox), `property` is data the sandbox never runs."""
    fields = Cell.model_fields
    assert "check" in fields and "property" in fields
    assert fields["check"].annotation != fields["property"].annotation
    # and the computed attributes still work despite the field shadowing `property`
    cell = Cell(id="c1", kind="code", source="x = 1\n")
    assert cell.is_code and cell.runs_in_sandbox and not cell.may_raise and not cell.is_graded


def test_every_stored_report_still_parses_and_a_verdict_rides_on_cell_result() -> None:
    old = {
        "notebook_slug": "s",
        "ok": True,
        "runner": "sandbox",
        "cells": [{"id": "c1", "status": "ok"}],
    }
    report = ExecutionReport.model_validate(old)
    assert report.cells[0].check is None
    verdict = CheckVerdict(status="inconclusive", basis="value", detail="not run")
    result = CellResult(id="k1", status="ok", check=verdict)
    assert CellResult.model_validate(result.model_dump(mode="json")) == result
    with pytest.raises(ValidationError):
        CheckVerdict(status="verified", basis="circuit")  # type: ignore[arg-type]


def test_expectation_key_ignores_who_wrote_it_and_whether_it_was_accepted() -> None:
    a = CheckProperty(kind="value", subject="p", value=1, author="nala", accepted=False)
    b = a.model_copy(update={"author": "user", "accepted": True})
    c = a.model_copy(update={"value": 2.0})
    assert a.expectation_key() == b.expectation_key()
    assert a.expectation_key() != c.expectation_key()
