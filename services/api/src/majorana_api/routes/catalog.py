"""Anonymous public catalog read endpoints (repository Step 6 / Neon cutover Slice C).

Read-only. The catalog reader scope comes exclusively from server configuration
(PublicCatalogScope), never from the caller, and resolves to a 404 when
SYSTEM_CATALOG_ENABLED is false — so these routes are inert until an operator
provisions and enables the system catalog. No write/publish surface is exposed
over HTTP: publication is an attributable human action run through the operator
CLI (catalog_admin), not a request handler.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from majorana_contracts import CatalogEntryEstimate, CatalogEstimateList, PublicCatalogEntry
from majorana_estimation import BUILTIN_ASSUMPTION_SETS

from ..auth.catalog_deps import PublicCatalogScope
from ..auth.deps import DbSession, get_settings
from ..catalog_estimate import (
    DEFAULT_ROTATION_SYNTHESIS_EPSILON,
    MAX_FACTORY_COUNT,
    MAX_ROTATION_SYNTHESIS_EPSILON,
    MIN_ROTATION_SYNTHESIS_EPSILON,
    UnknownAssumptionSet,
    estimate_for_record,
    estimate_list_for_records,
    resolve_assumptions,
)
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


@router.get("/catalog/estimates", response_model=CatalogEstimateList)
async def list_catalog_estimates(
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
    assumptions: Annotated[str | None, Query()] = None,
    epsilon: Annotated[
        float,
        Query(gt=MIN_ROTATION_SYNTHESIS_EPSILON, lt=MAX_ROTATION_SYNTHESIS_EPSILON),
    ] = DEFAULT_ROTATION_SYNTHESIS_EPSILON,
    factories: Annotated[int | None, Query(ge=0, le=MAX_FACTORY_COUNT)] = None,
) -> CatalogEstimateList:
    """Every published entry's cost under **one** assumption set (E4).

    Exists so the browse list can rank by cost at all. Fetching this per card
    would be 283 requests; more to the point, 283 independently-parameterised
    responses is precisely the shape in which a client ends up ordering rows
    costed under different assumptions without noticing. One call, one set,
    stated once at the top of the payload.

    Bounded by the same page ceiling as the listing, and the arithmetic is
    integer-only — the whole corpus costs single-digit milliseconds — so this
    stays safe on an anonymous route.
    """
    try:
        resolved = resolve_assumptions(assumptions, epsilon)
    except UnknownAssumptionSet as exc:
        raise HTTPException(
            status_code=422,
            detail=f"unknown assumption set {exc.args[0]!r}; known: {sorted(BUILTIN_ASSUMPTION_SETS)}",
        ) from exc
    entries = await catalog_repo.list_public_catalog_entries(
        scope,
        session,
        authority=settings.catalog_authority,
        limit=CATALOG_ENTRIES_MAX_LIMIT,
        offset=0,
    )
    return estimate_list_for_records(
        [(entry.slug, entry.record) for entry in entries],
        resolved,
        factory_count=factories,
    )


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


@router.get("/catalog/entries/{slug}/estimate", response_model=CatalogEntryEstimate)
async def get_catalog_entry_estimate(
    slug: str,
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
    assumptions: Annotated[
        str | None,
        Query(
            description="Assumption-set identity, e.g. `gidney-2025@v1`. Defaults to the only sourced set."
        ),
    ] = None,
    epsilon: Annotated[
        float,
        Query(
            gt=MIN_ROTATION_SYNTHESIS_EPSILON,
            lt=MAX_ROTATION_SYNTHESIS_EPSILON,
            description=(
                "Per-rotation Clifford+T synthesis error. The reader's error budget, "
                "not a hardware property — it is why an estimate is an estimate, so it "
                "is a knob rather than a constant and it travels in the response."
            ),
        ),
    ] = DEFAULT_ROTATION_SYNTHESIS_EPSILON,
    factories: Annotated[
        int | None,
        Query(
            ge=0,
            le=MAX_FACTORY_COUNT,
            description=(
                "Magic-state factories to cost. Defaults to the crossover, past which "
                "more factories buy nothing. Movable because for a small circuit the "
                "factories ARE the footprint, and a reader shown only the total will "
                "read a correct number as a broken one."
            ),
        ),
    ] = None,
) -> CatalogEntryEstimate:
    """This entry's fault-tolerant cost under a named assumption set, or why it has none (E4).

    Derived from the published record's own `portableCircuit` on read — never
    stored, so it cannot disagree with the circuit rendered beside it. Nothing
    here executes or simulates anything: every layer is integer arithmetic over
    the assumption set, which is why it is safe on an anonymous route.

    Four outcomes, and two of them carry no number. Branch on `basis` before
    rendering anything: a circuit whose cost this stack cannot state must not be
    shown as a cheap one, which is the whole reason the refusals are typed.

    The 404 comes from the same lookup the detail route uses, so a slug that
    resolves there resolves here.
    """
    entry = await catalog_repo.get_public_catalog_entry(
        scope, session, slug, authority=settings.catalog_authority
    )
    try:
        resolved = resolve_assumptions(assumptions, epsilon)
    except UnknownAssumptionSet as exc:
        # 422, not a fallback to the default. A caller who asked for one set and
        # silently received another's numbers has a wrong answer that looks right.
        raise HTTPException(
            status_code=422,
            detail=f"unknown assumption set {exc.args[0]!r}; known: {sorted(BUILTIN_ASSUMPTION_SETS)}",
        ) from exc
    return estimate_for_record(entry.record, entry.slug, resolved, factory_count=factories)
