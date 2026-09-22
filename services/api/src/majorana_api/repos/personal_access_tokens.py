"""Minting, listing, revoking and resolving personal access tokens (migration 0069).

Proposal 7 Phase B, under the owner's ruling on **ai-ops 362, option 1**: *"Tokens may
read and start verified runs, and expire after at most 90 days; hardware jobs come
later under their own permission"*.

## Scoped on the USER, not the workspace

Every function here takes a `Scope` first, as the authz invariant requires, and then
filters on `scope.user_id` rather than `scope.workspace_id`. That is narrower, not
weaker, and it is the same argument `provider_credentials.py` makes: a credential
belongs to a person. A workspace predicate would let a workspace ADMIN who is not the
token's owner list or revoke it, which is not a power anyone has been given — a
colleague cannot revoke your credentials, and an admin who could would be able to
silently break your automations.

`resolve_presented` is the one exception and is deliberately shaped differently: it
runs BEFORE any scope exists, because resolving the token is how a scope comes to
exist. It therefore takes no `Scope` and admits exactly one input, the presented
secret, from which it derives everything. Nothing in it is keyed on anything the
caller can vary except the secret itself.

## Why the secret never reaches a log

`mint` is the only function that has the plaintext, and it holds it in a local for the
length of one return. Everything stored is derived: a SHA-256 for matching and four
characters for recognition. No function here accepts a token as a keyword that could
end up in a repr, an exception message or a query parameter, and `resolve_presented`
raises nothing carrying its argument — a token that does not resolve returns `None`
and the caller says "invalid token" without ever naming what was presented.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid

from majorana_contracts import Scope
from majorana_contracts.tokens import (
    MAX_TOKEN_LIFETIME_DAYS,
    MAX_TOKENS_PER_USER,
    TOKEN_PREFIX,
    TOKEN_TAIL_CHARS,
    PersonalAccessToken as TokenResource,
    TokenScope,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import PersonalAccessToken, User
from ._base import NotFoundError, touched_now

#: Bytes of entropy behind the prefix. 32 bytes is 256 bits, which is why this is
#: hashed with SHA-256 rather than a work-factor hash — see 0069's docstring.
_SECRET_BYTES = 32

#: How stale `last_used_at` may be before a request bothers to write it. A token
#: driving a loop would otherwise turn every read into a write, and "when was this
#: last used" is a question people ask in days, not seconds.
LAST_USED_RESOLUTION = dt.timedelta(minutes=5)


class TokenLimitReached(Exception):
    """This account already holds `MAX_TOKENS_PER_USER` live tokens."""


class IdempotencyKeyAlreadyMinted(Exception):
    """This key already minted a token, whose secret is gone and cannot be re-shown.

    Carries the row so the caller can name it — its id and tail are what somebody needs
    in order to revoke the credential their lost response was carrying.
    """

    def __init__(self, row: PersonalAccessToken) -> None:
        super().__init__("idempotency key already minted a token")
        self.row = row


class IdempotencyKeyReused(Exception):
    """The same key, a different request. Refused rather than answered with the
    other request's token, which is the rule `POST /v1/runs` and `POST /v1/comments`
    already follow."""


def idempotency_request_hash(*, name: str, expires_in_days: int, scopes: list[str]) -> str:
    """What "the same request" means for a mint.

    The three fields that decide what the token IS. A caller who retries with the same
    key but asks for different scopes is not retrying, they are asking for something
    else under a used key, and that is the 409 this hash exists to produce.
    """
    payload = f"{name}\u0000{expires_in_days}\u0000{','.join(sorted(scopes))}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def new_token() -> str:
    """A fresh credential: the public prefix followed by 256 bits from the OS CSPRNG.

    A named function rather than three lines inside `mint` so the thing that GENERATES
    a token can be called by the checks that have to match it — `.gitleaks.toml`'s
    detection rule is tested against this function's real output rather than against a
    hand-written lookalike, which is how a scanner rule ends up matching only the
    example somebody typed while writing it.

    The prefix is outside the random part, so it is a constant a scanner can anchor on
    and not something a caller can influence.
    """
    return f"{TOKEN_PREFIX}{secrets.token_urlsafe(_SECRET_BYTES)}"


def hash_token(presented: str) -> str:
    """The stored form of a token. Lower-case hex, matching 0069's check constraint.

    Separate from `mint` so the auth path and the mint path provably agree: a test can
    hash a minted token and find the row, which is the property the whole scheme rests
    on, and neither side gets to choose its own digest.
    """
    return hashlib.sha256(presented.encode("utf-8")).hexdigest()


def normalise_scopes(scopes: list[TokenScope] | None) -> list[str]:
    """Every token reads; `run` is added on top, never instead.

    Applied here rather than in the request model so a row written by any path obeys
    it — the database check constraint says the same thing, and this is what keeps the
    two from disagreeing about a token minted by something that is not the route.
    """
    asked = set(scopes or [])
    ordered = [TokenScope.READ]
    if TokenScope.RUN in asked:
        ordered.append(TokenScope.RUN)
    return [str(scope) for scope in ordered]


def to_resource(row: PersonalAccessToken) -> TokenResource:
    return TokenResource(
        id=row.id,
        tail=row.tail,
        name=row.name,
        workspace_id=row.workspace_id,
        scopes=[TokenScope(value) for value in row.scopes],
        created_at=row.created_at,
        expires_at=row.expires_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
    )


def _live(row: PersonalAccessToken, *, now: dt.datetime) -> bool:
    """Not revoked and not expired. One definition, used by the mint ceiling and by
    the auth path, so "how many do I hold" and "will this one work" cannot disagree."""
    return row.revoked_at is None and row.expires_at > now


async def mint(
    scope: Scope,
    session: AsyncSession,
    *,
    name: str,
    expires_in_days: int = MAX_TOKEN_LIFETIME_DAYS,
    scopes: list[TokenScope] | None = None,
    idempotency_key: str | None = None,
    now: dt.datetime | None = None,
) -> tuple[str, PersonalAccessToken]:
    """Create a token for the caller in the caller's own active workspace.

    Returns the plaintext and the row, in that order and exactly once. The caller is
    expected to put the plaintext into one response and then drop it; nothing stores
    it, so there is no second chance to read it and no way for this function to hand it
    back later.

    The lifetime ceiling is checked here as well as at the database. Two checks for one
    rule because they fail differently and both failures matter: the request model
    turns an over-long ask into a 422 a person can read, and 0069's constraint means a
    future writer that is not this function still cannot exceed it.
    """
    moment = now if now is not None else touched_now()
    if not 1 <= expires_in_days <= MAX_TOKEN_LIFETIME_DAYS:
        raise ValueError(f"expires_in_days must be between 1 and {MAX_TOKEN_LIFETIME_DAYS}")
    normalised = normalise_scopes(scopes)
    request_hash = (
        idempotency_request_hash(name=name, expires_in_days=expires_in_days, scopes=normalised)
        if idempotency_key
        else None
    )

    # The caller's own row, locked for the rest of this transaction. Everything below
    # is a check-then-insert -- count the live tokens, then add one -- and without the
    # lock two concurrent mints near the ceiling both read the same count and both
    # insert, leaving the account above a bound that is there to bound abuse. The same
    # shape and the same remedy as the artifact quota (`repos/artifacts.py`), and the
    # same lock ordering: `users` is the last link in that module's stated chain
    # (artifact -> project -> workspace -> user) and nothing here holds anything above
    # it, so this introduces no new cycle.
    #
    # It also serialises the idempotency lookup below against a concurrent retry, which
    # the partial unique index would otherwise have to catch as an IntegrityError.
    await session.execute(select(User.id).where(User.id == scope.user_id).with_for_update())

    if idempotency_key:
        existing = (
            await session.execute(
                select(PersonalAccessToken).where(
                    PersonalAccessToken.user_id == scope.user_id,
                    PersonalAccessToken.idempotency_key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.idempotency_request_hash != request_hash:
                raise IdempotencyKeyReused
            # Same key, same request: the first one worked and its secret is gone.
            # Answering with a SECOND token here is the failure this whole branch
            # exists to prevent -- the first would stay live and unknown to the caller.
            raise IdempotencyKeyAlreadyMinted(existing)

    live_now = [row for row in await list_tokens(scope, session) if _live(row, now=moment)]
    if len(live_now) >= MAX_TOKENS_PER_USER:
        raise TokenLimitReached

    presented = new_token()
    secret = presented.removeprefix(TOKEN_PREFIX)

    row = PersonalAccessToken(
        id=uuid7(),
        user_id=scope.user_id,
        workspace_id=scope.workspace_id,
        name=name,
        token_hash=hash_token(presented),
        tail=secret[-TOKEN_TAIL_CHARS:],
        scopes=normalised,
        created_at=moment,
        expires_at=moment + dt.timedelta(days=expires_in_days),
        idempotency_key=idempotency_key,
        idempotency_request_hash=request_hash,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return presented, row


async def list_tokens(scope: Scope, session: AsyncSession) -> list[PersonalAccessToken]:
    """The caller's own tokens, newest first. Revoked and expired ones included.

    Both are kept in the list on purpose: a revoked token is the record of something
    that was live until somebody killed it, and an expired one still answers "did that
    automation stop because its token ran out". Neither can be presented, so listing
    them grants nothing.
    """
    return list(
        (
            await session.execute(
                select(PersonalAccessToken)
                .where(PersonalAccessToken.user_id == scope.user_id)
                .order_by(PersonalAccessToken.id.desc())
            )
        )
        .scalars()
        .all()
    )


async def revoke(
    scope: Scope,
    session: AsyncSession,
    token_id: uuid.UUID,
    *,
    now: dt.datetime | None = None,
) -> PersonalAccessToken:
    """Revoke one of the caller's own tokens. Idempotent: revoking twice is not an error.

    A token belonging to anyone else is `NotFoundError` — the same "absent or not
    yours" the rest of the repository layer gives, and here it is load-bearing: a
    distinguishable 403 would tell a caller that a token id they guessed exists.
    """
    row = (
        await session.execute(
            select(PersonalAccessToken).where(
                PersonalAccessToken.id == token_id,
                PersonalAccessToken.user_id == scope.user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("personal access token")
    if row.revoked_at is None:
        row.revoked_at = now if now is not None else touched_now()
        await session.flush()
    return row


async def resolve_presented(
    session: AsyncSession,
    presented: str,
    *,
    now: dt.datetime | None = None,
) -> PersonalAccessToken | None:
    """Find the live token a request presented, or `None`.

    Takes NO `Scope`, and is the only function in the repository layer that legitimately
    does not: it runs before a scope exists, because resolving the token is how one
    comes to exist. What makes that safe is that its single input is the secret itself —
    there is no user id, workspace id or token id it could be pointed at instead, so
    there is no query here that a caller can widen.

    `None` covers every failure the same way: wrong prefix, no such hash, revoked,
    expired. The caller answers 401 without saying which, so a probe cannot use the
    response to tell "this token never existed" from "this token existed and expired
    yesterday" — the second would confirm a real credential to whoever found it.

    Stamps `last_used_at`, at `LAST_USED_RESOLUTION`, so a token in a loop does not turn
    every read into a write.
    """
    if not presented.startswith(TOKEN_PREFIX):
        return None
    moment = now if now is not None else touched_now()
    row = (
        await session.execute(
            select(PersonalAccessToken).where(
                PersonalAccessToken.token_hash == hash_token(presented)
            )
        )
    ).scalar_one_or_none()
    if row is None or not _live(row, now=moment):
        return None
    if row.last_used_at is None or moment - row.last_used_at >= LAST_USED_RESOLUTION:
        row.last_used_at = moment
        await session.flush()
    return row
