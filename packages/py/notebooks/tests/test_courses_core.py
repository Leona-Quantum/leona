"""`leona_notebooks.courses`: the plan checks, the curriculum source tree a course
renders to, and the exported zip.

`check_plan`'s structural branches are unreachable through `model_validate` (the
contract's own validator rejects those plans first), so every one of them is driven
here through `CoursePlan.model_construct`, which runs no validator. A check nobody
has watched go red is not evidence of anything.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
import yaml

from majorana_contracts.courses import CoursePlan, PlannedModule

from leona_notebooks.courses import (
    COURSE_STARTERS,
    check_plan,
    course_to_curriculum_sources,
    export_course_zip,
    module_filename,
    plan_prompt,
    revise_plan_prompt,
)
from leona_notebooks.source import parse_source
from leona_notebooks.spec import NotebookKind

from leona_notebook_fixtures import LESSON

# A second, deliberately minimal source so the two modules in the fixture course are
# not the same notebook twice.
SECOND_LESSON = """\
# ---
# title: Two qubits
# kind: lesson
# summary: Entangling two qubits.
# objectives:
#   - Build a Bell pair
# ---

# %% [markdown] role=objective
# ## What you will build
# A Bell pair.

# %% role=run
from qiskit import QuantumCircuit
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)

# %% [markdown] role=summary
# You entangled two qubits.
"""


def _module(slug: str, **overrides) -> PlannedModule:
    base = dict(
        slug=slug,
        title=slug.replace("-", " ").title(),
        topic=f"The topic of {slug}",
        key_concepts=["superposition", "measurement"],
        objectives=[f"Do the {slug} thing"],
        deliverable=f"A working {slug} notebook",
        brief=f"Teach {slug}, assuming nothing but Python.",
        duration_minutes=45,
    )
    base.update(overrides)
    return PlannedModule(**base)


def _plan(**overrides) -> CoursePlan:
    base = dict(
        title="A two-module course",
        summary="From one qubit to two.",
        modules=[_module("week-01"), _module("week-02", prerequisites=["week-01"])],
    )
    base.update(overrides)
    return CoursePlan(**base)


# ------------------------------------------------------------------------ check_plan


def test_a_good_plan_has_no_failures():
    assert check_plan(_plan()) == []


def test_check_plan_catches_an_empty_plan():
    plan = CoursePlan.model_construct(title="T", summary="", modules=[])
    failures = check_plan(plan)
    assert failures == ["A course needs at least one module."]


def test_check_plan_catches_a_duplicate_slug():
    plan = CoursePlan.model_construct(
        title="T", summary="", modules=[_module("week-01"), _module("week-01")]
    )
    assert any("appears twice" in failure for failure in check_plan(plan))


def test_check_plan_catches_a_prerequisite_pointing_forward():
    plan = CoursePlan.model_construct(
        title="T",
        summary="",
        modules=[_module("week-01", prerequisites=["week-02"]), _module("week-02")],
    )
    failures = check_plan(plan)
    assert any("EARLIER module" in failure for failure in failures)
    assert any("week-02" in failure for failure in failures)


def test_check_plan_catches_an_empty_brief_and_a_module_with_no_objectives():
    plan = CoursePlan.model_construct(
        title="T",
        summary="",
        modules=[_module("week-01", brief="   ", objectives=[])],
    )
    failures = check_plan(plan)
    assert any("empty brief" in failure for failure in failures)
    assert any("no objectives" in failure for failure in failures)


def test_check_plan_catches_more_modules_than_the_cap():
    plan = CoursePlan.model_construct(
        title="T", summary="", modules=[_module(f"week-{i:02d}") for i in range(20)]
    )
    assert any("at most 16 modules" in failure for failure in check_plan(plan))


def test_check_plan_catches_an_absurd_total_duration():
    plan = CoursePlan.model_construct(
        title="T",
        summary="",
        modules=[_module(f"week-{i:02d}", duration_minutes=600) for i in range(16)]
        + [_module("week-99", duration_minutes=600)],
    )
    assert any("minute ceiling" in failure for failure in check_plan(plan))


# --------------------------------------------------------------------------- prompts


def test_plan_prompt_states_the_schema_the_module_briefs_rule_and_the_framework_facts():
    system, user = plan_prompt(brief="Teach me Qiskit in eight weeks", module_count=8)
    assert "CoursePlan" in system
    assert "self-contained" in system
    # The schema is stated IN the prompt, not merely passed as a response_schema.
    schema_text = user.split("COURSE PLAN JSON SCHEMA:\n", 1)[1].split("\n", 1)[0]
    schema = json.loads(schema_text)
    assert "PlannedModule" in json.dumps(schema)
    assert "modules" in schema["properties"]
    assert "Plan EXACTLY 8 modules." in user
    # Framework facts are the imported block, not a hand-written copy.
    from leona_notebooks.prompts import QISKIT_2_FACTS

    assert QISKIT_2_FACTS in user


def test_plan_prompt_without_a_module_count_leaves_the_length_to_the_planner():
    _system, user = plan_prompt(brief="A weekend on Grover")
    assert "Plan EXACTLY" not in user
    assert "never more than 16" in user.replace("never \n", "never ").replace("\n", " ")


def test_revise_plan_prompt_carries_the_plan_the_message_and_the_slug_stability_rule():
    plan = _plan()
    system, user = revise_plan_prompt(plan, "add a module on transpilation after week 1")
    assert "byte-identical" in system
    assert '"reply"' in system and '"plan"' in system
    assert "add a module on transpilation" in user
    assert "week-01, week-02" in user


# ----------------------------------------------------------------- curriculum sources


def test_course_to_curriculum_sources_writes_a_readme_yaml_and_one_dir_per_module():
    plan = _plan()
    specs = {
        "week-01": parse_source(LESSON, slug="week-01"),
        "week-02": parse_source(SECOND_LESSON, slug="week-02"),
    }
    files = {
        path.as_posix(): text for path, text in course_to_curriculum_sources(plan, specs).items()
    }
    assert set(files) >= {
        "README.md",
        "curriculum.yaml",
        "week-01/README.md",
        "week-01/lesson.nb.py",
        "week-02/README.md",
        "week-02/lesson.nb.py",
    }
    # The top-level README is the Quanmatic shape: title, who it is for, a table, uv.
    readme = files["README.md"]
    assert readme.startswith("# A two-module course")
    assert "## Who this is for" in readme
    assert "| # | Module | Topic | Key concepts | Deliverable |" in readme
    assert "A working week-01 notebook" in readme
    assert "uv sync" in readme
    # The module README is written from the module's own fields.
    unit = files["week-01/README.md"]
    assert "# Module 1: Week 01" in unit
    assert "Do the week-01 thing" in unit
    assert "superposition" in unit
    # curriculum.yaml is what `load_curriculum` parses.
    spec = yaml.safe_load(files["curriculum.yaml"])
    assert [u["directory"] for u in spec["units"]] == ["week-01", "week-02"]
    assert spec["units"][1]["order"] == 2


def test_course_to_curriculum_sources_returns_items_not_a_generator():
    """`.items()` is what the caller iterates; assert the mapping shape directly."""
    plan = _plan()
    specs = {"week-01": parse_source(LESSON, slug="week-01")}
    files = course_to_curriculum_sources(plan, specs)
    assert isinstance(files, dict)
    # A module with no generated notebook contributes nothing — no empty directory.
    assert not any(path.as_posix().startswith("week-02/") for path in files)


def test_module_filename_follows_the_kind():
    assert module_filename(NotebookKind.LAB) == "lab.nb.py"
    assert module_filename(NotebookKind.CHALLENGE) == "challenge.nb.py"
    assert module_filename(NotebookKind.LESSON) == "lesson.nb.py"
    assert module_filename(NotebookKind.SCRATCH) == "lesson.nb.py"


# ------------------------------------------------------------------------------ zip


def test_export_course_zip_contains_the_readme_yaml_and_a_compiled_notebook_per_module():
    plan = _plan()
    specs = {
        "week-01": parse_source(LESSON, slug="week-01"),
        "week-02": parse_source(SECOND_LESSON, slug="week-02"),
    }
    blob = export_course_zip(plan, specs, slug="two-module-course")
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        names = set(archive.namelist())
        curriculum = yaml.safe_load(archive.read("curriculum.yaml"))
        notebook = json.loads(archive.read("week-01/lesson.ipynb"))
    assert {"README.md", "curriculum.yaml", "week-01/lesson.ipynb", "week-02/lesson.ipynb"} <= names
    assert "week-01/README.md" in names
    # No `.nb.py` source is shipped; the reader gets notebooks.
    assert not any(name.endswith(".nb.py") for name in names)
    # The manifest's own unit list matches what the zip contains.
    assert {u["directory"] for u in curriculum["units"]} == {"week-01", "week-02"}
    for unit in curriculum["units"]:
        assert any(name.startswith(f"{unit['directory']}/") for name in names)
    # nbformat 4.5 with no outputs committed.
    assert notebook["nbformat"] == 4
    assert all(cell.get("outputs", []) == [] for cell in notebook["cells"])


def test_export_course_zip_refuses_a_course_with_no_generated_notebooks():
    with pytest.raises(RuntimeError, match="no notebooks"):
        export_course_zip(_plan(), {})


def test_a_challenge_module_also_exports_its_solution_build():
    """`build_curriculum`'s hidden-answer rule applies unchanged to a generated
    course: the challenge ships answer-free and the solution lands under
    `solutions/`."""
    challenge_source = (
        "# ---\n# title: C\n# kind: challenge\n# ---\n"
        "# %% [markdown] role=objective\n# o\n"
        "# %% [markdown] role=exercise\n# do it\n"
        '# %% role=solution stub="answer = None\\n"\nanswer = 1\n'
        "# %% [markdown] role=hint\n# h\n"
        "# %% role=checkpoint\nif answer is not None:\n    assert answer == 1\n"
        "# %% [markdown] role=summary\n# s\n"
    )
    plan = CoursePlan(
        title="One challenge",
        modules=[_module("week-01", kind=NotebookKind.CHALLENGE)],
    )
    specs = {"week-01": parse_source(challenge_source, slug="week-01")}
    blob = export_course_zip(plan, specs)
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        names = set(archive.namelist())
        challenge = json.loads(archive.read("week-01/challenge.ipynb"))
        solution = json.loads(archive.read("solutions/week-01/challenge_solution.ipynb"))
    assert "solutions/week-01/challenge_solution.ipynb" in names
    challenge_sources = ["".join(cell["source"]) for cell in challenge["cells"]]
    solution_sources = ["".join(cell["source"]) for cell in solution["cells"]]
    assert "answer = None\n" in challenge_sources
    assert "answer = 1\n" not in challenge_sources
    assert "answer = 1\n" in solution_sources


# --------------------------------------------------------------------------- starters


def test_course_starters_are_well_formed_and_cover_the_four_asks():
    assert len(COURSE_STARTERS) >= 3
    ids = {starter["id"] for starter in COURSE_STARTERS}
    assert ids == {"qiskit-study-group", "grover-weekend", "vqe-onboarding", "qec-from-zero"}
    for starter in COURSE_STARTERS:
        assert set(starter) == {"id", "kind", "title", "brief"}
        assert NotebookKind(starter["kind"])
        assert len(starter["brief"]) > 80, starter["id"]


def test_check_plan_catches_a_kind_that_is_not_a_notebook_kind():
    """The one branch a validated plan can never reach: pydantic coerces `kind`,
    so only `model_construct` on the MODULE itself produces it. Driven here so
    the branch is exercised rather than merely present."""
    broken = PlannedModule.model_construct(
        slug="week-01",
        title="Week 1",
        topic="",
        key_concepts=[],
        objectives=["Do it"],
        deliverable="",
        kind="not-a-kind",
        duration_minutes=None,
        prerequisites=[],
        brief="Teach it.",
    )
    plan = CoursePlan.model_construct(title="T", summary="", modules=[broken])
    assert any("unknown kind" in failure for failure in check_plan(plan))
