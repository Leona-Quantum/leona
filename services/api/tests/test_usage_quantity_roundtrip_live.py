"""`record_usage` must accept its own first insert of a float that Postgres cannot store exactly.

Production, 2026-09-24 01:08Z: a notebook build that needed three repairs ran four
sandboxes, summed their durations to a float with a 16th significant digit, and the
idempotency check read the `Numeric` row back at 15 digits, found it unequal, and raised
"usage event idempotency key was reused with different content" on the FIRST write. The
worker logs and swallows that, so the build's sandbox seconds were never recorded. The fix
normalises the quantity on both sides; this proves it against a real Postgres, which is the
only place the float8 -> numeric cast happens.
"""

from __future__ import annotations

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, UsageKind

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system
from majorana_api.repos import usage as usage_repo

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the float round trip needs a real Postgres"
)


@pytest.fixture
async def scoped_session():
    factory = session_factory(engine_from_env())
    async with factory() as session:  # never committed: everything rolls back
        tag = uuid.uuid4().hex[:12]
        user, workspace = await system.get_or_provision_user(
            session, workos_user_id=f"usage-rt-{tag}", email=f"usage-rt-{tag}@usage.test"
        )
        yield Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER), session


async def test_a_summed_float_duration_is_accepted_and_replays_idempotently(scoped_session) -> None:
    scope, session = scoped_session
    # Four sandbox runs summed the way `ProductionNotebookPorts.run_notebook` sums them.
    # About a third of random four-run sums of millisecond durations land past 15
    # significant digits (measured over 10,000 draws); this is one of them.
    seconds = 0.0
    for duration in (6.1, 9.662, 5.516, 7.089):
        seconds += duration
    assert repr(seconds) == "28.366999999999997"  # the input really is past 15 digits
    event_id = uuid.uuid4()
    first = await usage_repo.record_usage(
        scope,
        session,
        kind=UsageKind.SANDBOX_SECONDS,
        quantity=seconds,
        meta={"lane": "notebook"},
        event_id=event_id,
    )
    again = await usage_repo.record_usage(
        scope,
        session,
        kind=UsageKind.SANDBOX_SECONDS,
        quantity=seconds,
        meta={"lane": "notebook"},
        event_id=event_id,
    )
    assert first.id == again.id == event_id
    assert abs(float(again.quantity) - seconds) < 1e-6


async def test_a_genuinely_different_quantity_on_the_same_key_still_raises(scoped_session) -> None:
    scope, session = scoped_session
    event_id = uuid.uuid4()
    await usage_repo.record_usage(
        scope, session, kind=UsageKind.SANDBOX_SECONDS, quantity=10.5, event_id=event_id
    )
    with pytest.raises(ValueError, match="reused with different content"):
        await usage_repo.record_usage(
            scope, session, kind=UsageKind.SANDBOX_SECONDS, quantity=10.25, event_id=event_id
        )
