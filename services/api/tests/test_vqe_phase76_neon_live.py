"""Phase 7.6 persistence checks that require a disposable PostgreSQL branch."""

from __future__ import annotations

import asyncio
import hashlib
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_vqe.controlled_comparison import ControlledComparisonSpecV1
from majorana_vqe.models import ComponentType
from sqlalchemy import update
from sqlalchemy.exc import DBAPIError

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import VqeControlledComparisonSpec
from majorana_api.repos import NotFoundError, artifacts, system
from majorana_api.repos import vqe as vqe_repo
from majorana_api.standard_vqe_materializer import (
    materialize_standard_vqe_catalog,
)

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="Phase 7.6 Neon tests require DATABASE_URL",
)


@pytest.fixture
async def db():
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _catalog_scope(session) -> Scope:
    authority = CatalogAuthority.from_env()
    if not authority.enabled:
        pytest.skip("system catalog authority is disabled")
    assert authority.workspace_id is not None
    assert authority.importer_user_id is not None
    assert authority.public_reader_user_id is not None
    await system.ensure_system_catalog_authority(
        session,
        workspace_id=authority.workspace_id,
        importer_user_id=authority.importer_user_id,
        public_reader_user_id=authority.public_reader_user_id,
    )
    await materialize_standard_vqe_catalog(authority.importer_scope(), session)
    return authority.importer_scope()


async def _comparison_pair(factory):
    async with factory() as session:
        scope = await _catalog_scope(session)
        workflows = await vqe_repo.list_component_specs(
            scope,
            session,
            component_type=ComponentType.WORKFLOW,
            limit=200,
        )
        baseline = next(
            row for row in workflows if row.semantic_key == "workflow.h2.fixed_excitation.v1"
        )
        optimizers = await vqe_repo.list_component_specs(
            scope,
            session,
            component_type=ComponentType.PARAMETER_OPTIMIZER,
            limit=200,
        )
        slsqp = next(row for row in optimizers if row.semantic_key == "optimizer.slsqp.v1")
        candidate = await vqe_repo.save_component_swap_workflow_draft(
            scope,
            session,
            baseline_workflow_artifact_version_id=baseline.artifact_version_id,
            baseline_template_key="workflow.h2.fixed_excitation.v1",
            changed_role=ComponentType.PARAMETER_OPTIMIZER,
            candidate_component_semantic_key="optimizer.slsqp.v1",
            candidate_component_spec_sha256=slsqp.normalized_spec_sha256,
            configuration=(),
            evaluator_provider="qiskit",
            request_idempotency_key="phase76-neon-slsqp-workflow-v1",
            catalog_workspace_id=scope.workspace_id,
        )
        fixed: dict[ComponentType, str] = {}
        for link in await vqe_repo.list_workflow_components(
            scope,
            session,
            baseline.artifact_version_id,
        ):
            role = ComponentType(link.component_role)
            if role is ComponentType.PARAMETER_OPTIMIZER:
                continue
            component = await vqe_repo.get_component_spec(
                scope,
                session,
                link.component_artifact_version_id,
            )
            fixed[role] = component.normalized_spec_sha256
        await session.commit()
        spec = ControlledComparisonSpecV1(
            baseline_workflow_artifact_version_id=baseline.artifact_version_id,
            candidate_workflow_artifact_version_id=(candidate.workflow_spec.artifact_version_id),
            changed_role=ComponentType.PARAMETER_OPTIMIZER,
            fixed_component_digests=fixed,
            baseline_configuration={"algorithm": "bounded"},
            candidate_configuration={"algorithm": "slsqp"},
            metric_protocol_sha256=hashlib.sha256(b"phase76-metric").hexdigest(),
            budget_protocol_sha256=hashlib.sha256(b"phase76-budget").hexdigest(),
        )
        return scope, spec


@requires_db
async def test_standard_materialization_is_idempotent_and_digest_stable(db):
    async with db() as session:
        scope = await _catalog_scope(session)
        first = await materialize_standard_vqe_catalog(scope, session)
        second = await materialize_standard_vqe_catalog(scope, session)
        await session.commit()
    assert first.component_created == 0
    assert first.workflow_created == 0
    assert second.component_reused == 29
    assert second.workflow_reused == 7
    assert first.catalog_digest_sha256 == second.catalog_digest_sha256


@requires_db
async def test_standard_materialization_is_isolated_across_workspaces(db):
    reports = []
    for ordinal in range(2):
        async with db() as session:
            user, workspace = await system.get_or_provision_user(
                session,
                workos_user_id=f"phase76-materializer-tenant-{ordinal}-{uuid.uuid4()}",
                email=f"phase76-materializer-{ordinal}-{uuid.uuid4().hex}@invalid.test",
            )
            scope = Scope(
                user_id=user.id,
                workspace_id=workspace.id,
                role=Role.OWNER,
            )
            kept_before = await artifacts.count_kept_against_quota(scope, session)
            reports.append(await materialize_standard_vqe_catalog(scope, session))
            assert await artifacts.count_kept_against_quota(scope, session) == kept_before
            await session.commit()

    assert all(report.component_created == 29 for report in reports)
    assert all(report.workflow_created == 7 for report in reports)
    assert reports[0].catalog_digest_sha256 == reports[1].catalog_digest_sha256


@requires_db
async def test_comparison_spec_concurrency_is_idempotent_and_tenant_scoped(db):
    scope, spec = await _comparison_pair(db)
    key = f"phase76-comparison-{uuid.uuid4()}"

    async def create_once():
        async with db() as session:
            row = await vqe_repo.create_controlled_comparison_spec(
                scope,
                session,
                spec=spec,
                request_idempotency_key=key,
                catalog_workspace_id=scope.workspace_id,
            )
            await session.commit()
            return row.id

    first, second = await asyncio.gather(create_once(), create_once())
    assert first == second

    async with db() as session:
        intruder_user, intruder_workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"phase76-intruder-{uuid.uuid4()}",
            email=f"phase76-{uuid.uuid4().hex}@invalid.test",
        )
        intruder = Scope(
            user_id=intruder_user.id,
            workspace_id=intruder_workspace.id,
            role=Role.OWNER,
        )
        with pytest.raises(NotFoundError):
            await vqe_repo.get_controlled_comparison_spec(
                intruder,
                session,
                first,
            )

    async with db() as session:
        with pytest.raises(DBAPIError, match="append-only"):
            await session.execute(
                update(VqeControlledComparisonSpec)
                .where(VqeControlledComparisonSpec.id == first)
                .values(changed_role="ansatz")
            )
            await session.commit()
