"""`majorana_contracts.courses`: the shapes Lane B builds against, and the two
things `CoursePlan` refuses outright.

The validator here is the FIRST of two layers (the second is
`leona_notebooks.courses.check_plan`, which restates these as readable failures a
model can be handed back). These tests exist so the first layer is known to fail,
not assumed to: a validator nobody has watched reject anything is indistinguishable
from a validator that accepts everything.
"""

import datetime as dt
import uuid

import pytest
from pydantic import ValidationError

from majorana_contracts import courses


def _module(slug: str, **overrides) -> dict:
    base = dict(slug=slug, title=slug.replace("-", " ").title(), brief=f"Teach {slug}.")
    base.update(overrides)
    return base


def test_a_minimal_plan_validates():
    plan = courses.CoursePlan(
        title="Qiskit in eight weeks",
        summary="A study group.",
        modules=[_module("week-01"), _module("week-02", prerequisites=["week-01"])],
    )
    assert [m.slug for m in plan.modules] == ["week-01", "week-02"]
    assert plan.modules[0].kind is courses.NotebookKind.LESSON


def test_duplicate_module_slugs_are_refused():
    with pytest.raises(ValidationError, match="duplicate module slug"):
        courses.CoursePlan(title="T", modules=[_module("week-01"), _module("week-01")])


def test_a_prerequisite_pointing_forward_is_refused():
    with pytest.raises(ValidationError, match="not an\n?\\s*earlier module|earlier module"):
        courses.CoursePlan(
            title="T",
            modules=[_module("week-01", prerequisites=["week-02"]), _module("week-02")],
        )


def test_a_prerequisite_naming_no_module_at_all_is_refused():
    with pytest.raises(ValidationError):
        courses.CoursePlan(title="T", modules=[_module("week-01", prerequisites=["nope"])])


def test_a_plan_may_not_be_empty_or_longer_than_the_cap():
    with pytest.raises(ValidationError):
        courses.CoursePlan(title="T", modules=[])
    too_many = [_module(f"week-{i:02d}") for i in range(courses.MAX_COURSE_MODULES + 1)]
    with pytest.raises(ValidationError):
        courses.CoursePlan(title="T", modules=too_many)


def test_a_module_slug_must_match_the_notebook_slug_shape():
    with pytest.raises(ValidationError, match="must match"):
        courses.CoursePlan(title="T", modules=[_module("Week One")])


def test_objectives_and_key_concepts_default_empty_so_check_plan_can_be_the_gate():
    """Deliberate: a module with no objective is a POOR plan, not an impossible
    one, so it must be constructible for `check_plan` to have something to
    report and for the worker's one retry to be reachable."""
    plan = courses.CoursePlan(title="T", modules=[_module("week-01")])
    assert plan.modules[0].objectives == []
    assert plan.modules[0].key_concepts == []


def test_course_resource_carries_its_modules_and_a_literal_kind():
    now = dt.datetime(2026, 9, 3, tzinfo=dt.timezone.utc)
    course = courses.Course(
        id=uuid.uuid4(),
        slug="qiskit-study-group-ab12cd34",
        title="Qiskit study group",
        status=courses.CourseStatus.PLANNED,
        modules=[
            courses.CourseModule(id=uuid.uuid4(), seq=1, slug="week-01", title="Week 1"),
        ],
        module_count=1,
        ready_count=0,
        created_at=now,
        updated_at=now,
    )
    assert course.kind == "course"
    assert course.modules[0].status is courses.CourseModuleStatus.PLANNED
    assert course.model_dump(mode="json")["kind"] == "course"


def test_create_course_request_bounds_module_count():
    with pytest.raises(ValidationError):
        courses.CreateCourseRequest(brief="b", module_count=1)
    with pytest.raises(ValidationError):
        courses.CreateCourseRequest(brief="b", module_count=courses.MAX_COURSE_MODULES + 1)
    assert courses.CreateCourseRequest(brief="b").module_count is None


def test_notebook_templates_course_starters_default_empty():
    """The additive half of the 2.19.0 bump: a 2.18.0 client's payload still parses."""
    from majorana_contracts import NotebookTemplates

    templates = NotebookTemplates(kinds=[], starters=[])
    assert templates.course_starters == []
