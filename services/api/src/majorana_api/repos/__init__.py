"""Repository layer — the authz spine (02-architecture.md §4, AGENTS.md rule 2).

Every function here takes a `Scope` as its FIRST argument and applies the
workspace predicate itself; a row outside scope.workspace_id is reported as
NotFoundError, indistinguishable from a row that does not exist. No other code
may touch SQLAlchemy or issue queries (import-linter contract + CI grep).

Role gates: reads need any membership role; writes need owner/admin/member;
destructive/visibility operations need owner/admin (see _base.py).

`system.py` is the single deliberate exception: identity bootstrap and the
worker job loop run before/outside any workspace scope.
"""

from . import agent, artifacts, audit, catalog, folders, runs, system, usage, workspaces
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
    "folders",
    "runs",
    "system",
    "usage",
    "workspaces",
]
