"""Anonymous public catalog read endpoints (repository Step 6 / Neon cutover Slice C).

Read-only. The catalog reader scope comes exclusively from server configuration
(PublicCatalogScope), never from the caller, and resolves to a 404 when
SYSTEM_CATALOG_ENABLED is false — so these routes are inert until an operator
provisions and enables the system catalog. No write/publish surface is exposed
over HTTP: publication is an attributable human action run through the operator
CLI (catalog_admin), not a request handler.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
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

#: The page an anonymous caller gets when it does not ask for one, and the
#: largest it may ask for. Before this, the route accepted no bound at all and
#: served the entire corpus — 1.94 MB, one full-table read — to anybody, on
#: every request.
#:
#: The default is the maximum on purpose. A smaller default would silently
#: truncate the public /repository page for any client that predates
#: pagination, and a catalog that is quietly missing records looks exactly like
#: a working one. Clients that page (see repository-source.ts) pass an explicit
#: limit and are unaffected by this value.
CATALOG_ENTRIES_MAX_LIMIT = 500

#: Total number of entries the caller would get with no pagination at all.
#: Present so a paginating client can tell "I have the whole corpus" from "the
#: server stopped early", which is otherwise indistinguishable from the outside.
CATALOG_TOTAL_HEADER = "X-Catalog-Total"


@router.get("/catalog/entries", response_model=list[PublicCatalogEntry])
async def list_catalog_entries(
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
    response: Response,
    view: CatalogEntriesView = "full",
    limit: int = CATALOG_ENTRIES_MAX_LIMIT,
    offset: int = 0,
) -> list[PublicCatalogEntry]:
    """One page of the published catalog, oldest manifest identity first.

    `limit` is clamped rather than rejected: this is an anonymous browse
    endpoint, and refusing a caller who asked for too much would turn a
    harmless mistake into an error page on the public site.
    """
    total = await catalog_repo.count_public_catalog_entries(
        scope, session, authority=settings.catalog_authority
    )
    response.headers[CATALOG_TOTAL_HEADER] = str(total)
    entries = await catalog_repo.list_public_catalog_entries(
        scope,
        session,
        authority=settings.catalog_authority,
        limit=min(max(limit, 1), CATALOG_ENTRIES_MAX_LIMIT),
        offset=max(offset, 0),
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
