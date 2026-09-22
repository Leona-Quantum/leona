"""Personal access tokens: mint, list, revoke.

Proposal 7 Phase B, owner ruling **ai-ops 362 option 1**. What a token may then DO is
not decided here — it is `auth/token_access.py`, which every request carrying one
passes through. This module is only the three requests a signed-in person makes about
their own tokens.

**None of these three routes is reachable BY a token.** `GET /v1/tokens` is in
`token_access.READ_DENIED`, and the two writes are in no allowlist, so the default-shut
rule refuses them. A credential that could mint another credential, or revoke the one
an owner would use to stop it, is a privilege escalation with extra steps; these are
account settings and they need the account.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from majorana_contracts.tokens import (
    MAX_TOKENS_PER_USER,
    CreateTokenRequest,
    MintedToken,
    PersonalAccessTokenList,
)

from ..auth.deps import CurrentScope, DbSession, get_settings
from ..repos import personal_access_tokens as tokens_repo
from ..settings import Settings

router = APIRouter()


def _enabled(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    """404 every route here while `personal_access_tokens_enabled` is false.

    404 rather than 403 or 501: a deployment where the feature is off should look like
    one where it does not exist, so a probe cannot use this service to learn that the
    feature exists elsewhere and is merely switched off here. See that setting's
    docstring for why it ships off — the §2 k6 abuse run is still owed.
    """
    if not settings.personal_access_tokens_enabled:
        raise HTTPException(404, "not found")


@router.get("/tokens", response_model=PersonalAccessTokenList, dependencies=[Depends(_enabled)])
async def list_tokens(scope: CurrentScope, session: DbSession) -> PersonalAccessTokenList:
    """The caller's own tokens, newest first, including revoked and expired ones.

    No secret and no hash is in this response — `PersonalAccessToken` has no field
    that could carry one. What it does carry is `last_used_at`, which is the column
    somebody actually needs when they are deciding whether revoking a token they no
    longer recognise will break something.
    """
    rows = await tokens_repo.list_tokens(scope, session)
    return PersonalAccessTokenList(tokens=[tokens_repo.to_resource(row) for row in rows])


@router.post(
    "/tokens", response_model=MintedToken, status_code=201, dependencies=[Depends(_enabled)]
)
async def mint_token(
    body: CreateTokenRequest,
    scope: CurrentScope,
    session: DbSession,
    idempotency_key: Annotated[
        str | None, Header(alias="Idempotency-Key", min_length=1, max_length=255)
    ] = None,
) -> MintedToken:
    """Mint a token in the caller's active workspace and return it ONCE.

    The workspace is the caller's own scope, never a field of the body: a body that
    names its own tenant is a body that can be edited to name another one. The
    lifetime ceiling (90 days, the owner's ruling) is a `le=` on the request model, so
    an over-long ask is a 422 naming the field rather than a token quietly cut short.

    ## Idempotency, and why a retry is a 409 rather than a replay

    Takes an `Idempotency-Key`, as `services/api/AGENTS.md` asks of every mutation, but
    it cannot honour that header's usual contract and does not pretend to. Elsewhere a
    retry after a lost response returns what the first request created; here the thing
    the caller lost is the secret, and nothing stores it, so no implementation could
    return it — and one that could would be a worse system than one that cannot.

    What a retry must not do is mint a SECOND token, leaving the first live and unknown
    to the caller: an orphan credential nobody will revoke because nobody knows it
    exists. So a replayed key answers **409 `idempotency_key_already_minted`**, naming
    the token the first request made by id and tail, which is what somebody needs in
    order to revoke it and mint again. The same key with a different body is
    `idempotency_key_reused`, the contract `POST /v1/comments` already has.
    """
    try:
        presented, row = await tokens_repo.mint(
            scope,
            session,
            name=body.name,
            expires_in_days=body.expires_in_days,
            scopes=body.scopes,
            idempotency_key=idempotency_key,
        )
    except tokens_repo.TokenLimitReached:
        raise HTTPException(
            409,
            detail={
                "error": f"You already have {MAX_TOKENS_PER_USER} active access tokens. "
                "Revoke one before creating another.",
                "reason": "token_limit_reached",
            },
        ) from None
    except tokens_repo.IdempotencyKeyAlreadyMinted as already:
        raise HTTPException(
            409,
            detail={
                "error": "That request already created a token, and its secret cannot be "
                f"shown again. Revoke lq_pat_\u2026{already.row.tail} and create another.",
                "reason": "idempotency_key_already_minted",
                "token_id": str(already.row.id),
                "tail": already.row.tail,
            },
        ) from None
    except tokens_repo.IdempotencyKeyReused:
        raise HTTPException(
            409,
            detail={
                "error": "This Idempotency-Key was used for a different token. Use a new "
                "key, or repeat the original request exactly.",
                "reason": "idempotency_key_reused",
            },
        ) from None
    return MintedToken(token=presented, record=tokens_repo.to_resource(row))


@router.delete("/tokens/{token_id}", status_code=204, dependencies=[Depends(_enabled)])
async def revoke_token(token_id: uuid.UUID, scope: CurrentScope, session: DbSession) -> None:
    """Revoke one of the caller's own tokens. Takes effect on its next request.

    Idempotent, and a token belonging to anyone else is 404 rather than 403 — the
    repository's "absent or not yours", which here also keeps a guessed id from being
    confirmed as real.

    The row is kept. `revoked_at` is a column and never a missing row, so "this token
    was used at 03:00 and I killed it at 09:00" is still answerable afterwards.
    """
    await tokens_repo.revoke(scope, session, token_id)
