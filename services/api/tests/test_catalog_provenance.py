"""DB-free unit tests for Step 4 provenance/rights/review (repos/catalog.py).

Live global behavior (real UNIQUE/FK enforcement, transaction rollback) is
covered by test_catalog_provenance_live.py; this file proves the authz
gates, the automatic quarantine rule, the controlled review transitions,
and the stale-evidence reset added to stage_artifact_version.
"""

import datetime as dt
import uuid

import pytest
from repo_test_helpers import Row, SequencedSession

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.orm import Artifact, ArtifactVersion, LicenseAssertion, Workspace
from majorana_api.repos import AuthzError, catalog
from majorana_contracts import IllegalReviewTransition
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    CitationRelation,
    ExecutionState,
    Framework,
    LicenseAssertionKind,
    LicenseDecision,
    LicenseScope,
    PublicationState,
    ReviewState,
    Visibility,
)


def authority() -> CatalogAuthority:
    return CatalogAuthority(
        enabled=True,
        workspace_id=uuid.uuid4(),
        importer_user_id=uuid.uuid4(),
        public_reader_user_id=uuid.uuid4(),
    )


def _importer_workspace(configured: CatalogAuthority) -> Workspace:
    return Workspace(
        id=configured.workspace_id,
        kind="system",
        name="catalog",
        owner_user_id=configured.importer_user_id,
    )


def _reviewer_scope(configured: CatalogAuthority, *, reviewer_user_id=None):
    from majorana_contracts import Scope
    from majorana_contracts.enums import Role

    return Scope(
        user_id=reviewer_user_id or uuid.uuid4(),
        workspace_id=configured.workspace_id,
        role=Role.ADMIN,
    )


def _artifact(configured, *, review_state=ReviewState.PENDING_REVIEW, current_version_id=None):
    return Artifact(
        id=uuid.uuid4(),
        workspace_id=configured.workspace_id,
        slug="a",
        title="A",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        visibility=Visibility.PRIVATE,
        artifact_kind=ArtifactKind.CIRCUIT,
        execution_state=ExecutionState.EXECUTABLE,
        review_state=review_state,
        publication_state=PublicationState.PRIVATE,
        current_version_id=current_version_id,
    )


def _version(artifact_id, version_id=None):
    return ArtifactVersion(
        id=version_id or uuid.uuid4(),
        artifact_id=artifact_id,
        seq=1,
        code="x",
        code_lang="python",
        fingerprint="f" * 64,
        export_status="unsupported",
    )


# ---------------------------------------------------------------------------
# stage_artifact_version stale-evidence reset
# ---------------------------------------------------------------------------


async def test_new_version_resets_stale_accepted_review_state():
    configured = authority()
    scope = configured.importer_scope()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.ACCEPTED)
    session = SequencedSession([Row(workspace), Row(artifact), Row(1)])
    version = await catalog.stage_artifact_version(
        scope,
        session,
        artifact.id,
        authority=configured,
        raw_source=b"x",
        normalized_source="x",
        code="x",
        code_lang="python",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="1.0",
        source_language="python",
        metadata_schema_version="1",
    )
    assert artifact.review_state == ReviewState.DRAFT
    assert artifact.current_version_id == version.id


async def test_new_version_leaves_non_terminal_review_state_alone():
    configured = authority()
    scope = configured.importer_scope()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.QUARANTINED)
    session = SequencedSession([Row(workspace), Row(artifact), Row(1)])
    await catalog.stage_artifact_version(
        scope,
        session,
        artifact.id,
        authority=configured,
        raw_source=b"x",
        normalized_source="x",
        code="x",
        code_lang="python",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="1.0",
        source_language="python",
        metadata_schema_version="1",
    )
    assert artifact.review_state == ReviewState.QUARANTINED


# ---------------------------------------------------------------------------
# record_license_assertion: automatic fail-closed quarantine
# ---------------------------------------------------------------------------


async def test_unknown_license_quarantines_current_version_immediately():
    configured = authority()
    scope = configured.importer_scope()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.DRAFT)
    version = _version(artifact.id)
    artifact.current_version_id = version.id
    session = SequencedSession([Row(workspace), Row((artifact, version))])
    assertion = await catalog.record_license_assertion(
        scope,
        session,
        version.id,
        authority=configured,
        assertion_kind=LicenseAssertionKind.DECLARED,
        license_scope=LicenseScope.WHOLE,
        spdx_id=None,
    )
    assert artifact.review_state == ReviewState.QUARANTINED
    assert assertion.reviewer_decision == LicenseDecision.QUARANTINED


async def test_conflicting_license_quarantines_even_with_spdx_id():
    configured = authority()
    scope = configured.importer_scope()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.DRAFT)
    version = _version(artifact.id)
    artifact.current_version_id = version.id
    session = SequencedSession([Row(workspace), Row((artifact, version))])
    await catalog.record_license_assertion(
        scope,
        session,
        version.id,
        authority=configured,
        assertion_kind=LicenseAssertionKind.DETECTED,
        license_scope=LicenseScope.WHOLE,
        spdx_id="MIT",
        conflicting=True,
    )
    assert artifact.review_state == ReviewState.QUARANTINED


async def test_clear_license_does_not_quarantine():
    configured = authority()
    scope = configured.importer_scope()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.DRAFT)
    version = _version(artifact.id)
    artifact.current_version_id = version.id
    session = SequencedSession([Row(workspace), Row((artifact, version))])
    assertion = await catalog.record_license_assertion(
        scope,
        session,
        version.id,
        authority=configured,
        assertion_kind=LicenseAssertionKind.DECLARED,
        license_scope=LicenseScope.WHOLE,
        spdx_id="MIT",
    )
    assert artifact.review_state == ReviewState.DRAFT
    assert assertion.reviewer_decision == LicenseDecision.PENDING


async def test_unknown_license_on_non_current_version_does_not_quarantine():
    configured = authority()
    scope = configured.importer_scope()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.DRAFT)
    old_version = _version(artifact.id)
    artifact.current_version_id = uuid.uuid4()  # a different, current version
    session = SequencedSession([Row(workspace), Row((artifact, old_version))])
    await catalog.record_license_assertion(
        scope,
        session,
        old_version.id,
        authority=configured,
        assertion_kind=LicenseAssertionKind.DECLARED,
        license_scope=LicenseScope.WHOLE,
        spdx_id=None,
    )
    assert artifact.review_state == ReviewState.DRAFT


# ---------------------------------------------------------------------------
# decide_license_assertion: reviewer-only append
# ---------------------------------------------------------------------------


async def test_decide_license_assertion_rejects_importer_scope():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.decide_license_assertion(
            configured.importer_scope(),
            session,
            uuid.uuid4(),
            authority=configured,
            decision=LicenseDecision.APPROVED,
        )
    assert session.statements == []


async def test_decide_license_assertion_appends_superseding_row():
    configured = authority()
    reviewer_scope = _reviewer_scope(configured)
    workspace = Workspace(
        id=configured.workspace_id, kind="system", name="catalog", owner_user_id=uuid.uuid4()
    )
    artifact = _artifact(configured)
    version = _version(artifact.id)
    previous = LicenseAssertion(
        id=uuid.uuid4(),
        artifact_version_id=version.id,
        spdx_id=None,
        assertion_kind=LicenseAssertionKind.DECLARED,
        license_scope=LicenseScope.WHOLE,
        reviewer_decision=LicenseDecision.QUARANTINED,
    )
    session = SequencedSession([Row(workspace), Row((artifact, version)), Row(previous)])
    new_assertion = await catalog.decide_license_assertion(
        reviewer_scope,
        session,
        version.id,
        authority=configured,
        decision=LicenseDecision.APPROVED,
        spdx_id="MIT",
    )
    assert new_assertion.supersedes_assertion_id == previous.id
    assert new_assertion.spdx_id == "MIT"
    assert new_assertion.reviewer_decision == LicenseDecision.APPROVED
    assert new_assertion.reviewer_user_id == reviewer_scope.user_id


async def test_decide_license_assertion_rejects_pending_decision():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(ValueError, match="pending"):
        await catalog.decide_license_assertion(
            _reviewer_scope(configured),
            session,
            uuid.uuid4(),
            authority=configured,
            decision=LicenseDecision.PENDING,
        )


# ---------------------------------------------------------------------------
# submit_for_review / decide_review: controlled transitions + separation
# ---------------------------------------------------------------------------


async def test_submit_for_review_requires_importer_scope():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.submit_for_review(
            _reviewer_scope(configured), session, uuid.uuid4(), authority=configured
        )
    assert session.statements == []


async def test_submit_for_review_only_from_draft():
    configured = authority()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.PENDING_REVIEW)
    session = SequencedSession([Row(workspace), Row(artifact)])
    with pytest.raises(IllegalReviewTransition):
        await catalog.submit_for_review(
            configured.importer_scope(), session, artifact.id, authority=configured
        )


async def test_submit_for_review_moves_draft_to_pending():
    configured = authority()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.DRAFT)
    session = SequencedSession([Row(workspace), Row(artifact)])
    result = await catalog.submit_for_review(
        configured.importer_scope(), session, artifact.id, authority=configured
    )
    assert result.review_state == ReviewState.PENDING_REVIEW


async def test_decide_review_requires_reviewer_scope_not_importer():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.decide_review(
            configured.importer_scope(),
            session,
            uuid.uuid4(),
            authority=configured,
            decision=ReviewState.ACCEPTED,
        )
    assert session.statements == []


async def test_decide_review_rejects_illegal_source_state():
    configured = authority()
    workspace = Workspace(
        id=configured.workspace_id, kind="system", name="catalog", owner_user_id=uuid.uuid4()
    )
    artifact = _artifact(configured, review_state=ReviewState.DRAFT)
    session = SequencedSession([Row(workspace), Row(artifact)])
    with pytest.raises(IllegalReviewTransition):
        await catalog.decide_review(
            _reviewer_scope(configured),
            session,
            artifact.id,
            authority=configured,
            decision=ReviewState.ACCEPTED,
        )


async def test_decide_review_accepts_from_pending_review():
    configured = authority()
    workspace = Workspace(
        id=configured.workspace_id, kind="system", name="catalog", owner_user_id=uuid.uuid4()
    )
    artifact = _artifact(configured, review_state=ReviewState.PENDING_REVIEW)
    session = SequencedSession([Row(workspace), Row(artifact)])
    result = await catalog.decide_review(
        _reviewer_scope(configured),
        session,
        artifact.id,
        authority=configured,
        decision=ReviewState.ACCEPTED,
    )
    assert result.review_state == ReviewState.ACCEPTED


# ---------------------------------------------------------------------------
# record_citation / tag_artifact
# ---------------------------------------------------------------------------


async def test_record_citation_requires_at_least_one_identifier():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(ValueError, match="at least one"):
        await catalog.record_citation(
            configured.importer_scope(),
            session,
            uuid.uuid4(),
            authority=configured,
            relation=CitationRelation.DESCRIBES,
        )
    assert session.statements == []


async def test_record_citation_requires_importer_scope():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.record_citation(
            _reviewer_scope(configured),
            session,
            uuid.uuid4(),
            authority=configured,
            relation=CitationRelation.DESCRIBES,
            doi="10.1234/x",
        )
    assert session.statements == []


async def test_tag_artifact_requires_importer_scope():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.tag_artifact(
            _reviewer_scope(configured),
            session,
            uuid.uuid4(),
            authority=configured,
            tag="benchmark",
        )
    assert session.statements == []


# ---------------------------------------------------------------------------
# record_artifact_source
# ---------------------------------------------------------------------------


async def test_record_artifact_source_requires_importer_scope():
    configured = authority()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.record_artifact_source(
            _reviewer_scope(configured),
            session,
            uuid.uuid4(),
            authority=configured,
            source_kind="git",
            content_hash="a" * 64,
            retrieved_at=dt.datetime.now(dt.timezone.utc),
        )
    assert session.statements == []


async def test_record_artifact_source_returns_stored_hash_unchanged():
    configured = authority()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured)
    version = _version(artifact.id)
    digest = "c" * 64
    session = SequencedSession([Row(workspace), Row((artifact, version))])
    source = await catalog.record_artifact_source(
        configured.importer_scope(),
        session,
        version.id,
        authority=configured,
        source_kind="git",
        content_hash=digest,
        retrieved_at=dt.datetime.now(dt.timezone.utc),
        repository="https://example.invalid/repo",
        ref="abc123",
    )
    assert source.content_hash == digest


# ---------------------------------------------------------------------------
# get_publication_readiness: read-only, no mutation
# ---------------------------------------------------------------------------


async def test_publication_readiness_reports_blockers_without_current_version():
    configured = authority()
    workspace = _importer_workspace(configured)
    artifact = _artifact(configured, review_state=ReviewState.DRAFT, current_version_id=None)
    session = SequencedSession([Row(workspace), Row(artifact)])
    readiness = await catalog.get_publication_readiness(
        configured.importer_scope(), session, artifact.id, authority=configured
    )
    assert not readiness.ready
    assert session.added == []  # read-only: never inserts/mutates state that gets persisted
