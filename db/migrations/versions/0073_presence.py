"""Presence: who else in the workspace is looking at this right now.

Revision ID: 0073
Revises: 0069

Proposal 9 (ai-ops 349, "Working together, live"), second slice. First slice
(migration 0068) was comments and mentions; this is presence. Real co-editing of
a circuit is a later slice and adds nothing here — see the PR body for what it
would need.

## One table, upserted by a heartbeat

`presence` holds one row per (workspace, target, person): where they are looking
and when they were last seen there. A browser tab heartbeats every ~15s while it
is visible (Page Visibility API) and the API upserts this row; a reader is
"here" while `last_seen_at` is within the last 45s (`PRESENCE_TTL_S` in
`repos/presence.py`), read back at request time rather than stored as a boolean —
storing "present"/"absent" would need a row EXPIRING itself, which nothing here
does or should: this is a fact about the last request received, not a state
machine.

The primary key IS the natural key — `(workspace_id, target_type, target_id,
user_id)`, no surrogate `id` — because every write is an upsert on exactly that
tuple and nothing else ever looks a row up by anything less. `comment_mentions`
(0068) sets the precedent for a composite PK on this schema; this is the same
shape for the same reason: one person's presence on one thing is naturally
one row, not many.

## `target_type` / `target_id`, not a foreign key

The same shape as `comments.target_type` / `target_id` (0068), and the same
reason: `target_id` names a row in one of three tables chosen by `target_type`,
and Postgres has no polymorphic foreign key. The three target types are
CommentTargetType's three values, mirrored here as `_TARGET_TYPES` rather than
imported, because presence and comments are independent features that happen to
attach to the same three kinds of thing — the API checks the target exists in
the caller's workspace on every heartbeat and every read
(`repos/presence.py::_require_target`), the check that actually matters.

## Row-level security

Directly scoped in 0053's classification, same shape as `comments` and
`comment_mentions`: it carries its own `workspace_id`, so it gets the same
`tenant_isolation` policy — permissive while `majorana.rls_enforce` is not
`'on'` (every environment today), keyed on `majorana.workspace_id` once it is.
This migration does not turn enforcement on.

## Grants: the default is what this table wants, so nothing is revoked

0068's docstring notes that 0052's `ALTER DEFAULT PRIVILEGES` hands `app_rw`
SELECT, INSERT, UPDATE and DELETE on every table the migration role creates, and
comments revokes DELETE because a comment is never truly removed. Presence is
the opposite kind of row: it is a live fact about who is looking at something
right now, upserted and pruned by the same process, so DELETE is exactly what it
needs and the default is left alone. No grant/revoke block here at all —
absence of one is the deliberate choice, not an oversight.

## Downgrade

Drops the table outright, no guard. Comments refuse to downgrade with rows
present because a comment is something a person wrote to another person; a
presence row is a heartbeat's last timestamp, worth nothing an hour after it is
read, so there is nothing here a downgrade could lose.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0073"
down_revision = "0069"
branch_labels = None
depends_on = None

_TARGET_TYPES = ("run", "notebook", "artifact")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.create_table(
        "presence",
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_seen_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint(
            "workspace_id", "target_type", "target_id", "user_id", name="pk_presence"
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.CheckConstraint(_in("target_type", _TARGET_TYPES), name="ck_presence_target_type"),
    )
    # Opportunistic pruning (`repos/presence.py::_prune_stale`) deletes this
    # workspace's rows older than the TTL on every heartbeat, bounded to a small
    # batch. It filters on `workspace_id` and `last_seen_at` only — neither is a
    # PREFIX of the primary key above (whose second column is `target_type`), so
    # without this index that delete would be a sequential scan of the whole
    # table on every heartbeat from every workspace.
    op.create_index(
        "ix_presence_workspace_last_seen", "presence", ["workspace_id", "last_seen_at"]
    )

    # Written out per table, as 0058 and 0068 do, rather than formatted from a
    # template: a policy is read in review against the one it copies, and a
    # literal is what can be compared by eye.
    op.execute("alter table presence enable row level security")
    op.execute(
        "create policy tenant_isolation on presence for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "presence.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "presence.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )


def downgrade() -> None:
    op.drop_table("presence")
