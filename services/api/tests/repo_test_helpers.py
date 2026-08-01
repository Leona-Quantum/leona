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


async def delete_committed_tenants(factory, workspace_ids, user_ids) -> None:
    """Remove everything a COMMITTING live fixture created. Not optional.

    Most live suites run inside the `db` fixture's transaction and roll back. A
    few have to commit — anything with two connections, because a fixture only
    one of them can see makes every cross-connection assertion vacuously true —
    and those rows are then the suite's own to remove.

    Skipping it is not untidiness, it is a broken neighbour. With this absent,
    `test_catalog_bootstrap_import_live` finished `completed_with_rejections`
    instead of `completed` and `test_job_queue_live` recovered three stale jobs
    where it expected one: two suites that never mention sharing, failing on a
    CLEAN database, because twenty workspaces they did not create were sitting
    in it.

    Foreign-key order, and two of the steps are load-bearing:
    `artifacts.current_version_id` references the versions, so the pointer is
    NULLed BEFORE they are deleted (getting this backwards produced ten teardown
    errors beside a green "1453 passed"), and `users.active_workspace_id`
    references a workspace about to go.
    """
    from sqlalchemy import delete, select, update

    from majorana_api.orm import (
        Artifact,
        ArtifactVersion,
        AuditLog,
        Membership,
        Project,
        ProjectShare,
        User,
        Workspace,
    )

    workspace_ids = list(workspace_ids)
    user_ids = list(user_ids)
    async with factory() as session:
        artifact_ids = list(
            (
                await session.execute(
                    select(Artifact.id).where(Artifact.workspace_id.in_(workspace_ids))
                )
            )
            .scalars()
            .all()
        )
        project_ids = list(
            (
                await session.execute(
                    select(Project.id).where(Project.workspace_id.in_(workspace_ids))
                )
            )
            .scalars()
            .all()
        )
        if project_ids:
            await session.execute(
                delete(ProjectShare).where(ProjectShare.project_id.in_(project_ids))
            )
        if artifact_ids:
            await session.execute(
                update(Artifact)
                .where(Artifact.id.in_(artifact_ids))
                .values(current_version_id=None, project_id=None)
            )
            await session.execute(
                delete(ArtifactVersion).where(ArtifactVersion.artifact_id.in_(artifact_ids))
            )
            await session.execute(delete(Artifact).where(Artifact.id.in_(artifact_ids)))
        await session.execute(delete(Project).where(Project.workspace_id.in_(workspace_ids)))
        await session.execute(delete(AuditLog).where(AuditLog.workspace_id.in_(workspace_ids)))
        await session.execute(delete(Membership).where(Membership.workspace_id.in_(workspace_ids)))
        await session.execute(
            update(User).where(User.id.in_(user_ids)).values(active_workspace_id=None)
        )
        await session.execute(delete(Workspace).where(Workspace.id.in_(workspace_ids)))
        await session.execute(delete(User).where(User.id.in_(user_ids)))
        await session.commit()
