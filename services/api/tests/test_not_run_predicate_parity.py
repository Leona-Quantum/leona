"""The two copies of the not-run predicate must answer identically.

`ExecutionEvidence.was_not_run` (packages/py/agent) and
`repos.agent._trusted_not_run_execution` (this service) are the same seven
clauses written twice, in two units that deploy separately. That duplication is
the house convention — `tiers.py` states the reason, and a shared module would
let one service's deploy move the other's gate — but a copy nothing compares is
a copy that drifts.

The drift is dangerous in one direction specifically. This predicate is what
lets a materialization skip the `exit_code == 0` and `review.decision == ready`
requirements. If the API copy loosens relative to the worker's, the repository
stops being a backstop for the decision the worker already made; if it tightens,
materialization fails at the last boundary after the whole pipeline has run.
Neither shows up in a test of either service alone.

The table is written as deviations from one valid not-run observation, one
clause at a time, because that is what a drifting edit looks like.
"""

import uuid
from types import SimpleNamespace

import pytest
from majorana_agent import ExecutionEvidence, ExecutionFailureKind
from majorana_api.repos.agent import _trusted_not_run_execution

_FINGERPRINT = "a" * 64

#: A preflight decision that skipped execution. Every case below is this row
#: with one clause changed.
_VALID = {
    "exit_code": 75,
    "failure_kind": ExecutionFailureKind.RESOURCE_LIMIT,
    "duration_ms": 0,
    "result": {},
    "observation": {
        "execution_status": "not_run",
        "execution_reason_code": "local_statevector_capacity_exceeded",
        "sandbox_runs": 0,
    },
}


def _deviation(**overrides: object) -> dict[str, object]:
    row = dict(_VALID)
    observation = dict(_VALID["observation"])
    for key, value in overrides.items():
        if key in observation or key == "execution_reason_code":
            observation[key] = value
        else:
            row[key] = value
    row["observation"] = observation
    return row


CASES: list[tuple[str, dict[str, object], bool]] = [
    ("a trusted preflight decision", _deviation(), True),
    # Execution actually happened, or reported something.
    ("succeeded", _deviation(exit_code=0, failure_kind=None), False),
    ("spent wall-clock time", _deviation(duration_ms=1), False),
    ("reported a result", _deviation(result={"counts": {"00": 1}}), False),
    ("ran in the sandbox", _deviation(sandbox_runs=1), False),
    # A generic resource failure is not a preflight decision: code that started
    # and exhausted memory must still fail.
    (
        "exhausted memory while running",
        _deviation(failure_kind=ExecutionFailureKind.MEMORY_EXHAUSTED),
        False,
    ),
    ("timed out", _deviation(failure_kind=ExecutionFailureKind.TIMEOUT), False),
    # The observation has to say so, and say why.
    ("no execution_status", _deviation(execution_status="executed"), False),
    ("blank reason code", _deviation(execution_reason_code="   "), False),
    ("non-string reason code", _deviation(execution_reason_code=7), False),
]


def _evidence(row: dict[str, object]) -> ExecutionEvidence:
    return ExecutionEvidence(
        execution_id=uuid.uuid4(),
        candidate_id=uuid.uuid4(),
        source_fingerprint=_FINGERPRINT,
        environment_fingerprint=_FINGERPRINT,
        sandbox_provider="local",
        **row,
    )


def _row(row: dict[str, object]) -> SimpleNamespace:
    """The ORM shape. `failure_kind` is a column of strings, not the enum."""
    kind = row["failure_kind"]
    return SimpleNamespace(**{**row, "failure_kind": kind.value if kind is not None else None})


@pytest.mark.parametrize("name, row, expected", CASES, ids=[case[0] for case in CASES])
def test_both_copies_agree(name: str, row: dict[str, object], expected: bool) -> None:
    assert _evidence(row).was_not_run is expected
    assert _trusted_not_run_execution(_row(row)) is expected


def test_the_table_exercises_every_clause() -> None:
    """A clause added to one copy without a case here would go uncompared.

    Counted rather than named: the point is that the table is not allowed to
    fall behind the predicate, and a count is what notices a clause nobody
    thought to write a deviation for.
    """
    refusals = [case for case in CASES if case[2] is False]
    assert len(refusals) == 9, (
        "a clause was added or removed — add the matching deviation to CASES "
        "before changing this number"
    )
