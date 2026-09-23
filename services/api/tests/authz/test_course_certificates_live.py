"""Who may claim, see and revoke a course certificate, and what the public
Open Badges 2.0 assertion does and does not show, against real Postgres
(ai-ops 349 proposal 8, certificates slice).

The rule under test (`repos.certificates`): **a member may claim a certificate
for themselves once they have passed every graded exercise in the course**
(`is_eligible`, built on `courses.course_gradebook`'s own numbers); **the
certificate's own learner OR the course's creator may revoke it, and no one
else**; **the creator sees every certificate issued for a course, anyone else
sees only their own**; and **the public assertion at what would be
`GET /v1/certificates/{id}` needs no credential, shows only the chosen name,
the course title (snapshotted at claim time), the issue date, the issuer and
the revocation state — never an email, a score or a workspace id.**

Everything runs inside the authz `db` fixture's transaction and is rolled back,
except where a test deliberately triggers a database-level conflict and rolls
back by hand — see `test_course_cohorts_live.py` for why that is necessary
whenever the SAME session keeps being used afterward.
"""

from __future__ import annotations

import datetime as dt
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.courses import CoursePlan, PlannedModule
from majorana_contracts.enums import Framework, Role, RunMode
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.certificates_badge import build_assertion
from majorana_api.orm import User, Workspace
from majorana_api.repos import certificates as certificates_repo
from majorana_api.repos import courses as courses_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.repos._base import NotFoundError
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

FRAMEWORK = {"name": "qiskit", "version": ">=2.5,<2.6", "execution": "local-statevector"}

GRADED_SPEC = {
    "schema_version": 1,
    "slug": "graded",
    "title": "Graded",
    "kind": "lesson",
    "cells": [
        {"id": "c01", "kind": "markdown", "role": "objective", "source": "# Hi"},
        {
            "id": "ex1",
            "kind": "code",
            "role": "solution",
            "source": "def double(x):\n    return 2 * x",
            "stub": "def double(x):\n    ...",
            "check": "assert double(3) == 6",
        },
    ],
}

#: No `check`/`role: solution` cell at all — nothing for `graded_cells()` to count.
LESSON_SPEC = {
    "schema_version": 1,
    "slug": "lesson",
    "title": "Lesson",
    "kind": "lesson",
    "cells": [{"id": "c01", "kind": "markdown", "role": "objective", "source": "# Just reading"}],
}

T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.timezone.utc)


async def _person(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"cert-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@cert.test",
        display_name=tag.title(),
    )


async def _owner_scope(db, tag: str) -> Scope:
    user, workspace = await _person(db, tag)
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


async def _co_member(db, owner: Scope, tag: str, *, role: Role = Role.MEMBER) -> Scope:
    user, _own = await _person(db, tag)
    await workspaces_repo.add_member(owner, db, user_id=user.id, role=role)
    return Scope(user_id=user.id, workspace_id=owner.workspace_id, role=role)


async def _ready_module(db, creator: Scope, course_id, module_id, *, title: str, spec: dict):
    notebook, version = await notebooks_repo.create_notebook(
        creator,
        db,
        slug=f"cert-nb-{uuid.uuid4().hex[:8]}",
        title=title,
        kind="lesson",
        summary="",
        language="en",
        framework=FRAMEWORK,
        request={},
        run_id=None,
    )
    await notebooks_repo.set_version_result(
        creator,
        db,
        version.id,
        status="ready",
        spec=spec,
        source="",
        ipynb=None,
        report=None,
        review=None,
        error="",
    )
    await courses_repo.attach_module_notebook(creator, db, course_id, module_id, notebook.id)
    return notebook, version


async def _one_module_course(db, creator: Scope, *, spec: dict = GRADED_SPEC):
    """A single-module, fully-ready course: passing its one exercise is
    passing the whole course."""
    course = await courses_repo.create_course(
        creator,
        db,
        slug=f"cert-{uuid.uuid4().hex[:8]}",
        title="Certificate probe",
        brief="A course for the certificate suite.",
        audience={},
        style={},
        framework=FRAMEWORK,
        language="en",
        plan_run_id=None,
    )
    plan = CoursePlan(
        title="Certificate probe",
        modules=[PlannedModule(slug="week-01", title="Week 1", objectives=["one"], brief="One.")],
    )
    modules = await courses_repo.replace_modules(creator, db, course.id, plan)
    _notebook, version = await _ready_module(
        db, creator, course.id, modules[0].id, title="Week 1", spec=spec
    )
    return course, modules, version


async def _two_module_course(db, creator: Scope):
    """The second module has no notebook at all — still `planned` — so the
    course as a whole is never eligible no matter what happens to the first."""
    course = await courses_repo.create_course(
        creator,
        db,
        slug=f"cert-{uuid.uuid4().hex[:8]}",
        title="Certificate probe",
        brief="A course for the certificate suite.",
        audience={},
        style={},
        framework=FRAMEWORK,
        language="en",
        plan_run_id=None,
    )
    plan = CoursePlan(
        title="Certificate probe",
        modules=[
            PlannedModule(slug="week-01", title="Week 1", objectives=["one"], brief="One."),
            PlannedModule(slug="week-02", title="Week 2", objectives=["two"], brief="Two."),
        ],
    )
    modules = await courses_repo.replace_modules(creator, db, course.id, plan)
    _notebook, version = await _ready_module(
        db, creator, course.id, modules[0].id, title="Week 1", spec=GRADED_SPEC
    )
    return course, modules, version


async def _grade(db, learner: Scope, version_id: uuid.UUID, *, passed: int, at: dt.datetime = T0):
    run = await runs_repo.create_run(
        learner,
        db,
        task_prompt="Grade an attempt",
        mode=RunMode.NOTEBOOK,
        framework=Framework.QISKIT,
    )
    run.created_at = at
    await db.flush()
    await runs_repo.append_run_event(
        learner,
        db,
        run.id,
        type="notebook.grades",
        payload={
            "version_id": str(version_id),
            "grades": {
                "notebook_slug": "graded",
                "cells": [
                    {"id": "ex1", "status": "passed" if passed else "failed", "graded_by": "d"}
                ],
            },
            "passed": passed,
            "failed": 1 - passed,
            "attempted": 1,
            "note": "",
        },
    )
    return run


def _client(db, scope: Scope) -> httpx.AsyncClient:
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=scope.user_id, email="probe@cert.test"),
        Workspace(id=scope.workspace_id),
    )
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ---------------------------------------------------------------------- eligibility


async def test_a_member_who_passed_every_graded_exercise_is_eligible(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    _course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)

    assert await certificates_repo.is_eligible(ana, db, _course.id) is True


async def test_a_member_who_has_not_passed_is_not_eligible(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=0)

    assert await certificates_repo.is_eligible(ana, db, course.id) is False
    # Bo never attempted at all: also not eligible, not an error.
    assert await certificates_repo.is_eligible(bo, db, course.id) is False


async def test_a_module_still_planned_makes_the_whole_course_ineligible(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _two_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)

    assert await certificates_repo.is_eligible(ana, db, course.id) is False


async def test_a_stale_attempt_is_not_eligible(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    assert await certificates_repo.is_eligible(ana, db, course.id) is True

    revised = await notebooks_repo.create_version(
        creator,
        db,
        version.notebook_id,
        created_by="user",
        message="revised",
        request={},
        run_id=None,
    )
    await notebooks_repo.set_version_result(
        creator,
        db,
        revised.id,
        status="ready",
        spec=GRADED_SPEC,
        source="",
        ipynb=None,
        report=None,
        review=None,
        error="",
    )
    assert await certificates_repo.is_eligible(ana, db, course.id) is False


async def test_a_pure_lesson_module_needs_no_attempt(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _one_module_course(db, creator, spec=LESSON_SPEC)

    # Ana never touches the notebook at all; it has nothing graded in it.
    assert await certificates_repo.is_eligible(ana, db, course.id) is True


async def test_an_empty_course_is_never_eligible(db):
    creator = await _owner_scope(db, "teacher")
    course = await courses_repo.create_course(
        creator,
        db,
        slug=f"cert-empty-{uuid.uuid4().hex[:8]}",
        title="Empty",
        brief="No modules yet.",
        audience={},
        style={},
        framework=FRAMEWORK,
        language="en",
        plan_run_id=None,
    )
    assert await certificates_repo.is_eligible(creator, db, course.id) is False


async def test_the_creator_enrolled_in_their_own_course_is_checked_on_their_own_row(db):
    """Regression: `is_eligible` must find the CALLER's row, not `rows[0]`,
    when the caller is the creator and `course_gradebook` hands back every
    member sorted by name — which need not put the creator first."""
    creator = await _owner_scope(db, "AAA-teacher")  # sorts before "zzz-ana"
    ana = await _co_member(db, creator, "zzz-ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)  # Ana passes; the creator never attempts

    assert await certificates_repo.is_eligible(creator, db, course.id) is False
    assert await certificates_repo.is_eligible(ana, db, course.id) is True


# --------------------------------------------------------------------------- claim


async def test_claiming_before_eligible_is_refused(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _one_module_course(db, creator)

    with pytest.raises(certificates_repo.NotEligible):
        await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)


async def test_claiming_is_idempotent_and_keeps_the_first_chosen_name(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)

    first = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name="A. Name")
    second = await certificates_repo.claim_certificate(
        ana, db, course.id, recipient_name="Different"
    )
    assert first.id == second.id
    assert second.recipient_name == "A. Name"


async def test_claiming_defaults_the_name_to_the_display_name(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)

    row = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)
    assert row.recipient_name == "Ana"


async def test_a_viewer_may_read_but_not_mint(db):
    """A VIEWER cannot even submit the run `_grade` needs (`create_run` is
    `require_write` too), so this is refused by the role gate before
    eligibility is ever asked — the same "role gate first" a read-only member
    hits on due dates and cohorts."""
    creator = await _owner_scope(db, "teacher")
    viewer = await _co_member(db, creator, "viewer", role=Role.VIEWER)
    course, _modules, _version = await _one_module_course(db, creator)

    with pytest.raises(certificates_repo.AuthzError):
        await certificates_repo.claim_certificate(viewer, db, course.id, recipient_name=None)
    listed = await certificates_repo.list_certificates(viewer, db, course.id)
    assert listed.items == []  # reading is allowed; there is simply nothing yet


async def test_another_workspace_gets_404(db):
    creator = await _owner_scope(db, "teacher")
    course, _modules, _version = await _one_module_course(db, creator)
    stranger = await _owner_scope(db, "stranger")

    with pytest.raises(NotFoundError):
        await certificates_repo.claim_certificate(stranger, db, course.id, recipient_name=None)
    with pytest.raises(NotFoundError):
        await certificates_repo.list_certificates(stranger, db, course.id)


# ---------------------------------------------------------------------- visibility


async def test_the_creator_sees_every_certificate_and_a_member_sees_only_their_own(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    await _grade(db, bo, version.id, passed=1)
    await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)
    await certificates_repo.claim_certificate(bo, db, course.id, recipient_name=None)

    everyone = await certificates_repo.list_certificates(creator, db, course.id)
    assert {item.user_id for item in everyone.items} == {ana.user_id, bo.user_id}

    own = await certificates_repo.list_certificates(ana, db, course.id)
    assert [item.user_id for item in own.items] == [ana.user_id]


# -------------------------------------------------------------------------- revoke


async def test_the_learner_can_revoke_their_own_certificate(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)

    await certificates_repo.revoke_certificate(ana, db, course.id, cert.id)

    [row] = (await certificates_repo.list_certificates(ana, db, course.id)).items
    assert row.revoked_at is not None
    assert row.revoked_by_user_id == ana.user_id


async def test_the_creator_can_revoke_anyones_certificate(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)

    await certificates_repo.revoke_certificate(creator, db, course.id, cert.id)

    [row] = [
        item
        for item in (await certificates_repo.list_certificates(creator, db, course.id)).items
        if item.id == cert.id
    ]
    assert row.revoked_at is not None
    assert row.revoked_by_user_id == creator.user_id


async def test_a_third_party_cannot_revoke(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)

    with pytest.raises(certificates_repo.CertificateRevokeForbidden):
        await certificates_repo.revoke_certificate(bo, db, course.id, cert.id)


async def test_revoking_is_idempotent(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)

    await certificates_repo.revoke_certificate(ana, db, course.id, cert.id)
    await certificates_repo.revoke_certificate(ana, db, course.id, cert.id)  # must not raise

    [row] = (await certificates_repo.list_certificates(ana, db, course.id)).items
    assert row.revoked_by_user_id == ana.user_id  # the FIRST revoke's actor, unchanged


# --------------------------------------------------------------------------- public


async def test_the_public_assertion_has_the_expected_shape_and_leaks_nothing(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(
        ana, db, course.id, recipient_name="Ana Learner"
    )

    public_row = await certificates_repo.public_assertion_row(db, cert.id)
    assert public_row is not None
    assertion = build_assertion(public_row, web_origin="https://leonaqt.com")

    assert assertion["verification"] == {"type": "hosted"}
    assert assertion["badge"]["name"] == "Certificate probe"
    assert assertion["badge"]["issuer"]["name"] == "Leona Quantum"
    assert assertion["extensions:recipientName"] == "Ana Learner"
    assert assertion["revoked"] is False
    assert assertion["recipient"]["hashed"] is True
    assert assertion["recipient"]["identity"].startswith("sha256$")

    blob = repr(assertion)
    ana_user = await db.get(User, ana.user_id)
    assert ana_user.email not in blob
    assert str(course.workspace_id) not in blob
    assert str(ana.user_id) not in blob


async def test_a_revoked_certificates_public_assertion_says_so(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)
    await certificates_repo.revoke_certificate(creator, db, course.id, cert.id)

    public_row = await certificates_repo.public_assertion_row(db, cert.id)
    assertion = build_assertion(public_row, web_origin="https://leonaqt.com")
    assert assertion["revoked"] is True
    assert "revocationReason" in assertion


async def test_an_unknown_certificate_id_reads_as_none(db):
    assert await certificates_repo.public_assertion_row(db, uuid.uuid4()) is None


async def test_the_course_title_snapshot_survives_a_rename(db):
    """The certificate keeps saying what the course was called when it was
    claimed, even if the course is renamed afterward — migration 0074's
    documented reason for storing the title rather than joining it live."""
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name=None)

    await courses_repo.update_course(creator, db, course.id, title="Renamed course")

    public_row = await certificates_repo.public_assertion_row(db, cert.id)
    assert public_row.course_title == "Certificate probe"


# -------------------------------------------------------------------------------- HTTP


async def test_over_http_claiming_before_eligible_is_409(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, _version = await _one_module_course(db, creator)  # nobody graded yet

    async with _client(db, ana) as c:
        refused = await c.post(f"/v1/courses/{course.id}/certificates", json={})
    assert refused.status_code == 409, refused.text
    assert refused.json()["reason"] == "course_certificate_not_eligible"


async def test_over_http_claim_list_and_revoke(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    bo = await _co_member(db, creator, "bo")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)

    async with _client(db, ana) as c:
        claimed = await c.post(
            f"/v1/courses/{course.id}/certificates", json={"recipient_name": "Ana L."}
        )
        assert claimed.status_code == 201, claimed.text
        cert_id = claimed.json()["id"]
        assert claimed.json()["recipient_name"] == "Ana L."
        own_list = await c.get(f"/v1/courses/{course.id}/certificates")

    assert [item["id"] for item in own_list.json()["items"]] == [cert_id]

    async with _client(db, bo) as c:
        refused_revoke = await c.delete(f"/v1/courses/{course.id}/certificates/{cert_id}")
    assert refused_revoke.status_code == 403, refused_revoke.text
    assert refused_revoke.json()["reason"] == "course_certificate_revoke_forbidden"

    async with _client(db, ana) as c:
        revoked = await c.delete(f"/v1/courses/{course.id}/certificates/{cert_id}")
    assert revoked.status_code == 204, revoked.text


async def test_over_http_the_public_route_needs_no_credential(db):
    creator = await _owner_scope(db, "teacher")
    ana = await _co_member(db, creator, "ana")
    course, _modules, version = await _one_module_course(db, creator)
    await _grade(db, ana, version.id, passed=1)
    cert = await certificates_repo.claim_certificate(ana, db, course.id, recipient_name="Ana L.")

    app = create_app(Settings(**SETTINGS_KWARGS))
    # No dependency override for get_scope/get_identity at all: this route must
    # not need them. get_session still points at the shared test transaction.
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        response = await c.get(f"/v1/certificates/{cert.id}")
        missing = await c.get(f"/v1/certificates/{uuid.uuid4()}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["extensions:recipientName"] == "Ana L."
    assert body["revoked"] is False
    # `"email"` legitimately appears as `recipient.type` (spec vocabulary,
    # naming WHAT KIND of identity is hashed) — the leak this checks for is
    # the address itself, never the word.
    ana_user = await db.get(User, ana.user_id)
    assert ana_user.email not in repr(body)
    assert str(ana.user_id) not in repr(body)
    assert str(course.workspace_id) not in repr(body)
    assert missing.status_code == 404
