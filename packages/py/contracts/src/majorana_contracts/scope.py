"""The authz spine (plans/rebuild/02-architecture.md §4): every repository-layer
function takes a Scope as its FIRST argument and applies the workspace predicate
itself. Frozen so a scope can never be mutated after construction."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .enums import Role


class Scope(BaseModel):
    model_config = ConfigDict(frozen=True)

    user_id: UUID
    workspace_id: UUID
    role: Role
