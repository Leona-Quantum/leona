"""Anonymous public catalog read endpoints (repository Step 6 / Neon cutover Slice C).

Read-only. The catalog reader scope comes exclusively from server configuration
(PublicCatalogScope), never from the caller, and resolves to a 404 when
SYSTEM_CATALOG_ENABLED is false — so these routes are inert until an operator
provisions and enables the system catalog. No write/publish surface is exposed
over HTTP: publication is an attributable human action run through the operator
CLI (catalog_admin), not a request handler.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from majorana_contracts import PublicCatalogEntry

from ..auth.catalog_deps import PublicCatalogScope
from ..auth.deps import DbSession, get_settings
from ..catalog_read_model import project_record_for_list_view
from ..repos import catalog as catalog_repo
from ..settings import Settings

router = APIRouter()

_Settings = Annotated[Settings, Depends(get_settings)]

# 'full' (default, unchanged) returns the complete `record`. 'list' projects
# `record` to the browse-list allowlist (catalog_read_model.LIST_VIEW_RECORD_FIELDS)
# so the response fits under Vercel's 2 MB Next.js data-cache ceiling (Slice E).
# A Literal so FastAPI rejects any other value with 422 rather than silently
# falling back to 'full'.
CatalogEntriesView = Literal["full", "list"]


@router.get("/catalog/entries", response_model=list[PublicCatalogEntry])
async def list_catalog_entries(
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
    view: CatalogEntriesView = "full",
) -> list[PublicCatalogEntry]:
    entries = await catalog_repo.list_public_catalog_entries(
        scope, session, authority=settings.catalog_authority
    )
    if view == "list":
        return [
            entry.model_copy(update={"record": project_record_for_list_view(entry.record)})
            for entry in entries
        ]
    return entries


@router.get("/catalog/entries/{slug}", response_model=PublicCatalogEntry)
async def get_catalog_entry(
    slug: str,
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
) -> PublicCatalogEntry:
    return await catalog_repo.get_public_catalog_entry(
        scope, session, slug, authority=settings.catalog_authority
    )
