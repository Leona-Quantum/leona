"""Repository-wide Alembic graph invariants.

This test is deliberately static as well as Alembic-backed.  Alembic warns on
duplicate revision identifiers but can still construct a partial graph, which
allowed the feature/dev 0046 and 0047 collision to reach branch CI.
"""

from __future__ import annotations

import ast
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[3]
VERSIONS = ROOT / "db" / "migrations" / "versions"


def _literal_assignment(path: Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{path.name} does not assign {name}")


def test_migration_revision_ids_are_unique_resolved_and_single_headed():
    by_revision: dict[str, Path] = {}
    parents: dict[str, tuple[str, ...]] = {}

    for path in sorted(VERSIONS.glob("*.py")):
        revision = _literal_assignment(path, "revision")
        assert isinstance(revision, str) and revision, path
        assert revision not in by_revision, (
            f"duplicate Alembic revision {revision!r}: {by_revision.get(revision)} and {path}"
        )
        by_revision[revision] = path

        down_revision = _literal_assignment(path, "down_revision")
        if down_revision is None:
            parents[revision] = ()
        elif isinstance(down_revision, str):
            parents[revision] = (down_revision,)
        else:
            assert isinstance(down_revision, tuple) and all(
                isinstance(value, str) and value for value in down_revision
            ), path
            parents[revision] = down_revision

    missing = {
        (revision, parent)
        for revision, revision_parents in parents.items()
        for parent in revision_parents
        if parent not in by_revision
    }
    assert not missing, f"unresolved Alembic down_revision references: {sorted(missing)!r}"

    referenced = {parent for values in parents.values() for parent in values}
    static_heads = sorted(set(by_revision) - referenced)
    assert static_heads == ["vqe_reconcile_0056"]

    expected_vqe_chain = {
        "vqe_0046": ("0045",),
        "vqe_0047": ("vqe_0046",),
        "vqe_0048": ("vqe_0047",),
        "vqe_0049": ("vqe_0048",),
        "vqe_0050": ("vqe_0049",),
        "vqe_0051": ("vqe_0050",),
        "vqe_0052": ("vqe_0051",),
        "vqe_0053": ("vqe_0052",),
        # Kept addressable for databases stamped by the historical feature graph.
        "0054": ("vqe_0053",),
        "vqe_merge_0055": ("0048", "0054"),
        "vqe_reconcile_0056": ("vqe_merge_0055",),
    }
    assert {revision: parents[revision] for revision in expected_vqe_chain} == expected_vqe_chain

    config = Config(str(ROOT / "db" / "alembic.ini"))
    assert sorted(ScriptDirectory.from_config(config).get_heads()) == static_heads
