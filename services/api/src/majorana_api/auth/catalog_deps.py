"""Anonymous-safe catalog scope derived exclusively from server settings."""

from typing import Annotated

from fastapi import Depends, HTTPException
from majorana_contracts import Scope

from ..catalog_authority import CatalogDisabledError, CatalogConfigurationError
from ..settings import Settings
from .deps import get_settings


def get_public_catalog_scope(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Scope:
    try:
        return settings.catalog_authority.public_scope()
    except CatalogDisabledError as exc:
        raise HTTPException(404, "catalog not available") from exc
    except CatalogConfigurationError as exc:
        raise HTTPException(503, "catalog unavailable") from exc


PublicCatalogScope = Annotated[Scope, Depends(get_public_catalog_scope)]

__all__ = ["PublicCatalogScope"]
