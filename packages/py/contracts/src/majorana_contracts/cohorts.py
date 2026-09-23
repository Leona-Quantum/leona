"""Course cohorts: named groups within a course (ai-ops 349 proposal 8).

A cohort ("Section A", "Spring 2027") is how a course's creator splits a class
so the gradebook and its CSV can be read one section at a time. A member is in
AT MOST ONE cohort per course — `repos.cohorts` enforces this by upserting onto
`course_cohort_members`' primary key, never by policing a second index — so
moving someone between sections is a single write, not a delete racing an
insert.

Authz mirrors the gradebook (`courses.py`'s `GradebookVisibility`): the
course's creator manages every cohort and sees every roster; anyone else in
the workspace sees only their own cohort's name, never who else is in it —
`CohortVisibility` carries which of the two a response is, the same reason
`GradebookVisibility` does.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import Field

from .models import _ResourceBase

#: A cohort of every course fits a semester's worth of sections; longer than
#: this is a naming mistake, not a class.
MAX_COHORT_NAME_LENGTH = 80


class CohortVisibility(StrEnum):
    """Which rows of a course's cohort list the caller was allowed to see."""

    #: The course's creator: every cohort, each with its full roster.
    ALL_COHORTS = "all_cohorts"
    #: Anyone else in the workspace: at most one cohort — their own — with no
    #: roster. Present (as an empty list) for a member in no cohort at all.
    OWN_COHORT = "own_cohort"


class CohortMember(_ResourceBase):
    """One roster row. Creator-visible only — see `CohortVisibility`."""

    user_id: UUID
    email: str
    display_name: str | None = None


class CourseCohort(_ResourceBase):
    id: UUID
    course_id: UUID
    name: str = Field(min_length=1, max_length=MAX_COHORT_NAME_LENGTH)
    #: The roster. Empty under `CohortVisibility.OWN_COHORT` — a classmate does
    #: not get to see who else is in their section, the same "own row only" the
    #: gradebook draws for anyone but the creator.
    members: list[CohortMember] = Field(default_factory=list)
    #: Meaningful only under `CohortVisibility.ALL_COHORTS` (`len(members)`
    #: there); always 0 under `OWN_COHORT`, where the roster itself is empty
    #: too and a real count would tell a member something about their section
    #: this response otherwise withholds.
    member_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime


class CourseCohortList(_ResourceBase):
    course_id: UUID
    visibility: CohortVisibility
    items: list[CourseCohort] = Field(default_factory=list)


class CreateCohortRequest(_ResourceBase):
    name: str = Field(min_length=1, max_length=MAX_COHORT_NAME_LENGTH)


class UpdateCohortRequest(_ResourceBase):
    name: str = Field(min_length=1, max_length=MAX_COHORT_NAME_LENGTH)


class SetCohortMembershipRequest(_ResourceBase):
    """Assign, move or clear one member's cohort for this course.

    Unlike `CourseModulePatch.due_at`, there is no "leave it alone" state to
    tell apart from "clear it": this body has one field and one purpose, so
    `cohort_id: null` and an absent key mean the same thing — take the member
    out of every cohort of this course.
    """

    cohort_id: UUID | None = None
