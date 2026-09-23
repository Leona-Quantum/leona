"""Notebook share links — a public, read-only, revocable door onto one notebook.

Revision ID: 0072
Revises: 0071

Proposal 7 feature ("Notebooks and courses for a class"), approved on ai-ops 349
option 2 (all twelve approved). The progress note on 349 (2026-09-22) is explicit
that this is an anonymous route and goes through the `05-security.md` §1a
checklist; see the PR for which §2 items are met.

## What this is, and what it deliberately is not

A notebook's creator can mint a link that lets ANYONE who holds it read that one
notebook, redacted exactly as a non-creator workspace member already sees it
(`NotebookSpec.for_learner()`, ai-ops 260). It is not a visibility flag: `notebooks`
already carries a `visibility` column (migration 0058) that this table does not
touch and does not read. 0058 declined to add a `public_read` RLS policy on
`notebooks` "ahead of a route that uses it", per ADR-0028's ask that the ADDITION
be reviewed deliberately; this migration is that review, and the answer is still
no. Qapps (0055) DOES have such a policy — `public_read on qapps for select using
(visibility = 'public')` — and that shape is wrong here on purpose: it makes every
public row readable by GUESSING its id, which is fine for a Qapp gallery entry and
is exactly the property a token-gated share link must not have. A notebook stays
un-guessable; only the possession of an unguessable token (below) opens one.

## The shape, copied from 0069 and why

Same credential shape as `personal_access_tokens` (0069), for the same reason: the
table is looked up by a caller who has no session and therefore no `workspace_id`
to filter on. `token_hash` is the SHA-256 of a `lq_shr_`-prefixed, 256-bit random
secret (`majorana_contracts.notebook_shares.SHARE_TOKEN_PREFIX`); the secret itself
is in no column. SHA-256 rather than a work-factor hash, on the identical argument
0069 makes: 256 bits of entropy leaves no dictionary to be slow against, and a
work factor would tax every anonymous read for nothing. `tail` is four characters
so the creator's own list can tell two links apart.

## Why this table carries NO row-level-security policy

This is not `notebooks`' own escape hatch (see above) — it is a SEPARATE table, and
the argument for leaving it unprotected by RLS is 0069's identity/bootstrap
argument, not 0058's public-read argument: the resolve-by-hash lookup that answers
"does this token open a notebook, and which one" has to run BEFORE any
`workspace_id` is known, because resolving it is how the caller's (anonymous, but
real) scope for the notebook tables comes to exist — the same shape
`auth/qapp_deps.py::get_public_qapp_scope` already uses for Qapps, and the same one
`auth/deps.py::_token_scope` uses for personal access tokens. This makes the count
in 0053's identity/bootstrap census 5 (`users`, `workspaces`, `memberships`,
`personal_access_tokens`, now `notebook_share_links`), which is worth a reviewer's
eyes precisely because it is a new addition to a short, deliberately short list.
What stands in for RLS is the repository layer: `repos/notebook_share_links.py`
admits no `notebook_id` to its owner-facing functions (mint/list/revoke) other than
one already proven to belong to `scope.workspace_id` via `notebooks_repo.get_notebook`,
and the anonymous resolve function accepts nothing but the presented secret.

## The columns that are not on `personal_access_tokens`

- `notebook_id` — CASCADE on delete. There is no notebook hard-delete today
  (`soft_delete_notebook` only stamps `deleted_at`), so in practice this cascade is
  dead code until one is added; it is still the correct FK action, on the same
  argument 0058 makes for `notebook_versions`: a link to a notebook that no longer
  exists is not a thing, and a soft-deleted notebook already 404s through
  `get_notebook`'s `deleted_at is null` predicate before this table is even
  consulted.
- `created_by_user_id` — who minted it. Not necessarily `notebooks.owner_user_id`
  at READ time (an owner can change, though nothing does that yet); checked to
  equal the CURRENT owner at MINT time by the repository layer, per the owner's
  scope: "a non-creator member cannot mint a link" is a rule about who may create
  one, not a rule this column enforces by itself.
- `expires_at` — nullable. Unlike 0069's ceiling (an owner ruling on ai-ops 362,
  "expire after at most 90 days"), there is no such ruling for share links; the
  brief says only "optionally an expiry". The 365-day check constraint below is
  this author's own defensive bound, not an owner ruling, and is called out as
  such in the PR for exactly that reason.
- `last_viewed_at` — stamped by the anonymous read path itself, same
  `LAST_USED_RESOLUTION`-style debounce 0069 uses for `last_used_at`, so a link
  being polled does not turn every read into a write.

## Idempotency

`POST /v1/notebooks/{id}/share-links` takes an `Idempotency-Key`, as
`services/api/AGENTS.md` asks of every mutation. The columns and their unique
index are copied verbatim from 0069, including the reasoning: the secret is the
thing a lost response cannot get back, so a replayed key answers 409 naming the
link it already minted (id + tail) rather than inventing a second, orphaned link.

## Grants

`app_rw` gets select, insert, update. DELETE is revoked, on 0069's and 0068's
argument: revocation is a column (`revoked_at`), never a missing row, because
"this link was live at 03:00 and killed at 09:00" must stay answerable, and 0052's
`ALTER DEFAULT PRIVILEGES` would otherwise hand DELETE to every table the migrate
role creates.

## Downgrade

Refuses once any link exists, for the same reason 0069 refuses: dropping the table
would silently break every live link with no record of what it granted.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None

#: `majorana_contracts.notebook_shares.MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK` — see
#: that constant's docstring. Not a database check constraint: counting LIVE
#: (unrevoked, unexpired) links is a read-then-write the repository layer already
#: locks around (mint), and a CHECK constraint cannot see `now()` consistently
#: across a multi-row count. Written here only as a cross-reference for a reader
#: of the schema who has not opened the contracts package.
_MAX_LIVE_LINKS_PER_NOTEBOOK = 5

#: `majorana_contracts.notebook_shares.MAX_SHARE_LINK_LIFETIME_DAYS`. This
#: author's own defensive ceiling, not an owner ruling — see the module docstring.
_MAX_LIFETIME_DAYS = 365


def upgrade() -> None:
    op.create_table(
        "notebook_share_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Denormalized and fixed at mint, exactly like personal_access_tokens.workspace_id:
        # the anonymous resolve path needs a workspace_id to arm RLS with before it has
        # touched `notebooks` at all, and re-deriving it by joining at resolve time would
        # put a tenant-scoped table back in the lookup that has to run before any tenant
        # is known.
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        # SHA-256, lower-case hex. The secret itself is in no column — see 0069.
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("tail", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_viewed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=True),
        sa.Column("idempotency_request_hash", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "char_length(token_hash) = 64 and token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_notebook_share_links_hash_shape",
        ),
        sa.CheckConstraint("char_length(tail) = 4", name="ck_notebook_share_links_tail"),
        sa.CheckConstraint(
            f"expires_at is null or "
            f"(expires_at > created_at and expires_at <= created_at + interval '{_MAX_LIFETIME_DAYS} days')",
            name="ck_notebook_share_links_lifetime",
        ),
        sa.CheckConstraint(
            "idempotency_key is null or char_length(idempotency_key) between 1 and 255",
            name="ck_notebook_share_links_idempotency_key_length",
        ),
        sa.CheckConstraint(
            "(idempotency_key is null) = (idempotency_request_hash is null)",
            name="ck_notebook_share_links_idempotency_pair",
        ),
    )
    # The anonymous read path: one seek on the whole hash, unique for the same reason
    # 0069's token index is — two rows sharing a secret make "which link was this"
    # unanswerable exactly when it is being asked.
    op.create_index(
        "uq_notebook_share_links_hash",
        "notebook_share_links",
        ["token_hash"],
        unique=True,
    )
    # The creator's own list: this notebook's links, newest first. Ids are uuid7, so
    # id order is creation order.
    op.create_index(
        "ix_notebook_share_links_notebook",
        "notebook_share_links",
        ["notebook_id", sa.text("id DESC")],
    )
    # A key is the CREATOR's own, per user rather than per notebook — mirrors 0069's
    # `uq_personal_access_tokens_idempotency_key` exactly, and for the same reason:
    # two people who reuse the same string must each get their own outcome.
    op.create_index(
        "uq_notebook_share_links_idempotency_key",
        "notebook_share_links",
        ["created_by_user_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update on notebook_share_links to app_rw;
            revoke delete on notebook_share_links from app_rw;
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
          if exists (select 1 from notebook_share_links) then
            raise exception 'cannot downgrade 0072: notebook share links exist';
          end if;
        end
        $$;
        """
    )
    op.drop_table("notebook_share_links")
