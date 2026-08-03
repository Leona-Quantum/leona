"""The per-project artifact limit's constants agree with the database.

**This file is written because its own name was already being cited.** Both
`repos/projects.py` and `repos/_project_limits.py` carried a comment saying the
constant "is asserted equal in `test_project_artifact_limit.py`" — and the file
did not exist. The claim shipped in session 52, was copied forward verbatim into
the new module in session 55, and was found by CodeRabbit on PR 216.

A comment that names a guard is worth exactly as much as the guard. Nobody
checks; the sentence reads like coverage; the number it describes is free to
drift. So: the assertions, rather than a deleted sentence.

Two different things are pinned here and they fail for different reasons:

1. **The Python constant against the migration's CHECK constraint.** `0043`
   writes `max_artifacts <= 500` into the schema. If `MAX_PROJECT_ARTIFACT_LIMIT`
   were raised without a migration, the route would accept a value the database
   then rejects with an IntegrityError on flush — a 500 on a form the user filled
   in correctly.
2. **The two Python copies against each other.** `repos/projects` re-exports what
   `repos/_project_limits` defines, and `repos/shares` re-exports it again,
   because neither may import the other. Re-exports are how one of three names
   ends up pointing at a stale literal.
"""

import os
import re
from pathlib import Path

import pytest
from sqlalchemy import text

from majorana_api.db import engine_from_env
from majorana_api.repos import projects as projects_repo
from majorana_api.repos import shares as shares_repo
from majorana_api.repos._project_limits import (
    DEFAULT_PROJECT_ARTIFACT_LIMIT,
    MAX_PROJECT_ARTIFACT_LIMIT,
)

_MIGRATION = Path(__file__).resolve().parents[3] / "db" / "migrations" / "versions"


def test_every_python_copy_of_the_ceiling_is_the_same_number():
    """Three names, one value. Re-exports are the drift risk, not the source."""
    assert projects_repo.MAX_PROJECT_ARTIFACT_LIMIT == MAX_PROJECT_ARTIFACT_LIMIT
    assert shares_repo.MAX_PROJECT_ARTIFACT_LIMIT == MAX_PROJECT_ARTIFACT_LIMIT
    assert shares_repo.DEFAULT_PROJECT_ARTIFACT_LIMIT == DEFAULT_PROJECT_ARTIFACT_LIMIT


def test_the_default_sits_inside_the_ceiling():
    """`0 <= default <= max` — a default outside the range the route accepts
    would make every project that never chose a number unwritable."""
    assert 0 <= DEFAULT_PROJECT_ARTIFACT_LIMIT <= MAX_PROJECT_ARTIFACT_LIMIT


def test_the_migration_text_states_the_same_ceiling():
    """Read out of the migration file, so this runs without a database.

    The live check below is the authority — it asks the schema that actually
    exists — but it skips without `DATABASE_URL`, and a skipped guard is not a
    guard on a laptop or on a PR whose job does not provision one.
    """
    sources = [
        path.read_text()
        for path in _MIGRATION.glob("*.py")
        if "ck_projects_max_artifacts_range" in path.read_text()
    ]
    assert sources, "no migration defines ck_projects_max_artifacts_range"
    bounds = {
        int(match)
        for source in sources
        for match in re.findall(r"max_artifacts\s*<=\s*(\d+)", source)
    }
    assert bounds == {MAX_PROJECT_ARTIFACT_LIMIT}, (
        f"the migration bounds max_artifacts at {bounds} and Python says "
        f"{MAX_PROJECT_ARTIFACT_LIMIT}; a value between them is accepted by the "
        "route and refused by the database, which is a 500 on a valid form"
    )


@pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="the live constraint check needs DATABASE_URL",
)
@pytest.mark.asyncio
async def test_the_database_constraint_states_the_same_ceiling():
    """The authority: the constraint as the schema actually holds it.

    Asked of `pg_constraint` rather than of the migration file, because what
    binds a write is what was applied — a migration edited after it ran, or a
    hand-altered constraint, is invisible to the text check above.
    """
    engine = engine_from_env()
    try:
        async with engine.connect() as conn:
            definition = (
                await conn.execute(
                    text(
                        "select pg_get_constraintdef(oid) from pg_constraint "
                        "where conname = 'ck_projects_max_artifacts_range'"
                    )
                )
            ).scalar_one_or_none()
    finally:
        await engine.dispose()

    assert definition is not None, (
        "ck_projects_max_artifacts_range is not on this database; migration 0043 "
        "either did not run or was reverted"
    )
    bounds = {int(match) for match in re.findall(r"<=\s*(\d+)", definition)}
    assert MAX_PROJECT_ARTIFACT_LIMIT in bounds, (
        f"the database constraint reads {definition!r}, which does not bound "
        f"max_artifacts at {MAX_PROJECT_ARTIFACT_LIMIT}"
    )
