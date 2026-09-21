"""Qapp fork provenance, and an originating run that a fork does not have.

Revision ID: 0064
Revises: 0063

Proposal 6 (ai-ops#177 follow-on, owner-approved 2026-09-20) adds fork: a
signed-in visitor may copy a PUBLISHED Qapp into their own account as a new
PRIVATE Qapp whose first version is a byte-for-byte copy of the source's
current version.

## Why `created_by_run_id` has to become nullable

`qapps.created_by_run_id` (0055) is `NOT NULL` because every Qapp used to be
born from exactly one generation run — `create_generated` is idempotent on
that column, which is what stops a retried job from creating a second Qapp for
the same run. A fork is not a generation: nobody's prompt produced it, so
there is no run to point at. Inventing a synthetic run row to satisfy the
constraint would misrepresent the runs table (a run is a real task the
platform executed) for the sole purpose of pleasing a NOT NULL this migration
can simply relax instead.

`uq_qapps_created_by_run` still holds under multiple NULLs: Postgres treats
every NULL as distinct for a UNIQUE constraint, so any number of forks may
coexist with `created_by_run_id IS NULL` without touching that constraint at
all — nothing about it needs to change.

## Provenance

`forked_from_qapp_id` / `forked_from_version_id` name exactly which published
version a fork was copied from, as a composite foreign key into
`qapp_versions(qapp_id, id)` — the same unique pair `fk_qapps_current_version`
(0055) already relies on, so a fork's provenance can never point at a version
that belongs to some other Qapp. Both columns are NULL together for every
Qapp that was generated rather than forked; `ck_qapps_forked_from_pair` is the
one thing enforcing they move together, matching how 0055 pairs `visibility`
and `published_at`.

Deliberately NOT `ON DELETE`: the source Qapp uses soft delete
(`qapps.deleted_at`), so its row and its versions still exist, and the
provenance reference stays valid and readable even after the source is taken
down. Nothing here needs a cascade.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("qapps", "created_by_run_id", nullable=True)
    op.add_column(
        "qapps", sa.Column("forked_from_qapp_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "qapps", sa.Column("forked_from_version_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_qapps_forked_from_version",
        "qapps",
        "qapp_versions",
        ["forked_from_qapp_id", "forked_from_version_id"],
        ["qapp_id", "id"],
    )
    op.create_check_constraint(
        "ck_qapps_forked_from_pair",
        "qapps",
        "(forked_from_qapp_id is null) = (forked_from_version_id is null)",
    )


def downgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from qapps where forked_from_qapp_id is not null) then
            raise exception 'cannot downgrade 0064: forked Qapps exist';
          end if;
        end
        $$;
        """
    )
    op.drop_constraint("ck_qapps_forked_from_pair", "qapps", type_="check")
    op.drop_constraint("fk_qapps_forked_from_version", "qapps", type_="foreignkey")
    op.drop_column("qapps", "forked_from_version_id")
    op.drop_column("qapps", "forked_from_qapp_id")
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from qapps where created_by_run_id is null) then
            raise exception 'cannot downgrade 0064: Qapps exist with no originating run';
          end if;
        end
        $$;
        """
    )
    op.alter_column("qapps", "created_by_run_id", nullable=False)
