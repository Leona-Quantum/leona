from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

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


def test_remote_provisioning_accepts_github_actions_neon(
    monkeypatch: pytest.MonkeyPatch,
    provision_script,
) -> None:
    monkeypatch.setenv("CI", "true")
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    assert provision_script._remote_provisioning_allowed(
        "postgresql://example:secret@example-pooler.neon.tech/database"
    )


def test_remote_provisioning_accepts_exact_owner_s12_staging(
    monkeypatch: pytest.MonkeyPatch,
    provision_script,
) -> None:
    monkeypatch.setenv("MAJORANA_VQE_E2E_OWNER_STAGING_PROVISION", "true")
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("MAJORANA_DEPLOYMENT_ENVIRONMENT", "phase76-s12-staging")

    assert provision_script._remote_provisioning_allowed(
        "postgresql://example:secret@example-pooler.neon.tech/database"
    )


@pytest.mark.parametrize(
    ("database_url", "environment", "deployment_environment"),
    [
        ("postgresql://localhost/database", "production", "phase76-s12-staging"),
        (
            "postgresql://example:secret@example-pooler.neon.tech/database",
            "development",
            "phase76-s12-staging",
        ),
        (
            "postgresql://example:secret@example-pooler.neon.tech/database",
            "production",
            "production",
        ),
    ],
)
def test_remote_provisioning_rejects_non_s12_contexts(
    monkeypatch: pytest.MonkeyPatch,
    provision_script,
    database_url: str,
    environment: str,
    deployment_environment: str,
) -> None:
    monkeypatch.setenv("MAJORANA_VQE_E2E_OWNER_STAGING_PROVISION", "true")
    monkeypatch.setenv("MAJORANA_ENV", environment)
    monkeypatch.setenv("MAJORANA_DEPLOYMENT_ENVIRONMENT", deployment_environment)

    assert not provision_script._remote_provisioning_allowed(database_url)
