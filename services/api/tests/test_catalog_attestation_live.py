"""Live-DB tests for the owner bulk attestation primitives (Slice C.5).

Skipped without DATABASE_URL, in the authz-suite mold. The headline property:
one attestation call takes a staged draft all the way to publishable — provenance
row, approved license, accepted review — while the importer and the attesting
human remain structurally different principals, enforced by persisted membership
rows exactly as the per-record path enforces them (ADR-0016).
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
    LicenseAssertionKind,
    LicenseDecision,
    LicenseScope,
    PublicationState,
    ReviewState,
    Role,
    SourceKind,
)
from sqlalchemy import select

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import ArtifactSource, AuditLog, Membership
from majorana_api.repos import AuthzError, NotFoundError, catalog, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="catalog attestation needs DATABASE_URL"
)

# Same singleton authority as the other live catalog modules: the service
# identities' workos_user_id values are global constants, so two modules
# provisioning different UUIDs would collide on users.workos_user_id.
_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")

ATTESTATION_META = {
    "policy_version": 1,
    "policy_checksum": "c" * 64,
    "statement": "I attest that these records are first-party works.",
    "spdx_id": "CC-BY-4.0",
}


@pytest.fixture(scope="module")
def authority():
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
            attester, _ = await system.get_or_provision_user(
                session,
                workos_user_id="attestation-owner",
                email="attester@authz.test",
            )
            await session.commit()
            attester_id = attester.id
        await engine.dispose()
        return attester_id

    attester_id = asyncio.run(_provision())
    return configured, attester_id


@pytest.fixture
async def env(authority):
    configured, attester_id = authority
    engine = engine_from_env()
    factory = session_factory(engine)
    # grant_catalog_reviewer is itself under test, so the fixture uses it to
    # establish the ADMIN membership the rest of the module depends on.
    async with factory() as session:
        await catalog.grant_catalog_reviewer(
            configured.importer_scope(), session, authority=configured, user_id=attester_id
        )
        await session.commit()
    try:
        yield configured, attester_id, factory
    finally:
        await engine.dispose()


def _reviewer_scope(configured, attester_id) -> Scope:
    return Scope(user_id=attester_id, workspace_id=configured.workspace_id, role=Role.ADMIN)


async def _stage_draft(session, configured):
    scope = configured.importer_scope()
    text = f"attest-{uuid.uuid4()}"
    artifact = await catalog.stage_artifact(
        scope,
        session,
        authority=configured,
        slug=f"attest-{uuid.uuid4()}",
        title="Attestable",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        artifact_kind=ArtifactKind.CIRCUIT,
        execution_state=ExecutionState.EXECUTABLE,
    )
    await catalog.stage_artifact_version(
        scope,
        session,
        artifact.id,
        authority=configured,
        raw_source=text.encode(),
        normalized_source=text,
        code=text,
        code_lang="python",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="1.2.0",
        source_language="python",
        metadata_schema_version="1",
    )
    return artifact


async def _attest(session, configured, attester_id, artifact_id, **overrides):
    kwargs = {
        "authority": configured,
        "spdx_id": "CC-BY-4.0",
        "assertion_kind": LicenseAssertionKind.DECLARED,
        "license_scope": LicenseScope.WHOLE,
        "source_kind": SourceKind.LITERATURE,
        "evidence_hash": "e" * 64,
        "repository": None,
        "ref": "deadbeef",
        "path": "some-record",
        "retrieval_metadata": {"manifest_checksum": "f" * 64},
        "attestation_meta": ATTESTATION_META,
    }
    kwargs.update(overrides)
    return await catalog.attest_catalog_record(
        configured.importer_scope(),
        _reviewer_scope(configured, attester_id),
        session,
        artifact_id,
        **kwargs,
    )


@requires_db
async def test_attestation_makes_a_staged_draft_publishable(env):
    configured, attester_id, factory = env
    async with factory() as session:
        artifact = await _stage_draft(session, configured)
        blocked = await catalog.get_publication_readiness(
            configured.importer_scope(), session, artifact.id, authority=configured
        )
        # Baseline: exactly the two bindings the importer deliberately omits.
        assert not blocked.ready
        assert any("artifact_sources" in b for b in blocked.blockers)
        assert any("license" in b for b in blocked.blockers)

        performed = await _attest(session, configured, attester_id, artifact.id)
        assert performed == ("source", "declared", "approved", "submitted", "accepted")
        await session.commit()
        artifact_id = artifact.id

    async with factory() as session:
        ready = await catalog.get_publication_readiness(
            configured.importer_scope(), session, artifact_id, authority=configured
        )
        assert ready.ready, ready.blockers

    async with factory() as session:
        published = await catalog.publish_catalog_artifact(
            _reviewer_scope(configured, attester_id), session, artifact_id, authority=configured
        )
        assert published.publication_state == PublicationState.PUBLIC
        assert published.review_state == ReviewState.ACCEPTED
        await session.commit()


@requires_db
async def test_attestation_is_idempotent(env):
    """A run interrupted halfway must be resumable by simply re-running, so the
    second pass has to report no work rather than appending a second source row
    (which the UNIQUE constraint would reject) or a redundant approval."""
    configured, attester_id, factory = env
    async with factory() as session:
        artifact = await _stage_draft(session, configured)
        await _attest(session, configured, attester_id, artifact.id)
        await session.commit()
        artifact_id = artifact.id

    async with factory() as session:
        assert await _attest(session, configured, attester_id, artifact_id) == ()
        await session.commit()

    async with factory() as session:
        sources = (
            (
                await session.execute(
                    select(ArtifactSource)
                    .join(
                        catalog.ArtifactVersion,
                        catalog.ArtifactVersion.id == ArtifactSource.artifact_version_id,
                    )
                    .where(catalog.ArtifactVersion.artifact_id == artifact_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(sources) == 1


@requires_db
async def test_attestation_records_the_claim_and_the_signed_statement(env):
    configured, attester_id, factory = env
    async with factory() as session:
        artifact = await _stage_draft(session, configured)
        await _attest(
            session,
            configured,
            attester_id,
            artifact.id,
            retrieval_metadata={"license_claim": "Citation metadata only"},
        )
        await session.commit()
        artifact_id = artifact.id

    async with factory() as session:
        source = (
            (
                await session.execute(
                    select(ArtifactSource)
                    .join(
                        catalog.ArtifactVersion,
                        catalog.ArtifactVersion.id == ArtifactSource.artifact_version_id,
                    )
                    .where(catalog.ArtifactVersion.artifact_id == artifact_id)
                )
            )
            .scalars()
            .one()
        )
        # The prose claim survives as evidence; it is never mistaken for a grant.
        assert source.retrieval_metadata["license_claim"] == "Citation metadata only"
        assert source.source_kind == SourceKind.LITERATURE

        audit = (
            (
                await session.execute(
                    select(AuditLog).where(
                        AuditLog.target_id == artifact_id,
                        AuditLog.action == "catalog.license.attested",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(audit) == 1
        # A published record must trace back to the exact sentence someone signed
        # and to the human who signed it — never to the importer.
        assert audit[0].meta["statement"] == ATTESTATION_META["statement"]
        assert audit[0].meta["policy_checksum"] == ATTESTATION_META["policy_checksum"]
        assert audit[0].actor_user_id == attester_id
        assert audit[0].actor_user_id != configured.importer_user_id


@requires_db
async def test_approved_license_carries_the_policy_spdx_id(env):
    configured, attester_id, factory = env
    async with factory() as session:
        artifact = await _stage_draft(session, configured)
        await _attest(session, configured, attester_id, artifact.id)
        await session.commit()
        version_id = artifact.current_version_id

    async with factory() as session:
        current = await catalog._get_current_license_assertion(
            session, artifact_version_id=version_id
        )
        assert current.reviewer_decision == LicenseDecision.APPROVED
        assert current.spdx_id == "CC-BY-4.0"
        assert current.reviewer_user_id == attester_id
        assert current.supersedes_assertion_id is not None  # append-only correction chain


@requires_db
async def test_unattested_record_stays_unpublishable(env):
    """The excluded-records guarantee: withholding the attestation is what keeps
    a record private, so publish must refuse it on its own."""
    configured, attester_id, factory = env
    async with factory() as session:
        artifact = await _stage_draft(session, configured)
        await session.commit()
        artifact_id = artifact.id

    async with factory() as session:
        with pytest.raises(catalog.PublicationNotReadyError):
            await catalog.publish_catalog_artifact(
                _reviewer_scope(configured, attester_id), session, artifact_id, authority=configured
            )


@requires_db
async def test_reviewer_grant_refuses_service_identities(env):
    """Granting the importer ADMIN would collapse importer/reviewer separation
    into one principal and make the bulk run self-approving."""
    configured, _attester_id, factory = env
    for service_id in (configured.importer_user_id, configured.public_reader_user_id):
        async with factory() as session:
            with pytest.raises(AuthzError):
                await catalog.grant_catalog_reviewer(
                    configured.importer_scope(),
                    session,
                    authority=configured,
                    user_id=service_id,
                )


@requires_db
async def test_reviewer_grant_requires_an_existing_human_account(env):
    configured, _attester_id, factory = env
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await catalog.grant_catalog_reviewer(
                configured.importer_scope(),
                session,
                authority=configured,
                user_id=uuid.uuid4(),
            )


@requires_db
async def test_reviewer_grant_is_idempotent_and_never_changes_a_role(env):
    configured, attester_id, factory = env
    async with factory() as session:
        again = await catalog.grant_catalog_reviewer(
            configured.importer_scope(), session, authority=configured, user_id=attester_id
        )
        assert again.role == Role.ADMIN
        await session.commit()

    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(Membership).where(
                        Membership.workspace_id == configured.workspace_id,
                        Membership.user_id == attester_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1


@requires_db
async def test_bulk_attestation_row_is_attributed_to_the_human(env):
    configured, attester_id, factory = env
    async with factory() as session:
        await catalog.record_bulk_attestation(
            _reviewer_scope(configured, attester_id),
            session,
            authority=configured,
            meta={**ATTESTATION_META, "excluded": {"skipme": "third-party"}},
        )
        await session.commit()

    async with factory() as session:
        row = (
            (
                await session.execute(
                    select(AuditLog)
                    .where(AuditLog.action == "catalog.license.bulk_attestation")
                    .order_by(AuditLog.id.desc())
                    .limit(1)
                )
            )
            .scalars()
            .one()
        )
        assert row.actor_user_id == attester_id
        assert row.meta["excluded"] == {"skipme": "third-party"}


@requires_db
async def test_importer_cannot_attest_on_its_own(env):
    """Passing the importer scope as the reviewer must fail rather than
    self-approve — the separation has to survive a caller mistake."""
    configured, _attester_id, factory = env
    async with factory() as session:
        artifact = await _stage_draft(session, configured)
        with pytest.raises(AuthzError):
            await catalog.attest_catalog_record(
                configured.importer_scope(),
                configured.importer_scope(),
                session,
                artifact.id,
                authority=configured,
                spdx_id="CC-BY-4.0",
                assertion_kind=LicenseAssertionKind.DECLARED,
                license_scope=LicenseScope.WHOLE,
                source_kind=SourceKind.LITERATURE,
                evidence_hash="e" * 64,
                repository=None,
                ref="deadbeef",
                path="some-record",
                retrieval_metadata={},
                attestation_meta=ATTESTATION_META,
            )
