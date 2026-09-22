"""Comments and @-mentions on runs, notebooks and saved circuits.

Revision ID: 0068
Revises: 0067

Proposal 9 (ai-ops 349, "Working together, live"), first slice: comments and
mentions. Presence and co-editing come later and add nothing here.

## Numbering

`0068`, revising `0067` (course module due dates), which revises `0066`
(hardware mitigation). The three were built at the same time and landed in that
order; this file was written against `0065` and re-pointed once `0067` was on
`dev`, so the chain stays a single head.

## Two tables

`comments` holds the words. `comment_mentions` holds who a comment mentions, one
row per person, so "mentions of me, newest first" is an index seek rather than a
scan of every body in the workspace. A mentions array on `comments` was the
alternative and loses on exactly that query: an array can be indexed with GIN,
but not in the (workspace, person, newest) order the inbox reads.

## What the constraints hold, rather than what the API promises

- **A reply is on the same thing as its parent, in the same workspace.** The
  composite foreign key `(workspace_id, target_type, target_id, parent_id) ->
  comments (workspace_id, target_type, target_id, id)` makes a reply to a comment
  on another run, or in another workspace, unrepresentable. It is MATCH SIMPLE,
  so a top-level comment (NULL `parent_id`) is not checked at all, which is what
  a top-level comment should be.
- **A mention lives in the workspace of its comment.** `comment_mentions` carries
  `workspace_id` so the inbox index can lead with it, and the composite foreign
  key `(workspace_id, comment_id) -> comments (workspace_id, id)` is what stops
  that copy disagreeing with the comment it belongs to.
- **The body is bounded**, 1 to 4000 characters (`MAX_COMMENT_CHARS` in
  majorana_contracts.comments, which exists so a client gets a 422 instead of
  hitting this CHECK).
- **`target_id` has no foreign key.** It points into one of three tables chosen
  by `target_type`, and Postgres has no polymorphic foreign key. The API checks
  that the target exists in the caller's workspace on every write and every list
  (`repos/comments.py::_require_target`), which is the check that matters for
  isolation; a comment whose notebook was later soft-deleted keeps its row,
  because nothing here ever hard-deletes a notebook, run or artifact.

## Idempotency

`POST /v1/comments` takes an `Idempotency-Key`, the same contract `POST /v1/runs`
has (0002 and 0047): a retry after a lost response returns the comment the first
request created instead of posting it twice, and a reused key with a different
body is refused. The key is stored with a SHA-256 of the admitted request, and
`uq_comments_author_idempotency_key` is unique per (workspace, author, key), not
per workspace as for runs. A key is the author's own: two people who happen to
choose the same string must each get their own comment, and the lookup must
never hand one person another person's comment. Both columns are NULL for a
comment posted without a key, and they are NULL together (`ck_comments_idempotency_pair`).

## Soft delete, and the grant that makes it the only kind

A deleted comment keeps its place in its thread (`deleted_at` is set, the API
stops serving its body). Nothing in the product deletes a comment row, so
`app_rw` is not given DELETE on `comments` — and it is REVOKED rather than merely
not granted, because 0052's `ALTER DEFAULT PRIVILEGES` hands DELETE to `app_rw`
on every table the migration role creates. The same re-revoke pattern 0052 uses
for the append-only tables. `comment_mentions` does get DELETE: editing a comment
replaces the set of people it mentions.

## Row-level security

Both tables are DIRECTLY SCOPED in 0053's classification: each carries its own
`workspace_id`, so each gets the same `tenant_isolation` policy shape as
`notebooks` (0058) — permissive while `majorana.rls_enforce` is not `'on'`, which
is every environment today, and keyed on `majorana.workspace_id` once it is. This
migration does not turn enforcement on and must not: `Settings.rls_enforced` is
that switch, and 0053's docstring says what has to be resolved first.

## Downgrade

Refuses once any comment exists. Comments are what people wrote to each other;
a downgrade that dropped them would be the only way this system ever lost them.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None

_TARGET_TYPES = ("run", "notebook", "artifact")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("edited_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=True),
        sa.Column("idempotency_request_hash", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        # Serves the thread read — `WHERE workspace_id, target_type, target_id
        # [AND id > cursor] ORDER BY id` — and is the referenced key of the
        # reply foreign key below. The ids are uuid7, so id order is time order.
        sa.UniqueConstraint(
            "workspace_id", "target_type", "target_id", "id", name="uq_comments_thread_identity"
        ),
        # The referenced key of comment_mentions' workspace-consistency FK.
        # Trivially unique (id alone is the primary key); Postgres requires the
        # constraint to exist before a composite foreign key can name it.
        sa.UniqueConstraint("workspace_id", "id", name="uq_comments_workspace_identity"),
        sa.CheckConstraint(_in("target_type", _TARGET_TYPES), name="ck_comments_target_type"),
        sa.CheckConstraint("char_length(body) between 1 and 4000", name="ck_comments_body_length"),
        sa.CheckConstraint(
            "parent_id is null or parent_id <> id", name="ck_comments_not_own_parent"
        ),
        sa.CheckConstraint(
            "idempotency_key is null or char_length(idempotency_key) between 1 and 255",
            name="ck_comments_idempotency_key_length",
        ),
        sa.CheckConstraint(
            "(idempotency_key is null) = (idempotency_request_hash is null)",
            name="ck_comments_idempotency_pair",
        ),
    )
    op.create_index(
        "uq_comments_author_idempotency_key",
        "comments",
        ["workspace_id", "author_user_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.create_foreign_key(
        "fk_comments_parent_same_thread",
        "comments",
        "comments",
        ["workspace_id", "target_type", "target_id", "parent_id"],
        ["workspace_id", "target_type", "target_id", "id"],
    )

    op.create_table(
        "comment_mentions",
        sa.Column("comment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mentioned_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("comment_id", "mentioned_user_id", name="pk_comment_mentions"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "comment_id"],
            ["comments.workspace_id", "comments.id"],
            name="fk_comment_mentions_comment_same_workspace",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["mentioned_user_id"], ["users.id"]),
    )
    # "Mentions of me, newest first" (`GET /v1/comments/mentions`):
    # `WHERE workspace_id = :ws AND mentioned_user_id = :me [AND comment_id < :cursor]
    #  ORDER BY comment_id DESC`. Equality columns first, then the ordering column,
    # the same shape and reasoning as 0065's history index. DESC written out so the
    # cursor form is a forward scan.
    op.create_index(
        "ix_comment_mentions_inbox",
        "comment_mentions",
        ["workspace_id", "mentioned_user_id", sa.text("comment_id DESC")],
    )

    # Written out per table, as 0058 does, rather than formatted from a template:
    # a policy is read in review against the one it copies, and a literal is what
    # can be compared by eye.
    op.execute("alter table comments enable row level security")
    op.execute(
        "create policy tenant_isolation on comments for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "comments.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "comments.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )
    op.execute("alter table comment_mentions enable row level security")
    op.execute(
        "create policy tenant_isolation on comment_mentions for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "comment_mentions.workspace_id = "
        "nullif(current_setting('majorana.workspace_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "comment_mentions.workspace_id = "
        "nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update on comments to app_rw;
            revoke delete on comments from app_rw;
            grant select, insert, delete on comment_mentions to app_rw;
            revoke update on comment_mentions from app_rw;
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
          if exists (select 1 from comments) then
            raise exception 'cannot downgrade 0068: comments exist';
          end if;
        end
        $$;
        """
    )
    op.drop_table("comment_mentions")
    op.drop_constraint("fk_comments_parent_same_thread", "comments", type_="foreignkey")
    op.drop_table("comments")
