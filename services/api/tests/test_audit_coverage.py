"""Every destructive or authority-changing operation leaves an `audit_log` row.

`05-security.md` §1 asks for audit rows on "deletions ... and admin actions".
Before this, `record_audit` was called from exactly three modules and every
recorded action was a `catalog.*` or `project_share.*` one — so the table was
genuinely append-only (migration 0050) and almost empty of the events anybody
would reconstruct an incident from. Deleting an artifact, a project or a folder,
disconnecting a provider credential, removing a member, changing someone's role
and handing over a workspace all wrote nothing at all.

These are DB-free, driven through `RecordingSession` like the rest of the
repository unit tests. What they assert is that the call happens, that it
happens on the success path only, and that it carries the facts that cannot be
recovered afterwards — the live authz suite covers the scoping.
"""

import uuid

import pytest
from majorana_contracts.enums import Role
from repo_test_helpers import RecordingSession, make_scope

from majorana_api.orm import AuditLog, Membership, Project, User, WorkspaceFolder
from majorana_api.repos import artifacts, folders, projects, provider_credentials, workspaces


class _Result:
    """A result whose row and rowcount the test chooses."""

    def __init__(self, value=None, rowcount=0):
        self._value = value
        self.rowcount = rowcount

    def scalars(self):
        return self

    def first(self):
        return self._value

    def all(self):
        return [self._value] if self._value is not None else []

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value


class ScriptedSession(RecordingSession):
    """`RecordingSession` that answers each `execute` from a prepared list.

    The repository functions under test read before they write, so the default
    harness — which answers every read with "no rows" — makes them raise
    NotFoundError before reaching the line this file is about.
    """

    def __init__(self, results):
        super().__init__()
        self._results = list(results)
        self.deleted = []

    async def execute(self, stmt, params=None):
        self.statements.append(stmt)
        return self._results.pop(0) if self._results else _Result()

    async def delete(self, obj):
        self.deleted.append(obj)


def audit_rows(session) -> list[AuditLog]:
    return [row for row in session.added if isinstance(row, AuditLog)]


def only_audit_row(session) -> AuditLog:
    rows = audit_rows(session)
    assert len(rows) == 1, f"expected exactly one audit row, got {len(rows)}"
    return rows[0]


def test_deleting_an_artifact_is_audited():
    scope = make_scope(Role.ADMIN)
    artifact_id = uuid.uuid4()
    session = ScriptedSession([_Result(rowcount=1)])

    import asyncio

    asyncio.run(artifacts.soft_delete_artifact(scope, session, artifact_id))

    row = only_audit_row(session)
    assert row.action == "artifact.deleted"
    assert row.target_id == artifact_id
    assert row.workspace_id == scope.workspace_id
    assert row.actor_user_id == scope.user_id


def test_an_artifact_delete_that_matched_nothing_records_nothing():
    """The half that matters most: a log is answered FROM, so a row for a
    deletion that did not happen is worse than no row at all."""
    scope = make_scope(Role.ADMIN)
    session = ScriptedSession([_Result(rowcount=0)])

    import asyncio

    with pytest.raises(Exception):
        asyncio.run(artifacts.soft_delete_artifact(scope, session, uuid.uuid4()))

    assert audit_rows(session) == []


def test_deleting_a_project_records_the_name_it_had():
    scope = make_scope(Role.MEMBER)
    project_id = uuid.uuid4()
    project = Project(id=project_id, workspace_id=scope.workspace_id, name="Bell states")
    session = ScriptedSession([_Result(project), _Result(rowcount=0)])

    import asyncio

    asyncio.run(projects.delete_project(scope, session, project_id))

    row = only_audit_row(session)
    assert row.action == "project.deleted"
    assert row.target_id == project_id
    # The uuid alone answers "who deleted this" and not "what was deleted".
    assert row.meta == {"name": "Bell states"}


def test_deleting_a_folder_records_the_name_it_had():
    scope = make_scope(Role.MEMBER)
    folder_id = uuid.uuid4()
    folder = WorkspaceFolder(id=folder_id, workspace_id=scope.workspace_id, name="Ion trap")
    session = ScriptedSession([_Result(folder), _Result(rowcount=0)])

    import asyncio

    asyncio.run(folders.delete_folder(scope, session, folder_id))

    row = only_audit_row(session)
    assert row.action == "folder.deleted"
    assert row.meta == {"name": "Ion trap"}


def test_disconnecting_a_credential_is_audited_and_carries_no_secret():
    scope = make_scope(Role.VIEWER)
    session = ScriptedSession([_Result(rowcount=1)])

    import asyncio

    assert asyncio.run(provider_credentials.delete(scope, session, "ibm")) is True

    row = only_audit_row(session)
    assert row.action == "provider_credential.deleted"
    # This table holds a decryptable third-party API key. The audit row must
    # carry the fact and nothing derived from the secret itself.
    assert row.meta == {"provider": "ibm"}
    assert "ciphertext" not in (row.meta or {})


def test_disconnecting_nothing_records_nothing():
    scope = make_scope(Role.VIEWER)
    session = ScriptedSession([_Result(rowcount=0)])

    import asyncio

    assert asyncio.run(provider_credentials.delete(scope, session, "ibm")) is False
    assert audit_rows(session) == []


def test_removing_a_member_records_the_role_they_held():
    scope = make_scope(Role.ADMIN)
    user_id = uuid.uuid4()
    membership = Membership(workspace_id=scope.workspace_id, user_id=user_id, role=Role.MEMBER)
    session = ScriptedSession([_Result(membership), _Result(rowcount=1), _Result(rowcount=0)])

    import asyncio

    asyncio.run(workspaces.remove_member(scope, session, user_id=user_id))

    row = only_audit_row(session)
    assert row.action == "workspace.member_removed"
    assert row.target_id == user_id
    # Nothing is left to read this off once the membership row is gone.
    assert row.meta == {"role": "member"}


def test_a_role_change_records_both_ends():
    scope = make_scope(Role.ADMIN)
    user_id = uuid.uuid4()
    membership = Membership(workspace_id=scope.workspace_id, user_id=user_id, role=Role.VIEWER)
    user = User(id=user_id, email="someone@example.test")
    session = ScriptedSession([_Result(membership), _Result(user)])

    import asyncio

    asyncio.run(workspaces.set_member_role(scope, session, user_id=user_id, role=Role.ADMIN))

    row = only_audit_row(session)
    assert row.action == "workspace.member_role_changed"
    # "set to admin" reads identically whether they were a viewer a moment ago
    # or have always been one, and only one of those is a promotion.
    assert row.meta == {"email": "someone@example.test", "from": "viewer", "to": "admin"}
