"""Shared errors and role gates for the repository layer."""

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
