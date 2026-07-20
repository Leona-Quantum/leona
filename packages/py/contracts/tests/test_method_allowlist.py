"""The Python enum and the database allowlist are two gates on one value.

Migration 0023's docstring already said they "must widen together". Nothing
enforced it, and the drift it warned about is exactly what happened in the other
direction: six check names the verifier emits every run were never added to
`VerificationMethod`, so `agent_events.py` — which resolves a check's `method`
through that enum and skips a miss — dropped six of the ten checks in the panel
before they reached `run_events`. Production QPE run 019f7f2d-09c9 rejected a
candidate on one of the dropped checks and recorded three passing checks and no
failure anywhere a human could read.

This test makes the pairing mechanical. It parses the newest migration that
rewrites `ck_method_enum` rather than importing it, because alembic revisions are
not importable modules in this test environment.
"""

from __future__ import annotations

import ast
from pathlib import Path

from majorana_contracts.enums import VerificationMethod

_MIGRATIONS = Path(__file__).resolve().parents[4] / "db" / "migrations" / "versions"


def _newest_method_allowlist() -> tuple[Path, frozenset[str]]:
    """The `_METHODS_NEW` tuple of the highest-numbered migration that defines one."""
    candidates = sorted(_MIGRATIONS.glob("0*_*.py"))
    for path in reversed(candidates):
        module = ast.parse(path.read_text())
        for node in module.body:
            if not isinstance(node, ast.Assign):
                continue
            names = {target.id for target in node.targets if isinstance(target, ast.Name)}
            if "_METHODS_NEW" not in names:
                continue
            # `(*_METHODS_OLD, "a", "b")` — resolve the splat against the same
            # module's `_METHODS_OLD`, which is always a literal tuple.
            old = _literal_tuple(module, "_METHODS_OLD")
            values: list[str] = []
            assert isinstance(node.value, ast.Tuple)
            for element in node.value.elts:
                if isinstance(element, ast.Starred):
                    values.extend(old)
                else:
                    values.append(ast.literal_eval(element))
            return path, frozenset(values)
    raise AssertionError("no migration defines _METHODS_NEW")


def _literal_tuple(module: ast.Module, name: str) -> tuple[str, ...]:
    for node in module.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name for target in node.targets
        ):
            return tuple(ast.literal_eval(node.value))
    raise AssertionError(f"{name} not found")


def test_every_enum_member_is_allowed_by_the_database() -> None:
    path, allowed = _newest_method_allowlist()
    missing = {method.value for method in VerificationMethod} - allowed
    assert not missing, (
        f"{sorted(missing)} are VerificationMethod members the database would reject. "
        f"Widen ck_method_enum in a new migration after {path.name}."
    )


def test_the_database_allows_nothing_the_enum_has_dropped() -> None:
    """The reverse direction, so a retired member is retired in both places.

    A value the database accepts but the enum does not is how a check silently
    stops being emitted: nothing fails, the row is just never written.
    """
    path, allowed = _newest_method_allowlist()
    extra = allowed - {method.value for method in VerificationMethod}
    assert not extra, (
        f"{sorted(extra)} are allowed by {path.name} but are not VerificationMethod "
        "members; either restore the member or remove the value in a new migration."
    )
