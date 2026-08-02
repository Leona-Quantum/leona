"""Repository layer — the authz spine (02-architecture.md §4, AGENTS.md rule 2).

Every function here takes a `Scope` as its FIRST argument and applies the
workspace predicate itself; a row outside scope.workspace_id is reported as
NotFoundError, indistinguishable from a row that does not exist. No other code
may touch SQLAlchemy or issue queries (import-linter contract + CI grep).

Role gates: reads need any membership role; writes need owner/admin/member;
destructive/visibility operations need owner/admin (see _base.py).

`system.py` is the single deliberate exception: identity bootstrap and the
worker job loop run before/outside any workspace scope.

`provider_credentials.py` takes a `Scope` like everything else but applies
`scope.user_id` rather than `scope.workspace_id`, because the rows it owns
belong to a person rather than a tenant — the same predicate `runs` and
`qpu_runs` already use for the weekly allowances. Its module docstring carries
the argument; it is not a licence for anything else here to drop the workspace.
"""

from . import (
    agent,
    artifacts,
    audit,
    catalog,
    catalog_import,
    folders,
    identity_migration,
    projects,
    provider_credentials,
    runs,
    shares,
    system,
    usage,
    workspaces,
)
from ._base import ADMIN_ROLES, WRITE_ROLES, AuthzError, NotFoundError, RepoError

__all__ = [
    "ADMIN_ROLES",
    "WRITE_ROLES",
    "AuthzError",
    "NotFoundError",
    "RepoError",
    "artifacts",
    "agent",
    "audit",
    "catalog",
    "catalog_import",
    "folders",
    "identity_migration",
    "projects",
    "provider_credentials",
    "runs",
    "shares",
    "system",
    "usage",
    "workspaces",
]
