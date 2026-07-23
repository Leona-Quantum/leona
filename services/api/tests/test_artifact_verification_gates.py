import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import ExportStatus, Visibility
from majorana_evals import load_seeded_corpus
from repo_test_helpers import compiled

from majorana_api.repos import artifacts


class _WriteResult:
    rowcount = 1


class _WriteSession:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _WriteResult()


@pytest.mark.parametrize(
    "summary",
    [
        {
            "verified": False,
            "decision": "inconclusive",
            "evidence_strength": "structural",
        },
        {"verified": True, "decision": "pass", "evidence_strength": "structural"},
        {"verified": False, "decision": "pass", "evidence_strength": "physical"},
    ],
)
async def test_public_visibility_fails_closed_without_verified_physical_pass(
    scope, monkeypatch, summary
):
    artifact_id = uuid.uuid4()
    version_id = uuid.uuid4()

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(current_version_id=version_id)

    async def get_version(*_args, **_kwargs):
        return SimpleNamespace(
            fingerprint="a" * 64,
            artifact_metadata={
                "source": "agent_candidate",
                "source_fingerprint": "a" * 64,
                "verification_summary": summary,
            },
        )

    monkeypatch.setattr(artifacts, "get_artifact", get_artifact)
    monkeypatch.setattr(artifacts, "get_version", get_version)

    admin = scope.model_copy(update={"role": "admin"})
    with pytest.raises(ValueError, match="verified physical PASS"):
        await artifacts.set_visibility(admin, _WriteSession(), artifact_id, Visibility.PUBLIC)


async def test_verified_physical_pass_can_be_made_public(scope, monkeypatch):
    version_id = uuid.uuid4()

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(current_version_id=version_id)

    async def get_version(*_args, **_kwargs):
        return SimpleNamespace(
            fingerprint="a" * 64,
            artifact_metadata={
                "source": "agent_candidate",
                "source_fingerprint": "a" * 64,
                "verification_summary": {
                    "verified": True,
                    "decision": "pass",
                    "evidence_strength": "physical",
                },
            },
        )

    monkeypatch.setattr(artifacts, "get_artifact", get_artifact)
    monkeypatch.setattr(artifacts, "get_version", get_version)

    session = _WriteSession()
    admin = scope.model_copy(update={"role": "admin"})
    await artifacts.set_visibility(admin, session, uuid.uuid4(), Visibility.PUBLIC)

    assert len(session.statements) == 1


@pytest.mark.parametrize(
    "case",
    load_seeded_corpus(Path(__file__).parents[3] / "evals" / "seeded-mistakes"),
    ids=lambda case: case.id,
)
async def test_seeded_verification_v2_publication_matrix(scope, monkeypatch, case):
    """Every Step 13 seed crosses the real API public gate, not a copied predicate."""

    version_id = uuid.uuid4()
    fingerprint = "a" * 64
    expected = case.expected
    summary = {
        "verified": expected.decision == "pass" and expected.evidence_strength == "physical",
        "decision": expected.decision.value if expected.decision else None,
        "evidence_strength": (
            expected.evidence_strength.value if expected.evidence_strength else None
        ),
    }

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(current_version_id=version_id)

    async def get_version(*_args, **_kwargs):
        return SimpleNamespace(
            fingerprint=fingerprint,
            artifact_metadata={
                "source": "agent_candidate",
                "source_fingerprint": fingerprint,
                "verification_summary": summary,
            },
        )

    monkeypatch.setattr(artifacts, "get_artifact", get_artifact)
    monkeypatch.setattr(artifacts, "get_version", get_version)
    session = _WriteSession()
    admin = scope.model_copy(update={"role": "admin"})

    if expected.public_eligible:
        await artifacts.set_visibility(admin, session, uuid.uuid4(), Visibility.PUBLIC)
        assert len(session.statements) == 1
    else:
        with pytest.raises(ValueError, match="verified physical PASS"):
            await artifacts.set_visibility(admin, session, uuid.uuid4(), Visibility.PUBLIC)


@pytest.mark.parametrize(
    ("source", "metadata_fingerprint", "version_fingerprint"),
    [
        ("public_repository", "a" * 64, "a" * 64),
        ("agent_candidate", "b" * 64, "a" * 64),
    ],
)
async def test_public_visibility_rejects_imported_or_fingerprint_mismatched_metadata(
    scope, monkeypatch, source, metadata_fingerprint, version_fingerprint
):
    version_id = uuid.uuid4()

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(current_version_id=version_id)

    async def get_version(*_args, **_kwargs):
        return SimpleNamespace(
            fingerprint=version_fingerprint,
            artifact_metadata={
                "source": source,
                "source_fingerprint": metadata_fingerprint,
                "verification_summary": {
                    "verified": True,
                    "decision": "pass",
                    "evidence_strength": "physical",
                },
            },
        )

    monkeypatch.setattr(artifacts, "get_artifact", get_artifact)
    monkeypatch.setattr(artifacts, "get_version", get_version)

    admin = scope.model_copy(update={"role": "admin"})
    with pytest.raises(ValueError, match="verified physical PASS"):
        await artifacts.set_visibility(admin, _WriteSession(), uuid.uuid4(), Visibility.PUBLIC)


class _ScalarResult:
    def scalar_one(self):
        return 1


class _CreateVersionSession:
    def __init__(self):
        self.statements = []
        self.added = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _ScalarResult() if len(self.statements) == 1 else _WriteResult()

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        return None


def _personal_artifact(*, visibility=Visibility.PUBLIC):
    return SimpleNamespace(
        id=uuid.uuid4(),
        visibility=visibility,
        artifact_kind=None,
        execution_state=None,
        review_state=None,
        publication_state=None,
        current_version_id=uuid.uuid4(),
        updated_at=None,
    )


@pytest.mark.parametrize(
    "metadata",
    [
        {
            "source": "studio_draft",
            "verification_summary": {
                "verified": False,
                "decision": None,
                "reason_code": "source_changed_pending_verification",
            },
        },
        {
            "source": "agent_candidate",
            "verification_summary": {
                "verified": False,
                "decision": "inconclusive",
                "reason_code": "required_check_unavailable",
            },
        },
    ],
)
async def test_new_draft_or_inconclusive_version_atomically_demotes_public_personal_artifact(
    scope, monkeypatch, metadata
):
    artifact = _personal_artifact()

    async def get_artifact(*_args, **_kwargs):
        return artifact

    monkeypatch.setattr(artifacts, "get_artifact", get_artifact)
    session = _CreateVersionSession()

    await artifacts.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata=metadata,
        code="edited source",
        code_lang="qiskit",
        fingerprint="a" * 64,
        export_status=ExportStatus.UNSUPPORTED,
    )

    update_sql, update_params = compiled(session.statements[-1])
    assert "visibility" in update_sql
    assert Visibility.PRIVATE in update_params.values()
    assert artifact.visibility is Visibility.PRIVATE


async def test_personal_version_writer_rejects_catalog_lifecycle_artifact(scope, monkeypatch):
    artifact = _personal_artifact()
    artifact.artifact_kind = "circuit"
    artifact.review_state = "accepted"
    artifact.publication_state = "public"

    async def get_artifact(*_args, **_kwargs):
        return artifact

    monkeypatch.setattr(artifacts, "get_artifact", get_artifact)

    with pytest.raises(ValueError, match="catalog repository lifecycle"):
        await artifacts.create_version(
            scope,
            object(),
            artifact.id,
            qasm_version=None,
            qasm=None,
            metadata={"source": "studio_draft"},
            code="must not replace catalog current version",
            code_lang="qiskit",
            fingerprint="a" * 64,
            export_status=ExportStatus.UNSUPPORTED,
        )
