"""Minting, listing, revoking and resolving notebook share links (migration 0072).

Proposal 7 ("Notebooks and courses for a class"), approved ai-ops 349 option 2.

## Creator-only, and why that is a narrower rule than `require_write`

Every mint/list/revoke function here takes a `Scope`, as the authz invariant
requires, resolves the notebook through the ordinary `notebooks_repo.get_notebook`
(which proves it belongs to `scope.workspace_id`), and then checks
`scope.user_id == notebook.owner_user_id` itself. That check is NOT
`require_write` or `require_admin` — a workspace ADMIN who did not create the
notebook is refused exactly like an ordinary MEMBER, because "only the person who
created a notebook sees its answer keys" (ai-ops 260) is a rule about the
CREATOR, not about workspace role, and a share link is a door onto exactly the
content that ruling protects.

## `resolve_presented` is the one exception, and is shaped like 0069's

It runs BEFORE any scope exists, takes no `Scope`, and admits exactly one input:
the presented secret. See migration 0072's docstring for why this table carries
no row-level-security policy and why that is a different argument from the one
`notebooks` itself already declined (0058, on `visibility`).

## Why the secret never reaches a log

Identical shape to `personal_access_tokens.py`: `mint` is the only function that
holds the plaintext, for the length of one return. `resolve_presented` raises
nothing carrying its argument — a token that does not resolve returns `None`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid

from majorana_contracts import Scope
from majorana_contracts.notebook_shares import (
    MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK,
    SHARE_TOKEN_PREFIX,
    SHARE_TOKEN_TAIL_CHARS,
    NotebookShareLink as ShareLinkResource,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Notebook, NotebookShareLink
from ._base import AuthzError, NotFoundError, touched_now
from . import notebooks as notebooks_repo

#: Bytes of entropy behind the prefix. 32 bytes is 256 bits — see 0072's docstring
#: on why this is hashed with SHA-256 rather than a work-factor hash.
_SECRET_BYTES = 32

#: How stale `last_viewed_at` may be before a read bothers to write it. Mirrors
#: `personal_access_tokens.LAST_USED_RESOLUTION`: a link being polled or a page
#: being refreshed must not turn every anonymous read into a write.
LAST_VIEWED_RESOLUTION = dt.timedelta(minutes=5)


class ShareLinkLimitReached(Exception):
    """This notebook already holds `MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK` live links."""


class IdempotencyKeyAlreadyMinted(Exception):
    """This key already minted a link, whose secret is gone and cannot be re-shown.

    Carries the row so the caller can name it — its id and tail are what somebody
    needs to revoke it and mint a fresh one.
    """

    def __init__(self, row: NotebookShareLink) -> None:
        super().__init__("idempotency key already minted a share link")
        self.row = row


class IdempotencyKeyReused(Exception):
    """The same key, a different notebook. Refused rather than answered with the
    other request's link — the rule `POST /v1/tokens` and `POST /v1/runs` follow."""


def idempotency_request_hash(*, notebook_id: uuid.UUID, expires_in_days: int | None) -> str:
    """What "the same request" means for a mint. The two fields that decide what
    the link IS: which notebook, and how long it lives."""
    payload = f"{notebook_id}\u0000{expires_in_days}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def new_token() -> str:
    """A fresh credential: the public prefix followed by 256 bits from the OS
    CSPRNG. See `personal_access_tokens.new_token` for why this is a named
    function rather than inlined — `.gitleaks.toml`'s detection rule for
    `lq_shr_` is tested against this function's real output."""
    return f"{SHARE_TOKEN_PREFIX}{secrets.token_urlsafe(_SECRET_BYTES)}"


def hash_token(presented: str) -> str:
    """The stored form of a share token. Lower-case hex, matching 0072's check
    constraint. Separate from `mint` so the mint path and the public resolve path
    provably agree."""
    return hashlib.sha256(presented.encode("utf-8")).hexdigest()


def to_resource(row: NotebookShareLink) -> ShareLinkResource:
    return ShareLinkResource(
        id=row.id,
        notebook_id=row.notebook_id,
        tail=row.tail,
        created_at=row.created_at,
        expires_at=row.expires_at,
        last_viewed_at=row.last_viewed_at,
        revoked_at=row.revoked_at,
    )


def _live(row: NotebookShareLink, *, now: dt.datetime) -> bool:
    """Not revoked and not expired. One definition, used by the mint ceiling and
    by the public resolve path, so "how many live links" and "will this one open"
    cannot disagree."""
    return row.revoked_at is None and (row.expires_at is None or row.expires_at > now)


async def _owned_notebook(scope: Scope, session: AsyncSession, notebook_id: uuid.UUID) -> Notebook:
    """The notebook, proven to belong to `scope.workspace_id` AND to have been
    created by `scope.user_id`.

    Two different failures collapse to the same `NotFoundError` for the first
    check (absent-or-not-yours, the repository layer's usual rule) but the
    second — a real member of the right workspace who simply did not create this
    notebook — is a distinguishable `AuthzError`, on purpose: "a non-creator
    member cannot mint a link" is worth a 403 that says so, not a 404 that looks
    like the notebook does not exist to someone who can otherwise see it fine.
    """
    notebook = await notebooks_repo.get_notebook(scope, session, notebook_id)
    if scope.user_id != notebook.owner_user_id:
        raise AuthzError("only this notebook's creator may manage its share links")
    return notebook


async def mint(
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    *,
    expires_in_days: int | None = None,
    idempotency_key: str | None = None,
    now: dt.datetime | None = None,
) -> tuple[str, NotebookShareLink]:
    """Create a share link for a notebook the caller created.

    Returns the plaintext and the row, exactly once, on the same argument
    `personal_access_tokens.mint` makes: nothing stores the plaintext, so there is
    no second chance to read it.
    """
    moment = now if now is not None else touched_now()
    notebook = await _owned_notebook(scope, session, notebook_id)
    request_hash = (
        idempotency_request_hash(notebook_id=notebook_id, expires_in_days=expires_in_days)
        if idempotency_key
        else None
    )

    # The notebook row, locked for the rest of this transaction — same argument
    # `personal_access_tokens.mint` makes for locking the user row: counting live
    # links and then inserting one is a read-then-write, and two concurrent mints
    # near the ceiling must not both read the same count and both insert.
    await session.execute(select(Notebook.id).where(Notebook.id == notebook.id).with_for_update())

    if idempotency_key:
        existing = (
            await session.execute(
                select(NotebookShareLink).where(
                    NotebookShareLink.created_by_user_id == scope.user_id,
                    NotebookShareLink.idempotency_key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.idempotency_request_hash != request_hash:
                raise IdempotencyKeyReused
            raise IdempotencyKeyAlreadyMinted(existing)

    live_now = [
        row for row in await list_links(scope, session, notebook_id) if _live(row, now=moment)
    ]
    if len(live_now) >= MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK:
        raise ShareLinkLimitReached

    presented = new_token()
    secret = presented.removeprefix(SHARE_TOKEN_PREFIX)
    expires_at = moment + dt.timedelta(days=expires_in_days) if expires_in_days else None

    row = NotebookShareLink(
        id=uuid7(),
        notebook_id=notebook.id,
        workspace_id=scope.workspace_id,
        created_by_user_id=scope.user_id,
        token_hash=hash_token(presented),
        tail=secret[-SHARE_TOKEN_TAIL_CHARS:],
        created_at=moment,
        expires_at=expires_at,
        idempotency_key=idempotency_key,
        idempotency_request_hash=request_hash,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return presented, row


async def list_links(
    scope: Scope, session: AsyncSession, notebook_id: uuid.UUID
) -> list[NotebookShareLink]:
    """This notebook's links, newest first. Revoked and expired ones included —
    same reasoning as `personal_access_tokens.list_tokens`: a revoked link is the
    record of something that was live until somebody killed it."""
    await _owned_notebook(scope, session, notebook_id)
    return list(
        (
            await session.execute(
                select(NotebookShareLink)
                .where(NotebookShareLink.notebook_id == notebook_id)
                .order_by(NotebookShareLink.id.desc())
            )
        )
        .scalars()
        .all()
    )


async def revoke(
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    link_id: uuid.UUID,
    *,
    now: dt.datetime | None = None,
) -> NotebookShareLink:
    """Revoke one of this notebook's links. Idempotent: revoking twice is not an
    error. A link belonging to a different notebook (or a caller who is not the
    creator) is `NotFoundError` / `AuthzError` exactly as `_owned_notebook` gives."""
    await _owned_notebook(scope, session, notebook_id)
    row = (
        await session.execute(
            select(NotebookShareLink).where(
                NotebookShareLink.id == link_id,
                NotebookShareLink.notebook_id == notebook_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("notebook share link")
    if row.revoked_at is None:
        row.revoked_at = now if now is not None else touched_now()
        await session.flush()
    return row


async def resolve_presented(
    session: AsyncSession,
    presented: str,
    *,
    now: dt.datetime | None = None,
) -> NotebookShareLink | None:
    """Find the live share link a request presented, or `None`.

    Takes NO `Scope` — see the module docstring. `None` covers every failure the
    same way: wrong prefix, no such hash, revoked, expired. The caller answers 404
    without saying which, per the brief: "revoked/expired links -> 404 (not 403)".

    Stamps `last_viewed_at`, debounced by `LAST_VIEWED_RESOLUTION`, so a link
    being polled does not turn every anonymous read into a write.
    """
    if not presented.startswith(SHARE_TOKEN_PREFIX):
        return None
    moment = now if now is not None else touched_now()
    row = (
        await session.execute(
            select(NotebookShareLink).where(NotebookShareLink.token_hash == hash_token(presented))
        )
    ).scalar_one_or_none()
    if row is None or not _live(row, now=moment):
        return None
    if row.last_viewed_at is None or moment - row.last_viewed_at >= LAST_VIEWED_RESOLUTION:
        row.last_viewed_at = moment
        await session.flush()
    return row
