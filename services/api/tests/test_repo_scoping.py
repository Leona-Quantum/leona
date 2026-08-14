"""Every repository function must bind scope.workspace_id into its statement
(02-architecture.md §4). Statement-level check, DB-free; the live cross-workspace
probes land with the step-4 authz suite."""

import uuid
from types import SimpleNamespace

import pytest
from repo_test_helpers import Row, Rows, SequencedSession, compiled, make_scope
from majorana_contracts.enums import RunMode, RunStatus, UsageKind, VerificationMethod

from majorana_api.repos import (
    NotFoundError,
    agent,
    artifacts,
    audit,
    folders,
    projects,
    runs,
    usage,
    workspaces,
)


def assert_workspace_bound(stmt, scope):
    sql, params = compiled(stmt)
    assert "workspace_id" in sql
    assert scope.workspace_id in params.values(), f"scope not bound in: {sql}"


async def test_get_workspace(scope, session):
    with pytest.raises(NotFoundError):
        await workspaces.get_workspace(scope, session)
    # workspaces scope by their own id column
    sql, params = compiled(session.statements[0])
    assert "workspaces.id" in sql
    assert scope.workspace_id in params.values()


async def test_list_members(scope, session):
    await workspaces.list_members(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_list_artifacts(scope, session):
    await artifacts.list_artifacts(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_get_artifact(scope, session):
    with pytest.raises(NotFoundError):
        await artifacts.get_artifact(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_get_artifact_by_slug(scope, session):
    assert await artifacts.get_artifact_by_slug(scope, session, "public-reference") is None
    assert_workspace_bound(session.statements[0], scope)


async def test_update_display_name_is_scoped(scope, session):
    with pytest.raises(NotFoundError):
        await workspaces.update_display_name(scope, session, display_name="Eshaan")
    assert_workspace_bound(session.statements[0], scope)


async def test_get_version_joins_artifact(scope, session):
    with pytest.raises(NotFoundError):
        await artifacts.get_version(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN artifacts" in sql
    assert_workspace_bound(stmt, scope)


async def test_version_history_refuses_an_artifact_outside_the_scope(scope, session):
    """The list resolves the artifact first, and that resolution is the gate.

    `artifact_versions` has no workspace_id column, so an unscoped version query
    would happily hand one workspace another's history.
    """
    with pytest.raises(NotFoundError):
        await artifacts.list_versions(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_version_history_query_joins_artifact(scope, session):
    """The version SELECT itself carries the predicate too.

    Not redundant with the check above: the artifact lookup and the version
    query are separate statements, and only this one reads artifact_versions.
    """
    artifact_id = uuid.uuid4()
    seq = SequencedSession(
        [Row(SimpleNamespace(id=artifact_id, workspace_id=scope.workspace_id)), Rows([])]
    )
    await artifacts.list_versions(scope, seq, artifact_id)
    stmt = seq.statements[1]
    sql, _ = compiled(stmt)
    assert "artifact_versions" in sql
    assert "JOIN artifacts" in sql
    assert_workspace_bound(stmt, scope)


async def test_fingerprint_lookup_joins_artifact(scope, session):
    """`create_version` reinstates an existing row by fingerprint; that lookup
    must not be able to reach across workspaces either."""
    assert await artifacts.get_version_by_fingerprint(scope, session, uuid.uuid4(), "fp") is None
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN artifacts" in sql
    assert_workspace_bound(stmt, scope)


async def test_restore_version_is_scoped(scope, session):
    with pytest.raises(NotFoundError):
        await artifacts.restore_version(scope, session, uuid.uuid4(), uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_set_visibility_scoped_update(scope, session):
    admin = scope.model_copy(update={"role": "admin"})
    with pytest.raises(NotFoundError):  # rowcount 0 == outside scope or absent
        await artifacts.set_visibility(admin, session, uuid.uuid4(), "public")
    assert_workspace_bound(session.statements[0], admin)


async def test_soft_delete_scoped_update(scope, session):
    admin = scope.model_copy(update={"role": "admin"})
    with pytest.raises(NotFoundError):
        await artifacts.soft_delete_artifact(admin, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], admin)


async def test_get_run(scope, session):
    with pytest.raises(NotFoundError):
        await runs.get_run(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_list_runs(scope, session):
    await runs.list_runs(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_tier_allowance_counts_the_account_not_the_workspace(scope, session):
    """The documented exception to the rule this file enforces.

    The weekly execute allowance belongs to an account. Binding the workspace
    would multiply it by the number of workspaces the user can reach — a free
    account invited into ten would hold fifty weekly runs while the product says
    five — and binding *only* the workspace would spend a collaborator's
    allowance on somebody else's runs while the refusal says "your plan".

    Counting the caller's own rows crosses no tenancy boundary: every row
    matched was created by `scope.user_id`.
    """
    import datetime as _dt

    await runs.count_execute_runs_since(scope, session, _dt.datetime.now(_dt.UTC))
    sql, params = compiled(session.statements[0])
    assert "user_id" in sql
    assert scope.user_id in params.values()
    assert scope.workspace_id not in params.values(), (
        "the account-wide allowance must not be narrowed to one workspace"
    )


async def test_the_abuse_backstop_stays_bound_to_the_workspace(scope, session):
    """The ceiling above the allowance bounds a TENANT, so it keeps the
    workspace predicate. If this ever starts counting per account instead, one
    tenant's runaway script stops being contained by its own workspace.

    This is `EXECUTE_BACKSTOP_LIMIT`'s counter specifically — ai-ops 86
    (2026-08-14) left that one workspace-scoped on purpose. The OTHER backstop,
    the combined EXECUTE+AUTO submission ceiling, moved to per-account the same
    ruling; see the test directly below."""
    import datetime as _dt

    await runs.count_runs_by_mode_since(scope, session, _dt.datetime.now(_dt.UTC))
    assert_workspace_bound(session.statements[0], scope)


async def test_the_submission_backstop_counts_the_account_not_the_workspace(scope, session):
    """ai-ops 86's second documented exception, and for the same reason as the
    tier allowance above: the free tier sells `owned_workspaces=3`
    (`tiers.TIER_LIMITS`), and a workspace-bound count let one free signup clear
    the backstop three times over by spreading submissions across them.
    """
    import datetime as _dt

    await runs.count_submitted_runs_for_account_since(scope, session, _dt.datetime.now(_dt.UTC))
    sql, params = compiled(session.statements[0])
    assert "user_id" in sql
    assert scope.user_id in params.values()
    assert scope.workspace_id not in params.values(), (
        "the per-account submission backstop must not be narrowed to one workspace"
    )


async def test_list_folders(scope, session):
    await folders.list_folders(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_get_folder(scope, session):
    with pytest.raises(NotFoundError):
        await folders.get_folder(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


# The folder MUTATIONS had no statement-level cover until Projects were written
# against the same shape and the gap became visible. Each one below reaches its
# first statement through a scoped getter, which is exactly the property that
# would be lost by a refactor that "helpfully" looked the row up by id alone.
async def test_rename_folder_resolves_the_folder_in_scope(scope, session):
    with pytest.raises(NotFoundError):
        await folders.rename_folder(scope, session, uuid.uuid4(), name="renamed")
    assert_workspace_bound(session.statements[0], scope)


async def test_delete_folder_resolves_the_folder_in_scope(scope, session):
    with pytest.raises(NotFoundError):
        await folders.delete_folder(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_reorder_folders_lists_within_the_scope(scope, session):
    with pytest.raises(NotFoundError):
        await folders.reorder_folders(scope, session, [uuid.uuid4()])
    assert_workspace_bound(session.statements[0], scope)


async def test_set_run_folder_resolves_the_run_in_scope(scope, session):
    with pytest.raises(NotFoundError):
        await folders.set_run_folder(scope, session, uuid.uuid4(), uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_list_projects(scope, session):
    await projects.list_projects(scope, session)
    assert_workspace_bound(session.statements[0], scope)


async def test_get_project(scope, session):
    with pytest.raises(NotFoundError):
        await projects.get_project(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_create_project_binds_both_of_its_reads(scope, session):
    """Two statements, and BOTH matter.

    The duplicate-name check decides whether a row is created at all, and the
    `max(position)` decides where it lands. An unbound name check would return
    another workspace's project as "already exists" — leaking its existence and
    then handing the caller a row it must not see.
    """
    project = await projects.create_project(scope, session, name="  Bell   states  ")
    assert_workspace_bound(session.statements[0], scope)
    assert_workspace_bound(session.statements[1], scope)
    assert project.workspace_id == scope.workspace_id
    assert project.name == "Bell states"


async def test_rename_project_resolves_the_project_in_scope(scope, session):
    with pytest.raises(NotFoundError):
        await projects.rename_project(scope, session, uuid.uuid4(), name="renamed")
    assert_workspace_bound(session.statements[0], scope)


async def test_delete_project_resolves_the_project_in_scope(scope, session):
    with pytest.raises(NotFoundError):
        await projects.delete_project(scope, session, uuid.uuid4())
    assert_workspace_bound(session.statements[0], scope)


async def test_reorder_projects_lists_within_the_scope(scope, session):
    with pytest.raises(NotFoundError):
        await projects.reorder_projects(scope, session, [uuid.uuid4()])
    assert_workspace_bound(session.statements[0], scope)


async def test_set_artifact_project_resolves_the_artifact_in_scope(scope, session):
    with pytest.raises(NotFoundError):
        await projects.set_artifact_project(
            scope, session, uuid.uuid4(), uuid.uuid4(), workspace_artifact_limit=None
        )
    assert_workspace_bound(session.statements[0], scope)


async def test_set_artifact_project_resolves_the_project_in_scope(scope):
    """The artifact being ours does not make the project ours.

    Filing OUR artifact under ANOTHER workspace's project is the interesting
    half: the first lookup succeeds, so a missing predicate on the second would
    write a cross-tenant pointer that every later read then follows.
    """
    session = SequencedSession(
        [
            Row(SimpleNamespace(id=uuid.uuid4(), workspace_id=None, project_id=None)),
            Row(None),  # the project lookup finds nothing in this scope
        ]
    )
    scope = make_scope()
    with pytest.raises(NotFoundError):
        await projects.set_artifact_project(
            scope, session, uuid.uuid4(), uuid.uuid4(), workspace_artifact_limit=None
        )
    assert_workspace_bound(session.statements[1], scope)


async def test_update_run_status(scope, session):
    with pytest.raises(NotFoundError):
        await runs.update_run_status(scope, session, uuid.uuid4(), "running")
    assert_workspace_bound(session.statements[0], scope)


async def test_finish_run_update_is_scoped(scope, session, monkeypatch):
    async def get_run(*_args, **_kwargs):
        return SimpleNamespace(status=RunStatus.RUNNING)

    async def append_run_event(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runs, "get_run", get_run)
    monkeypatch.setattr(runs, "append_run_event", append_run_event)
    with pytest.raises(RuntimeError, match="changed while its row lock was held"):
        await runs.finish_run(
            scope,
            session,
            uuid.uuid4(),
            RunStatus.FAILED,
            event_payload={"status": "failed", "reason_code": "agent_failed"},
            event_id=uuid.uuid4(),
        )
    assert_workspace_bound(session.statements[0], scope)


async def test_append_run_event_checks_run_scope(scope, session):
    with pytest.raises(NotFoundError):  # parent run resolved under scope first
        await runs.append_run_event(scope, session, uuid.uuid4(), type="run.started", payload={})
    assert_workspace_bound(session.statements[0], scope)


async def test_list_run_events_joins_runs(scope, session):
    await runs.list_run_events(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN runs" in sql
    assert_workspace_bound(stmt, scope)


async def test_list_verification_records_joins_runs(scope, session):
    await runs.list_verification_records(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN runs" in sql
    assert_workspace_bound(stmt, scope)


async def test_agent_steps_join_runs_for_scope(scope, session):
    await agent.list_steps(scope, session, uuid.uuid4())
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN runs" in sql
    assert_workspace_bound(stmt, scope)


async def test_candidate_lookup_joins_runs_for_scope(scope, session):
    assert await agent.get_candidate_by_id(scope, session, uuid.uuid4()) is None
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "JOIN runs" in sql
    assert_workspace_bound(stmt, scope)


@pytest.mark.parametrize(
    ("read", "sequence_column"),
    [
        (
            lambda scope, session: agent.latest_plan_revision(scope, session, uuid.uuid4()),
            "run_plans.revision DESC",
        ),
        (
            lambda scope, session: agent.latest_semantic_review(
                scope, session, uuid.uuid4(), uuid.uuid4()
            ),
            "candidate_semantic_reviews.attempt_seq DESC",
        ),
        (
            lambda scope, session: agent.latest_strict_verification(
                scope, session, uuid.uuid4(), uuid.uuid4()
            ),
            "candidate_verification_attempts.attempt_seq DESC",
        ),
    ],
)
async def test_new_latest_evidence_reads_are_scoped_and_sequence_ordered(
    scope, session, read, sequence_column
):
    assert await read(scope, session) is None
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert sequence_column in sql
    assert "created_at DESC" not in sql
    assert_workspace_bound(stmt, scope)


async def test_current_plan_read_uses_explicit_current_plan_id(scope, session):
    assert await agent.get_current_plan_revision(scope, session, uuid.uuid4()) is None
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "agent_runs.current_plan_id = run_plans.id" in sql
    assert_workspace_bound(stmt, scope)


async def test_exact_strict_verification_read_is_scoped(scope, session):
    assert (
        await agent.get_strict_verification(
            scope,
            session,
            uuid.uuid4(),
            uuid.uuid4(),
            uuid.uuid4(),
        )
        is None
    )
    stmt = session.statements[0]
    sql, _ = compiled(stmt)
    assert "candidate_verification_attempts.id" in sql
    assert "candidate_verification_attempts.candidate_id" in sql
    assert_workspace_bound(stmt, scope)


async def test_strict_append_atomically_projects_typed_summary_to_run(scope, monkeypatch):
    run_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    review_id = uuid.uuid4()
    fingerprint = "a" * 64
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint=fingerprint)
    execution = SimpleNamespace(
        id=execution_id,
        source_fingerprint=fingerprint,
    )
    review = SimpleNamespace(
        id=review_id,
        execution_id=execution_id,
        source_fingerprint=fingerprint,
        decision="ready",
    )

    async def get_candidate(*_args):
        return candidate

    async def get_execution(*_args):
        return execution

    async def get_review(*_args):
        return review

    async def latest(*_args):
        return None

    monkeypatch.setattr(agent, "get_candidate", get_candidate)
    monkeypatch.setattr(agent, "get_execution", get_execution)
    monkeypatch.setattr(agent, "get_semantic_review", get_review)
    monkeypatch.setattr(agent, "latest_strict_verification", latest)

    class Result:
        rowcount = 1

    class Session:
        def __init__(self):
            self.statements = []

        def add(self, _row):
            return None

        async def flush(self):
            return None

        async def execute(self, statement):
            self.statements.append(statement)
            return Result()

    session = Session()
    await agent.append_strict_verification(
        scope,
        session,
        run_id,
        {
            "id": uuid.uuid4(),
            "candidate_id": candidate_id,
            "execution_id": execution_id,
            "semantic_review_id": review_id,
            "source_fingerprint": fingerprint,
            "attempt_seq": 1,
            "checks": [{"method": "success_criteria", "result": "fail"}],
            "decision": "fail",
            "evidence_strength": "structural",
            "claim_coverage": [],
            "reason_code": "strict_plan_defect",
            "candidate_defect_observed": False,
            "failure_class": "plan_defect",
            "retry_target": "planning",
            "unverified_claims": ["plan success criterion"],
            "verifier_version": "verification-v2",
        },
    )

    stmt = session.statements[-1]
    _, params = compiled(stmt)
    summary = next(value for value in params.values() if isinstance(value, dict))
    assert summary["decision"] == "fail"
    assert summary["checks"] == [{"method": "success_criteria", "result": "fail"}]
    assert_workspace_bound(stmt, scope)


async def test_semantic_review_write_rejects_stale_candidate_fingerprint(
    scope, session, monkeypatch
):
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint="a" * 64)
    execution = SimpleNamespace(
        id=execution_id, candidate_id=candidate_id, source_fingerprint="a" * 64
    )

    async def get_candidate(*_args):
        return candidate

    async def get_execution(*_args):
        return execution

    monkeypatch.setattr(agent, "get_candidate", get_candidate)
    monkeypatch.setattr(agent, "get_execution", get_execution)

    with pytest.raises(ValueError, match="fingerprint mismatch"):
        await agent.append_semantic_review(
            scope,
            session,
            uuid.uuid4(),
            {
                "candidate_id": candidate_id,
                "execution_id": execution_id,
                "source_fingerprint": "b" * 64,
                "attempt_seq": 1,
            },
        )
    assert session.added == []


async def test_duplicate_semantic_attempt_is_rejected_before_insert(scope, session, monkeypatch):
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    candidate = SimpleNamespace(id=candidate_id, source_fingerprint="a" * 64)
    execution = SimpleNamespace(
        id=execution_id, candidate_id=candidate_id, source_fingerprint="a" * 64
    )

    async def get_candidate(*_args):
        return candidate

    async def get_execution(*_args):
        return execution

    async def latest_review(*_args):
        return SimpleNamespace(attempt_seq=1)

    monkeypatch.setattr(agent, "get_candidate", get_candidate)
    monkeypatch.setattr(agent, "get_execution", get_execution)
    monkeypatch.setattr(agent, "latest_semantic_review", latest_review)

    with pytest.raises(ValueError, match="attempt must be 2"):
        await agent.append_semantic_review(
            scope,
            session,
            uuid.uuid4(),
            {
                "candidate_id": candidate_id,
                "execution_id": execution_id,
                "source_fingerprint": "a" * 64,
                "attempt_seq": 1,
            },
        )
    assert session.added == []


def test_immutable_evidence_repositories_expose_no_update_method():
    assert not hasattr(agent, "update_plan_revision")
    assert not hasattr(agent, "update_semantic_review")
    assert not hasattr(agent, "update_strict_verification")


async def test_legacy_set_plan_dual_writes_and_selects_revision_one(scope, session, monkeypatch):
    run_id = uuid.uuid4()
    plan_id = uuid.uuid4()
    row = SimpleNamespace(
        run_id=run_id,
        plan_id=None,
        current_plan_id=None,
        plan=None,
        updated_at=None,
    )
    appended = []
    selected = []

    async def get_agent_run(*_args):
        return row

    async def get_revision(*_args):
        return None

    async def append_revision(_scope, _session, owner_run_id, values):
        appended.append((owner_run_id, values))

    async def select_plan(_scope, _session, owner_run_id, selected_plan_id):
        selected.append((owner_run_id, selected_plan_id))

    monkeypatch.setattr(agent, "get_or_create_agent_run", get_agent_run)
    monkeypatch.setattr(agent, "get_plan_revision", get_revision)
    monkeypatch.setattr(agent, "append_plan_revision", append_revision)
    monkeypatch.setattr(agent, "select_current_plan", select_plan)

    plan = {"framework": "qiskit", "steps": []}
    await agent.set_plan(scope, session, run_id, plan_id=plan_id, plan=plan)

    assert row.plan_id == plan_id
    assert appended[0][0] == run_id
    assert appended[0][1]["id"] == plan_id
    assert appended[0][1]["revision"] == 1
    assert appended[0][1]["plan_fingerprint"] == agent._fingerprint_plan(plan)
    assert selected == [(run_id, plan_id)]


async def test_candidate_uses_explicit_current_plan_and_rejects_stale_plan(
    scope, session, monkeypatch
):
    run_id = uuid.uuid4()
    legacy_plan_id = uuid.uuid4()
    current_plan_id = uuid.uuid4()
    agent_run = SimpleNamespace(
        plan_id=legacy_plan_id,
        current_plan_id=current_plan_id,
    )

    async def get_agent_run(*_args):
        return agent_run

    monkeypatch.setattr(agent, "get_or_create_agent_run", get_agent_run)
    values = {
        "id": uuid.uuid4(),
        "tool_call_id": "simulate-1",
        "revision": 1,
        "parent_candidate_id": None,
        "plan_id": current_plan_id,
        "framework": "qiskit",
        "source": "print(1)",
        "source_fingerprint": "a" * 64,
        "status": "created",
    }

    await agent.add_candidate(scope, session, run_id, values)
    assert session.added[-1].plan_id == current_plan_id

    with pytest.raises(ValueError, match="plan does not belong"):
        await agent.add_candidate(
            scope, session, run_id, values | {"id": uuid.uuid4(), "plan_id": legacy_plan_id}
        )


async def test_sum_usage(scope, session):
    import datetime as dt

    await usage.sum_usage(
        scope, session, kind=UsageKind.RUN, since=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    )
    assert_workspace_bound(session.statements[0], scope)


async def test_list_audit(scope, session):
    admin = scope.model_copy(update={"role": "admin"})
    await audit.list_audit(admin, session)
    assert_workspace_bound(session.statements[0], admin)


async def test_created_rows_carry_scope_workspace(scope, session):
    artifact = await artifacts.create_artifact(
        scope,
        session,
        slug="s",
        title="t",
        family="VQE",
        framework="qiskit",
        kept=True,
    )
    assert artifact.workspace_id == scope.workspace_id

    run = await runs.create_run(
        scope, session, task_prompt="p", mode=RunMode.EXECUTE, framework="qiskit"
    )
    assert run.workspace_id == scope.workspace_id
    assert run.user_id == scope.user_id

    folder = await folders.create_folder(scope, session, name="  shared   work  ")
    assert folder.workspace_id == scope.workspace_id
    assert folder.name == "shared work"

    event = await usage.record_usage(scope, session, kind=UsageKind.RUN, quantity=1)
    assert event.workspace_id == scope.workspace_id

    row = await audit.record_audit(scope, session, action="test")
    assert row.workspace_id == scope.workspace_id
    assert row.actor_user_id == scope.user_id


async def test_create_run_rejects_an_artifact_version_outside_scope(scope, session):
    """A bad Vault context must fail before a queued Run is inserted.

    The worker also resolves the version under scope, but waiting until claim
    time would leave an apparently valid queued run and an orphaned job. The
    submission repository is the first boundary and must reject the reference
    there.
    """
    with pytest.raises(NotFoundError):
        await runs.create_run(
            scope,
            session,
            task_prompt="use this artifact",
            mode=RunMode.EXECUTE,
            framework="qiskit",
            artifact_version_id=uuid.uuid4(),
        )

    assert_workspace_bound(session.statements[0], scope)
    assert session.added == []


async def test_verification_record_requires_in_scope_run(scope, session):
    with pytest.raises(NotFoundError):
        await runs.add_verification_record(
            scope, session, uuid.uuid4(), method=VerificationMethod.EXACT, result="pass"
        )
    assert_workspace_bound(session.statements[0], scope)
