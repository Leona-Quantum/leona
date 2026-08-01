"""Shared errors, role gates and stamps for the repository layer."""

import datetime as dt

from majorana_contracts import Scope
from majorana_contracts.enums import Role

WRITE_ROLES = frozenset({Role.OWNER, Role.ADMIN, Role.MEMBER})
ADMIN_ROLES = frozenset({Role.OWNER, Role.ADMIN})


class RepoError(Exception):
    pass


class AuthzError(RepoError):
    """The scope's role forbids this operation."""


class NotFoundError(RepoError):
    """Row absent OR outside scope.workspace_id — indistinguishable by design."""


def touched_now() -> dt.datetime:
    """The stamp for an in-place edit, as a Python value rather than `func.now()`.

    `updated_at` on these tables carries only a `server_default`, so an ORM
    attribute assignment followed by a flush leaves it at its INSERT value and
    the resource reports a stale time. Two things it deliberately is not:

    - `onupdate=func.now()` on the column. SQLAlchemy marks an `onupdate`
      attribute expired after the UPDATE, and the route's next read of it becomes
      a lazy load outside the async greenlet — the exact 500 that
      `set_artifact_project` was fixed for.
    - `func.now()` assigned to the instance. That leaves a SQL expression object
      on the attribute until something refreshes it, which is the same trap
      wearing a different hat.

    A plain UTC datetime is a value the instance keeps, so the row the caller
    serializes is the row that was written.

    Here rather than in one repository because the argument above is subtle,
    non-obvious from the call site, and now needed by two tables whose only
    difference is what they hold — `projects` learned it first, `workspace_folders`
    had the same bug the whole time.
    """
    return dt.datetime.now(dt.timezone.utc)


def require_write(scope: Scope) -> None:
    if scope.role not in WRITE_ROLES:
        raise AuthzError(f"role {scope.role} cannot write")


def require_admin(scope: Scope) -> None:
    if scope.role not in ADMIN_ROLES:
        raise AuthzError(f"role {scope.role} cannot administer")


def require_owner(scope: Scope) -> None:
    """The one authority an admin does not have: disposing of the workspace.

    Separate from `require_admin` because an admin is someone the owner trusted
    with the members list, and handing the workspace away — or deleting it — is
    not on that list. Every other administrative operation is recoverable by the
    owner; these two are recoverable only by whoever the workspace ended up with.
    """
    if scope.role != Role.OWNER:
        raise AuthzError(f"role {scope.role} is not the workspace owner")
