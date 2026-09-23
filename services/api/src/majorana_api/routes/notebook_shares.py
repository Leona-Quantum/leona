"""Public, read-only notebook share links: mint/list/revoke, and the anonymous view.

Proposal 7 ("Notebooks and courses for a class"), approved ai-ops 349 option 2. The
progress note on 349 (2026-09-22): "Public share links are an anonymous route, so
they go through the security checklist" — `05-security.md` §1a. See the PR for
which §2 items are met.

Three routes are creator-only and behave like every other authenticated route in
this service (`CurrentScope`, `repos/notebook_share_links.py` enforces "creator,
not just any workspace member"). The fourth, `POST /notebooks/shared/lookup`, is
the anonymous one: no `CurrentScope`, no bearer token, nothing but the token in
its body (`auth/notebook_share_deps.py::PublicNotebookShare`) — a POST rather
than the more obvious `GET .../{token}` so the secret never lands in a
path-logging access log; see that dependency's docstring.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import majorana_contracts as contracts
from fastapi import APIRouter, Header, HTTPException, Response
from majorana_contracts.notebook_shares import MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK
from majorana_contracts.notebooks import SOLUTION_ONLY_ROLES

from ..auth.deps import CurrentScope, DbSession
from ..auth.notebook_share_deps import PublicNotebookShare
from ..repos import notebook_share_links as share_links_repo
from ..repos import notebooks as notebooks_repo
from ..request_models import RequestModel

router = APIRouter()


class CreateNotebookShareLinkRequest(RequestModel, contracts.CreateNotebookShareLinkRequest):
    pass


@router.post(
    "/notebooks/{notebook_id}/share-links",
    response_model=contracts.MintedNotebookShareLink,
    status_code=201,
)
async def create_notebook_share_link(
    notebook_id: uuid.UUID,
    body: CreateNotebookShareLinkRequest,
    scope: CurrentScope,
    session: DbSession,
    idempotency_key: Annotated[
        str | None, Header(alias="Idempotency-Key", min_length=1, max_length=255)
    ] = None,
) -> contracts.MintedNotebookShareLink:
    """Mint a share link for a notebook the caller created, and return it ONCE.

    Creator-only: a workspace admin who did not create this notebook is refused
    exactly like an ordinary member (`AuthzError` -> 403), per ai-ops 260 — a share
    link is a door onto the same content that ruling protects. Idempotency follows
    `POST /v1/tokens`'s shape exactly, for the same reason: the secret is what a
    lost response cannot get back, so a retry is a 409 naming the link already
    minted rather than a silent second one.
    """
    try:
        presented, row = await share_links_repo.mint(
            scope,
            session,
            notebook_id,
            expires_in_days=body.expires_in_days,
            idempotency_key=idempotency_key,
        )
    except share_links_repo.ShareLinkLimitReached:
        raise HTTPException(
            409,
            detail={
                "error": f"This notebook already has {MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK} live "
                "share links. Revoke one before creating another.",
                "reason": "share_link_limit_reached",
            },
        ) from None
    except share_links_repo.IdempotencyKeyAlreadyMinted as already:
        raise HTTPException(
            409,
            detail={
                "error": "That request already created a share link, and its secret cannot "
                f"be shown again. Revoke lq_shr_…{already.row.tail} and create another.",
                "reason": "idempotency_key_already_minted",
                "share_link_id": str(already.row.id),
                "tail": already.row.tail,
            },
        ) from None
    except share_links_repo.IdempotencyKeyReused:
        raise HTTPException(
            409,
            detail={
                "error": "This Idempotency-Key was used for a different request. Use a new "
                "key, or repeat the original request exactly.",
                "reason": "idempotency_key_reused",
            },
        ) from None
    return contracts.MintedNotebookShareLink(
        token=presented, record=share_links_repo.to_resource(row)
    )


@router.get(
    "/notebooks/{notebook_id}/share-links",
    response_model=contracts.NotebookShareLinkList,
)
async def list_notebook_share_links(
    notebook_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> contracts.NotebookShareLinkList:
    """This notebook's links, newest first, including revoked and expired ones.

    No secret and no hash is in this response — `NotebookShareLink` has no field
    that could carry one.
    """
    rows = await share_links_repo.list_links(scope, session, notebook_id)
    return contracts.NotebookShareLinkList(items=[share_links_repo.to_resource(r) for r in rows])


@router.delete("/notebooks/{notebook_id}/share-links/{link_id}", status_code=204)
async def revoke_notebook_share_link(
    notebook_id: uuid.UUID, link_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> None:
    """Revoke one of this notebook's links. Takes effect on its very next read:
    the public route re-resolves the token from the database on every request, so
    there is no cache anywhere in this service for a revocation to catch up with."""
    await share_links_repo.revoke(scope, session, notebook_id, link_id)


def _redact_report_for_public(
    spec: contracts.NotebookSpec, report: contracts.ExecutionReport | None
) -> contracts.ExecutionReport | None:
    """Strip execution results for cells `for_learner()` treats as secret.

    `for_learner()` (ai-ops 260's redaction) only touches `NotebookSpec` — it has
    no opinion about `ExecutionReport`, because the ordinary non-owner view
    (`GET /notebooks/{id}/versions/{seq}`) returns the report UNCHANGED for a
    signed-in workspace member. That is an existing, separate surface with its own
    review history; this route is new and anonymous, and the brief's own test —
    "none of a solution/answer cell's text appears anywhere in the response" —
    would fail without this, because a `solution` cell keeps its ORIGINAL id after
    `for_learner()` swaps its source for the stub, and a prior run's
    `CellResult` for that id can still carry the real code's stdout or return
    value. So this drops any `CellResult` whose id belonged to a
    `SOLUTION_ONLY_ROLES` cell in the (pre-redaction) spec, and is a second,
    narrower guard on a field `for_learner()` does not touch — not a second copy
    of what it already does to `cells`.

    What this does NOT catch, and is not trying to: a later cell that reads and
    prints a variable the solution cell defined. That is a pre-existing property
    of how notebooks share state across cells and is out of scope for a share-link
    feature to fix; flagged in the PR rather than silently assumed away.
    """
    if report is None:
        return None
    redacted_ids = {cell.id for cell in spec.cells if cell.role in SOLUTION_ONLY_ROLES}
    if not redacted_ids:
        return report
    return report.model_copy(
        update={"cells": [result for result in report.cells if result.id not in redacted_ids]}
    )


@router.post(
    "/notebooks/shared/lookup",
    response_model=contracts.PublicNotebookView,
)
async def lookup_public_notebook_share(
    resolved: PublicNotebookShare,
    session: DbSession,
    response: Response,
) -> contracts.PublicNotebookView:
    """The anonymous view: one notebook, answers redacted, no workspace or owner
    identity anywhere in the response.

    A POST carrying the token in its body, not a `GET .../{token}` — see
    `auth/notebook_share_deps.py::LookupNotebookShareRequest`'s docstring for why:
    this deployment's uvicorn logs every request line by default, and a path
    segment is IN that line while a JSON body is not. Also means Cloudflare's
    default cache rules already exclude this route (they cache GET/HEAD only),
    which is one whole class of PR-923-style cache-poisoning risk this route
    never has a chance to hit. `Cache-Control` is still set explicitly rather
    than left to a framework default, on that same PR's lesson: a default that
    looked safe once was not, for a response that varies per request. A revoked
    or expired link already 404s one layer down (`auth/notebook_share_deps.py`),
    before this handler runs at all.
    """
    response.headers["Cache-Control"] = "private, no-store"
    notebook = await notebooks_repo.get_notebook(resolved.scope, session, resolved.notebook_id)
    framework = contracts.NotebookFramework.model_validate(notebook.framework)
    version = await notebooks_repo.get_current_version(
        resolved.scope, session, resolved.notebook_id
    )
    if version is None or version.status != contracts.NotebookVersionStatus.READY.value:
        return contracts.PublicNotebookView(
            title=notebook.title,
            kind=contracts.NotebookKind(notebook.kind),
            summary=notebook.summary,
            language=notebook.language,
            framework=framework,
            status="not_ready",
        )
    resource = notebooks_repo.version_to_resource(version, full=True)
    assert isinstance(resource, contracts.NotebookVersion)  # full=True always returns this
    learner = resource.spec.for_learner() if resource.spec is not None else None
    report = (
        _redact_report_for_public(resource.spec, resource.report)
        if resource.spec is not None
        else None
    )
    return contracts.PublicNotebookView(
        title=notebook.title,
        kind=contracts.NotebookKind(notebook.kind),
        summary=notebook.summary,
        language=notebook.language,
        framework=framework,
        status="ready",
        version_seq=resource.seq,
        cells=learner.cells if learner is not None else [],
        report=report,
    )
