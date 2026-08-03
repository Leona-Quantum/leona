"""Saving to the Vault is a choice (migration 0036).

The design that had to survive: a run ALWAYS materializes, because the Run
surface's conversion tabs read the saved version (events carry no QASM) and the
next turn in a conversation forks from `run.artifact_version_id`. What the user
chooses is whether the result is *filed*. So the invariants worth pinning are
about which queries filter on `kept_at` and which deliberately do not.
"""

import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import Algorithm, Framework, Role
from repo_test_helpers import RecordingSession, compiled, make_scope

from majorana_api.repos import artifacts, workspaces
from majorana_api.routes import artifacts as artifact_routes
from majorana_api.routes import workspaces as workspace_routes


def _sql(stmt) -> str:
    return compiled(stmt)[0]


async def test_list_filters_on_kept_by_default(scope, session):
    await artifacts.list_artifacts(scope, session)
    assert "kept_at IS NOT NULL" in _sql(session.statements[0])


async def test_list_can_be_asked_for_everything(scope, session):
    """`include_unkept` exists for callers reasoning about everything a
    workspace produced. Quota accounting must never use it — an unkept run would
    spend the user's Vault allowance."""
    await artifacts.list_artifacts(scope, session, include_unkept=True)
    # The column is in the projection either way; what must be absent is the
    # predicate.
    assert "kept_at IS NOT NULL" not in _sql(session.statements[0])


async def test_fetching_one_artifact_ignores_kept_entirely(scope, session):
    """Load-bearing. The Run surface fetches the artifact it just produced to
    render its conversion tabs, and a follow-up run forks from it. If get_artifact
    filtered on kept_at, declining to keep a result would break both."""
    from majorana_api.repos import NotFoundError

    with pytest.raises(NotFoundError):
        await artifacts.get_artifact(scope, session, uuid.uuid4())
    assert "kept_at IS NOT NULL" not in _sql(session.statements[0])


async def test_a_new_artifact_is_kept_unless_the_caller_says_otherwise(scope, session):
    """Every pre-existing caller — imports, catalog staging — keeps its old
    behaviour. Only the agent save path opts out."""
    await artifacts.create_artifact(
        scope,
        session,
        slug="s",
        title="t",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        kept=True,
    )
    assert session.added[-1].kept_at is not None

    await artifacts.create_artifact(
        scope,
        session,
        slug="s2",
        title="t2",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        kept=False,
    )
    assert session.added[-1].kept_at is None


async def test_keeping_is_scoped_and_locks_the_row(scope, session):
    from majorana_api.repos import NotFoundError

    with pytest.raises(NotFoundError):
        await artifacts.keep_artifact(scope, session, uuid.uuid4(), workspace_artifact_limit=None)
    sql = _sql(session.statements[0])
    assert "workspace_id" in sql
    assert "FOR UPDATE" in sql


async def test_keeping_requires_write(session):
    """A viewer must not be able to file things into a workspace's Vault."""
    from majorana_api.repos import AuthzError

    with pytest.raises(AuthzError):
        await artifacts.keep_artifact(
            make_scope(Role.VIEWER), session, uuid.uuid4(), workspace_artifact_limit=None
        )


class _SessionWithWorkspace(RecordingSession):
    """get_overview reads the workspace before counting anything, and the
    DB-free harness returns no rows — so the count statement is never reached
    unless the first read finds something."""

    async def execute(self, stmt, params=None):
        self.statements.append(stmt)
        return _WorkspaceRow()


class _WorkspaceRow:
    rowcount = 0

    def scalars(self):
        return self

    def first(self):
        return SimpleNamespace(id=uuid.uuid4(), deleted_at=None)

    def all(self):
        return []

    def scalar_one(self):
        return 0

    def scalar_one_or_none(self):
        return None


async def test_the_workspace_artifact_count_counts_kept_only(scope):
    """The account page's "Artifacts" number must agree with what the Vault
    lists, or the free-tier cap reads as already spent."""
    session = _SessionWithWorkspace()
    await workspaces.get_overview(scope, session)
    counted = [s for s in session.statements if "count(artifacts.id)" in _sql(s).lower()]
    assert counted, "no count statement issued"
    assert "kept_at IS NOT NULL" in _sql(counted[0])


async def test_auto_keep_defaults_off_when_the_workspace_is_missing(scope, session):
    """Read on the run setup path. A missing row must not fail a run, and the
    safe default is False: the artifact still exists and can be kept by hand,
    whereas defaulting True files things nobody asked for."""
    assert await workspaces.auto_keep_artifacts(scope, session) is False
    assert "workspaces.id" in _sql(session.statements[0])


def test_every_direct_artifact_insert_sets_kept_at():
    """Rows built with `Artifact(...)` instead of `create_artifact` do not inherit
    its kept default, and an unkept row is invisible to the Vault.

    The starter Bell example is exactly this, and shipping without it would have
    emptied the Vault of every new workspace — the DB-backed authz suite caught
    that, no unit test did. This is the cheap version of that check: any new
    direct insert must say what it means about keeping.
    """
    import ast
    import pathlib

    src_root = pathlib.Path(__file__).resolve().parents[1] / "src" / "majorana_api"
    assert src_root.is_dir(), f"source root not found at {src_root}"

    offenders = []
    seen = 0
    for path in src_root.rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not (isinstance(node.func, ast.Name) and node.func.id == "Artifact"):
                continue
            seen += 1
            if not any(kw.arg == "kept_at" for kw in node.keywords):
                offenders.append(f"{path.name}:{node.lineno}")

    # A scan that finds nothing to scan passes for the wrong reason — which is
    # exactly how the first version of this test went green over a path that did
    # not exist. There are three such call sites today.
    assert seen >= 3, f"expected to find Artifact(...) call sites, found {seen}"
    # repos/artifacts.py:create_artifact is the one that derives it from `kept`.
    assert offenders == [], (
        f"Artifact(...) built without kept_at at {offenders} — it will not appear "
        "in the Vault. Pass kept_at explicitly, or go through create_artifact."
    )


def _paths(router) -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in router.routes
        for method in getattr(route, "methods", set())
    }


def test_keep_and_settings_are_reachable_over_http():
    """Repo primitives that no route calls are how Library delete shipped broken
    once already (test_artifact_routes.py)."""
    assert ("/artifacts/{artifact_id}/keep", "POST") in _paths(artifact_routes.router)
    assert ("/workspace/settings", "PATCH") in _paths(workspace_routes.router)
