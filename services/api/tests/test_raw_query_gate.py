"""Test-the-test for scripts/check_raw_queries.py: a deliberate raw-query probe
outside the repository layer MUST be flagged (08-phases.md Phase 1 step 3 check)."""

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

spec = importlib.util.spec_from_file_location(
    "check_raw_queries", REPO_ROOT / "scripts" / "check_raw_queries.py"
)
check_raw_queries = importlib.util.module_from_spec(spec)
sys.modules["check_raw_queries"] = check_raw_queries
spec.loader.exec_module(check_raw_queries)

PROBES = [
    'rows = await session.execute(text("select * from runs"))',
    "session.query(Run).all()",
    "from sqlalchemy import select",
    "import psycopg",
]


def _tree_with_probe(tmp_path: Path, probe_line: str) -> Path:
    routes = tmp_path / "services" / "api" / "src" / "majorana_api" / "routes"
    routes.mkdir(parents=True)
    (routes / "sneaky.py").write_text(f"async def handler(session):\n    {probe_line}\n")
    return tmp_path


def test_probe_outside_repo_layer_fails(tmp_path):
    for probe in PROBES:
        found = check_raw_queries.violations(_tree_with_probe(tmp_path / probe[:8], probe))
        assert found, f"probe not caught: {probe}"
        assert "sneaky.py" in found[0]


def test_repo_layer_is_allowed(tmp_path):
    repos = tmp_path / "services" / "api" / "src" / "majorana_api" / "repos"
    repos.mkdir(parents=True)
    (repos / "runs.py").write_text("async def f(session, stmt):\n    await session.execute(stmt)\n")
    assert check_raw_queries.violations(tmp_path) == []


def test_real_tree_is_clean():
    assert check_raw_queries.violations(REPO_ROOT) == []
