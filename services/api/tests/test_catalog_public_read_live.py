"""Live-DB test for the public catalog read path (Neon cutover Slice C).

Proves Step 6 end-to-end against real Postgres: the review->public transition
fails closed on publication readiness, only an attributable human reviewer can
perform it, and the anonymous read surface returns exactly the accepted+public
set — with the rich presentation record and import provenance recovered from
the pinned source at read time.

Skipped without DATABASE_URL, like the other _live suites.
"""

import asyncio
import datetime as dt
import json
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    ExecutionState,
    Framework,
    ImportJobStatus,
    ImportItemState,
    ImportProvider,
    JobStatus,
    LicenseAssertionKind,
    LicenseDecision,
    LicenseScope,
    PublicationState,
    ReviewState,
    Role,
    SourceKind,
)
from sqlalchemy import select

from majorana_api.app import create_app
from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.ids import uuid7
from majorana_api.orm import Artifact, ImportItem, ImportJob, Job, Membership
from majorana_api.repos import AuthzError, catalog, system, workspaces
from majorana_api.settings import Settings

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="public catalog read needs DATABASE_URL"
)

# Same stable namespace as the other catalog _live suites: the authority's
# service identities are global singletons, so every module must resolve to the
# same one (see test_catalog_provenance_live.py).
_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")


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
            if existing is None:
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


def _record(slug: str) -> dict:
    """A catalog record shaped like the pinned manifest's embedded entry."""
    return {
        "slug": slug,
        "title": "Amplitude Amplification",
        "algorithmFamily": "Grover",
        "category": "algorithms",
        "classicalComparison": {"baseline": "O(N)", "quantumClaim": "O(sqrt N)"},
        "verificationMethods": ["unitary_equivalence"],
    }


async def _stage(session, configured, *, slug: str, source_text: str):
    """Stage an artifact whose version source is the canonical-JSON record,
    exactly as the bootstrap importer persists it."""
    scope = configured.importer_scope()
    artifact = await catalog.stage_artifact(
        scope,
        session,
        authority=configured,
        slug=slug,
        title=slug,
        family=Algorithm.OTHER,
        framework=Framework.QISKIT,
        artifact_kind=ArtifactKind.CIRCUIT,
        execution_state=ExecutionState.TEMPLATE_ONLY,
    )
    version = await catalog.stage_artifact_version(
        scope,
        session,
        artifact.id,
        authority=configured,
        raw_source=source_text.encode(),
        normalized_source=source_text,
        code=source_text,
        code_lang="json",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="unknown",
        source_language="json",
        metadata_schema_version="1",
    )
    return artifact, version


async def _make_ready(session, configured, version_id):
    """Attach the provenance + rights bindings publication requires."""
    scope = configured.importer_scope()
    await catalog.record_artifact_source(
        scope,
        session,
        version_id,
        authority=configured,
        source_kind=SourceKind.BENCHMARK_MANIFEST,
        content_hash="c" * 64,
        retrieved_at=dt.datetime.now(dt.timezone.utc),
    )
    await catalog.record_license_assertion(
        scope,
        session,
        version_id,
        authority=configured,
        assertion_kind=LicenseAssertionKind.DECLARED,
        license_scope=LicenseScope.WHOLE,
        spdx_id="MIT",
    )


async def _publish_new_entry(factory, configured, reviewer_id, *, slug: str) -> uuid.UUID:
    """Full lifecycle for one record: stage -> provenance/rights -> submit ->
    accept -> publish. Returns the artifact id."""
    reviewer = _reviewer_scope(configured, reviewer_id)
    source_text = json.dumps(_record(slug))
    async with factory() as session:
        artifact, version = await _stage(session, configured, slug=slug, source_text=source_text)
        await _make_ready(session, configured, version.id)
        await catalog.submit_for_review(
            configured.importer_scope(), session, artifact.id, authority=configured
        )
        # The importer's declared license lands as 'pending'; only a reviewer
        # decision approves it, and publication stays blocked until it does.
        await catalog.decide_license_assertion(
            reviewer,
            session,
            version.id,
            authority=configured,
            decision=LicenseDecision.APPROVED,
        )
        await catalog.decide_review(
            reviewer, session, artifact.id, authority=configured, decision=ReviewState.ACCEPTED
        )
        await session.commit()
        artifact_id = artifact.id

    async with factory() as session:
        published = await catalog.publish_catalog_artifact(
            reviewer, session, artifact_id, authority=configured
        )
        await session.commit()
        assert published.publication_state == PublicationState.PUBLIC
    return artifact_id


@requires_db
async def test_review_to_public_transition_publishes_a_ready_record(env):
    configured, reviewer_id, factory = env
    slug = f"published-{uuid.uuid4()}"
    artifact_id = await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with factory() as session:
        reloaded = (
            await session.execute(select(Artifact).where(Artifact.id == artifact_id))
        ).scalar_one()
    assert reloaded.publication_state == PublicationState.PUBLIC
    assert reloaded.review_state == ReviewState.ACCEPTED


@requires_db
async def test_publication_fails_closed_without_source_and_license(env):
    """The headline safety property: a record that was never reviewed or
    licensed cannot be published, and the attempt mutates nothing."""
    configured, reviewer_id, factory = env
    reviewer = _reviewer_scope(configured, reviewer_id)
    slug = f"notready-{uuid.uuid4()}"
    async with factory() as session:
        artifact, _version = await _stage(
            session, configured, slug=slug, source_text=json.dumps(_record(slug))
        )
        await session.commit()
        artifact_id = artifact.id

    async with factory() as session:
        with pytest.raises(catalog.PublicationNotReadyError) as excinfo:
            await catalog.publish_catalog_artifact(
                reviewer, session, artifact_id, authority=configured
            )
    blockers = " ".join(excinfo.value.blockers)
    assert "review_state" in blockers
    assert "artifact_sources" in blockers
    assert "license" in blockers

    async with factory() as session:
        reloaded = (
            await session.execute(select(Artifact).where(Artifact.id == artifact_id))
        ).scalar_one()
    assert reloaded.publication_state == PublicationState.PRIVATE


@requires_db
async def test_importer_and_public_reader_cannot_publish(env):
    """Publication is an attributable human action: neither the importer
    service principal nor the anonymous reader identity may perform it."""
    configured, reviewer_id, factory = env
    slug = f"sep-{uuid.uuid4()}"
    source_text = json.dumps(_record(slug))
    async with factory() as session:
        artifact, version = await _stage(session, configured, slug=slug, source_text=source_text)
        await _make_ready(session, configured, version.id)
        await catalog.submit_for_review(
            configured.importer_scope(), session, artifact.id, authority=configured
        )
        await catalog.decide_review(
            _reviewer_scope(configured, reviewer_id),
            session,
            artifact.id,
            authority=configured,
            decision=ReviewState.ACCEPTED,
        )
        await session.commit()
        artifact_id = artifact.id

    for offending in (configured.importer_scope(), configured.public_scope()):
        async with factory() as session:
            with pytest.raises(AuthzError):
                await catalog.publish_catalog_artifact(
                    offending, session, artifact_id, authority=configured
                )

    async with factory() as session:
        reloaded = (
            await session.execute(select(Artifact).where(Artifact.id == artifact_id))
        ).scalar_one()
    assert reloaded.publication_state == PublicationState.PRIVATE


@requires_db
async def test_public_listing_returns_only_published_records(env):
    configured, reviewer_id, factory = env
    published_slug = f"listed-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=published_slug)

    # an accepted-but-unpublished record must stay invisible
    hidden_slug = f"hidden-{uuid.uuid4()}"
    async with factory() as session:
        artifact, version = await _stage(
            session, configured, slug=hidden_slug, source_text=json.dumps(_record(hidden_slug))
        )
        await _make_ready(session, configured, version.id)
        await catalog.submit_for_review(
            configured.importer_scope(), session, artifact.id, authority=configured
        )
        await catalog.decide_review(
            _reviewer_scope(configured, reviewer_id),
            session,
            artifact.id,
            authority=configured,
            decision=ReviewState.ACCEPTED,
        )
        await session.commit()

    async with factory() as session:
        entries = await catalog.list_public_catalog_entries(
            configured.public_scope(), session, authority=configured
        )
    slugs = {entry.slug for entry in entries}
    assert published_slug in slugs
    assert hidden_slug not in slugs


@requires_db
async def test_public_entry_exposes_the_rich_record_and_honest_state(env):
    configured, reviewer_id, factory = env
    slug = f"rich-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with factory() as session:
        entry = await catalog.get_public_catalog_entry(
            configured.public_scope(), session, slug, authority=configured
        )
    # rich presentation fields recovered from the pinned source blob
    assert entry.record["algorithmFamily"] == "Grover"
    assert entry.record["category"] == "algorithms"
    assert entry.record["classicalComparison"]["quantumClaim"] == "O(sqrt N)"
    # the honest staged column, never upgraded by the record's claims
    assert entry.execution_state == ExecutionState.TEMPLATE_ONLY
    assert entry.provenance.source_blob_sha256


@requires_db
async def test_unpublished_slug_is_not_found_rather_than_forbidden(env):
    configured, reviewer_id, factory = env
    slug = f"missing-{uuid.uuid4()}"
    async with factory() as session:
        await _stage(session, configured, slug=slug, source_text=json.dumps(_record(slug)))
        await session.commit()

    async with factory() as session:
        with pytest.raises(catalog.NotFoundError):
            await catalog.get_public_catalog_entry(
                configured.public_scope(), session, slug, authority=configured
            )


def _client(configured, factory):
    """An ASGI client over the real app; the public catalog routes take no
    auth, so nothing is overridden — only the configured authority varies."""
    settings = Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.test",
        workos_jwks_url="https://issuer.test/jwks",
        web_origin="http://localhost:3000",
        catalog_authority=configured,
    )
    app = create_app(settings)
    app.state.session_factory = factory
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@requires_db
async def test_route_is_absent_until_the_feature_flag_is_enabled(env):
    """The whole surface is inert until an operator enables the system catalog:
    with SYSTEM_CATALOG_ENABLED off, the routes 404 rather than serving data."""
    configured, reviewer_id, factory = env
    slug = f"flagged-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    disabled = CatalogAuthority(
        enabled=False,
        workspace_id=configured.workspace_id,
        importer_user_id=configured.importer_user_id,
        public_reader_user_id=configured.public_reader_user_id,
    )
    async with _client(disabled, factory) as client:
        assert (await client.get("/v1/catalog/entries")).status_code == 404
        assert (await client.get(f"/v1/catalog/entries/{slug}")).status_code == 404


@requires_db
async def test_route_serves_published_entries_when_enabled(env):
    configured, reviewer_id, factory = env
    slug = f"served-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with _client(configured, factory) as client:
        listed = await client.get("/v1/catalog/entries")
        assert listed.status_code == 200
        assert slug in {entry["slug"] for entry in listed.json()}

        detail = await client.get(f"/v1/catalog/entries/{slug}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["record"]["algorithmFamily"] == "Grover"
        assert body["execution_state"] == ExecutionState.TEMPLATE_ONLY
        assert body["provenance"]["source_blob_sha256"]

        # an unknown slug is a 404, not a leak of internal state
        assert (await client.get("/v1/catalog/entries/no-such-entry")).status_code == 404


@requires_db
async def test_import_provenance_surfaces_the_manifest_identity(env):
    """A bootstrap-imported record is served under its manifest identity, with
    the pinned provider/source-commit provenance recovered through the import
    linkage — not under the importer's synthetic internal slug."""
    configured, reviewer_id, factory = env
    internal_slug = f"import-internal-{uuid.uuid4()}"
    manifest_identity = f"amplitude-amplification-{uuid.uuid4()}"
    artifact_id = await _publish_new_entry(factory, configured, reviewer_id, slug=internal_slug)

    async with factory() as session:
        # status='done': this stands in for an already-completed import, and a
        # claimable queued job here would be picked up by the shared job-queue
        # suites running against the same database.
        queue_job = Job(
            id=uuid7(),
            kind="catalog_import",
            payload={"idempotency_key": f"k-{uuid.uuid4()}"},
            status=JobStatus.DONE,
        )
        session.add(queue_job)
        await session.flush()
        import_job = ImportJob(
            id=uuid7(),
            job_id=queue_job.id,
            provider=ImportProvider.CATALOG_BOOTSTRAP,
            upstream_ref="deadbeefcafe",
            idempotency_key=f"catalog-bootstrap-{uuid.uuid4()}",
            status=ImportJobStatus.COMPLETED,
            item_count=1,
        )
        session.add(import_job)
        await session.flush()
        session.add(
            ImportItem(
                id=uuid7(),
                import_job_id=import_job.id,
                upstream_identity=manifest_identity,
                state=ImportItemState.STAGED,
                resulting_artifact_id=artifact_id,
            )
        )
        await session.commit()

    async with factory() as session:
        entry = await catalog.get_public_catalog_entry(
            configured.public_scope(), session, manifest_identity, authority=configured
        )
    assert entry.slug == manifest_identity
    assert entry.provenance.import_provider == ImportProvider.CATALOG_BOOTSTRAP
    assert entry.provenance.upstream_ref == "deadbeefcafe"
