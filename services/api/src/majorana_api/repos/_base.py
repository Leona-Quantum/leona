"""Shared errors, role gates and stamps for the repository layer."""

import datetime as dt

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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


async def set_rls_context(session: AsyncSession, scope: Scope, *, enforce: bool) -> None:
    """Arm the RLS GUCs for the rest of this transaction (ai-ops#143;
    docs/adr/0028-rls-defense-in-depth.md; db/migrations/versions/0053).

    The one place the raw `text()`/`session.execute()` this needs is allowed to
    live: `scripts/check_raw_queries.py` only exempts the repository layer plus
    `db.py`/`orm.py`, so `auth/deps.py` — which is where this actually needs to
    be CALLED, once, right after a `Scope` is derived — imports this function
    instead of touching SQLAlchemy itself. Keeping the call site in `auth/deps.py`
    and the SQL in here is deliberate, not a compromise: "does this code path
    enforce RLS" is still answered by "does it call `get_scope`", and the raw
    query stays inside the layer the authz invariant already trusts.

    Three GUCs, set in ONE statement so they cannot drift apart or be armed
    separately. `majorana.user_id` arrived with 0054 (ai-ops#149): it is what the
    grant disjunct on `projects`/`artifacts`/`artifact_versions`/`project_shares`
    keys on, and a session that had the workspace GUC without it would evaluate
    every one of those disjuncts against NULL — no rows through any grant, which
    is the silent breakage 0054 exists to remove.

    `enforce=False` (the default everywhere until `Settings.rls_enforced` is
    flipped — see that field's docstring) is a genuine no-op: nothing is
    executed, not even a `set_config` clearing the GUC to off, so a caller that
    never reaches this function and a caller that reaches it with `enforce=False`
    are indistinguishable to Postgres. `set_config(..., true)` is `SET LOCAL`'s
    parameterizable form — transaction-scoped, gone the moment this request's
    transaction ends, and never built by string-formatting `scope.workspace_id`
    into SQL.
    """
    if not enforce:
        return
    await session.execute(
        text(
            "select set_config('majorana.rls_enforce', 'on', true), "
            "set_config('majorana.workspace_id', :workspace_id, true), "
            "set_config('majorana.user_id', :user_id, true)"
        ),
        {"workspace_id": str(scope.workspace_id), "user_id": str(scope.user_id)},
    )
