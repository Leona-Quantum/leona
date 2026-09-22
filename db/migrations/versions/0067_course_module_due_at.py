"""A due date per course module: `course_modules.due_at`.

Revision ID: 0067
Revises: 0065

Proposal 8 (ai-ops 349, "Notebooks and courses for a class"), the assignments
slice: the course's creator can say when each module is due, and the gradebook
reads an attempt as late, or a module nobody attempted as missing, against it.

## Numbering

`0067`, revising `0065`, the head of `dev` when this was written. 0066 is claimed
by the open hardware-mitigation branch (`add/qpu-mitigation`) and 0068 by the
comments branch (`add/workspace-comments`); both revise 0065 as well. The
revision id is a label; what alembic follows is `down_revision`, so whichever of
the three lands after another re-points its `down_revision` at the new head when
it merges `dev` in. Two heads never reach `dev`: CI's `upgrade head` refuses to
choose between them.

## The column

`timestamptz`, nullable, no default and no backfill. NULL means "no due date",
which is true of every module that exists before this migration: nobody set one,
and a guessed date would mark real learners late for a deadline no instructor
gave. An instant rather than a date because a class deadline is a moment ("Friday
at 17:00 in Tokyo"), and a bare date would leave the time zone to whichever
server or browser read it. The API refuses a time with no offset
(`CourseModulePatch.due_at` is an aware datetime), so nothing here has to guess
the zone either.

No CHECK. A due date in the past is legitimate (an instructor recording one
after the fact), and there is no bound worth enforcing that the API's datetime
parsing does not already enforce. No index: the only reads are by `course_id`,
which `ix_course_modules_course_id` (0059) already serves.

## Privileges and row-level security

Nothing to add, checked rather than assumed, the same way 0065 checked it for
`qpu_runs`. `app_rw` holds TABLE-level `select, insert, update, delete` on
`course_modules` (0059's conditional grant block); no migration grants
column-level privileges, so a new column is covered by the existing grant. The
RLS policy on `course_modules` (0059) resolves the tenant through `courses` by
row, which a new column does not change.

## Downgrade refuses once a due date exists

Like 0059, 0064 and 0065: a downgrade that would destroy data a person entered
refuses instead. A due date is typed in by an instructor, is not derived from
anything else in the database, and could not be recovered once the column is
dropped, which is exactly the case those migrations refuse on (0059 refuses on
any course, 0064 on any fork, 0065 on any provider-reported backend name). A
database where nobody has set one yet downgrades cleanly.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0067"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "course_modules",
        sa.Column("due_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from course_modules where due_at is not null) then
            raise exception 'cannot downgrade 0067: course modules carry a due date';
          end if;
        end
        $$;
        """
    )
    op.drop_column("course_modules", "due_at")
