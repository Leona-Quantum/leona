"""A least-authority Scope for the anonymous, single-notebook share view.

Mirrors `auth/qapp_deps.py::get_public_qapp_scope` in shape, and differs from it
in exactly the place that matters: a Qapp's public scope carries a NIL
`workspace_id` because `repos/qapps.py::public_qapp` reads across every tenant,
filtered only by `visibility = 'public'` (0055's `public_read` policy). A shared
notebook has no such policy — migration 0072 deliberately does not add one, on
the argument in its docstring — so this scope's `workspace_id` is the REAL
workspace the resolved share link names, and `notebooks_repo.get_notebook`'s
ordinary `tenant_isolation` RLS predicate is what admits the read. `user_id`
stays nil: it identifies nobody, and the one place that would matter —
`notebooks.py`'s owner-vs-everyone-else redaction branch — treats "nil" exactly
like any other non-owner, which is the point.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

import majorana_contracts as contracts
from fastapi import Depends, HTTPException
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from ..orm import NotebookShareLink
from ..repos import notebook_share_links as share_links_repo
from ..repos import set_rls_context
from ..request_models import RequestModel
from ..settings import Settings
from .deps import DbSession, get_settings


class LookupNotebookShareRequest(RequestModel, contracts.LookupNotebookShareRequest):
    """`RequestModel`'s NUL-byte guard, on the one body every anonymous caller of
    this service can send. `test_request_models_refuse_nul.py` scans `routes/`
    for `*Request` classes; this one lives here because the dependency that
    parses it does, but it inherits the same guard for the same reason every
    other request body in this service does."""


#: Matches nobody. RLS on `notebooks`/`notebook_versions`/`notebook_turns` never
#: reads `scope.user_id`, and the one Python-level check that does
#: (`routes/notebooks.py::get_notebook_version`'s `scope.user_id ==
#: notebook.owner_user_id`) must always be false here — an anonymous share-link
#: viewer is never the notebook's owner, by construction, so nil can never
#: collide with a real owner's id.
_ANONYMOUS_USER_ID = UUID(int=0)


@dataclass(frozen=True)
class ResolvedPublicShare:
    """What a valid, live share token resolves to. Plain values, not the ORM row
    — the row belongs to the session this ran in, exactly the same reasoning
    `auth/deps.PresentedToken` gives for not parking a detached instance on
    `request.state`."""

    scope: Scope
    notebook_id: UUID
    share_link_id: UUID


async def get_public_notebook_share(
    body: LookupNotebookShareRequest,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ResolvedPublicShare:
    """Resolve the presented token to a live share link, or 404.

    The token arrives in the REQUEST BODY, not the URL — see
    `LookupNotebookShareRequest`'s docstring in the contracts package for why a
    path- or query-embedded secret was the wrong shape here: this deployment's
    uvicorn runs with default access logging on, and an access log line carries
    the method, path and status, never a JSON body.

    404, never 403 or 401, for revoked, expired, malformed and never-existed
    alike — per the brief: a share link's whole point is that its holder has no
    other credential to be challenged for, and distinguishing "this token is
    wrong" from "this token used to work" would confirm a real link to whoever
    is guessing.
    """
    row: NotebookShareLink | None = await share_links_repo.resolve_presented(session, body.token)
    if row is None:
        raise HTTPException(404, "notebook not found")
    scope = Scope(user_id=_ANONYMOUS_USER_ID, workspace_id=row.workspace_id, role=Role.VIEWER)
    await set_rls_context(session, scope, enforce=settings.rls_enforced)
    return ResolvedPublicShare(scope=scope, notebook_id=row.notebook_id, share_link_id=row.id)


PublicNotebookShare = Annotated[ResolvedPublicShare, Depends(get_public_notebook_share)]
