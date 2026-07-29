from __future__ import annotations

import importlib.util
from pathlib import Path
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "provision-h2-vqe-candidate.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("provision_h2_vqe_candidate", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def provision_script():
    return _load_script()


@pytest.fixture(autouse=True)
def isolate_remote_provisioning_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "CI",
        "GITHUB_ACTIONS",
        "MAJORANA_VQE_E2E_OWNER_STAGING_PROVISION",
        "MAJORANA_ENV",
        "MAJORANA_DEPLOYMENT_ENVIRONMENT",
    ):
        monkeypatch.delenv(name, raising=False)


def test_remote_provisioning_accepts_github_actions_isolated_postgres(
    monkeypatch: pytest.MonkeyPatch,
    provision_script,
) -> None:
    monkeypatch.setenv("CI", "true")
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    assert provision_script._remote_provisioning_allowed(
        "postgresql://pg:pg@localhost:5432/majorana_vqe_e2e"
    )


def test_candidate_storage_slug_is_workspace_scoped_and_semantically_stable(
    provision_script,
) -> None:
    semantic_key = "h2.sto3g.actual_vqe.v0_2.problem"
    first = Scope(
        user_id=uuid.UUID("11111111-1111-4111-8111-111111111111"),
        workspace_id=uuid.UUID("22222222-2222-4222-8222-222222222222"),
        role=Role.OWNER,
    )
    second = Scope(
        user_id=uuid.UUID("33333333-3333-4333-8333-333333333333"),
        workspace_id=uuid.UUID("44444444-4444-4444-8444-444444444444"),
        role=Role.OWNER,
    )

    assert provision_script._workspace_slug(first, semantic_key) != (
        provision_script._workspace_slug(second, semantic_key)
    )
    assert provision_script._workspace_slug(first, semantic_key) == (
        provision_script._workspace_slug(first, semantic_key)
    )


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://pg:pg@localhost:5432/another_database",
        "postgresql://pg:pg@remote.example/majorana_vqe_e2e",
        "postgresql://example:secret@example-pooler.neon.tech/database",
        "not-a-database-url",
    ],
)
def test_remote_provisioning_rejects_other_github_actions_databases(
    monkeypatch: pytest.MonkeyPatch,
    provision_script,
    database_url: str,
) -> None:
    monkeypatch.setenv("CI", "true")
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    assert not provision_script._remote_provisioning_allowed(database_url)


def test_remote_provisioning_rejects_local_database_outside_github_actions(
    provision_script,
) -> None:
    assert not provision_script._remote_provisioning_allowed(
        "postgresql://pg:pg@localhost:5432/majorana_vqe_e2e"
    )
