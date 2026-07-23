"""Route-level wiring for artifact mutations.

`soft_delete_artifact` was implemented, workspace-scoped, role-gated and
covered by repo tests — and reachable from no route at all. The Library's
Delete button therefore only wrote a localStorage tombstone: the row stayed in
Postgres and reappeared on another device or after clearing site data.

Repo-level tests cannot catch that, because the primitive itself was correct.
These assert the HTTP surface actually exposes it.
"""

import uuid
from types import SimpleNamespace

from majorana_contracts.enums import ExportStatus, Framework

from majorana_api.routes import artifacts as artifact_routes


def _routes() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in artifact_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_library_delete_is_reachable_over_http():
    assert ("/artifacts/{artifact_id}", "DELETE") in _routes()


def test_delete_route_delegates_to_the_scoped_soft_delete():
    """Guards against a hard delete or an unscoped query being swapped in."""
    source = artifact_routes.delete_artifact.__doc__ or ""
    assert "Soft" in source
    handler = artifact_routes.delete_artifact
    assert handler.__annotations__["scope"] is not None
    # The handler must take CurrentScope, not a caller-supplied workspace id.
    assert "workspace_id" not in handler.__annotations__


def test_list_resource_reads_the_verification_grade_and_never_guesses():
    """The Vault list fabricated "verified" for unopened artifacts because the
    list resource carried no grade at all. It now reads the current version's
    verification_summary — and absence or garbage maps to None (unknown), never
    to a verdict."""
    from majorana_contracts.enums import EvidenceStrength, VerifierDecision

    fields = artifact_routes._verification_summary_fields

    assert fields(None) == (None, None)
    assert fields({}) == (None, None)
    assert fields({"verification_summary": "corrupt"}) == (None, None)
    assert fields({"verification_summary": {"decision": "certainly!"}}) == (None, None)
    assert fields(
        {"verification_summary": {"decision": "pass", "evidence_strength": "structural"}}
    ) == (VerifierDecision.PASS, EvidenceStrength.STRUCTURAL)
    assert fields(
        {"verification_summary": {"decision": "pass", "evidence_strength": "physical"}}
    ) == (VerifierDecision.PASS, EvidenceStrength.PHYSICAL)


async def test_imported_public_reference_is_explicitly_not_fresh_verification(scope, monkeypatch):
    artifact_id = uuid.uuid4()
    captured = {}
    body = artifact_routes.ImportPublicArtifactRequest(
        source_slug="bell-reference",
        title="Bell reference",
        family="bell",
        framework=Framework.QISKIT,
        code="print('reference')",
        code_lang="python",
        source_url="https://example.test/reference",
        source_title="Public reference",
        source_license="Apache-2.0",
        introduction="Introduction",
        explanation="Explanation",
        verification="Source description only",
        export_status=ExportStatus.DOWNLOAD_ONLY,
    )

    async def get_by_slug(*_args):
        return None

    async def create_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id)

    async def create_version(_scope, _session, supplied_artifact_id, **values):
        captured.update(values)
        captured["artifact_id"] = supplied_artifact_id

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact_by_slug", get_by_slug)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_artifact", create_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_version", create_version)
    monkeypatch.setattr(artifact_routes, "_to_artifact", lambda row: row.id)

    result = await artifact_routes.import_public_artifact(body, scope, object())

    assert result == artifact_id
    assert captured["artifact_id"] == artifact_id
    assert captured["metadata"]["source"]["kind"] == "public_repository"
    assert captured["metadata"]["verification_summary"] == {
        "verified": False,
        "decision": None,
        "reason_code": "imported_reference_not_verified",
        "evidence_strength": None,
    }
    assert "verification_attempt_id" not in captured["metadata"]
