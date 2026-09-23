"""In-app notifications: a hardware job of yours finished, or someone mentioned you.

Revision ID: 0073
Revises: 0072

ai-ops 349, option 2's "Job-finished notifications". One table, two producers:

- `repos/qpu_runs.py::transition` writes a row the moment a hardware run reaches
  DONE, ERROR or CANCELLED — the single funnel every terminal write already goes
  through, from either the API (closing a run before it is ever submitted) or
  the worker (every real submit/poll outcome). Nothing else writes `qpu_runs.status`
  to a terminal value, so nothing else needs to remember to notify.
- `repos/comments.py::_replace_mentions` writes one when a comment newly mentions
  a person — not on every edit, only for a mention that was not already there,
  so re-saving an unchanged comment does not re-notify its mentions.

## Why a new table rather than reading `comment_mentions` at request time

`GET /v1/comments/mentions` (migration 0068) already answers "comments that
mention me", but it has no read state, and there is no equivalent question a
hardware run can answer at all — a `qpu_runs` row has no per-viewer "have you
seen this finish" column and adding one would still leave two producers with
two different shapes to merge into one paged, one sorted feed. A table that
holds the EVENT, not a view over two others, is one paging query instead of a
merge of two, and one mark-read column instead of teaching `comment_mentions`
what read state means for something that is not the record of a mention at all.
The duplication this creates — a comment mention now has a row in two tables —
is a duplicated EVENT, the normal shape for a notification, not a duplicated
STATE MACHINE; `comment_mentions` keeps deciding who a comment mentions, this
table only remembers that someone was told.

## Scoped on the RECIPIENT, not the workspace

Every function in `repos/notifications.py` takes `Scope` and filters on
`scope.user_id`, the same argument `personal_access_tokens` (0069) makes for a
credential: an inbox belongs to a person, not to whichever workspace they had
open when the event happened, and a member of the workspace who is not the
recipient has no more business reading or marking it than a colleague has
revoking somebody else's token. `workspace_id` is still a real column — it is
where the event happened, kept for context and so a summary can be built
without a second query — but it is not part of the boundary.

Row-level security follows that: `notifications` gets `owner_only`, keyed on
`majorana.user_id` rather than the `tenant_isolation` shape 0058/0068 use for a
workspace-scoped table. That GUC already exists — 0054 (ai-ops#149) set it for
the grant disjuncts on `projects`/`artifacts` — this is its first use as an
RLS policy predicate of its own. Permissive while `majorana.rls_enforce` is not
`'on'`, which is every environment today, the same as every other policy in
this repository; this migration does not turn enforcement on.

## Retention, and why it is a real DELETE

"Bounded retention (prune on write)" per the plan: `repos/notifications.py`
deletes a user's own rows older than `RETENTION_DAYS` (90) every time it writes
a new one for them. That is a genuine hard delete, unlike `comments` and
`personal_access_tokens`, which revoke `app_rw`'s DELETE and keep every row as
an audit trail — a notification is not a record anyone is later held to, it is
a reminder that expires on its own, and keeping a "you were mentioned two years
ago and already read it" row forever serves nobody. `app_rw` keeps DELETE here;
nothing revokes it.

## What is NOT here

No email. `data` is a snapshot taken at write time (the device id and outcome,
or the comment and its target) rather than a foreign key followed at read time,
so a notification still renders correctly after the run or comment it names is
gone from whatever page originally showed it — the same reasoning `raw_counts`
on `qpu_runs` already rests on: attest once, at the moment it was true.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None

_KINDS = ("qpu_run_terminal", "mention")


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # The recipient. The authz boundary (repos/notifications.py), not merely
        # a label — see this file's docstring.
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Context only: where the event happened, so a summary can be built
        # without a second query. Never part of the read/write predicate.
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        # A short rendered sentence, written once at the moment the event was
        # true, mirrored by `MAX_NOTIFICATION_SUMMARY_CHARS` in
        # majorana_contracts.notifications so a client never has to guess the
        # bound this CHECK enforces.
        sa.Column("summary", sa.Text(), nullable=False),
        # Kind-specific fields snapshotted at write time (the qpu_run id and
        # status, or the comment id and its target) — never re-derived from a
        # row this event's own subject might no longer have.
        sa.Column(
            "data", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.CheckConstraint(
            "kind in ({values})".format(values=", ".join(f"'{value}'" for value in _KINDS)),
            name="ck_notifications_kind",
        ),
        sa.CheckConstraint(
            "char_length(summary) between 1 and 280", name="ck_notifications_summary_length"
        ),
        sa.CheckConstraint(
            "read_at is null or read_at >= created_at", name="ck_notifications_read_after_created"
        ),
    )
    # The inbox read: `WHERE user_id = :me [AND id < :cursor] ORDER BY id DESC`.
    # Ids are uuid7, so id order is creation order and no second column is
    # needed for the sort — the same shape `ix_personal_access_tokens_owner`
    # (0069) uses for the same reason: this table's boundary is the user too.
    op.create_index(
        "ix_notifications_inbox",
        "notifications",
        ["user_id", sa.text("id DESC")],
    )
    # The unread badge: `count(*) WHERE user_id = :me AND read_at IS NULL`. A
    # partial index because most rows are read within the retention window and
    # the count only ever needs the ones that are not.
    op.create_index(
        "ix_notifications_unread",
        "notifications",
        ["user_id"],
        postgresql_where=sa.text("read_at IS NULL"),
    )
    # The prune-on-write delete: `WHERE user_id = :me AND created_at < :cutoff`.
    op.create_index(
        "ix_notifications_retention",
        "notifications",
        ["user_id", "created_at"],
    )

    op.execute("alter table notifications enable row level security")
    op.execute(
        "create policy owner_only on notifications for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "notifications.user_id = nullif(current_setting('majorana.user_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "notifications.user_id = nullif(current_setting('majorana.user_id', true), '')::uuid)"
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update, delete on notifications to app_rw;
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
          if exists (select 1 from notifications) then
            raise exception 'cannot downgrade 0073: notifications exist';
          end if;
        end
        $$;
        """
    )
    op.drop_table("notifications")
