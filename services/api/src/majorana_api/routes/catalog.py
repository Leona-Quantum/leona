"""Anonymous public catalog read endpoints (repository Step 6 / Neon cutover Slice C).

Read-only. The catalog reader scope comes exclusively from server configuration
(PublicCatalogScope), never from the caller, and resolves to a 404 when
SYSTEM_CATALOG_ENABLED is false — so these routes are inert until an operator
provisions and enables the system catalog. No write/publish surface is exposed
over HTTP: publication is an attributable human action run through the operator
CLI (catalog_admin), not a request handler.
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from majorana_contracts import (
    CatalogEntryEstimate,
    CatalogEntryProfile,
    CatalogEstimateList,
    CatalogProfileList,
    PublicCatalogEntry,
)
from majorana_estimation import BUILTIN_ASSUMPTION_SETS

from ..auth.catalog_deps import PublicCatalogScope
from ..auth.deps import DbSession, get_settings
from ..catalog_estimate import (
    ContradictoryPrecision,
    DEFAULT_ROTATION_SYNTHESIS_EPSILON,
    MAX_FACTORY_COUNT,
    MAX_ROTATION_SYNTHESIS_EPSILON,
    MIN_ROTATION_SYNTHESIS_EPSILON,
    UnknownAssumptionSet,
    estimate_for_record,
    estimate_list_for_records,
    resolve_assumptions,
)
from ..catalog_profile import profile_for_record, profile_list_for_records
from ..catalog_read_model import project_record_for_list_view
from ..repos import catalog as catalog_repo
from ..settings import Settings

router = APIRouter()
logger = logging.getLogger(__name__)

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


def _precision_conflict(exc: ContradictoryPrecision) -> str:
    """Say which two values disagreed, because the caller supplied both."""
    from_identity, from_query = exc.args
    if from_query is None:
        return (
            f"the precision {from_identity!r} carried in the assumption-set identity is "
            f"outside the accepted range "
            f"({MIN_ROTATION_SYNTHESIS_EPSILON:g}, {MAX_ROTATION_SYNTHESIS_EPSILON:g})"
        )
    return (
        f"the assumption-set identity states eps={from_identity!r} and the epsilon "
        f"parameter states {from_query!r}. Pass one, or make them agree — an estimate "
        "is labelled with its precision, so guessing which you meant would label it "
        "with a budget you did not choose."
    )


async def _whole_published_corpus(scope, session, settings, *, derivation: str):
    """Every published entry, bounded — and **loud** when the bound bites.

    `/catalog/estimates` and `/catalog/profiles` both derive one row per entry
    and neither paginates: a client holding the response treats it as the whole
    corpus, because there is nothing in the payload to say otherwise. At 283
    published entries against a 500 ceiling that is true. Past 500 it stops being
    true *silently*, and the visible symptom is the worst possible one — the
    omitted entries appear in the browse list under "Not ranked", which reads as
    "this entry has no circuit" when in fact nobody measured it.

    The bound stays: this is an anonymous route and an unbounded response is a
    DoS surface, which is why the ceiling exists. What must not stay is the
    silence. Raised as a review finding on #261 (CodeRabbit) and answered this
    way rather than by paginating, because paginating these two is a payload
    shape change on both plus the client, and it is not R1's business.
    """
    entries = await catalog_repo.list_public_catalog_entries(
        scope,
        session,
        authority=settings.catalog_authority,
        limit=CATALOG_ENTRIES_MAX_LIMIT,
        offset=0,
    )
    if len(entries) >= CATALOG_ENTRIES_MAX_LIMIT:
        total = await catalog_repo.count_public_catalog_entries(
            scope, session, authority=settings.catalog_authority
        )
        if total > len(entries):
            logger.error(
                "catalog %s listing truncated: served %d of %d published entries; "
                "the remainder render as unranked, which reads as 'no circuit'",
                derivation,
                len(entries),
                total,
            )
    return entries


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
    # `None`, not the default value: `resolve_assumptions` has to be able to tell
    # "the caller chose this precision" from "nobody said", because an identity
    # may carry one too and two stated precisions must agree rather than one
    # quietly winning.
    epsilon: Annotated[
        float | None,
        Query(gt=MIN_ROTATION_SYNTHESIS_EPSILON, lt=MAX_ROTATION_SYNTHESIS_EPSILON),
    ] = None,
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
    except ContradictoryPrecision as exc:
        raise HTTPException(status_code=422, detail=_precision_conflict(exc)) from exc
    entries = await _whole_published_corpus(scope, session, settings, derivation="estimate")
    return estimate_list_for_records(
        [(entry.slug, entry.record) for entry in entries],
        resolved,
        factory_count=factories,
    )


@router.get("/catalog/profiles", response_model=CatalogProfileList)
async def list_catalog_profiles(
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
) -> CatalogProfileList:
    """Every published entry's circuit size (R1).

    Exists so the browse list can rank by depth and two-qubit count at all —
    fetching this per card would be 283 requests.

    **No parameters, and that is the difference from `/catalog/estimates`.** A
    profile is a property of the circuit, so there is no assumption set to state
    and nothing in the payload that only holds under one: every row here is
    rankable against every other unconditionally. The arithmetic is a single pass
    over each step list, which is why this stays safe on an anonymous route.
    """
    entries = await _whole_published_corpus(scope, session, settings, derivation="profile")
    return profile_list_for_records([(entry.slug, entry.record) for entry in entries])


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
            description=(
                "Assumption set, as either the registry key (`gidney-2025@v2`, "
                "`composed-trapped-ion@v2`) or the full identity an estimate carries "
                "(`gidney-2025@v2+eps=1e-06`). Defaults to `gidney-2025@v2`. A "
                "precision given both here and in `epsilon` must agree. Costs under "
                "two different identities are not comparable and must not be ranked "
                "against each other."
            )
        ),
    ] = None,
    # `None` rather than the default value, so `resolve_assumptions` can tell a
    # chosen precision from an unstated one when the identity carries one too.
    epsilon: Annotated[
        float | None,
        Query(
            gt=MIN_ROTATION_SYNTHESIS_EPSILON,
            lt=MAX_ROTATION_SYNTHESIS_EPSILON,
            description=(
                "Per-rotation Clifford+T synthesis error. The reader's error budget, "
                "not a hardware property — it is why an estimate is an estimate, so it "
                "is a knob rather than a constant and it travels in the response. "
                f"Defaults to {DEFAULT_ROTATION_SYNTHESIS_EPSILON:g}."
            ),
        ),
    ] = None,
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
    except ContradictoryPrecision as exc:
        raise HTTPException(status_code=422, detail=_precision_conflict(exc)) from exc
    return estimate_for_record(entry.record, entry.slug, resolved, factory_count=factories)


@router.get("/catalog/entries/{slug}/profile", response_model=CatalogEntryProfile)
async def get_catalog_entry_profile(
    slug: str,
    scope: PublicCatalogScope,
    session: DbSession,
    settings: _Settings,
) -> CatalogEntryProfile:
    """This entry's circuit size, or why it has none (R1).

    Derived from the published record's own `portableCircuit` on read — never
    stored, so it cannot disagree with the circuit rendered beside it.

    Branch on `present` before rendering. An entry with no circuit is not a
    zero-gate circuit, and printing five zeros for one would state a measurement
    nobody took.

    The 404 comes from the same lookup the detail and estimate routes use, so a
    slug that resolves there resolves here.
    """
    entry = await catalog_repo.get_public_catalog_entry(
        scope, session, slug, authority=settings.catalog_authority
    )
    return profile_for_record(entry.record, entry.slug)
