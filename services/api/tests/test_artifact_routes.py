"""Route-level wiring for artifact mutations.

`soft_delete_artifact` was implemented, workspace-scoped, role-gated and
covered by repo tests — and reachable from no route at all. The Library's
Delete button therefore only wrote a localStorage tombstone: the row stayed in
Postgres and reappeared on another device or after clearing site data.

Repo-level tests cannot catch that, because the primitive itself was correct.
These assert the HTTP surface actually exposes it.
"""

import datetime as dt
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import ExportStatus, Framework
from pydantic import ValidationError

from majorana_api.orm import User
from majorana_api.routes import artifacts as artifact_routes
from majorana_api.settings import Settings
from majorana_api.tiers import limits_for


def _settings() -> Settings:
    """A deployment with no allowlists, so the importer resolves to `free`.

    Written out rather than defaulted: `tier_of` reads both allowlists, and a
    Settings built from the ambient environment would give this test a different
    tier on a machine where LEONA_DEVELOPER_EMAILS happens to be set.
    """
    return Settings(
        workos_client_id="client_test",
        workos_jwt_issuer="https://test.invalid",
        workos_jwks_url="https://test.invalid/jwks",
        web_origin="http://localhost:3000",
        developer_emails=frozenset(),
    )


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

    def summary(decision="pass", strength="structural"):
        return {
            "decision": decision,
            "semantic_review_decision": "ready",
            "evidence_strength": strength,
            "reason_code": "strict_complete",
            "candidate_defect_observed": False,
            "failure_class": None,
            "retry_target": "none",
            "unverified_claims": [],
            "checks": [{"method": "return_contract", "result": "pass"}],
        }

    assert fields(None) == (None, None)
    assert fields({}) == (None, None)
    assert fields({"verification_summary": "corrupt"}) == (None, None)
    assert fields({"verification_summary": {"decision": "certainly!"}}) == (None, None)
    assert fields({"verification_summary": summary()}) == (
        VerifierDecision.PASS,
        EvidenceStrength.STRUCTURAL,
    )
    assert fields({"verification_summary": summary(strength="physical")}) == (
        VerifierDecision.PASS,
        EvidenceStrength.PHYSICAL,
    )


def test_typed_summary_is_bounded_and_legacy_absence_stays_none():
    from majorana_api.verification_summary import parse_verification_summary

    assert parse_verification_summary(None) is None
    assert parse_verification_summary({}) is None
    raw = {
        "decision": "inconclusive",
        "semantic_review_decision": "inconclusive",
        "evidence_strength": "structural",
        "reason_code": "required_check_unavailable",
        "candidate_defect_observed": False,
        "failure_class": "capability_limit",
        "retry_target": "none",
        "unverified_claims": ["phase"],
        "checks": [{"method": "return_contract", "result": "pass", "details": {"secret": "drop"}}]
        * 60,
    }
    summary = parse_verification_summary(raw)
    assert summary.decision.value == "inconclusive"
    assert len(summary.checks) == 50
    assert summary.checks[0].model_dump(mode="json") == {
        "method": "return_contract",
        "result": "pass",
    }


async def test_imported_public_reference_is_explicitly_not_fresh_verification(scope, monkeypatch):
    artifact_id = uuid.uuid4()
    captured = {}
    body = artifact_routes.ImportPublicArtifactRequest(
        source_slug="bell-reference",
        title="Bell reference",
        family="bell",
        framework=Framework.QISKIT,
        # A real published circuit, not a placeholder: the route refuses source
        # that binds neither FINAL_CIRCUIT nor RESULT, so `print('reference')`
        # here would be testing the import path with something the catalog can
        # no longer contain.
        code="from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n\nFINAL_CIRCUIT = qc",
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

    async def keep_artifact(_scope, _session, supplied_artifact_id, **values):
        # The import files through `keep_artifact` since 2026-08-02, which is
        # where the allowance is enforced. Recorded rather than ignored: a double
        # that dropped the limit would let this test pass against a route that
        # had stopped passing one.
        captured["kept_artifact_id"] = supplied_artifact_id
        captured["kept_limit"] = values.get("workspace_artifact_limit")
        return SimpleNamespace(id=supplied_artifact_id)

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact_by_slug", get_by_slug)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_artifact", create_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_version", create_version)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "keep_artifact", keep_artifact)
    monkeypatch.setattr(artifact_routes, "_to_artifact", lambda row: row.id)

    result = await artifact_routes.import_public_artifact(
        body,
        scope,
        object(),
        (User(email="importer@example.com", plan=None), object()),
        _settings(),
    )

    assert captured["kept_artifact_id"] == artifact_id
    assert captured["kept_limit"] == limits_for("free").private_artifacts, (
        "the import must file against the caller's own tier limit"
    )

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


async def test_a_public_record_that_is_not_a_circuit_is_refused_not_filed(scope, monkeypatch):
    """The catalog published 87 prose records — an operator's representative
    form, a literature method's ingredient list — under `framework: "Qiskit"`.
    `getPublicRepositoryLibraryVariant` selected them, and this route filed the
    paragraph as an artifact's executable code.

    `import-source` has always refused source that binds neither name. This is
    the same refusal on the catalog's side of the door.
    """
    filed = []

    async def get_by_slug(*_args):
        return None

    async def create_artifact(*_args, **_kwargs):
        filed.append("created")
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact_by_slug", get_by_slug)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_artifact", create_artifact)

    body = artifact_routes.ImportPublicArtifactRequest(
        source_slug="operator-annihilation",
        title="Fermionic annihilation operator",
        family="bell",
        framework=Framework.QISKIT,
        code=(
            "OPERATOR: Fermionic annihilation operator\n"
            "REPRESENTATIVE FORM: a_p\n\n"
            "This is a mathematical operator record, not an executable circuit."
        ),
        code_lang="text",
        source_url="https://example.test/reference",
        source_title="Public reference",
        source_license="Apache-2.0",
        introduction="Introduction",
        explanation="Explanation",
        verification="Source description only",
        export_status=ExportStatus.DOWNLOAD_ONLY,
    )

    with pytest.raises(HTTPException) as excinfo:
        await artifact_routes.import_public_artifact(
            body,
            scope,
            object(),
            (User(email="importer@example.com", plan=None), object()),
            _settings(),
        )

    assert excinfo.value.status_code == 422
    assert excinfo.value.detail["reason"] == "public_source_role_unknown"
    assert filed == [], "a record this product cannot run must not reach the Vault"


# --- version history ---------------------------------------------------------


def _version_row(version_id, seq, **overrides):
    row = {
        "id": version_id,
        "artifact_id": None,
        "seq": seq,
        "qasm_version": None,
        "qasm": None,
        "artifact_metadata": None,
        "code": "print(1)",
        "code_lang": "qiskit",
        "fingerprint": f"fp-{seq}",
        "export_status": "unsupported",
        "export_reason": None,
        "framework_variants": None,
        "resource_estimates": None,
        "limitations": None,
        "created_at": dt.datetime(2026, 8, 1, tzinfo=dt.UTC),
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _rich_row(version_id, seq):
    """A worker-materialized version: QASM, exports, estimates, a PASS."""
    return _version_row(
        version_id,
        seq,
        qasm="OPENQASM 3.0;",
        qasm_version="3.0",
        export_status="lossless",
        resource_estimates={"qubits": 2},
        artifact_metadata={
            "source": "simple_pipeline_candidate",
            "verification_summary": {
                "decision": "pass",
                "semantic_review_decision": "ready",
                "evidence_strength": "structural",
                "reason_code": "strict_complete",
                "candidate_defect_observed": False,
                "failure_class": None,
                "retry_target": "none",
                "unverified_claims": [],
                "checks": [{"method": "return_contract", "result": "pass"}],
            },
        },
    )


def test_version_history_and_restore_are_reachable_over_http():
    assert ("/artifacts/{artifact_id}/versions", "GET") in _routes()
    assert ("/artifacts/{artifact_id}/versions/{version_id}/restore", "POST") in _routes()


def test_the_versions_list_stays_bounded_like_every_other_artifact_query():
    assert artifact_routes.VERSION_PAGE_MAX == 100
    assert artifact_routes.VERSION_PAGE_DEFAULT <= artifact_routes.VERSION_PAGE_MAX


def test_the_list_row_carries_no_source():
    """History is a sidebar. Shipping every version's code down with the list
    would put megabytes behind a panel that renders one line per row."""
    fields = set(artifact_routes.ArtifactVersionSummary.model_fields)
    assert "code" not in fields
    assert "qasm" not in fields
    assert {"has_qasm", "exportable", "verified", "origin", "restore_losses"} <= fields


async def test_current_is_the_pointer_not_the_highest_seq(scope, monkeypatch):
    """A restore moves `current_version_id` without authoring a row, so the
    current version is routinely NOT max(seq). A client reading position would
    label the wrong row."""
    artifact_id = uuid.uuid4()
    older, newer = uuid.uuid4(), uuid.uuid4()
    rows = [_version_row(newer, 2), _rich_row(older, 1)]

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id, current_version_id=older)

    async def list_versions(*_args, **_kwargs):
        return rows

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact", get_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "list_versions", list_versions)

    page = await artifact_routes.list_artifact_versions(artifact_id, scope, object())

    assert [v.seq for v in page.versions] == [2, 1]
    assert [v.is_current for v in page.versions] == [False, True]
    assert page.current_version_id == older
    # A short page is the last page.
    assert page.next_before_seq is None


async def test_each_row_states_what_restoring_it_would_cost(scope, monkeypatch):
    artifact_id = uuid.uuid4()
    draft, run = uuid.uuid4(), uuid.uuid4()
    rows = [_version_row(draft, 2), _rich_row(run, 1)]

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id, current_version_id=run)

    async def list_versions(*_args, **_kwargs):
        return rows

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact", get_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "list_versions", list_versions)

    page = await artifact_routes.list_artifact_versions(artifact_id, scope, object())

    by_id = {v.id: v for v in page.versions}
    assert by_id[run].restore_losses == []  # already current
    assert by_id[draft].restore_losses == ["qasm", "export", "resource_estimates", "verification"]
    assert by_id[draft].has_qasm is False
    assert by_id[run].verified is True


async def test_restore_refuses_a_lossy_restore_until_it_is_acknowledged(scope, monkeypatch):
    """Silently restoring a Studio draft over a verified run hands the canvas a
    version it cannot render and tells the user nothing."""
    artifact_id = uuid.uuid4()
    draft, run = uuid.uuid4(), uuid.uuid4()
    restored = []

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id, current_version_id=run)

    async def get_version(_scope, _session, version_id):
        row = _version_row(draft, 2) if version_id == draft else _rich_row(run, 1)
        row.artifact_id = artifact_id
        return row

    async def restore_version(_scope, _session, _artifact_id, version_id):
        restored.append(version_id)
        row = _version_row(draft, 2)
        row.artifact_id = artifact_id
        return row

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact", get_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_version", get_version)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "restore_version", restore_version)

    body = artifact_routes.RestoreVersionRequest()
    with pytest.raises(HTTPException) as refusal:
        await artifact_routes.restore_artifact_version(artifact_id, draft, body, scope, object())
    assert refusal.value.status_code == 409
    assert refusal.value.detail["reason"] == "restore_loses_capabilities"
    # Codes, not a sentence: the web renders these from its own locale tables.
    assert refusal.value.detail["losses"] == [
        "qasm",
        "export",
        "resource_estimates",
        "verification",
    ]
    assert restored == []

    acknowledged = artifact_routes.RestoreVersionRequest(acknowledge_capability_loss=True)
    result = await artifact_routes.restore_artifact_version(
        artifact_id, draft, acknowledged, scope, object()
    )
    assert restored == [draft]
    assert result.id == draft


async def test_a_restore_that_loses_nothing_needs_no_acknowledgement(scope, monkeypatch):
    artifact_id = uuid.uuid4()
    draft, run = uuid.uuid4(), uuid.uuid4()
    restored = []

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id, current_version_id=draft)

    async def get_version(_scope, _session, version_id):
        row = _version_row(draft, 2) if version_id == draft else _rich_row(run, 1)
        row.artifact_id = artifact_id
        return row

    async def restore_version(_scope, _session, _artifact_id, version_id):
        restored.append(version_id)
        row = _rich_row(run, 1)
        row.artifact_id = artifact_id
        return row

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact", get_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_version", get_version)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "restore_version", restore_version)

    await artifact_routes.restore_artifact_version(
        artifact_id, run, artifact_routes.RestoreVersionRequest(), scope, object()
    )
    assert restored == [run]


async def test_restore_refuses_a_version_belonging_to_another_artifact(scope, monkeypatch):
    """Both ids in the path are load-bearing: without binding them, any version
    the workspace can see would restore onto any artifact it owns."""
    artifact_id = uuid.uuid4()
    stray = uuid.uuid4()

    async def get_artifact(*_args, **_kwargs):
        return SimpleNamespace(id=artifact_id, current_version_id=None)

    async def get_version(_scope, _session, version_id):
        row = _version_row(version_id, 1)
        row.artifact_id = uuid.uuid4()  # a different artifact
        return row

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact", get_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_version", get_version)

    with pytest.raises(HTTPException) as refusal:
        await artifact_routes.restore_artifact_version(
            artifact_id, stray, artifact_routes.RestoreVersionRequest(), scope, object()
        )
    assert refusal.value.status_code == 404


# --- POST /artifacts/import-source: a circuit the user wrote themselves --------
#
# The route that closes OWNER_TODO §7. Everything here is about what it refuses
# and what it promises, because the one thing it must never do is file source
# nobody executed and let anything downstream read it as evidence.

_CIRCUIT = (
    "from qiskit import QuantumCircuit\n"
    "FINAL_CIRCUIT = QuantumCircuit(2, 2)\n"
    "FINAL_CIRCUIT.h(0)\n"
    "FINAL_CIRCUIT.cx(0, 1)\n"
    "FINAL_CIRCUIT.measure([0, 1], [0, 1])\n"
)
_PROGRAM = _CIRCUIT + "RESULT = {'counts': {'00': 512, '11': 512}}\n"


def _import_doubles(monkeypatch, *, existing=None):
    """Record what the route writes. Returns the capture dict."""
    artifact_id = uuid.uuid4()
    captured = {"artifact_id_out": artifact_id}

    async def get_by_slug(_scope, _session, slug):
        captured["slug"] = slug
        return existing

    async def create_artifact(*_args, **kwargs):
        captured["create"] = kwargs
        return SimpleNamespace(id=artifact_id)

    async def create_version(_scope, _session, supplied_artifact_id, **values):
        captured.update(values)
        captured["artifact_id"] = supplied_artifact_id

    async def keep_artifact(_scope, _session, supplied_artifact_id, **values):
        captured["kept_artifact_id"] = supplied_artifact_id
        captured["kept_limit"] = values.get("workspace_artifact_limit")
        return SimpleNamespace(id=supplied_artifact_id)

    monkeypatch.setattr(artifact_routes.artifacts_repo, "get_artifact_by_slug", get_by_slug)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_artifact", create_artifact)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "create_version", create_version)
    monkeypatch.setattr(artifact_routes.artifacts_repo, "keep_artifact", keep_artifact)
    monkeypatch.setattr(artifact_routes, "_to_artifact", lambda row: row.id)
    return captured


async def _import(body, scope):
    return await artifact_routes.import_own_source(
        body,
        scope,
        object(),
        (User(email="author@example.com", plan=None), object()),
        _settings(),
    )


def test_bringing_your_own_circuit_is_reachable_over_http():
    assert ("/artifacts/import-source", "POST") in _routes(), (
        "a circuit you wrote yourself needs a door that is not the agent pipeline"
    )


@pytest.mark.parametrize("source", [_CIRCUIT, _PROGRAM])
async def test_a_supplied_circuit_files_without_claiming_any_evidence(scope, monkeypatch, source):
    captured = _import_doubles(monkeypatch)
    body = artifact_routes.ImportOwnSourceRequest(
        title="My Bell state", framework=Framework.QISKIT, code=source
    )

    result = await _import(body, scope)

    assert result == captured["artifact_id_out"]
    # Filed under the caller's own allowance, through the one place that holds
    # the workspace lock across the comparison and the write.
    assert captured["kept_artifact_id"] == captured["artifact_id_out"]
    assert captured["kept_limit"] == limits_for("free").private_artifacts
    assert captured["create"]["kept"] is False, "created unkept, then filed"

    summary = captured["metadata"]["verification_summary"]
    assert summary["verified"] is False
    assert summary["decision"] is None
    assert summary["evidence_strength"] is None
    assert summary["reason_code"] == "user_supplied_source_not_verified"
    # The five an unexecuted artifact cannot claim. Same list the pipeline files
    # for a run that never executed, because it is the same claim.
    assert summary["unverified_claims"] == [
        "reported output",
        "quantum correctness",
        "physical fidelity",
        "optimality",
        "intent alignment",
    ]
    # No QASM is lifted without an execution, so nothing may be offered as one.
    assert captured["qasm"] is None
    assert captured["export_status"] is ExportStatus.UNSUPPORTED


async def test_a_supplied_circuit_is_attributed_to_the_person_who_brought_it(scope, monkeypatch):
    """`_origin` reads this string. A writer that does not name itself reads as
    `unknown`, which is what a legacy row reads as, next to a restore button."""
    from majorana_api.version_capabilities import (
        ORIGIN_USER_IMPORT,
        USER_IMPORT_SOURCE,
        _origin,
    )

    captured = _import_doubles(monkeypatch)
    body = artifact_routes.ImportOwnSourceRequest(
        title="Mine", framework=Framework.QISKIT, code=_CIRCUIT
    )

    await _import(body, scope)

    assert captured["metadata"]["source"] == USER_IMPORT_SOURCE
    assert _origin(captured["metadata"]) == ORIGIN_USER_IMPORT
    assert captured["metadata"]["program_role"] == "circuit"


async def test_source_binding_neither_name_is_refused_rather_than_filed(scope, monkeypatch):
    """UNKNOWN is not a circuit with a missing result — it is something this
    product cannot execute. Filing it would create an artifact whose only
    possible future is failing every time anyone opens it."""
    _import_doubles(monkeypatch)
    body = artifact_routes.ImportOwnSourceRequest(
        title="Not a circuit",
        framework=Framework.QISKIT,
        code="from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\n",
    )

    with pytest.raises(HTTPException) as refusal:
        await _import(body, scope)

    assert refusal.value.status_code == 422
    assert refusal.value.detail["reason"] == "source_role_unknown"
    assert "FINAL_CIRCUIT" in refusal.value.detail["error"]


async def test_source_that_will_not_parse_is_refused(scope, monkeypatch):
    _import_doubles(monkeypatch)
    body = artifact_routes.ImportOwnSourceRequest(
        title="Broken", framework=Framework.QISKIT, code="FINAL_CIRCUIT = ((("
    )

    with pytest.raises(HTTPException) as refusal:
        await _import(body, scope)

    assert refusal.value.status_code == 422


async def test_source_written_for_another_framework_is_refused(scope, monkeypatch):
    """Submitting Cirq under the Qiskit tab is the mislabelling `startRun`'s
    `sourceFramework` comment describes. It must fail on the label, here, and
    not in a sandbox later."""
    _import_doubles(monkeypatch)
    body = artifact_routes.ImportOwnSourceRequest(
        title="Cirq under Qiskit",
        framework=Framework.QISKIT,
        code="import cirq\nFINAL_CIRCUIT = cirq.Circuit()\n",
    )

    with pytest.raises(HTTPException) as refusal:
        await _import(body, scope)

    assert refusal.value.status_code == 422
    assert refusal.value.detail["reason"] == "source_contract_failed"
    assert refusal.value.detail["diagnostics"], "a refusal must say what was wrong"


async def test_reimporting_the_same_bytes_spends_nothing(scope, monkeypatch):
    """An account at its cap must still be able to re-open what it already has,
    which is the same reason `import-public` is idempotent on its slug."""
    already = SimpleNamespace(id=uuid.uuid4())
    captured = _import_doubles(monkeypatch, existing=already)
    body = artifact_routes.ImportOwnSourceRequest(
        title="Mine", framework=Framework.QISKIT, code=_CIRCUIT
    )

    result = await _import(body, scope)

    assert result == already.id
    assert "kept_artifact_id" not in captured, "an existing import may not spend the allowance"
    assert "metadata" not in captured, "nor write a second version"


async def test_a_full_workspace_refuses_the_import_with_the_cap_sentence(scope, monkeypatch):
    _import_doubles(monkeypatch)

    async def full(_scope, _session, _artifact_id, **_values):
        raise artifact_routes.artifacts_repo.ArtifactCapReached(held=3, limit=3)

    monkeypatch.setattr(artifact_routes.artifacts_repo, "keep_artifact", full)
    body = artifact_routes.ImportOwnSourceRequest(
        title="One too many", framework=Framework.QISKIT, code=_CIRCUIT
    )

    with pytest.raises(HTTPException) as refusal:
        await _import(body, scope)

    assert refusal.value.status_code == 429
    assert refusal.value.detail["reason"] == "artifact_allowance_exhausted"


async def test_two_workspaces_importing_identical_bytes_get_separate_artifacts(scope, monkeypatch):
    """The idempotency slug carries the workspace. Without it, the second
    workspace to import a popular circuit would be handed the first one's row."""
    captured = _import_doubles(monkeypatch)
    body = artifact_routes.ImportOwnSourceRequest(
        title="Mine", framework=Framework.QISKIT, code=_CIRCUIT
    )

    await _import(body, scope)
    first_slug = captured["slug"]

    other = scope.model_copy(update={"workspace_id": uuid.uuid4()})
    await _import(body, other)

    assert first_slug != captured["slug"]
    assert scope.workspace_id.hex in first_slug


@pytest.mark.parametrize("blank", ["   ", "\n\n", "\t", " \n \t "])
def test_source_that_is_only_whitespace_is_a_bad_request_not_a_crash(blank):
    """`min_length=1` admits a single space and `FrameworkProgram` raises on one.
    Unhandled, that is a 500 for what is plainly a bad request — and a 500 is the
    one response that tells the caller nothing about what to fix."""
    with pytest.raises(ValidationError):
        artifact_routes.ImportOwnSourceRequest(
            title="Blank", framework=Framework.QISKIT, code=blank
        )


def test_source_with_leading_whitespace_is_kept_byte_for_byte():
    """Only *entirely* blank is refused. Indentation is meaningful in Python and
    the route's promise is that it stores what you wrote."""
    indented = "  \nFINAL_CIRCUIT = build()\n"
    body = artifact_routes.ImportOwnSourceRequest(
        title="Indented", framework=Framework.QISKIT, code=indented
    )

    assert body.code == indented
