"""Course contracts — an ordered plan of notebooks, generated from one prompt.

A notebook (`majorana_contracts.notebooks`) is one lesson. A **course** is the plan
that puts many of them in order: the reader says what they want to learn and how, a
planner model writes a `CoursePlan`, and each planned module becomes a real notebook
through the ordinary `notebook.generate` path. Nothing here re-implements a notebook;
a module carries the *brief* that produces one and a pointer to the one it produced.

Three layers, like the notebook module:

1. What the planner returns: `PlannedModule` and `CoursePlan` — pure content, no ids.
2. The stored resource: `Course`, `CourseModule`, `CourseSummary`, `CourseTurn`.
3. The requests of `/v1/courses`: create, update, generate, and the plan-chat turn.

`leona_notebooks.courses` owns every operation on these (the planner prompts, the
plan checks, and the export that renders a plan as a `build_curriculum` source tree)
and imports the types from here so there is one definition.

Two layers check a plan, deliberately. `CoursePlan`'s own validator refuses a
structurally impossible plan (duplicate slugs, a prerequisite that points forward)
so no such object can exist; `leona_notebooks.courses.check_plan` re-states those
plus the *pedagogical* requirements (every module has a brief and an objective) as a
list of readable failures the worker can hand back to the model. The first makes the
type honest; the second makes the retry possible.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .notebooks import (
    _SLUG_RE,
    Audience,
    NotebookFramework,
    NotebookKind,
    Seed,
    Style,
)

#: A course of more than this many modules is a syllabus, not a course: every plan
#: the planner returns and every `module_count` a reader asks for is capped here.
MAX_COURSE_MODULES = 16
#: Longest a single module may claim to take, in minutes (the notebook spec's own cap).
MAX_MODULE_MINUTES = 600


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


#: Imported rather than redeclared. `test_every_public_resource_model_reaches_the_export`
#: finds unexported models by testing `issubclass(value, models._ResourceBase)` — so a
#: module with its own identically-configured base is INVISIBLE to it, and this module's
#: entire family of request/response models was. Two of them slipped past the guard the
#: day it was checked. One base, one guard that can see everything under it.
from .models import _ResourceBase  # noqa: E402


# --------------------------------------------------------------------------- status


class CourseStatus(StrEnum):
    """Where a course is between "asked for" and "every module runs"."""

    #: The plan run is queued or in flight; there are no modules yet.
    PLANNING = "planning"
    #: A plan exists and its modules are stored; no notebook has been generated.
    PLANNED = "planned"
    #: At least one module's notebook is being generated.
    GENERATING = "generating"
    #: Every module has a notebook whose latest version is ready.
    READY = "ready"
    #: Planning failed. Module-level failures do not put the course here — the
    #: module carries its own `failed`, and the course stays `generating`.
    FAILED = "failed"


class CourseModuleStatus(StrEnum):
    """Derived, never stored: read from the module's notebook's latest version.

    A module with no notebook is `planned`; otherwise the notebook version's
    status (`queued`/`running`/`ready`/`failed`) is the module's status.
    """

    PLANNED = "planned"
    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


# ------------------------------------------------------------------------- the plan


class PlannedModule(_Model):
    """One module as the planner writes it — the brief that will become a notebook.

    `brief` is the load-bearing field: it is handed to `notebook.generate` on its
    own, so it must be self-contained and must say what the earlier modules
    established. `prerequisites` names earlier modules by slug and is what makes
    "earlier" checkable.
    """

    slug: str
    title: str
    topic: str = ""
    key_concepts: list[str] = Field(default_factory=list)
    objectives: list[str] = Field(default_factory=list)
    deliverable: str = ""
    kind: NotebookKind = NotebookKind.LESSON
    duration_minutes: int | None = Field(default=None, ge=1, le=MAX_MODULE_MINUTES)
    #: Slugs of modules that must come EARLIER in this plan.
    prerequisites: list[str] = Field(default_factory=list)
    brief: str = Field(default="", max_length=4_000)

    @field_validator("slug")
    @classmethod
    def _slug_shape(cls, value: str) -> str:
        if not _SLUG_RE.match(value):
            raise ValueError(f"module slug {value!r} must match {_SLUG_RE.pattern}")
        return value

    @field_validator("title")
    @classmethod
    def _title_nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("module title must not be blank")
        return value.strip()


class CoursePlan(_Model):
    """The whole plan: what the course is, and its modules in teaching order.

    The validator refuses two shapes that could never be generated: a duplicate
    slug (two modules would collide in the export tree and in `replace_modules`)
    and a prerequisite pointing at a later module or at nothing (the preface the
    generate route writes would then describe a notebook that does not exist yet).
    """

    title: str
    summary: str = ""
    modules: list[PlannedModule] = Field(min_length=1, max_length=MAX_COURSE_MODULES)

    @model_validator(mode="after")
    def _slugs_unique_and_prerequisites_earlier(self) -> CoursePlan:
        seen: set[str] = set()
        for module in self.modules:
            if module.slug in seen:
                raise ValueError(f"duplicate module slug {module.slug!r}")
            for prerequisite in module.prerequisites:
                if prerequisite not in seen:
                    raise ValueError(
                        f"module {module.slug!r} requires {prerequisite!r}, which is not an "
                        "earlier module in this plan"
                    )
            seen.add(module.slug)
        return self


# --------------------------------------------------------------------------- resources


class CourseModule(_ResourceBase):
    """A stored module: the plan's content, plus where its notebook got to."""

    id: UUID
    seq: int = Field(ge=1)
    slug: str
    title: str
    topic: str = ""
    key_concepts: list[str] = Field(default_factory=list)
    objectives: list[str] = Field(default_factory=list)
    deliverable: str = ""
    kind: NotebookKind = NotebookKind.LESSON
    duration_minutes: int | None = Field(default=None, ge=1, le=MAX_MODULE_MINUTES)
    prerequisites: list[str] = Field(default_factory=list)
    brief: str = ""
    notebook_id: UUID | None = None
    status: CourseModuleStatus = CourseModuleStatus.PLANNED
    #: `seq` of the notebook version the module's status was read from.
    notebook_version_seq: int | None = None


class Course(_ResourceBase):
    """Owner-facing course resource, modules included — a course is small enough
    that splitting the modules behind a second request would only cost a round
    trip (a plan is capped at 16 modules)."""

    id: UUID
    slug: str
    title: str
    summary: str = ""
    #: The reader's own words, kept verbatim as provenance.
    brief: str = ""
    #: Discriminates a course from a notebook in a mixed client-side list.
    kind: Literal["course"] = "course"
    audience: Audience = Field(default_factory=Audience)
    style: Style = Field(default_factory=Style)
    framework: NotebookFramework = Field(default_factory=NotebookFramework)
    language: Literal["en", "ja"] = "en"
    status: CourseStatus
    #: The run that planned (or is planning) this course.
    plan_run_id: UUID | None = None
    modules: list[CourseModule] = Field(default_factory=list)
    module_count: int = Field(default=0, ge=0)
    #: Modules whose notebook's latest version is ready.
    ready_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime


class CourseSummary(_ResourceBase):
    """A course as a list row: no modules, so a list of courses is one query."""

    id: UUID
    slug: str
    title: str
    summary: str = ""
    status: CourseStatus
    language: Literal["en", "ja"] = "en"
    module_count: int = Field(default=0, ge=0)
    ready_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime


class CourseTurn(_ResourceBase):
    """One turn of the chat that revises the PLAN (not a notebook's content)."""

    id: UUID
    seq: int = Field(ge=1)
    role: Literal["user", "nala"]
    content: str
    created_at: datetime


class CourseList(_ResourceBase):
    items: list[CourseSummary] = Field(default_factory=list)
    next_cursor: str | None = None


class CourseTurnList(_ResourceBase):
    items: list[CourseTurn] = Field(default_factory=list)


# --------------------------------------------------------------------------- requests


class CreateCourseRequest(_ResourceBase):
    brief: str = Field(min_length=1, max_length=8_000)
    title: str | None = Field(default=None, max_length=200)
    audience: Audience | None = None
    style: Style | None = None
    framework: NotebookFramework | None = None
    #: How many modules the reader wants. `None` lets the planner decide.
    module_count: int | None = Field(default=None, ge=2, le=MAX_COURSE_MODULES)
    seeds: list[Seed] = Field(default_factory=list, max_length=8)
    response_locale: Literal["en", "ja"] = "en"


class CreateCourseResponse(_ResourceBase):
    course: Course
    run_id: UUID


class CourseModulePatch(_ResourceBase):
    """A hand edit to one planned module. Refused once the module has a notebook:
    the notebook was generated FROM these fields, so changing them afterwards
    would leave the module describing something the notebook does not teach."""

    id: UUID
    title: str | None = Field(default=None, min_length=1, max_length=240)
    brief: str | None = Field(default=None, max_length=4_000)
    objectives: list[str] | None = None
    kind: NotebookKind | None = None
    #: New position in the course, 1-based. Reordering renumbers the others.
    seq: int | None = Field(default=None, ge=1)


class UpdateCourseRequest(_ResourceBase):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=2_000)
    modules: list[CourseModulePatch] | None = None


class GenerateCourseRequest(_ResourceBase):
    """Which modules to turn into notebooks. `None` means every module that does
    not have one yet — the ordinary "build my course" button."""

    module_ids: list[UUID] | None = None


class GenerateCourseResponse(_ResourceBase):
    course: Course
    #: One run per module dispatched, in module order.
    run_ids: list[UUID] = Field(default_factory=list)


class CreateCourseTurnRequest(_ResourceBase):
    """Chat that edits the PLAN: "add a module on transpilation after week 3",
    "make module 2 a lab", "drop the last one"."""

    message: str = Field(min_length=1, max_length=8_000)


class CreateCourseTurnResponse(_ResourceBase):
    turn: CourseTurn
    run_id: UUID
