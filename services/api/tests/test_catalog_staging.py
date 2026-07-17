"""DB-free unit tests for the Step 3 private staging path (repos/catalog.py).

Duplicate rejection needs a real UNIQUE constraint violation and is covered
by the live-DB suite (test_catalog_staging_live.py); this file proves the
authz gate, the query shape, and the hard-coded non-public defaults.
"""

import uuid

import pytest
from repo_test_helpers import compiled

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.catalog_hashing import hash_normalized_source, hash_source_blob
from majorana_api.orm import Artifact, Workspace
from majorana_api.repos import AuthzError, NotFoundError, catalog
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    ExecutionState,
    Framework,
    PublicationState,
    ReviewState,
    Visibility,
)


class _Row:
    """Wraps one value with the subset of the Result API repo code calls."""

    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def first(self):
        return self._value

    def scalar_one(self):
        return self._value


class SequencedSession:
    """Returns queued results in call order; records every statement/insert."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.added = []

    async def execute(self, stmt, params=None):
        self.statements.append(stmt)
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def rollback(self):
        pass


def authority() -> CatalogAuthority:
    return CatalogAuthority(
        enabled=True,
        workspace_id=uuid.uuid4(),
        importer_user_id=uuid.uuid4(),
        public_reader_user_id=uuid.uuid4(),
    )


def _stage_artifact_kwargs(**overrides):
    kwargs = dict(
        slug=f"live-{uuid.uuid4()}",
        title="Bell",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        artifact_kind=ArtifactKind.CIRCUIT,
        execution_state=ExecutionState.EXECUTABLE,
    )
    kwargs.update(overrides)
    return kwargs


async def test_stage_artifact_requires_importer_scope():
    configured = authority()
    wrong_scope = configured.public_scope()  # viewer, not the importer identity
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.stage_artifact(
            wrong_scope, session, authority=configured, **_stage_artifact_kwargs()
        )
    assert session.statements == []


async def test_stage_artifact_rejects_workspace_substitution():
    configured = authority()
    substituted = configured.importer_scope().model_copy(update={"workspace_id": uuid.uuid4()})
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.stage_artifact(
            substituted, session, authority=configured, **_stage_artifact_kwargs()
        )
    assert session.statements == []


async def test_stage_artifact_queries_exact_importer_membership():
    configured = authority()
    scope = configured.importer_scope()
    session = SequencedSession([_Row(None)])
    with pytest.raises(NotFoundError):
        await catalog.stage_artifact(
            scope, session, authority=configured, **_stage_artifact_kwargs()
        )
    sql, params = compiled(session.statements[0])
    assert "workspaces.kind" in sql
    assert "memberships.role" in sql
    assert scope.workspace_id in params.values()
    assert scope.user_id in params.values()
    assert "system" in params.values()
    assert "owner" in params.values()


async def test_stage_artifact_hardcodes_non_public_states():
    configured = authority()
    scope = configured.importer_scope()
    workspace = Workspace(
        id=scope.workspace_id, kind="system", name="catalog", owner_user_id=scope.user_id
    )
    session = SequencedSession([_Row(workspace)])
    artifact = await catalog.stage_artifact(
        scope, session, authority=configured, **_stage_artifact_kwargs()
    )
    assert artifact.review_state == ReviewState.DRAFT
    assert artifact.publication_state == PublicationState.PRIVATE
    assert artifact.visibility == Visibility.PRIVATE
    assert artifact.workspace_id == scope.workspace_id
    assert session.added == [artifact]


async def test_stage_artifact_version_requires_importer_scope():
    configured = authority()
    wrong_scope = configured.public_scope()
    session = SequencedSession([])
    with pytest.raises(AuthzError):
        await catalog.stage_artifact_version(
            wrong_scope,
            session,
            uuid.uuid4(),
            authority=configured,
            raw_source=b"x",
            normalized_source="x",
            code="x",
            code_lang="python",
            authoritative_framework=Framework.QISKIT,
            authoritative_framework_version="1.0.0",
            source_language="python",
            metadata_schema_version="1",
        )
    assert session.statements == []


async def test_stage_artifact_version_computes_hashes_and_next_seq():
    configured = authority()
    scope = configured.importer_scope()
    workspace = Workspace(
        id=scope.workspace_id, kind="system", name="catalog", owner_user_id=scope.user_id
    )
    artifact = Artifact(
        id=uuid.uuid4(),
        workspace_id=scope.workspace_id,
        slug="live-1",
        title="Bell",
        family=Algorithm.BELL,
        framework=Framework.QISKIT,
        visibility=Visibility.PRIVATE,
    )
    session = SequencedSession([_Row(workspace), _Row(artifact), _Row(3)])
    version = await catalog.stage_artifact_version(
        scope,
        session,
        artifact.id,
        authority=configured,
        raw_source=b"raw bytes",
        normalized_source="normalized text",
        code="print(1)",
        code_lang="python",
        authoritative_framework=Framework.QISKIT,
        authoritative_framework_version="1.2.0",
        source_language="python",
        metadata_schema_version="1",
    )
    assert version.source_blob_sha256 == hash_source_blob(b"raw bytes")
    assert version.normalized_source_hash == hash_normalized_source("normalized text")
    assert version.seq == 3
    assert version.qasm is None
    assert version.qasm_version is None
    assert version.fingerprint == hash_normalized_source("normalized text")
    assert artifact.current_version_id == version.id
