"""The pre-dispatch caps in `ExecutionSpec` are bounds in BOTH directions.

`05-security.md` §1 lists "hard timeout <=120 s, memory cap per plan tier" among
the sandbox-lane controls. The timeout had `le=MAX_TIMEOUT_S` and the memory
field had only `ge=64` — a floor where the gate claimed a ceiling, so the stated
control existed in the direction that cannot hurt and not in the direction that
can.

Nothing reachable exercises this today: the worker builds every `ExecutionSpec`
and no code path sets `memory_mb`, so every spec in the product takes the
default. These tests pin the bound so that stays true by construction rather
than by nobody having written the line yet.
"""

import pytest
from pydantic import ValidationError

from majorana_sandbox.spec import (
    DEFAULT_MEMORY_MB,
    DEFAULT_QUBIT_CEILING,
    MAX_MEMORY_MB,
    MAX_TIMEOUT_S,
    ExecutionSpec,
)


def test_the_default_spec_is_inside_every_cap():
    spec = ExecutionSpec(code="pass")
    assert spec.timeout_s <= MAX_TIMEOUT_S
    assert spec.memory_mb == DEFAULT_MEMORY_MB <= MAX_MEMORY_MB
    assert spec.qubit_ceiling == DEFAULT_QUBIT_CEILING


def test_memory_above_the_ceiling_is_refused():
    with pytest.raises(ValidationError):
        ExecutionSpec(code="pass", memory_mb=MAX_MEMORY_MB + 1)


def test_memory_below_the_floor_is_still_refused():
    """The pre-existing half, asserted so a future edit cannot drop it while
    adding the ceiling."""
    with pytest.raises(ValidationError):
        ExecutionSpec(code="pass", memory_mb=63)


def test_the_ceiling_bounds_the_vcpu_request_a_provider_is_billed_for():
    """Why this cap is not really about memory.

    `vercel._create_kwargs` turns `memory_mb` into a vCPU count, because Vercel
    provisions 2 GiB per vCPU. Unbounded memory was therefore an unbounded vCPU
    request against a paid provider. The assertion is on the derived number, not
    on the field, because that is the quantity that costs money.
    """
    from majorana_sandbox.vercel import _create_kwargs

    largest = ExecutionSpec(code="pass", memory_mb=MAX_MEMORY_MB)
    kwargs = _create_kwargs(largest, "majorana-runner")
    assert kwargs["resources"]["vcpus"] == 2
    # And the invariant that shares this function, asserted here too because a
    # change to the kwargs builder is the change most likely to disturb both.
    assert kwargs["network_policy"] == "deny-all"
    assert kwargs["env"] == {}


def test_a_timeout_above_the_cap_is_refused():
    with pytest.raises(ValidationError):
        ExecutionSpec(code="pass", timeout_s=MAX_TIMEOUT_S + 1)
