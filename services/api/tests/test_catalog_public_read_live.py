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
from majorana_api.catalog_read_model import LIST_VIEW_RECORD_FIELDS
from majorana_api.routes.catalog import CATALOG_ENTRIES_MAX_LIMIT, CATALOG_TOTAL_HEADER
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


async def _publish_new_entry(
    factory, configured, reviewer_id, *, slug: str, record: dict | None = None
) -> uuid.UUID:
    """Full lifecycle for one record: stage -> provenance/rights -> submit ->
    accept -> publish. Returns the artifact id.

    `record` overrides the default presentation blob, so a test that needs a
    published entry carrying a specific `portableCircuit` does not have to
    reimplement the lifecycle to get one."""
    reviewer = _reviewer_scope(configured, reviewer_id)
    source_text = json.dumps(record if record is not None else _record(slug))
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
async def test_listing_pages_and_reports_its_own_total(env):
    """limit/offset are honoured, and the total header describes the whole set.

    The header is what lets a client tell a complete corpus from a truncated
    one; without it, a page that stops early is indistinguishable from a
    catalog that genuinely holds that many records.
    """
    configured, reviewer_id, factory = env
    slugs = sorted(f"paged-{uuid.uuid4()}" for _ in range(3))
    for slug in slugs:
        await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with _client(configured, factory) as client:
        everything = await client.get("/v1/catalog/entries")
        assert everything.status_code == 200
        total = int(everything.headers["X-Catalog-Total"])
        assert total == len(everything.json())

        first = await client.get("/v1/catalog/entries?limit=2&offset=0")
        second = await client.get("/v1/catalog/entries?limit=2&offset=2")
        assert len(first.json()) == 2
        # The total describes the corpus, not the page.
        assert int(first.headers["X-Catalog-Total"]) == total

        # Paging covers the corpus exactly once, in the listing's own order.
        walked: list[str] = []
        for offset in range(0, total, 2):
            page = await client.get(f"/v1/catalog/entries?limit=2&offset={offset}")
            walked.extend(entry["slug"] for entry in page.json())
        assert walked == [entry["slug"] for entry in everything.json()]
        assert len(walked) == len(set(walked)) == total
        assert set(slugs) <= set(walked)
        assert second.json()[0]["slug"] == walked[2]


@requires_db
async def test_listing_clamps_an_out_of_range_limit_instead_of_refusing(env):
    """A public browse endpoint must not turn a silly query into an error page.

    Also pins the ceiling: an anonymous caller cannot ask for an unbounded read
    of the table, which is the whole point of the bound.
    """
    configured, reviewer_id, factory = env
    await _publish_new_entry(factory, configured, reviewer_id, slug=f"clamped-{uuid.uuid4()}")

    async with _client(configured, factory) as client:
        for query in ("limit=0", "limit=-5", "limit=100000", "offset=-1"):
            response = await client.get(f"/v1/catalog/entries?{query}")
            assert response.status_code == 200, query

        assert len((await client.get("/v1/catalog/entries?limit=0")).json()) == 1
        huge = await client.get("/v1/catalog/entries?limit=100000")
        assert len(huge.json()) <= CATALOG_ENTRIES_MAX_LIMIT


@requires_db
async def test_the_view_projection_still_applies_to_a_page(env):
    """`view=list` and pagination are independent; combining them must not drop
    the projection and start serving full records under a list request."""
    configured, reviewer_id, factory = env
    slug = f"viewed-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with _client(configured, factory) as client:
        # The listing is oldest-first, so page 0 is whatever was published first
        # — in a suite run, another file's entry, whose source may legitimately
        # not be a manifest record (`record=None`, see parse_source_record).
        # Paginate to THIS entry: the projection is what is under test, not
        # which entry happens to sort first.
        total = int((await client.get("/v1/catalog/entries?limit=0")).headers[CATALOG_TOTAL_HEADER])
        page = await client.get(f"/v1/catalog/entries?view=list&limit=1&offset={total - 1}")
        assert page.status_code == 200
        [entry] = page.json()
        assert entry["slug"] == slug
        assert set(entry["record"]) <= set(LIST_VIEW_RECORD_FIELDS)


async def _attach_import_item(
    factory, *, artifact_id: uuid.UUID, manifest_identity: str, upstream_ref: str
) -> None:
    """Record one import batch that produced `artifact_id`.

    A reconciling importer writes a fresh ImportItem per batch against the
    artifact it reused, so calling this twice is what a second import of the
    same corpus actually leaves behind. The artifact carries the identity itself
    (migration 0046) — stamping it here is what the importer's stage_artifact
    does — while the ImportItem rows accumulate one per batch, which is the
    condition that used to multiply public rows.
    """
    async with factory() as session:
        artifact = (
            await session.execute(select(Artifact).where(Artifact.id == artifact_id))
        ).scalar_one()
        artifact.upstream_identity = manifest_identity
        await session.commit()

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
            upstream_ref=upstream_ref,
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


@requires_db
async def test_import_provenance_surfaces_the_manifest_identity(env):
    """A bootstrap-imported record is served under its manifest identity, with
    the pinned provider/source-commit provenance recovered through the import
    linkage — not under the importer's synthetic internal slug."""
    configured, reviewer_id, factory = env
    internal_slug = f"import-internal-{uuid.uuid4()}"
    manifest_identity = f"amplitude-amplification-{uuid.uuid4()}"
    artifact_id = await _publish_new_entry(factory, configured, reviewer_id, slug=internal_slug)
    await _attach_import_item(
        factory,
        artifact_id=artifact_id,
        manifest_identity=manifest_identity,
        upstream_ref="deadbeefcafe",
    )

    async with factory() as session:
        entry = await catalog.get_public_catalog_entry(
            configured.public_scope(), session, manifest_identity, authority=configured
        )
    assert entry.slug == manifest_identity
    assert entry.provenance.import_provider == ImportProvider.CATALOG_BOOTSTRAP
    assert entry.provenance.upstream_ref == "deadbeefcafe"


@requires_db
@pytest.mark.parametrize("imported_first", [True, False])
async def test_an_imported_identity_wins_over_an_artifact_merely_named_like_it(env, imported_first):
    """`coalesce(upstream_identity, slug)` is not unique, so the detail route can
    match two rows: the record that carries the identity, and an unimported
    artifact whose slug happens to equal it. `.first()` alone would pick one
    arbitrarily — and possibly a different one per request.

    The imported record must win. It is the one the listing shows under that
    slug, and a detail page that disagrees with the listing it was reached from
    is the confusing kind of wrong.

    **Both creation orders are exercised deliberately.** With one order this test
    passes against an unordered query purely by luck of the scan — which is what
    a test asserting "the right row came back" is worth when nothing made it come
    back. Creating the rival first in one case and second in the other means an
    unordered query has to be wrong in at least one of them.
    """
    configured, reviewer_id, factory = env
    contested = f"contested-{uuid.uuid4()}"

    async def _make_rival():
        # An artifact whose *slug* is the contested name, carrying no identity.
        await _publish_new_entry(factory, configured, reviewer_id, slug=contested)

    async def _make_owner():
        artifact_id = await _publish_new_entry(
            factory, configured, reviewer_id, slug=f"internal-{uuid.uuid4()}"
        )
        await _attach_import_item(
            factory,
            artifact_id=artifact_id,
            manifest_identity=contested,
            upstream_ref="commit-owning-the-identity",
        )

    for make in (_make_owner, _make_rival) if imported_first else (_make_rival, _make_owner):
        await make()

    async with factory() as session:
        entry = await catalog.get_public_catalog_entry(
            configured.public_scope(), session, contested, authority=configured
        )
    assert entry.slug == contested
    assert entry.provenance.upstream_ref == "commit-owning-the-identity"


@requires_db
async def test_a_second_import_of_the_same_record_does_not_multiply_public_rows(env):
    """Re-importing a record must not make the listing disagree with its total.

    This is the failure that would have shipped green. The listing reached
    ImportItem to recover the manifest identity; the count query never did. They
    agreed only because every artifact happened to have exactly one import item.
    A reconciling importer reuses the artifact and writes a **new** ImportItem
    per batch, so the listing's join goes one-to-many and renders the same record
    once per import while `X-Catalog-Total` still counts artifacts.

    The web layer compares `collected.length !== total` and, on a mismatch,
    refuses the corpus and falls back to the *static* entries — which are the
    fixed ones. So `/repository` would look correct because of the fallback
    rather than because of the fix, and nothing would report a problem.
    """
    configured, reviewer_id, factory = env
    manifest_identity = f"reimported-{uuid.uuid4()}"
    artifact_id = await _publish_new_entry(
        factory, configured, reviewer_id, slug=f"reimport-internal-{uuid.uuid4()}"
    )

    for upstream_ref in ("commit-first-import", "commit-second-import"):
        await _attach_import_item(
            factory,
            artifact_id=artifact_id,
            manifest_identity=manifest_identity,
            upstream_ref=upstream_ref,
        )

    async with factory() as session:
        rows = await catalog.list_public_catalog_entries(
            configured.public_scope(), session, authority=configured
        )
        total = await catalog.count_public_catalog_entries(
            configured.public_scope(), session, authority=configured
        )

    assert len(rows) == total
    # The record appears once, under its manifest identity, not once per batch.
    assert [row.slug for row in rows].count(manifest_identity) == 1

    async with _client(configured, factory) as client:
        listing = await client.get("/v1/catalog/entries")
        assert listing.status_code == 200
        body = listing.json()
        assert len(body) == int(listing.headers[CATALOG_TOTAL_HEADER])
        assert [entry["slug"] for entry in body].count(manifest_identity) == 1

    # And the detail route still resolves that identity to exactly one record
    # rather than failing on a multi-row result.
    async with factory() as session:
        entry = await catalog.get_public_catalog_entry(
            configured.public_scope(), session, manifest_identity, authority=configured
        )
    assert entry.slug == manifest_identity


# --- E4: the estimate routes -------------------------------------------------


def _record_with_circuit(slug: str, steps: list[dict]) -> dict:
    record = _record(slug)
    record["portableCircuit"] = {"qubitCount": 2, "steps": steps}
    return record


@requires_db
async def test_the_estimate_route_costs_a_published_circuit_under_a_named_set(env):
    """The route's contract in one pass: a Clifford circuit is EXACT and states
    no runtime, a rotation circuit is ESTIMATED and names the precision that
    made it one, and both carry the assumption set they were costed under."""
    configured, reviewer_id, factory = env
    clifford_slug = f"clifford-{uuid.uuid4()}"
    rotation_slug = f"rotation-{uuid.uuid4()}"
    await _publish_new_entry(
        factory,
        configured,
        reviewer_id,
        slug=clifford_slug,
        record=_record_with_circuit(
            clifford_slug, [{"gate": "h", "qubits": [0]}, {"gate": "cx", "qubits": [0, 1]}]
        ),
    )
    await _publish_new_entry(
        factory,
        configured,
        reviewer_id,
        slug=rotation_slug,
        record=_record_with_circuit(rotation_slug, [{"gate": "ry", "qubits": [0], "param": "0.3"}]),
    )

    async with _client(configured, factory) as client:
        exact = await client.get(f"/v1/catalog/entries/{clifford_slug}/estimate")
        assert exact.status_code == 200
        body = exact.json()
        assert body["basis"] == "exact"
        assert body["logical"]["magic_states"] == 0
        # Both runtime terms are magic-state terms, so this circuit has no
        # stated wall-clock. 0.0 would read as "runs instantly".
        assert body["runtime"]["seconds"] is None
        assert body["footprint"]["total_physical_qubits"] > 0

        estimated = await client.get(f"/v1/catalog/entries/{rotation_slug}/estimate")
        assert estimated.status_code == 200
        body = estimated.json()
        assert body["basis"] == "estimated"
        assert body["assumptions"]["identity"] == "gidney-2025@v2+eps=1e-06"
        assert body["assumptions"]["t_per_rotation"] == 60
        assert body["logical"]["t_from_synthesis"] == 60


@requires_db
async def test_an_entry_without_a_circuit_is_not_reported_as_a_refusal(env):
    """Nothing was attempted and nothing failed. A refusal here would invent a
    doubt about the entry that the data does not support."""
    configured, reviewer_id, factory = env
    slug = f"prose-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with _client(configured, factory) as client:
        response = await client.get(f"/v1/catalog/entries/{slug}/estimate")
        assert response.status_code == 200
        body = response.json()
        assert body["basis"] == "no_circuit"
        assert body["reason"]
        assert body["footprint"] is None


@requires_db
async def test_the_estimate_route_404s_exactly_where_the_detail_route_does(env):
    """A slug that resolves on one and not the other is a 404 nobody can
    explain, and the flag has to take both down together or the feature is not
    actually inert."""
    configured, reviewer_id, factory = env
    slug = f"paired-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    disabled = CatalogAuthority(
        enabled=False,
        workspace_id=configured.workspace_id,
        importer_user_id=configured.importer_user_id,
        public_reader_user_id=configured.public_reader_user_id,
    )
    # Asserting 404 on the estimate routes alone would pass even if the detail
    # route drew its boundary somewhere else entirely — which is the failure the
    # test is named for. Compare the two, rather than checking one against a
    # constant that happens to match.
    async with _client(configured, factory) as client:
        detail = await client.get("/v1/catalog/entries/nope")
        estimate = await client.get("/v1/catalog/entries/nope/estimate")
        assert estimate.status_code == detail.status_code == 404

    async with _client(disabled, factory) as client:
        detail = await client.get(f"/v1/catalog/entries/{slug}")
        estimate = await client.get(f"/v1/catalog/entries/{slug}/estimate")
        listing = await client.get("/v1/catalog/entries")
        estimates = await client.get("/v1/catalog/estimates")
        assert estimate.status_code == detail.status_code == 404
        assert estimates.status_code == listing.status_code == 404


@requires_db
async def test_an_unknown_assumption_set_is_refused_rather_than_silently_defaulted(env):
    """Answering a request for trapped-ion numbers with superconducting ones is
    a wrong answer that looks like a right one."""
    configured, reviewer_id, factory = env
    slug = f"unknown-set-{uuid.uuid4()}"
    await _publish_new_entry(factory, configured, reviewer_id, slug=slug)

    async with _client(configured, factory) as client:
        response = await client.get(
            f"/v1/catalog/entries/{slug}/estimate", params={"assumptions": "trapped-ion@v1"}
        )
        assert response.status_code == 422


@requires_db
async def test_the_estimate_listing_states_its_assumption_set_once_for_every_row(env):
    """The shape is the ordering rule: one set for the whole payload means a
    client holding it has nothing inside it to rank across."""
    configured, reviewer_id, factory = env
    slug = f"listed-{uuid.uuid4()}"
    await _publish_new_entry(
        factory,
        configured,
        reviewer_id,
        slug=slug,
        record=_record_with_circuit(slug, [{"gate": "t", "qubits": [0]}]),
    )

    async with _client(configured, factory) as client:
        response = await client.get("/v1/catalog/estimates")
        assert response.status_code == 200
        body = response.json()
        assert body["assumptions"]["identity"] == "gidney-2025@v2+eps=1e-06"
        row = next(item for item in body["estimates"] if item["slug"] == slug)
        assert row["basis"] == "exact"
        assert row["magic_states"] == 1

        # Every row on the page came from the same set, or ranking them is
        # ordering by assumption rather than by circuit.
        assert {item["slug"] for item in body["estimates"]}


@requires_db
async def test_a_tighter_precision_moves_the_whole_listing_to_a_new_identity(env):
    """The knob and the label move together. A payload whose numbers changed
    while its identity did not is exactly how two budgets get mixed."""
    configured, reviewer_id, factory = env
    slug = f"precision-{uuid.uuid4()}"
    await _publish_new_entry(
        factory,
        configured,
        reviewer_id,
        slug=slug,
        record=_record_with_circuit(slug, [{"gate": "rz", "qubits": [0], "param": "0.3"}]),
    )

    async with _client(configured, factory) as client:
        loose = (await client.get("/v1/catalog/estimates", params={"epsilon": 1e-3})).json()
        tight = (await client.get("/v1/catalog/estimates", params={"epsilon": 1e-12})).json()

    assert loose["assumptions"]["identity"] != tight["assumptions"]["identity"]
    loose_row = next(item for item in loose["estimates"] if item["slug"] == slug)
    tight_row = next(item for item in tight["estimates"] if item["slug"] == slug)
    assert tight_row["total_physical_qubits"] > loose_row["total_physical_qubits"]
