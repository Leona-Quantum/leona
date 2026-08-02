"""Per-user provider credentials — scoped on the caller, not on the workspace.

## Where this sits against the authz invariant

AGENTS.md rule 2: repository functions take a `Scope` first and apply workspace
scoping themselves, and `system.py` is the sole exception. This module takes a
`Scope` first and is not that exception — but the predicate it applies is
`scope.user_id`, not `scope.workspace_id`, and that choice was made deliberately
rather than inherited.

The row is a person's own credential for a third-party provider. It is not
tenant data: it does not belong to a workspace, it is not visible to a
workspace's other members, and it follows its owner into every workspace they
act in — the same shape the weekly run allowance and the weekly hardware-spend
allowance already have, both of which `runs` and `qpu_runs` key on `user_id`
inside Scope-taking repositories. So `workspace_id` is not a narrower filter
here, it is a WRONG one: adding it would mean a user who switched workspaces
appeared to have no IBM account connected, and connecting again would collide
with the `(user_id, provider)` unique constraint.

`system.py` was the other candidate and is the wrong home. Its contract is that
it "may never expose tenant data to request handlers", and it exists for
questions asked before a Scope exists or outside every tenant. These rows are
reached from ordinary request handlers that carry a perfectly good Scope; the
question is not "which tenant" but "which person", and a Scope answers that
directly. Putting them in `system.py` would move a user-owned secret into the
one module with no scoping at all, to avoid an argument about which half of the
Scope is the right predicate.

**Every query in this module is keyed on `scope.user_id`.** There is no function
here that takes a user id as a parameter, so there is no call site that can pass
somebody else's. A caller who wants another user's credential has no expression
for it. `test_provider_credentials_live.py` drives two real accounts through the
real routes and asserts exactly that.

## Why no role gate

`require_write` is not called here, and that is deliberate. The role on a Scope
describes what the caller may do *inside a workspace*. A user who has been added
to somebody else's workspace as a VIEWER, and is acting in it, still owns their
own IBM account and must still be able to connect and disconnect it — refusing
that would mean the product's answer to "connect your quantum hardware account"
depended on which workspace happened to be active. The gate that matters here is
identity, and it is applied by every predicate below.

## What is never in this module

Plaintext. Rows carry `ciphertext` produced by `majorana_api.credential_crypto`;
this layer stores and returns the encrypted blob and never decrypts, so a
credential cannot leak through a repository call, a repr, or a query log.
"""

from __future__ import annotations

import datetime as dt

from majorana_contracts import Scope
from sqlalchemy import delete as sql_delete
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import ProviderCredential


async def get(scope: Scope, session: AsyncSession, provider: str) -> ProviderCredential | None:
    """The caller's own credential for `provider`, or None.

    None rather than a raised `NotFoundError`: "you have not connected IBM yet"
    is the ordinary state of every account that has never used hardware, and the
    status route has to render it rather than handle it.
    """
    stmt = select(ProviderCredential).where(
        ProviderCredential.user_id == scope.user_id,
        ProviderCredential.provider == provider,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def has_credential(scope: Scope, session: AsyncSession, provider: str) -> bool:
    """Whether the caller holds a credential, without loading the ciphertext.

    Selects the id rather than the row. The submission gate asks this on a read
    endpoint the Studio polls, and there is no reason for an encrypted secret to
    travel from Postgres into this process to answer a boolean.
    """
    stmt = select(ProviderCredential.id).where(
        ProviderCredential.user_id == scope.user_id,
        ProviderCredential.provider == provider,
    )
    return (await session.execute(stmt)).scalar_one_or_none() is not None


async def upsert(
    scope: Scope,
    session: AsyncSession,
    *,
    provider: str,
    ciphertext: str,
    key_id: str,
    instance: str | None,
    label: str | None,
    last_verified_at: dt.datetime,
) -> ProviderCredential:
    """Store the caller's credential, replacing whatever was there.

    Replace rather than refuse-if-present: reconnecting is what a user does when
    they rotate their key on IBM's dashboard, and a 409 telling them to
    disconnect first would leave an account in the state where the old key is
    gone from IBM and the new one is refused here.

    `last_used_at` is deliberately not cleared on a replace. It records that
    something of this user's ran, which stays true across a key rotation, and
    resetting it would erase the only evidence a user has that their hardware
    connection has ever done anything.
    """
    existing = await get(scope, session, provider)
    now = dt.datetime.now(dt.UTC)
    if existing is not None:
        await session.execute(
            update(ProviderCredential)
            .where(
                ProviderCredential.id == existing.id,
                ProviderCredential.user_id == scope.user_id,
            )
            .values(
                ciphertext=ciphertext,
                key_id=key_id,
                instance=instance,
                label=label,
                last_verified_at=last_verified_at,
                updated_at=now,
            )
        )
        await session.refresh(existing)
        return existing
    record = ProviderCredential(
        id=uuid7(),
        user_id=scope.user_id,
        provider=provider,
        ciphertext=ciphertext,
        key_id=key_id,
        instance=instance,
        label=label,
        last_verified_at=last_verified_at,
    )
    session.add(record)
    await session.flush()
    return record


async def delete(scope: Scope, session: AsyncSession, provider: str) -> bool:
    """Remove the caller's credential. True if a row was actually deleted.

    A real DELETE, not a flag. "Disconnect" has to mean the ciphertext is gone:
    a soft delete leaves a decryptable key in the database after the user has
    been told it was removed, which is the difference between a product feature
    and a lie about one.

    The `user_id` predicate is on the DELETE itself rather than on a preceding
    SELECT, so there is no window in which the row this deletes differs from the
    row this checked.
    """
    result = await session.execute(
        sql_delete(ProviderCredential).where(
            ProviderCredential.user_id == scope.user_id,
            ProviderCredential.provider == provider,
        )
    )
    return bool(result.rowcount)


async def mark_provider_success(scope: Scope, session: AsyncSession, provider: str) -> None:
    """Record that a provider call made with this credential succeeded.

    Stamps BOTH `last_used_at` and `last_verified_at`, and the second one is the
    point. A provider call that succeeds is proof the key was accepted — that is
    the same fact the connect-time IAM exchange establishes, arriving later.
    Without this refresh, `last_verified_at` would only ever be written by the
    PUT that stored the key: a creation timestamp wearing a verification label,
    reporting "verified" as of the day it was pasted for a credential the user
    revoked on IBM's dashboard last week. A surface rendering "Last verified"
    beside it would be stating something false.

    The two fields still differ. `last_used_at` is null for a credential
    connected and never used, and a reconnection moves verification without
    moving use.
    """
    now = dt.datetime.now(dt.UTC)
    await session.execute(
        update(ProviderCredential)
        .where(
            ProviderCredential.user_id == scope.user_id,
            ProviderCredential.provider == provider,
        )
        .values(last_used_at=now, last_verified_at=now, updated_at=now)
    )
