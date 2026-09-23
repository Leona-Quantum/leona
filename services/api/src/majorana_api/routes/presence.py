"""Presence: who else in the workspace is looking at a run, a notebook or a
saved circuit, right now (proposal 9, second slice).

    POST /v1/presence/heartbeat   I am still looking at this
    GET  /v1/presence             who else is here, right now

Who may do what is decided in `repos/presence.py`'s module docstring: every
current member, viewer included, may heartbeat and read. This module adds
nothing to that; it serializes and meters.

Every refusal that concerns a thing outside the caller's workspace is the same
404 the rest of the API gives for a row that does not exist, because the
repository layer raises the same `NotFoundError` for both.
"""

from __future__ import annotations

import uuid

import majorana_contracts as contracts
from fastapi import APIRouter, HTTPException, Request, Response
from majorana_contracts import PresenceTargetType, Scope

from ..auth.deps import CurrentScope, DbSession
from ..repos import presence as presence_repo
from ..request_models import RequestModel

router = APIRouter()


class HeartbeatRequest(RequestModel, contracts.PresenceHeartbeatRequest):
    pass


def _to_viewer(viewer: presence_repo.Viewer) -> contracts.PresenceViewer:
    return contracts.PresenceViewer(
        user_id=viewer.user_id, display_name=viewer.display_name, handle=viewer.handle
    )


def _meter(request: Request, scope: Scope) -> None:
    """Count one heartbeat against the caller's own per-minute ceiling.

    Keyed by the account, the same shape `routes/comments.py::_meter` uses:
    checked before the repository is called, so a refused heartbeat costs no
    query, and reading (`GET /v1/presence`) is never metered — the same choice
    comments makes, on the same reasoning: a buggy tab retrying a WRITE in a
    tight loop is the failure this bounds, and reading is not that.
    """
    decision = request.app.state.presence_limiter.check(str(scope.user_id))
    if not decision.allowed:
        raise HTTPException(
            429,
            detail={
                "error": "You are sending presence updates too quickly. Wait a moment and try again.",
                "reason": "presence_rate_limited",
            },
            headers={"Retry-After": str(decision.retry_after_s)},
        )


@router.post("/presence/heartbeat", status_code=204)
async def heartbeat(
    request: Request, body: HeartbeatRequest, scope: CurrentScope, session: DbSession
) -> Response:
    """Record that the caller is still looking at `target_id`. 404 when the
    target does not exist in the caller's workspace, whether it exists
    elsewhere or nowhere."""
    _meter(request, scope)
    await presence_repo.heartbeat(
        scope, session, target_type=body.target_type, target_id=body.target_id
    )
    return Response(status_code=204)


@router.get("/presence", response_model=contracts.PresenceList)
async def list_presence(
    scope: CurrentScope,
    session: DbSession,
    target_type: PresenceTargetType,
    target_id: uuid.UUID,
) -> contracts.PresenceList:
    """Everyone else currently looking at this run, notebook or saved circuit.
    Never includes the caller. 404 for a target outside the caller's workspace,
    byte-identical to one that does not exist."""
    viewers = await presence_repo.list_viewers(
        scope, session, target_type=target_type, target_id=target_id
    )
    return contracts.PresenceList(viewers=[_to_viewer(v) for v in viewers])
