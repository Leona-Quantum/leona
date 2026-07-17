"""Server-owned authority for the future public quantum catalog.

Catalog identifiers come only from process configuration. HTTP clients never
choose them, which prevents a private workspace from being substituted into a
public catalog query.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from opentelemetry import metrics

_meter = metrics.get_meter("majorana.catalog_authority")
_scope_issued = _meter.create_counter(
    "majorana.catalog.scope.issued",
    description="Server-owned catalog scopes issued by purpose",
)


class CatalogConfigurationError(RuntimeError):
    """Catalog configuration is incomplete or internally inconsistent."""


class CatalogDisabledError(RuntimeError):
    """The public catalog feature flag is disabled."""


def _enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes"}


def _uuid_env(name: str) -> uuid.UUID | None:
    raw = os.environ.get(name)
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise CatalogConfigurationError(f"{name} must be a UUID") from exc


@dataclass(frozen=True)
class CatalogAuthority:
    enabled: bool = False
    workspace_id: uuid.UUID | None = None
    importer_user_id: uuid.UUID | None = None
    public_reader_user_id: uuid.UUID | None = None

    def __post_init__(self) -> None:
        values = (self.workspace_id, self.importer_user_id, self.public_reader_user_id)
        configured = [value is not None for value in values]
        if any(configured) and not all(configured):
            raise CatalogConfigurationError(
                "SYSTEM_CATALOG_WORKSPACE_ID, SYSTEM_CATALOG_IMPORTER_USER_ID, and "
                "SYSTEM_CATALOG_PUBLIC_READER_USER_ID must be configured together"
            )
        if self.enabled and not all(configured):
            raise CatalogConfigurationError(
                "SYSTEM_CATALOG_ENABLED requires all catalog authority IDs"
            )
        present = [value for value in values if value is not None]
        if len(present) != len(set(present)):
            raise CatalogConfigurationError("catalog authority IDs must be distinct")

    @classmethod
    def from_env(cls) -> "CatalogAuthority":
        return cls(
            enabled=_enabled(os.environ.get("SYSTEM_CATALOG_ENABLED")),
            workspace_id=_uuid_env("SYSTEM_CATALOG_WORKSPACE_ID"),
            importer_user_id=_uuid_env("SYSTEM_CATALOG_IMPORTER_USER_ID"),
            public_reader_user_id=_uuid_env("SYSTEM_CATALOG_PUBLIC_READER_USER_ID"),
        )

    @property
    def configured(self) -> bool:
        return self.workspace_id is not None

    def require_configured(self) -> None:
        if not self.configured:
            raise CatalogConfigurationError("catalog authority IDs are not configured")

    def public_scope(self) -> Scope:
        if not self.enabled:
            raise CatalogDisabledError("system catalog is disabled")
        self.require_configured()
        assert self.workspace_id is not None
        assert self.public_reader_user_id is not None
        _scope_issued.add(1, {"purpose": "public_read"})
        return Scope(
            user_id=self.public_reader_user_id,
            workspace_id=self.workspace_id,
            role=Role.VIEWER,
        )

    def is_public_scope(self, scope: Scope) -> bool:
        """Compare against configured authority without emitting issuance telemetry."""
        self.require_configured()
        return (
            scope.user_id == self.public_reader_user_id
            and scope.workspace_id == self.workspace_id
            and scope.role == Role.VIEWER
        )

    def importer_scope(self) -> Scope:
        self.require_configured()
        assert self.workspace_id is not None
        assert self.importer_user_id is not None
        _scope_issued.add(1, {"purpose": "import"})
        return Scope(
            user_id=self.importer_user_id,
            workspace_id=self.workspace_id,
            role=Role.OWNER,
        )

    def is_importer_scope(self, scope: Scope) -> bool:
        """Compare against configured authority without emitting issuance telemetry."""
        self.require_configured()
        return (
            scope.user_id == self.importer_user_id
            and scope.workspace_id == self.workspace_id
            and scope.role == Role.OWNER
        )
