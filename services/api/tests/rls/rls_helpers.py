"""Live RLS probe dataset (ai-ops#143; docs/adr/0028-rls-defense-in-depth.md).

Runs against DATABASE_URL (skipped when unset), exactly like
`services/api/tests/authz/matrix_helpers.py` — but self-contained rather than
importing that module. Neither `tests/authz/` nor `tests/rls/` carries an
`__init__.py`, so pytest collects each as a rootless package and inserts only
that ONE directory onto `sys.path`; an import across them would work only by
accident of both directories being collected in the same invocation, and this
suite is meant to run as its own step, against its own connecting role (see
`.github/workflows/ci.yml`'s `db` job) — precisely the case where that
accident does not happen.

**This suite MUST connect as a non-superuser, non-owner role equivalent to
production's `majorana_api`** (LOGIN, member of `app_rw` only, no BYPASSRLS,
no SUPERUSER). A superuser or table-owner connection bypasses every policy
this migration creates regardless of GUC state and would report every probe
below as passing while proving nothing — see
`db/migrations/versions/0052_app_rw_privilege_bundle.py`'s own note on this
exact trap, and `test_connecting_role_cannot_bypass_rls` in
`test_rls_policies.py`, which asserts it rather than assuming it.

Provisions two workspaces (A, B) through the repository layer for the tables
that already have write functions there, then inserts one row per REMAINING
protected table directly via SQL for both — the deeper agent/candidate/QPU/
provenance chain that no existing repository fixture populates. Raw SQL here
is not a shortcut around the repository layer's authz invariant (AGENTS.md
hard rule 2): this data exists to be probed for ROW-LEVEL SECURITY, a
different, database-enforced control than the Scope-predicate one that
invariant protects, and every insert below runs with RLS enforcement OFF
(nothing sets `majorana.rls_enforce`), which is the permissive default and
therefore unaffected by whichever policy is under test.
"""

import dataclasses
import datetime as dt
import hashlib
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, RunMode, UsageKind, VerificationMethod
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from majorana_api.repos import artifacts, folders, projects, runs, system, usage

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="RLS suite needs DATABASE_URL"
)

#: Set once per probe by the test, never here — this module only inserts data
#: with enforcement off, so it must never itself set `majorana.rls_enforce`.
WORKSPACE_GUC = "majorana.workspace_id"
ENFORCE_GUC = "majorana.rls_enforce"


def _hex64(seed: str) -> str:
    """A valid `^[0-9a-f]{64}$` fingerprint, several tables' CHECK constraints
    require this shape and a uuid's hex digest (32 chars) is too short."""
    return hashlib.sha256(f"rls-fixture-{seed}-{uuid.uuid4()}".encode()).hexdigest()


@dataclasses.dataclass
class TenantRows:
    """One id per protected table, for one tenant. `None` where this tenant
    was not given a row in that table (there is no reason to double every
    insert when one row per table, in tenant A, is enough to prove the
    predicate reaches that table at all — the CROSS-tenant probes are what
    need both tenants to have data, and every DIRECT/live-probed table below
    does)."""

    workspace_id: uuid.UUID
    owner_user_id: uuid.UUID
    workspace_folders: uuid.UUID
    projects: uuid.UUID
    artifacts: uuid.UUID
    artifact_versions: uuid.UUID
    runs: uuid.UUID
    usage_events: uuid.UUID
    audit_log: uuid.UUID
    qpu_runs: uuid.UUID
    qapps: uuid.UUID
    qapp_versions: uuid.UUID
    qapp_executions: uuid.UUID
    artifact_citations: uuid.UUID
    artifact_tags: str
    artifact_sources: uuid.UUID
    license_assertions: uuid.UUID
    run_events: uuid.UUID
    verification_records: uuid.UUID
    agent_runs: uuid.UUID  # == runs (shared PK), kept for readability at call sites
    run_plans: uuid.UUID
    run_candidates: uuid.UUID
    candidate_executions: uuid.UUID


async def _build_tenant(session: AsyncSession, tag: str) -> TenantRows:
    owner, ws = await system.get_or_provision_user(
        session, workos_user_id=f"rls-{tag}-owner-{uuid.uuid4()}", email=f"rls-{tag}@rls.test"
    )
    scope = Scope(user_id=owner.id, workspace_id=ws.id, role=Role.OWNER)

    artifact = await artifacts.create_artifact(
        scope,
        session,
        slug=f"rls-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"rls probe {tag}",
        family="Bell",
        framework="qiskit",
        kept=True,
    )
    version = await artifacts.create_version(
        scope,
        session,
        artifact.id,
        qasm_version="3.0",
        qasm="OPENQASM 3.0;",
        code="pass",
        code_lang="python",
        fingerprint=f"rls-fp-{tag}-{uuid.uuid4().hex[:8]}",
        export_status="lossless",
    )
    run = await runs.create_run(
        scope, session, task_prompt=f"rls {tag}", mode=RunMode.EXECUTE, framework="qiskit"
    )
    folder = await folders.create_folder(scope, session, name=f"rls {tag} folder")
    project = await projects.create_project(scope, session, name=f"rls {tag} project")
    await runs.append_run_event(scope, session, run.id, type="run.queued", payload={})
    event = (
        await session.execute(
            text("select id from run_events where run_id = :r limit 1"), {"r": run.id}
        )
    ).scalar_one()
    await runs.add_verification_record(
        scope, session, run.id, method=VerificationMethod.EXACT, result="pass"
    )
    verification_id = (
        await session.execute(
            text("select id from verification_records where run_id = :r limit 1"), {"r": run.id}
        )
    ).scalar_one()
    await usage.record_usage(scope, session, kind=UsageKind.RUN, quantity=1)
    usage_id = (
        await session.execute(
            text(
                "select id from usage_events where workspace_id = :w order by created_at desc limit 1"
            ),
            {"w": ws.id},
        )
    ).scalar_one()

    # Everything past here has no repository write function exercised by an
    # existing fixture, so it is inserted directly. Ids are generated here
    # (rather than read back) so later inserts in the same chain can
    # reference them without a round trip.
    audit_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into audit_log (id, workspace_id, actor_user_id, action) "
            "values (:id, :w, :u, 'rls.fixture')"
        ),
        {"id": audit_id, "w": ws.id, "u": owner.id},
    )

    qpu_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into qpu_runs (id, workspace_id, user_id, provider, device_id, shots, "
            "source_fingerprint, qasm, estimate_basis, rate_source, rate_confirmed_on) "
            "values (:id, :w, :u, 'ibm', 'ibm_test', 1, :fp, 'OPENQASM 3.0;', 'vendor_rate_card', "
            "'rls-fixture', '2026-01-01')"
        ),
        {"id": qpu_id, "w": ws.id, "u": owner.id, "fp": f"rls-qpu-{tag}-{uuid.uuid4().hex[:8]}"},
    )

    qapp_id = uuid.uuid4()
    qapp_version_id = uuid.uuid4()
    qapp_execution_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into qapps "
            "(id, workspace_id, owner_user_id, slug, title, description, created_by_run_id) "
            "values (:id, :w, :u, :slug, 'RLS Qapp', 'private probe', :r)"
        ),
        {
            "id": qapp_id,
            "w": ws.id,
            "u": owner.id,
            "slug": f"rls-qapp-{tag}-{uuid.uuid4().hex[:8]}",
            "r": run.id,
        },
    )
    await session.execute(
        text(
            "insert into qapp_versions "
            "(id, qapp_id, seq, framework, qubits_estimate, ui_document, quantum_source, "
            "input_schema, output_schema, fingerprint, generation_prompt) values "
            "(:id, :q, 1, 'qiskit', 2, '<html></html>', 'RESULT = {}', "
            '\'{"type":"object"}\'::jsonb, \'{"type":"object"}\'::jsonb, :fp, \'probe\')'
        ),
        {"id": qapp_version_id, "q": qapp_id, "fp": _hex64(f"qapp-{tag}")},
    )
    await session.execute(
        text("update qapps set current_version_id = :v where id = :q"),
        {"v": qapp_version_id, "q": qapp_id},
    )
    await session.execute(
        text(
            "insert into qapp_executions "
            "(id, workspace_id, user_id, qapp_id, qapp_version_id, inputs) "
            "values (:id, :w, :u, :q, :v, '{}'::jsonb)"
        ),
        {"id": qapp_execution_id, "w": ws.id, "u": owner.id, "q": qapp_id, "v": qapp_version_id},
    )

    citation_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into artifact_citations (id, artifact_id, relation, url) "
            "values (:id, :a, 'describes', :url)"
        ),
        {"id": citation_id, "a": artifact.id, "url": f"https://example.test/rls-fixture-{tag}"},
    )

    tag_value = f"rls-{tag}"
    await session.execute(
        text("insert into artifact_tags (artifact_id, tag) values (:a, :t)"),
        {"a": artifact.id, "t": tag_value},
    )

    source_id = uuid.uuid4()
    now = dt.datetime.now(dt.timezone.utc)
    await session.execute(
        text(
            "insert into artifact_sources "
            "(id, artifact_version_id, source_kind, retrieved_at, content_hash) "
            "values (:id, :v, 'upload', :now, :hash)"
        ),
        {"id": source_id, "v": version.id, "now": now, "hash": _hex64(f"source-{tag}")},
    )

    license_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into license_assertions "
            "(id, artifact_version_id, assertion_kind, license_scope) "
            "values (:id, :v, 'declared', 'whole')"
        ),
        {"id": license_id, "v": version.id},
    )

    # agent_runs shares its primary key with runs — no id column of its own.
    await session.execute(text("insert into agent_runs (run_id) values (:r)"), {"r": run.id})

    plan_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into run_plans (id, run_id, revision, plan, plan_fingerprint) "
            "values (:id, :r, 1, '{}'::jsonb, :fp)"
        ),
        {"id": plan_id, "r": run.id, "fp": _hex64(f"plan-{tag}")},
    )

    candidate_id = uuid.uuid4()
    candidate_fp = _hex64(f"candidate-{tag}")
    await session.execute(
        text(
            "insert into run_candidates "
            "(id, run_id, tool_call_id, revision, plan_id, framework, source, source_fingerprint) "
            "values (:id, :r, 'rls-tool-call', 1, :plan_id, 'qiskit', 'llm', :fp)"
        ),
        {"id": candidate_id, "r": run.id, "plan_id": plan_id, "fp": candidate_fp},
    )

    execution_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into candidate_executions "
            "(id, candidate_id, source_fingerprint, environment_fingerprint, sandbox_provider, "
            "exit_code, duration_ms, result, observation) "
            "values (:id, :c, :fp, :env_fp, 'local', 0, 1, '{}'::jsonb, '{}'::jsonb)"
        ),
        {
            "id": execution_id,
            "c": candidate_id,
            "fp": candidate_fp,
            "env_fp": _hex64(f"env-{tag}"),
        },
    )

    return TenantRows(
        workspace_id=ws.id,
        owner_user_id=owner.id,
        workspace_folders=folder.id,
        projects=project.id,
        artifacts=artifact.id,
        artifact_versions=version.id,
        runs=run.id,
        usage_events=usage_id,
        audit_log=audit_id,
        qpu_runs=qpu_id,
        qapps=qapp_id,
        qapp_versions=qapp_version_id,
        qapp_executions=qapp_execution_id,
        artifact_citations=citation_id,
        artifact_tags=tag_value,
        artifact_sources=source_id,
        license_assertions=license_id,
        run_events=event,
        verification_records=verification_id,
        agent_runs=run.id,
        run_plans=plan_id,
        run_candidates=candidate_id,
        candidate_executions=execution_id,
    )


async def provision(session_factory) -> tuple[TenantRows, TenantRows]:
    async with session_factory() as session:
        a = await _build_tenant(session, "a")
        b = await _build_tenant(session, "b")
        await session.commit()
    return a, b
