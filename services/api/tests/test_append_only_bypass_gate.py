"""Test-the-test for scripts/check_append_only_bypass.py: `majorana.append_only_bypass`
reachable from anywhere but the two allowed locations MUST be flagged
(0050_append_only_triggers.py's docstring — the bypass exists so
`delete_committed_tenants` can clean up committed rows without weakening the
trigger for anything else, and a bypass any file can reach is no control at
all)."""

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

spec = importlib.util.spec_from_file_location(
    "check_append_only_bypass", REPO_ROOT / "scripts" / "check_append_only_bypass.py"
)
check_append_only_bypass = importlib.util.module_from_spec(spec)
sys.modules["check_append_only_bypass"] = check_append_only_bypass
spec.loader.exec_module(check_append_only_bypass)

PROBE = "await session.execute(text(\"SET LOCAL majorana.append_only_bypass = 'on'\"))"

# One from the API's own repository layer, one from the worker, one from a
# packages/py library — the three shapes of "product code" this gate exists to
# keep the bypass out of, not just one of them.
DISALLOWED_LOCATIONS = (
    "services/api/src/majorana_api/repos",
    "services/worker/src/majorana_worker",
    "packages/py/agent/src/majorana_agent",
)
ALLOWED_LOCATIONS = ("services/api/tests", "db/migrations/versions")


def _tree_with_probe(tmp_path: Path, relative_dir: str) -> Path:
    target = tmp_path / relative_dir
    target.mkdir(parents=True)
    (target / "sneaky.py").write_text(f"async def handler(session):\n    {PROBE}\n")
    return tmp_path


def test_probe_outside_the_two_allowed_locations_fails(tmp_path):
    for index, relative_dir in enumerate(DISALLOWED_LOCATIONS):
        tree = _tree_with_probe(tmp_path / str(index), relative_dir)
        found = check_append_only_bypass.violations(tree)
        assert found, f"probe not caught under {relative_dir}"
        assert "sneaky.py" in found[0]


def test_the_two_allowed_locations_are_not_flagged(tmp_path):
    for index, relative_dir in enumerate(ALLOWED_LOCATIONS):
        tree = _tree_with_probe(tmp_path / str(index), relative_dir)
        assert check_append_only_bypass.violations(tree) == []


def test_a_sibling_directory_that_merely_starts_with_the_same_letters_is_not_allowed(tmp_path):
    """`services/api/tests/` must not accidentally allow
    `services/api/tests_helpers/` or similar — a prefix check without the
    trailing slash would."""
    tree = _tree_with_probe(tmp_path, "services/api/testsomething")
    found = check_append_only_bypass.violations(tree)
    assert found, "a same-prefix sibling directory was wrongly treated as allowed"


def test_real_tree_is_clean():
    assert check_append_only_bypass.violations(REPO_ROOT) == []
