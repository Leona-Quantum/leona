"""Personal access tokens — the credential an outside tool holds to act as a person.

Revision ID: 0069
Revises: 0068

Proposal 7 Phase B (ai-ops 349 feature 7), shaped by the owner's ruling on **ai-ops
362, option 1**: *"Tokens may read and start verified runs, and expire after at most
90 days; hardware jobs come later under their own permission"*. Until now the only
credential the API accepted was a WorkOS session JWT, which expires within the hour
and lives only in a browser, so nothing outside the website could act as a user for
longer than a session.

## What is stored, and what deliberately is not

The token is 32 random bytes behind a `lq_pat_` prefix. **The table never holds it.**
`token_hash` is its SHA-256, and that is what a request is matched against. SHA-256
and not a slow hash on purpose: bcrypt and argon2 exist to make a LOW-entropy secret
expensive to guess, and this secret has 256 bits of entropy — there is no dictionary
to run, so a work factor would buy nothing and cost a round of it on every single
authenticated request.

`tail` is four characters of the secret, kept so a person can tell two of their own
tokens apart and match one against a leak report. Four, as GitHub shows: enough to
identify, far too few to narrow the search.

## Why it carries a workspace_id but is NOT row-level-security scoped

This is an **identity/bootstrap** table in 0053's classification — the fourth member
of the group that file names as `users`, `workspaces` and `memberships`, and it is
there for exactly the reason 0053 gives for those three: it has to be readable BEFORE
a `workspace_id` is known. `auth/deps.py` resolves a presented token to a row in order
to learn which workspace the caller is even in; a policy keyed on
`majorana.workspace_id` would be consulted before anything could have set that GUC and
would refuse the lookup that derives it.

So the census line in 0053 reads 7 + 17 + 3 + 3 + 2 = 32 tables; with this one it is
33, and the GLOBAL/IDENTITY group is 4. The protection is the same as those three
have: the repository layer (`repos/personal_access_tokens.py`) admits no `user_id`
other than `scope.user_id`, so no query in it can read or revoke another account's
token. `provider_credentials` — the other per-person credential table — is excluded
from RLS on a neighbouring argument, that its tenant boundary is the user and not the
workspace.

The `workspace_id` column is still real and still constrained: it fixes which tenant a
token acts in, decided when it was minted and never re-read from the user's current
active workspace. An automation's reach must not change because its owner clicked a
workspace switcher on the website.

## The constraints, and which of them are the security boundary

- `uq_personal_access_tokens_hash` — one row per secret. Also what makes the auth
  lookup a single index seek rather than a scan.
- `ck_personal_access_tokens_scopes` — every token has `read`, and every scope is one
  of `read` / `run`. **There is no `hardware`, and that absence is the ruling.** A
  token cannot be granted a power that has no name here, so "hardware jobs come later"
  is enforced by the alphabet rather than by a check somebody has to remember.
- `ck_personal_access_tokens_lifetime` — expiry is after creation and no more than 90
  days past it, from the same ruling. Written as an interval on the row rather than
  trusted to the API: a ceiling that only the caller of the mint route enforces is a
  ceiling that the next writer of an insert does not know about.
- `ck_personal_access_tokens_tail` — exactly four characters, so nothing can quietly
  start storing more of the secret in the clear under this column's name.

## Grants

`app_rw` gets select, insert and update — it mints, it stamps `last_used_at`, and it
sets `revoked_at`. **DELETE is revoked**, on the same argument 0068 makes for
`comments`: revocation here is a column, never a missing row, because "this token was
used at 03:00 and I killed it at 09:00" has to stay answerable afterwards, and 0052's
`ALTER DEFAULT PRIVILEGES` would otherwise hand DELETE over on every table the migrate
role creates.

## Downgrade

Refuses once any token exists. Dropping the table would revoke every live automation
silently — the tokens would simply stop working, with no record of what they were.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None

#: Mirrors `majorana_contracts.tokens.TokenScope`. Written out as a literal rather
#: than imported so the migration keeps saying what it said on the day it ran, even
#: after the enum gains a member; a later scope needs its own migration to widen this,
#: which is the review point.
_SCOPES = ("read", "run")

#: `majorana_contracts.tokens.MAX_TOKEN_LIFETIME_DAYS`, same reasoning.
_MAX_LIFETIME_DAYS = 90


def upgrade() -> None:
    op.create_table(
        "personal_access_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        # SHA-256, lower-case hex. The secret itself is in no column.
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("tail", sa.Text(), nullable=False),
        sa.Column(
            "scopes",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("array['read']::text[]"),
        ),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.CheckConstraint(
            "char_length(name) between 1 and 80", name="ck_personal_access_tokens_name_length"
        ),
        sa.CheckConstraint(
            "char_length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_personal_access_tokens_hash_shape",
        ),
        sa.CheckConstraint("char_length(tail) = 4", name="ck_personal_access_tokens_tail"),
        sa.CheckConstraint(
            "array_length(scopes, 1) between 1 and {n} "
            "and 'read' = any(scopes) "
            "and scopes <@ array[{members}]::text[]".format(
                n=len(_SCOPES),
                members=", ".join(f"'{scope}'" for scope in _SCOPES),
            ),
            name="ck_personal_access_tokens_scopes",
        ),
        sa.CheckConstraint(
            f"expires_at > created_at "
            f"and expires_at <= created_at + interval '{_MAX_LIFETIME_DAYS} days'",
            name="ck_personal_access_tokens_lifetime",
        ),
    )
    # The auth path: one seek per authenticated request, on the whole hash. Unique
    # because two rows sharing a secret would make "which token was this" unanswerable
    # exactly when it is being asked.
    op.create_index(
        "uq_personal_access_tokens_hash",
        "personal_access_tokens",
        ["token_hash"],
        unique=True,
    )
    # The settings page: this person's tokens, newest first. Ids are uuid7, so id
    # order is creation order and no second column is needed for the sort. DESC is
    # written out so the cursor form is a forward scan, as 0068's inbox index is.
    op.create_index(
        "ix_personal_access_tokens_owner",
        "personal_access_tokens",
        ["user_id", sa.text("id DESC")],
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update on personal_access_tokens to app_rw;
            revoke delete on personal_access_tokens from app_rw;
          end if;
        end
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from personal_access_tokens) then
            raise exception 'cannot downgrade 0069: personal access tokens exist';
          end if;
        end
        $$;
        """
    )
    op.drop_table("personal_access_tokens")
