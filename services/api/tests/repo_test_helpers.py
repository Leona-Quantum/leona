"""DB-free harness for repository-layer unit tests.

RecordingSession captures every statement a repo function issues so tests can
assert the workspace predicate is present WITHOUT a database. The live authz
suite (tests/authz/) covers entity × role × cross-workspace against Postgres.
"""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy.dialects import postgresql

#: A `users.plan` value that names no tier, for the tests that exercise the
#: fall-through. `users.plan` has no CHECK constraint and `resolve_tier` maps an
#: unrecognised value to `free`, so this is a real state, not a hypothetical.
#:
#: It lives here rather than beside its users because it must be *asserted*
#: rather than chosen, and the module that uses it sits entirely under a
#: `requires_db` skip. `test_tier_table.test_unknown_plan_names_no_tier` is the
#: guard, and it runs in the `py` job — on every pull request — rather than only
#: in `db`.
#:
#: The value was `"pro"` until `pro` became a real tier. The day it did,
#: `test_me_reports_free_for_a_plan_string_nobody_recognises` failed loudly with
#: `assert 'pro' == 'free'`, which was the honest outcome. The quieter half is
#: the one that made this a shared constant with a guard: the OTHER test using
#: it went on passing, because `pro` happens not to grant sharing either — so it
#: silently stopped being a test about an unknown plan string and became a test
#: about the pro tier, green the whole way.
UNKNOWN_PLAN = "not-a-plan"


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


def empty_tier_sources(**populated: frozenset[str]):
    """A `tiers.TierSources` with every allowlist empty unless named.

    Built from `TIER_ALLOWLIST_ENV` rather than written out, because a double
    thinner than the protocol it stands in for is the mistake this shape exists
    to prevent: `tier_of` reads every allowlist, so a hand-listed namespace that
    forgets one raises AttributeError deep inside a route the moment a third
    list is added — which is exactly what happened when `pro` arrived.
    """
    from types import SimpleNamespace

    from majorana_api.tiers import TIER_ALLOWLIST_ENV

    unknown = set(populated) - set(TIER_ALLOWLIST_ENV)
    assert not unknown, f"no such allowlist: {sorted(unknown)}"
    return SimpleNamespace(
        **{field: populated.get(field, frozenset()) for field in TIER_ALLOWLIST_ENV}
    )


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

    Foreign-key order, and three of the steps are load-bearing:
    `artifacts.current_version_id` references the versions, so the pointer is
    NULLed BEFORE they are deleted (getting this backwards produced ten teardown
    errors beside a green "1453 passed"), `users.active_workspace_id` references
    a workspace about to go, and SEVEN tables reference `runs.id` — every one of
    them has to go before the run does, and the run before its workspace.

    Runs were absent here until a suite committed one. Nothing had, so nothing
    failed; the first that did got a ForeignKeyViolation from the workspace
    delete rather than a wrong answer, which is the good direction for a gap
    like this to be found in.
    """
    from sqlalchemy import delete, select, update

    from majorana_api.orm import (
        AgentLLMCall,
        AgentRun,
        AgentStep,
        Artifact,
        ArtifactVersion,
        AuditLog,
        Job,
        Membership,
        Project,
        ProjectShare,
        QpuRun,
        Run,
        RunCandidate,
        RunEvent,
        UsageEvent,
        User,
        VerificationRecord,
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
        # First, because a qpu_run references an artifact VERSION as well as the
        # workspace and the user, and the versions go three statements below.
        # Nothing references a qpu_run, so nothing needs it to survive. Absent
        # here until a suite committed one — the same way runs were, and with
        # the same good failure mode: a ForeignKeyViolation from the workspace
        # delete rather than a wrong answer somewhere quiet.
        await session.execute(delete(QpuRun).where(QpuRun.workspace_id.in_(workspace_ids)))
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
        run_ids = list(
            (await session.execute(select(Run.id).where(Run.workspace_id.in_(workspace_ids))))
            .scalars()
            .all()
        )
        if run_ids:
            # Everything that points at a run, then the run. Ordered by the FK
            # graph rather than by guess: agent_llm_calls and agent_steps hang
            # off agent_runs as well as off the run itself, so they go first.
            for model in (
                AgentLLMCall,
                AgentStep,
                AgentRun,
                RunCandidate,
                RunEvent,
                VerificationRecord,
                Job,
            ):
                await session.execute(delete(model).where(model.run_id.in_(run_ids)))
            await session.execute(delete(Run).where(Run.id.in_(run_ids)))
        await session.execute(delete(UsageEvent).where(UsageEvent.workspace_id.in_(workspace_ids)))
        await session.execute(delete(AuditLog).where(AuditLog.workspace_id.in_(workspace_ids)))
        await session.execute(delete(Membership).where(Membership.workspace_id.in_(workspace_ids)))
        await session.execute(
            update(User).where(User.id.in_(user_ids)).values(active_workspace_id=None)
        )
        await session.execute(delete(Workspace).where(Workspace.id.in_(workspace_ids)))
        await session.execute(delete(User).where(User.id.in_(user_ids)))
        await session.commit()


class LockOnlySession:
    """A session double for routes whose only own statement is a row lock.

    `object()` was enough for the allowance tests while every read they exercise
    went through a repository function they monkeypatch. It stopped being enough
    the moment the run allowance became a *reservation*:
    `runs.reserve_execute_run_slot` takes the account's row before it counts, and
    a double with no `execute` turned four agreement tests and seven
    parametrised ones into AttributeErrors at once.

    Deliberately NOT a general session double. It answers the one call the
    locked path makes and records it, so a route that starts issuing real
    statements against this fails loudly instead of quietly reading None — and
    so a test can assert the reservation reserved. The lock's *effect* is
    measured where an effect like that can be: across two connections, in
    `test_run_allowance_race_live.py`.

    One copy, in this module, for the reason `any_team_grantee` is one copy: a
    double duplicated per test file is a double that drifts, and the version
    that drifts is the permissive one.
    """

    def __init__(self) -> None:
        self.statements: list[object] = []

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return None


async def slot_taken_or_the_reason_why(taken, first_caller, timeout: float = 30.0) -> None:
    """Wait for the first racer to take the contested slot — or surface why it did not.

    Every two-connection race test in this suite is staged the same way: caller A
    takes the last slot, sets an event, and holds its transaction open while
    caller B proves it is blocked. A bare `await taken.wait()` is then a hang
    waiting to happen. If A raises anywhere before the `set()` — a fixture that
    staged the wrong count, a constraint, a repository signature that moved —
    the event is never set, the test body waits forever, the `finally` that
    tears down never runs, and the row A locked stays locked until the job is
    killed. CI reports that as a stuck job with no reason attached, which is the
    worst shape a failure can take: it costs the whole job's wall clock and says
    nothing.

    So this waits on the event AND on A's task, and if A finished first it
    re-raises what A actually failed with. A timeout is the last resort rather
    than the mechanism, because "timed out" is a much worse message than the
    exception that caused it.
    """
    import asyncio

    waiter = asyncio.create_task(taken.wait())
    done, _pending = await asyncio.wait(
        {waiter, first_caller}, return_when=asyncio.FIRST_COMPLETED, timeout=timeout
    )
    if waiter in done:
        return
    waiter.cancel()
    if first_caller in done:
        # Re-raises whatever the first caller failed with, rather than reporting
        # a timeout that describes the symptom.
        first_caller.result()
        raise AssertionError("the first caller returned without taking the slot")
    raise AssertionError(f"the first caller neither took the slot nor failed within {timeout}s")
