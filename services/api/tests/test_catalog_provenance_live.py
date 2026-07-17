"""Live-DB test in the authz-suite mold: skipped without DATABASE_URL.

Proves Step 4's provenance/rights/review path end-to-end against real
Postgres: fail-closed automatic quarantine, stale-evidence reset on a new
version, hash round-trip fidelity, and — the headline property — that the
importer service principal and a real human reviewer are structurally
different principals enforced by persisted membership rows, not just
in-process checks.
"""

import asyncio
import datetime as dt
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    CitationRelation,
    ExecutionState,
    Framework,
    LicenseAssertionKind,
    LicenseDecision,
    LicenseScope,
    ReviewState,
    Role,
    SourceKind,
)
from sqlalchemy import select

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Membership
from majorana_api.repos import AuthzError, catalog, system, workspaces

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="catalog provenance needs DATABASE_URL"
)

# Same namespace and labels as test_catalog_staging_live.py on purpose: the
# system catalog authority's service-identity workos_user_id values are
# global fixed constants (services/api/src/majorana_api/repos/system.py), so
# two test modules provisioning different workspace/importer UUIDs against
# the same database collide on users.workos_user_id. Both files must resolve
# to the same singleton authority, matching production.
_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")


@pytest.fixture(scope="module")
def authority():
    """Provision the shared catalog authority plus a real human reviewer
    with ADMIN membership, granted by the importer's OWNER scope."""
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
            reviewer, _ = await system.get_or_provision_user(
                session,
                workos_user_id="provenance-reviewer",
                email="reviewer@authz.test",
            )
            existing = (
                (
                    await session.execute(
                        select(Membership).where(
                            Membership.workspace_id == configured.workspace_id,
                            Membership.user_id == reviewer.id,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if existing is None:  # workspaces.add_member is a plain INSERT
                await workspaces.add_member(
                    configured.importer_scope(),
                    session,
                    user_id=reviewer.id,
                    role=Role.ADMIN,
                )
            await session.commit()
            reviewer_id = reviewer.id
        await engine.dispose()
        return reviewer_id

    reviewer_id = asyncio.run(_provision())
    return configured, reviewer_id


@pytest.fixture
async def env(authority):
    configured, reviewer_id = authority
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield configured, reviewer_id, factory
    finally:
        await engine.dispose()


def _reviewer_scope(configured, reviewer_id) -> Scope:
    return Scope(user_id=reviewer_id, workspace_id=configured.workspace_id, role=Role.ADMIN)


async def _stage_ready_version(session, configured, *, source_text: str):
    scope = configured.importer_scope()
    artifact = await catalog.stage_artifact(
        scope,
        session,
        authority=configured,
        slug=f"live-{uuid.uuid4()}",
        title="Live",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        artifact_kind=ArtifactKind.CIRCUIT,
        execution_state=ExecutionState.EXECUTABLE,
    )
    version = await catalog.stage_artifact_version(
        scope,
        session,
        artifact.id,
        authority=configured,
        raw_source=source_text.encode(),
        normalized_source=source_text,
        code=source_text,
        code_lang="python",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="1.2.0",
        source_language="python",
        metadata_schema_version="1",
    )
    return artifact, version


@requires_db
async def test_provenance_and_rights_round_trip_with_identical_hashes(env):
    configured, reviewer_id, factory = env
    content_hash = "a" * 64
    evidence_hash = "b" * 64
    async with factory() as session:
        artifact, version = await _stage_ready_version(
            session, configured, source_text=f"round-trip-{uuid.uuid4()}"
        )
        source = await catalog.record_artifact_source(
            configured.importer_scope(),
            session,
            version.id,
            authority=configured,
            source_kind=SourceKind.GIT,
            content_hash=content_hash,
            retrieved_at=dt.datetime.now(dt.timezone.utc),
            repository="https://example.invalid/repo",
            ref="deadbeef",
        )
        assertion = await catalog.record_license_assertion(
            configured.importer_scope(),
            session,
            version.id,
            authority=configured,
            assertion_kind=LicenseAssertionKind.DECLARED,
            license_scope=LicenseScope.WHOLE,
            spdx_id="MIT",
            evidence_hash=evidence_hash,
        )
        await session.commit()
        source_id, assertion_id = source.id, assertion.id

    async with factory() as session:
        from sqlalchemy import select

        from majorana_api.orm import ArtifactSource, LicenseAssertion

        reloaded_source = (
            await session.execute(select(ArtifactSource).where(ArtifactSource.id == source_id))
        ).scalar_one()
        reloaded_assertion = (
            await session.execute(
                select(LicenseAssertion).where(LicenseAssertion.id == assertion_id)
            )
        ).scalar_one()

    assert reloaded_source.content_hash == content_hash
    assert reloaded_assertion.evidence_hash == evidence_hash
    assert reloaded_assertion.spdx_id == "MIT"


@requires_db
async def test_unknown_license_quarantine_then_reviewer_approves_and_accepts(env):
    configured, reviewer_id, factory = env
    async with factory() as session:
        artifact, version = await _stage_ready_version(
            session, configured, source_text=f"quarantine-{uuid.uuid4()}"
        )
        await catalog.record_artifact_source(
            configured.importer_scope(),
            session,
            version.id,
            authority=configured,
            source_kind=SourceKind.GIT,
            content_hash="d" * 64,
            retrieved_at=dt.datetime.now(dt.timezone.utc),
        )
        await catalog.record_license_assertion(
            configured.importer_scope(),
            session,
            version.id,
            authority=configured,
            assertion_kind=LicenseAssertionKind.DETECTED,
            license_scope=LicenseScope.WHOLE,
            spdx_id=None,  # unknown -> fail-closed quarantine
        )
        await session.commit()
        assert artifact.review_state == ReviewState.QUARANTINED

    reviewer_scope = _reviewer_scope(configured, reviewer_id)
    async with factory() as session:
        await catalog.decide_license_assertion(
            reviewer_scope,
            session,
            version.id,
            authority=configured,
            decision=LicenseDecision.APPROVED,
            spdx_id="Apache-2.0",
        )
        decided = await catalog.decide_review(
            reviewer_scope,
            session,
            artifact.id,
            authority=configured,
            decision=ReviewState.ACCEPTED,
        )
        await session.commit()
        assert decided.review_state == ReviewState.ACCEPTED

    async with factory() as session:
        readiness = await catalog.get_publication_readiness(
            reviewer_scope, session, artifact.id, authority=configured
        )
    assert readiness.ready, readiness.blockers


@requires_db
async def test_new_version_resets_stale_acceptance(env):
    configured, reviewer_id, factory = env
    reviewer_scope = _reviewer_scope(configured, reviewer_id)
    async with factory() as session:
        artifact, version = await _stage_ready_version(
            session, configured, source_text=f"stale-{uuid.uuid4()}"
        )
        await catalog.record_artifact_source(
            configured.importer_scope(),
            session,
            version.id,
            authority=configured,
            source_kind=SourceKind.UPLOAD,
            content_hash="c" * 64,
            retrieved_at=dt.datetime.now(dt.timezone.utc),
        )
        await catalog.record_license_assertion(
            configured.importer_scope(),
            session,
            version.id,
            authority=configured,
            assertion_kind=LicenseAssertionKind.DECLARED,
            license_scope=LicenseScope.WHOLE,
            spdx_id="MIT",
        )
        await catalog.submit_for_review(
            configured.importer_scope(), session, artifact.id, authority=configured
        )
        await catalog.decide_review(
            reviewer_scope,
            session,
            artifact.id,
            authority=configured,
            decision=ReviewState.ACCEPTED,
        )
        await session.commit()
        assert artifact.review_state == ReviewState.ACCEPTED

    async with factory() as session:
        new_source_text = f"stale-followup-{uuid.uuid4()}"
        new_version = await catalog.stage_artifact_version(
            configured.importer_scope(),
            session,
            artifact.id,
            authority=configured,
            raw_source=new_source_text.encode(),
            normalized_source=new_source_text,
            code=new_source_text,
            code_lang="python",
            authoritative_framework=Framework.QISKIT,
            authoritative_framework_version="1.2.0",
            source_language="python",
            metadata_schema_version="1",
        )
        await session.commit()

    async with factory() as session:
        from sqlalchemy import select

        from majorana_api.orm import Artifact

        reloaded = (
            await session.execute(select(Artifact).where(Artifact.id == artifact.id))
        ).scalar_one()
    assert reloaded.review_state == ReviewState.DRAFT
    assert reloaded.current_version_id == new_version.id


@requires_db
async def test_importer_cannot_act_as_reviewer(env):
    configured, reviewer_id, factory = env
    async with factory() as session:
        artifact, version = await _stage_ready_version(
            session, configured, source_text=f"separation-{uuid.uuid4()}"
        )
        await catalog.submit_for_review(
            configured.importer_scope(), session, artifact.id, authority=configured
        )
        await session.commit()

    async with factory() as session:
        with pytest.raises(AuthzError):
            await catalog.decide_review(
                configured.importer_scope(),  # importer trying to review its own import
                session,
                artifact.id,
                authority=configured,
                decision=ReviewState.ACCEPTED,
            )


@requires_db
async def test_reviewer_cannot_stage_or_submit(env):
    configured, reviewer_id, factory = env
    reviewer_scope = _reviewer_scope(configured, reviewer_id)
    async with factory() as session:
        with pytest.raises(AuthzError):
            await catalog.stage_artifact(
                reviewer_scope,
                session,
                authority=configured,
                slug=f"reviewer-{uuid.uuid4()}",
                title="nope",
                family=Algorithm.BELL,
                framework=Framework.QISKIT,
                artifact_kind=ArtifactKind.CIRCUIT,
                execution_state=ExecutionState.EXECUTABLE,
            )


@requires_db
async def test_duplicate_normalized_source_hash_still_rejected_with_provenance(env):
    """Regression guard: Step 4 additions must not weaken Step 3's global
    duplicate rejection."""
    configured, reviewer_id, factory = env
    normalized = f"dup-with-provenance-{uuid.uuid4()}"
    async with factory() as session:
        await _stage_ready_version(session, configured, source_text=normalized)
        await session.commit()

    async with factory() as session:
        second_artifact = await catalog.stage_artifact(
            configured.importer_scope(),
            session,
            authority=configured,
            slug=f"live-{uuid.uuid4()}",
            title="Second",
            family=Algorithm.BELL,
            framework=Framework.QISKIT,
            artifact_kind=ArtifactKind.CIRCUIT,
            execution_state=ExecutionState.EXECUTABLE,
        )
        await session.commit()

    async with factory() as session:
        with pytest.raises(catalog.DuplicateSourceError):
            await catalog.stage_artifact_version(
                configured.importer_scope(),
                session,
                second_artifact.id,
                authority=configured,
                raw_source=b"different bytes",
                normalized_source=normalized,
                code="different",
                code_lang="python",
                authoritative_framework=Framework.QISKIT,
                authoritative_framework_version="1.2.0",
                source_language="python",
                metadata_schema_version="1",
            )


@requires_db
async def test_citation_and_tag_persist(env):
    configured, reviewer_id, factory = env
    async with factory() as session:
        artifact, _version = await _stage_ready_version(
            session, configured, source_text=f"citation-{uuid.uuid4()}"
        )
        citation = await catalog.record_citation(
            configured.importer_scope(),
            session,
            artifact.id,
            authority=configured,
            relation=CitationRelation.DESCRIBES,
            doi="10.1234/example",
        )
        await catalog.tag_artifact(
            configured.importer_scope(),
            session,
            artifact.id,
            authority=configured,
            tag="benchmark",
        )
        await session.commit()
    assert citation.doi == "10.1234/example"
