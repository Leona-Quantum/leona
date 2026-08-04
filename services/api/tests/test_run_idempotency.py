"""A reused Idempotency-Key must describe the same request (routes/runs.py).

`0002` gave POST /v1/runs a key and a partial unique index, but nothing recorded
WHAT was submitted under it — so a second, different body got the first run back
under a 201 that said it had just been created. The refusal lives in a pure
function so it can be tested at the boundary that decides, rather than inferred
from a route that happens to call it.
"""

import uuid

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode

from majorana_api.orm import Run as RunRow
from majorana_api.routes.runs import (
    CreateRunRequest,
    _assert_same_request,
    _idempotency_request_hash,
)


def _body(**overrides) -> CreateRunRequest:
    base = dict(task_prompt="bell state on 2 qubits")
    base.update(overrides)
    return CreateRunRequest(**base)


def _stored(request_hash: str | None) -> RunRow:
    return RunRow(idempotency_key="k", idempotency_request_hash=request_hash)


# --------------------------------------------------------------------------
# The fingerprint
# --------------------------------------------------------------------------


def test_the_same_request_hashes_the_same():
    assert _idempotency_request_hash(_body()) == _idempotency_request_hash(_body())


@pytest.mark.parametrize(
    "field,value",
    [
        ("task_prompt", "something else entirely"),
        ("mode", RunMode.EXECUTE),
        ("framework", Framework.CIRQ),
        ("seed", 7),
        ("shots", 512),
        ("timeout_s", 42),
        ("conversation_id", uuid.uuid4()),
    ],
)
def test_every_field_moves_the_fingerprint(field, value):
    """A hand-listed subset is how a field added later goes uncovered, and the
    failure of forgetting one — two different requests hashing alike — is silent."""
    assert _idempotency_request_hash(_body(**{field: value})) != _idempotency_request_hash(_body())


def test_source_code_moves_the_fingerprint():
    """The field that forced a stored hash rather than a comparison against the
    Run's own columns: `source_code` is never a column. Two submissions differing
    only in the code to run are indistinguishable from the row."""
    a = _idempotency_request_hash(_body(source_code="print(1)"))
    b = _idempotency_request_hash(_body(source_code="import os; os.system('id')"))
    assert a != b


# --------------------------------------------------------------------------
# The refusal
# --------------------------------------------------------------------------


def test_a_genuine_retry_is_allowed_through():
    body = _body()
    _assert_same_request(_stored(_idempotency_request_hash(body)), _idempotency_request_hash(body))


def test_a_different_body_under_the_same_key_is_refused():
    stored = _stored(_idempotency_request_hash(_body()))
    with pytest.raises(HTTPException) as refused:
        _assert_same_request(
            stored, _idempotency_request_hash(_body(task_prompt="a different ask"))
        )

    assert refused.value.status_code == 409
    assert refused.value.detail["reason"] == "idempotency_key_reused"


def test_a_row_predating_the_migration_cannot_be_compared_and_is_not_refused():
    """NULL means "no recorded request", not "a request that differs". Refusing
    on missing data would invent a conflict the row cannot support."""
    _assert_same_request(_stored(None), _idempotency_request_hash(_body()))
