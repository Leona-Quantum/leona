"""The allowance query must have an index it can use.

`count_execute_runs_since` runs on the admission path of every run submission and
filters `runs` on (user_id, mode, created_at). Every other index on that table
leads with `workspace_id`, and Postgres does not index the referencing side of a
foreign key, so before migration 0039 this was a sequential scan of the whole
table — measured at 693 buffers and 14ms against 36,000 rows, growing with every
run anyone had ever submitted.

The test EXPLAINs the statement the repository actually builds, imported from the
repository rather than copied, so a change to the predicates fails here instead of
quietly reverting to the scan.
"""

import datetime as dt
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import text

from majorana_api.repos import runs as runs_repo

pytestmark = pytest.mark.asyncio


async def _explain(db, stmt) -> str:
    compiled = stmt.compile(
        dialect=db.bind.dialect, compile_kwargs={"literal_binds": True}
    )
    result = await db.execute(text(f"EXPLAIN (COSTS OFF) {compiled}"))
    return "\n".join(row[0] for row in result.all())


async def test_the_allowance_query_can_be_served_by_an_index(db):
    scope = Scope(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        role=Role.OWNER,
    )
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)
    stmt = runs_repo.execute_allowance_stmt(scope, since)

    # A near-empty table is always cheapest to scan, so the planner would pick a
    # sequential scan here whatever indexes exist and the assertion would pass
    # for the wrong reason. Penalising seq scans asks the question the test
    # actually means: *is there an index that can serve these predicates at all*.
    # Postgres treats this as a cost penalty rather than a prohibition, so a
    # table with no usable index still reports Seq Scan and still fails.
    await db.execute(text("SET LOCAL enable_seqscan = off"))
    plan = await _explain(db, stmt)

    assert "Seq Scan" not in plan, (
        "the weekly allowance check falls back to a sequential scan of `runs`; "
        f"it runs on every submission. Plan:\n{plan}"
    )
    assert "ix_runs_user_mode_created" in plan, (
        f"expected the allowance index to serve this query. Plan:\n{plan}"
    )


async def test_the_index_leads_with_user_id(db):
    # The column order is the whole reason it works: user_id and mode are
    # equality predicates and created_at is a range, so created_at has to come
    # last or the index cannot seek. Asserting the order catches a "tidy-up"
    # that reorders the columns and leaves an index that still exists, still
    # has the same name, and no longer serves the query.
    row = (
        await db.execute(
            text(
                "select indexdef from pg_indexes "
                "where tablename = 'runs' and indexname = 'ix_runs_user_mode_created'"
            )
        )
    ).first()
    assert row is not None, "ix_runs_user_mode_created is missing from `runs`"
    definition = row[0]
    assert "(user_id, mode, created_at" in definition, definition
