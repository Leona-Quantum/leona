"""Public, read-only share links for one notebook (migration 0072).

Proposal 7 ("Notebooks and courses for a class"), approved ai-ops 349 option 2.
Answer visibility is already ruled — ai-ops 260, option 1: only the person who
created a notebook sees its answer keys, hidden graders and worked solutions; a
shared notebook arrives with the answers stripped. This module does not redact
anything itself: `NotebookSpec.for_learner()` (notebooks.py) is the one function
that does, and the public route applies it unconditionally, exactly as
`GET /notebooks/{id}/versions/{seq}` already applies it to any viewer who is not
the notebook's owner.

What is new here is the DOOR, not the redaction: a creator mints an unguessable
token that lets an anonymous holder open one specific notebook, read-only, and
revoke it later. See migration 0072's docstring for why this is a token-gated
door rather than a `visibility` flag — a notebook stays un-guessable; only
possession of the token opens one.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .models import _ResourceBase
from .notebooks import Cell, ExecutionReport, NotebookFramework, NotebookKind

#: Every share token starts with this — same reasoning as `tokens.TOKEN_PREFIX`:
#: a distinctive prefix is what makes a leaked token recognisable as OUR
#: credential (to gitleaks, to GitHub secret scanning, to a human skimming a log)
#: rather than fifty characters that look like anything else. Deliberately
#: DIFFERENT from `lq_pat_`: a share link and a personal access token are
#: different credentials with different blast radii if leaked (one reads a
#: single already-redacted notebook; the other acts as a person), and giving
#: them the same prefix would make a leak report ambiguous about which kind of
#: secret it found.
SHARE_TOKEN_PREFIX = "lq_shr_"

#: Characters of the secret kept in the clear, as with `TOKEN_TAIL_CHARS` — enough
#: for a creator to tell two of their own links apart, far too few to narrow a
#: 256-bit search.
SHARE_TOKEN_TAIL_CHARS = 4

#: The most LIVE (unrevoked, unexpired) links one notebook may carry at once —
#: the brief's "at most a small number of live links per notebook". Not an owner
#: ruling; sized the way `MAX_TOKENS_PER_USER` is, as a bound on how much one
#: compromised or careless account can hand out before anyone notices, well above
#: anything a real class needs (one link per class is the expected case).
MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK = 5

#: A defensive ceiling on `expires_in_days`, this author's own choice rather than
#: an owner ruling — unlike `tokens.MAX_TOKEN_LIFETIME_DAYS`, which IS one
#: (ai-ops 362). Flagged in the PR for exactly that reason: it is a judgment
#: call, not a decision already made, and the owner may want a different number
#: or none at all.
MAX_SHARE_LINK_LIFETIME_DAYS = 365


class NotebookShareLink(_ResourceBase):
    """One link, as its creator sees it in the share dialog.

    Carries no secret and no hash — nothing here can be presented to the public
    route. `tail` is how the creator recognises which link a row is.
    """

    id: UUID
    notebook_id: UUID
    #: Shown as `lq_shr_…AbCd`. The client formats it; this is the tail alone.
    tail: str = Field(min_length=SHARE_TOKEN_TAIL_CHARS, max_length=SHARE_TOKEN_TAIL_CHARS)
    created_at: datetime
    expires_at: datetime | None = None
    #: `None` means nobody has opened the link yet.
    last_viewed_at: datetime | None = None
    #: Set when the creator revoked it. Kept and shown rather than deleted, so
    #: "this link was live at 03:00 and I killed it at 09:00" stays answerable —
    #: same argument 0069 makes for `PersonalAccessToken.revoked_at`.
    revoked_at: datetime | None = None


class NotebookShareLinkList(_ResourceBase):
    items: list[NotebookShareLink] = Field(default_factory=list)


class MintedNotebookShareLink(_ResourceBase):
    """The response to `POST /v1/notebooks/{id}/share-links`, the only object that
    carries the secret.

    `token` is returned once. The server stores a SHA-256 of it and nothing else,
    so losing it means revoking this link and minting another — never a second
    read.
    """

    #: The full credential, `lq_shr_` followed by the secret. Never logged, never
    #: stored in the clear, present in no other response.
    token: str
    record: NotebookShareLink


class CreateNotebookShareLinkRequest(_ResourceBase):
    """Mint a link for one notebook the caller owns.

    The notebook is a path parameter, not a body field, for the same reason a
    token's workspace is not one (`tokens.CreateTokenRequest`): the route already
    knows which notebook from the URL, and a body that repeated it would be a
    second thing that could disagree with the first.
    """

    #: `None` means the link does not expire. `MAX_SHARE_LINK_LIFETIME_DAYS` is
    #: this author's own ceiling — see the module docstring — so a value above it
    #: is a 422 rather than a silent clamp, on the same argument
    #: `tokens.CreateTokenRequest.expires_in_days` makes.
    expires_in_days: int | None = Field(default=None, ge=1, le=MAX_SHARE_LINK_LIFETIME_DAYS)


class LookupNotebookShareRequest(_ResourceBase):
    """`POST /v1/notebooks/shared/lookup`'s body, and the WHOLE reason this is a
    POST with a body rather than the more obvious `GET /notebooks/shared/{token}`.

    A share token in a URL PATH ends up in every request line a proxy or an
    application server logs — this deployment's own uvicorn runs with default
    access logging on (`services/api/Dockerfile`), so a path-embedded token would
    print to stdout, and stdout is what Cloud Run ships to the log sink. A field
    in a JSON body does not appear in an access log line, which logs the method,
    path and status and nothing past the `?`. The web app carries the token to
    the browser in a URL FRAGMENT (`#token`, never sent to any server at all) and
    reads it client-side before making this call — see `apps/web/app/shared/
    notebooks/page.tsx`. Found by this feature's own authz test asserting on
    `caplog`, the same discipline `tokens.py`'s tests already apply to bearer
    tokens; a token in a path segment is the one case that check would have
    missed if the route had shipped as a GET.
    """

    token: str = Field(min_length=1, max_length=200)


class PublicNotebookView(BaseModel):
    """What an anonymous holder of a valid link sees. Nothing else.

    `extra="forbid"` and an explicit field list, the same defence
    `PublicQappSummary` uses: this is the type that decides what crosses the
    public boundary, so a field silently added elsewhere in the notebook resource
    cannot ride along by accident. There is no `id`, `notebook_id`, `workspace_id`,
    `owner_user_id`, or `run_id` anywhere on this model, on purpose — a public
    viewer is told nothing about which tenant, which account, or which internal
    ids the notebook lives behind.

    `cells` and `report` are ALREADY the redacted half — the route applies
    `NotebookSpec.for_learner()` before this model is ever constructed, exactly as
    `GET /notebooks/{id}/versions/{seq}` does for a signed-in non-owner. This model
    does not repeat that check; it trusts the route did it, the same way
    `PublicQappSummary` trusts its route to have filtered on `visibility`.
    """

    model_config = ConfigDict(extra="forbid")

    title: str
    kind: NotebookKind
    summary: str
    language: Literal["en", "ja"]
    framework: NotebookFramework
    #: `"ready"` means `cells`/`report` describe the current, generated version;
    #: `"not_ready"` means the notebook has no ready version yet (still
    #: generating, or its only version failed) and both are empty. The public
    #: page renders a "not ready yet" state rather than a blank one.
    status: Literal["ready", "not_ready"]
    version_seq: int | None = None
    cells: list[Cell] = Field(default_factory=list)
    report: ExecutionReport | None = None


__all__ = [
    "MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK",
    "MAX_SHARE_LINK_LIFETIME_DAYS",
    "SHARE_TOKEN_PREFIX",
    "SHARE_TOKEN_TAIL_CHARS",
    "CreateNotebookShareLinkRequest",
    "LookupNotebookShareRequest",
    "MintedNotebookShareLink",
    "NotebookShareLink",
    "NotebookShareLinkList",
    "PublicNotebookView",
]
