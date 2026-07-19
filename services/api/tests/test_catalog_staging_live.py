"""Live-DB test in the authz-suite mold: skipped without DATABASE_URL.

Proves Step 3's private staging path end-to-end against real Postgres:
importer-only creation, non-public defaults, and the global exact-duplicate
rejection enforced by migration 0014's unique constraint. Each test uses
fresh UUIDs so it is safe to run repeatedly against the same branch.
"""

import asyncio
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    ExecutionState,
    Framework,
    PublicationState,
    ReviewState,
    Role,
)

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import AuthzError, catalog, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="catalog staging needs DATABASE_URL"
)


_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")


@pytest.fixture(scope="module")
def authority():
    """Provision the fixed importer/reader identity once per module.

    ensure_system_catalog_authority is a singleton operation in production
    (services/api/src/majorana_api/catalog_admin.py): its service-identity
    workos_user_id values are fixed constants, so a fresh uuid4() workspace
    triple on every test run collides with a prior run's row on the
    users.workos_user_id unique constraint the moment the same database is
    reused. Deterministic UUIDs make re-provisioning idempotent instead,
    matching how Step 2 validated this function against a real Neon branch.
    """
    configured = CatalogAuthority(
        enabled=True,
        workspace_id=uuid.uuid5(_STABLE_NAMESPACE, "workspace"),
        importer_user_id=uuid.uuid5(_STABLE_NAMESPACE, "importer"),
        public_reader_user_id=uuid.uuid5(_STABLE_NAMESPACE, "public-reader"),
    )

    async def _provision():
        engine = engine_from_env()
        factory = session_factory(engine)
        async with factory() as session:
            await system.ensure_system_catalog_authority(
                session,
                workspace_id=configured.workspace_id,
                importer_user_id=configured.importer_user_id,
                public_reader_user_id=configured.public_reader_user_id,
            )
            await session.commit()
        await engine.dispose()

    asyncio.run(_provision())
    return configured


@pytest.fixture
async def catalog_env(authority):
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield authority, factory
    finally:
        await engine.dispose()


def _stage_kwargs(**overrides):
    kwargs = dict(
        slug=f"live-{uuid.uuid4()}",
        title="Live Bell",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        artifact_kind=ArtifactKind.CIRCUIT,
        execution_state=ExecutionState.EXECUTABLE,
    )
    kwargs.update(overrides)
    return kwargs


def _version_kwargs(**overrides):
    kwargs = dict(
        code_lang="python",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="1.2.0",
        source_language="python",
        metadata_schema_version="1",
    )
    kwargs.update(overrides)
    return kwargs


@requires_db
async def test_stage_artifact_and_version_persist_non_public(catalog_env):
    authority, factory = catalog_env
    scope = authority.importer_scope()
    async with factory() as session:
        artifact = await catalog.stage_artifact(
            scope, session, authority=authority, **_stage_kwargs()
        )
        source = f"qc.h(0)\nqc.cx(0,1)\n# {uuid.uuid4()}"
        version = await catalog.stage_artifact_version(
            scope,
            session,
            artifact.id,
            authority=authority,
            raw_source=source.encode(),
            normalized_source=source,
            code=source,
            **_version_kwargs(),
        )
        await session.commit()

    assert artifact.review_state == ReviewState.DRAFT
    assert artifact.publication_state == PublicationState.PRIVATE
    assert version.artifact_id == artifact.id
    assert version.seq == 1
    assert version.source_blob_sha256 == version.normalized_source_hash


@requires_db
async def test_duplicate_normalized_source_hash_rejected_across_artifacts(catalog_env):
    authority, factory = catalog_env
    scope = authority.importer_scope()
    normalized = f"duplicate-source-{uuid.uuid4()}"

    async with factory() as session:
        first_artifact = await catalog.stage_artifact(
            scope, session, authority=authority, **_stage_kwargs()
        )
        await catalog.stage_artifact_version(
            scope,
            session,
            first_artifact.id,
            authority=authority,
            raw_source=normalized.encode(),
            normalized_source=normalized,
            code=normalized,
            **_version_kwargs(),
        )
        await session.commit()

    async with factory() as session:
        second_artifact = await catalog.stage_artifact(
            scope, session, authority=authority, **_stage_kwargs()
        )
        await session.commit()

    async with factory() as session:
        with pytest.raises(catalog.DuplicateSourceError):
            await catalog.stage_artifact_version(
                scope,
                session,
                second_artifact.id,
                authority=authority,
                raw_source=b"entirely different bytes",
                normalized_source=normalized,  # same normalized text -> global collision
                code="different code",
                **_version_kwargs(),
            )


@requires_db
async def test_normal_user_scope_cannot_stage(catalog_env):
    authority, factory = catalog_env
    async with factory() as session:
        user, ws = await system.get_or_provision_user(
            session,
            workos_user_id=f"catalog-intruder-{uuid.uuid4()}",
            email=f"intruder-{uuid.uuid4().hex[:8]}@authz.test",
        )
        await session.commit()
        intruder_scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)
        with pytest.raises(AuthzError):
            await catalog.stage_artifact(
                intruder_scope, session, authority=authority, **_stage_kwargs()
            )
