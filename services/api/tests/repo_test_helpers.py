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


class Row:
    """Wraps one value with the subset of the Result API repo code calls."""

    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def first(self):
        return self._value

    def scalar_one(self):
        return self._value


class Rows:
    """Wraps a list of values for repo code that calls .scalars().all()."""

    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return self._values


class SequencedSession:
    """Returns queued results in call order; records every statement/insert."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.added = []

    async def execute(self, stmt, params=None):
        self.statements.append(stmt)
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def refresh(self, obj):
        """No-op, to match `RecordingSession`.

        Nothing reaches it today — the repo functions that refresh after a flush
        are driven through `RecordingSession` — so its absence was invisible. It
        is here because the next test to drive a creating function through this
        double would get an `AttributeError` from the double rather than a
        failure about the code under test.
        """

    async def rollback(self):
        pass
