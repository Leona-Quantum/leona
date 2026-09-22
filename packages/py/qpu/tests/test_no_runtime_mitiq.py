"""Mitiq is a test-time cross-check and nothing else (ai-ops 361, option 1).

The ruling: *"Write both techniques directly, and use Mitiq only in tests to
check that our numbers match its numbers."* Three ways that could stop being
true, one check each:

1. Code that ships imports it. Every Python file under `services/`,
   `packages/py/` and `evals/` is scanned, tests included, because a test
   helper imported by a runtime module is how a test dependency becomes a
   runtime one. The only file allowed to import it is `scripts/mitiq_parity.py`,
   which ships in no image.
2. A dependency list names it. Every `pyproject.toml` in the workspace.
3. The lock resolves it. `uv.lock` is what `services/api/Dockerfile` installs
   from, so a package in it is one `--no-dev` away from the image; Mitiq cannot
   be in it at all (the parity script's docstring says why).

The scanner is checked against a planted import first, so an empty result means
"nothing imports Mitiq" and not "the pattern cannot match".
"""

from __future__ import annotations

import importlib.util
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]

_IMPORT = re.compile(r"^\s*(?:import\s+mitiq\b|from\s+mitiq\b)", re.MULTILINE)
_DYNAMIC = re.compile(r"""import_module\(\s*["']mitiq""")

SCANNED = ("services", "packages/py", "evals")
ALLOWED = {ROOT / "scripts" / "mitiq_parity.py"}


def _imports_mitiq(text: str) -> bool:
    return bool(_IMPORT.search(text) or _DYNAMIC.search(text))


def _python_files():
    for top in SCANNED:
        for path in (ROOT / top).rglob("*.py"):
            if any(part in {".venv", "node_modules", "__pycache__"} for part in path.parts):
                continue
            yield path


def test_the_scanner_sees_a_planted_import():
    assert _imports_mitiq("import mitiq\n")
    assert _imports_mitiq("x = 1\n    from mitiq.zne import scaling\n")
    # Split so this line is not itself a dynamic import the scan would flag.
    assert _imports_mitiq("importlib.import_module(" + "'mitiq.rem')\n")
    # ...and not a mention in prose, which this very file is full of.
    assert not _imports_mitiq("# use Mitiq only in tests\n")
    assert not _imports_mitiq('"""mitiq is not imported here"""\n')


def test_the_scan_covers_the_code_that_ships():
    files = {path.relative_to(ROOT).as_posix() for path in _python_files()}
    # A scan that silently found nothing would pass the test below.
    assert "packages/py/qpu/src/majorana_qpu/mitigation.py" in files
    assert "packages/py/qpu/src/majorana_qpu/ibm.py" in files
    assert "services/worker/src/majorana_worker/handlers.py" in files
    assert "services/api/src/majorana_api/routes/qpu.py" in files


def test_nothing_that_ships_imports_mitiq():
    offenders = [
        path.relative_to(ROOT).as_posix()
        for path in _python_files()
        if path not in ALLOWED and _imports_mitiq(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []


def test_the_parity_script_is_where_mitiq_runs():
    assert _imports_mitiq((ROOT / "scripts" / "mitiq_parity.py").read_text(encoding="utf-8"))


def _dependency_strings(document: dict) -> list[str]:
    project = document.get("project", {})
    found = list(project.get("dependencies", []))
    for extra in project.get("optional-dependencies", {}).values():
        found.extend(extra)
    for group in document.get("dependency-groups", {}).values():
        found.extend(item for item in group if isinstance(item, str))
    return found


def test_no_pyproject_depends_on_mitiq():
    manifests = [ROOT / "pyproject.toml", *ROOT.glob("services/*/pyproject.toml")]
    manifests += [*ROOT.glob("packages/py/*/pyproject.toml"), *ROOT.glob("evals/*/pyproject.toml")]
    assert ROOT / "packages/py/qpu/pyproject.toml" in manifests
    named = {
        manifest.relative_to(ROOT).as_posix(): requirement
        for manifest in manifests
        for requirement in _dependency_strings(tomllib.loads(manifest.read_text()))
        if re.match(r"^\s*mitiq\b", requirement, re.IGNORECASE)
    }
    assert named == {}


def test_the_lock_does_not_resolve_mitiq():
    lock = (ROOT / "uv.lock").read_text()
    assert '\nname = "qiskit"\n' in lock  # the pattern below is the right shape
    assert '\nname = "mitiq"\n' not in lock


def test_mitiq_is_not_importable_in_the_environment_the_tests_run_in():
    """This environment is the runtime's plus the dev group, so a Mitiq found
    here came from somewhere the lock does not describe."""
    assert importlib.util.find_spec("mitiq") is None
