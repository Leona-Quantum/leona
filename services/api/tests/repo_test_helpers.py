"""DB-free harness for repository-layer unit tests.

RecordingSession captures every statement a repo function issues so tests can
assert the workspace predicate is present WITHOUT a database. The live authz
suite (tests/authz/) covers entity × role × cross-workspace against Postgres.
"""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy.dialects import postgresql


class _Result:
    """Empty result: reads see no rows, writes see rowcount 0."""

    rowcount = 0

    def scalars(self):
        return self

    def all(self):
        return []

    def first(self):
        return None

    def scalar_one_or_none(self):
        return None

    def scalar_one(self):
        return 1


class RecordingSession:
    def __init__(self):
        self.statements = []
        self.added = []

    async def execute(self, stmt, params=None):
        self.statements.append(stmt)
        return _Result()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def refresh(self, obj):
        pass


def compiled(stmt) -> tuple[str, dict]:
    c = stmt.compile(dialect=postgresql.dialect())
    return str(c), c.params


def make_scope(role: Role = Role.MEMBER) -> Scope:
    return Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=role)
