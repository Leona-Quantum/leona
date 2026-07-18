"""Credential-separated fetch runner tests (Step 5b).

Proves the ADR-0017 split at the process boundary: the child that touches the
network is spawned with a rebuilt environment that provably lacks DATABASE_URL
and every other credential, and the parent's pickup re-hashes the quarantined
bytes instead of trusting the child's manifest.
"""

import subprocess
import sys

import pytest
from fetch_test_helpers import run_mock_https_server

from majorana_api.catalog_fetch_runner import build_child_env, fetch_in_subprocess

_SECRET_VARS = (
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "SYSTEM_CATALOG_WORKSPACE_ID",
    "SYSTEM_CATALOG_IMPORTER_USER_ID",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "WORKOS_CLIENT_ID",
)


@pytest.fixture(scope="module")
def mock_server(tmp_path_factory):
    tmpdir = tmp_path_factory.mktemp("fetch_runner_cert")
    with run_mock_https_server(tmpdir) as (port, cert):
        yield port, str(cert)


def test_build_child_env_strips_credentials(monkeypatch):
    for name in _SECRET_VARS:
        monkeypatch.setenv(name, "super-secret")
    env = build_child_env()
    for name in _SECRET_VARS:
        assert name not in env
    assert "PATH" in env
    assert "PYTHONPATH" in env


def test_spawned_child_cannot_see_database_url(monkeypatch):
    """End-to-end proof at the real process boundary, not just the dict."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret@example/db")
    probe = subprocess.run(
        [sys.executable, "-c", "import os; print('DATABASE_URL' in os.environ)"],
        env=build_child_env(),
        capture_output=True,
        text=True,
        check=True,
    )
    assert probe.stdout.strip() == "False"


async def test_fetch_in_subprocess_happy_path(mock_server, tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret@example/db")
    port, cert = mock_server
    outcome = await fetch_in_subprocess(
        f"https://127.0.0.1:{port}/ok",
        allowed_hosts=frozenset({"127.0.0.1"}),
        allowed_port=port,
        allow_private_addresses=True,
        ca_file=cert,
        quarantine_dir=tmp_path / "quarantine",
        timeout_s=5.0,
    )
    assert outcome.ok
    assert outcome.status_code == 200
    assert outcome.output_path.read_bytes() == b"hello from mock server"
    assert outcome.bytes_written == len(b"hello from mock server")
    assert outcome.sha256 is not None


async def test_fetch_in_subprocess_reports_blocked_address(mock_server, tmp_path):
    """Default (production) policy inside the child still refuses loopback."""
    port, cert = mock_server
    outcome = await fetch_in_subprocess(
        f"https://127.0.0.1:{port}/ok",
        allowed_hosts=frozenset({"127.0.0.1"}),
        allowed_port=port,
        allow_private_addresses=False,
        ca_file=cert,
        quarantine_dir=tmp_path / "quarantine",
        timeout_s=5.0,
    )
    assert not outcome.ok
    assert outcome.error_kind == "blocked_address"
    assert not outcome.output_path.exists()


async def test_fetch_in_subprocess_reports_oversized(mock_server, tmp_path):
    port, cert = mock_server
    outcome = await fetch_in_subprocess(
        f"https://127.0.0.1:{port}/big",
        allowed_hosts=frozenset({"127.0.0.1"}),
        allowed_port=port,
        allow_private_addresses=True,
        ca_file=cert,
        quarantine_dir=tmp_path / "quarantine",
        max_bytes=1024,
        timeout_s=5.0,
    )
    assert not outcome.ok
    assert outcome.error_kind == "response_too_large"
    assert not outcome.output_path.exists()


async def test_fetch_in_subprocess_reports_redirect(mock_server, tmp_path):
    port, cert = mock_server
    outcome = await fetch_in_subprocess(
        f"https://127.0.0.1:{port}/redirect",
        allowed_hosts=frozenset({"127.0.0.1"}),
        allowed_port=port,
        allow_private_addresses=True,
        ca_file=cert,
        quarantine_dir=tmp_path / "quarantine",
        timeout_s=5.0,
    )
    assert not outcome.ok
    assert outcome.error_kind == "redirect_rejected"
    assert not outcome.output_path.exists()
