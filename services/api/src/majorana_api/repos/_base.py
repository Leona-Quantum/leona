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
