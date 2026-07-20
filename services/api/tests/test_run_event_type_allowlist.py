"""The event contract and the database allowlist must name the same event types.

A new run event has to be declared twice — once in `majorana_contracts.events` and
once in a migration widening `run_events.ck_type_enum` — and until 2026-07-20
nothing checked that both happened. `run.best_effort` shipped in #96 with only the
first, and the first production run that reached it dead-lettered on the INSERT:
"the loop had no passing candidate" became "the job died", which is strictly worse
than the behaviour the event was added to improve.

A comment saying "remember the migration" would not have caught it. This does.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
from majorana_contracts.events import RunEvent
from typing import get_args

MIGRATIONS = Path(__file__).resolve().parents[3] / "db" / "migrations" / "versions"


def _contract_event_types() -> set[str]:
    """Every `type` Literal in the discriminated RunEvent union."""
    # RunEvent is Annotated[A | B | ..., Field(discriminator=...)]; the first arg
    # is the union, and each member pins its own `type` Literal default.
    union = get_args(RunEvent)[0]
    return {member.model_fields["type"].default for member in get_args(union)}


def _rewrites_the_constraint(path: Path) -> bool:
    """True when the migration actually installs an event-type allowlist.

    Naming the constraint is not enough: a later migration that merely mentions
    `ck_type_enum` in a comment or docstring would otherwise be selected as the
    newest one and take an empty allowlist with it. Requiring a real
    `create_check_constraint` call plus a module-level event-type tuple keeps the
    selection tied to the thing being read.
    """
    source = path.read_text()
    return (
        "ck_type_enum" in source
        and "create_check_constraint" in source
        and bool(_event_type_tuples(ast.parse(source)))
    )


def _latest_allowlist_migration() -> Path:
    """The highest-numbered migration that rewrites the event-type constraint."""
    touching = [
        path for path in sorted(MIGRATIONS.glob("[0-9]*.py")) if _rewrites_the_constraint(path)
    ]
    assert touching, "no migration installs an event-type allowlist"
    return touching[-1]


def _allowlist_from(path: Path) -> set[str]:
    """The set of event types the migration's upgrade() installs.

    Read from the source rather than executed: importing a migration pulls in
    alembic's op context, which is not bound outside a live migration run.

    The migrations name their event types in module-level tuples, and the newer
    ones build the post-upgrade set by splatting the pre-upgrade one
    (`_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "run.best_effort")`), so the splat
    has to be resolved — reading literals alone makes the "new" tuple look like a
    single element and picks the wrong set. The widest resolved tuple is the
    post-upgrade allowlist: a migration that adds a value always leaves the new
    set larger than the old one it also names.
    """
    named = _event_type_tuples(ast.parse(path.read_text()))
    assert named, f"{path.name} names no event-type tuple"
    return max(named.values(), key=len)


def _event_type_tuples(module: ast.Module) -> dict[str, set[str]]:
    """Module-level `*EVENT_TYPES*` tuples, with `*splat` references resolved."""
    named: dict[str, set[str]] = {}
    for node in module.body:
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Tuple):
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name) or "EVENT_TYPES" not in target.id:
            continue
        values: set[str] = set()
        for element in node.value.elts:
            if isinstance(element, ast.Constant) and isinstance(element.value, str):
                values.add(element.value)
            elif isinstance(element, ast.Starred) and isinstance(element.value, ast.Name):
                values |= named.get(element.value.id, set())
        if values:
            named[target.id] = values
    return named


def test_every_contract_event_type_is_allowed_by_the_database():
    missing = _contract_event_types() - _allowlist_from(_latest_allowlist_migration())
    assert not missing, (
        f"{sorted(missing)} exist in majorana_contracts.events but no migration "
        f"adds them to run_events.ck_type_enum — writing one will fail at runtime. "
        f"Add a migration widening the constraint (see 0021 for the pattern)."
    )


def test_the_database_allows_nothing_the_contract_cannot_produce():
    """The other direction: a value the constraint permits but nothing emits is a
    retired event, and should be found deliberately rather than by surprise."""
    extra = _allowlist_from(_latest_allowlist_migration()) - _contract_event_types()
    assert not extra, (
        f"{sorted(extra)} are allowed by run_events.ck_type_enum but no event in "
        f"majorana_contracts.events emits them."
    )


@pytest.mark.parametrize("name", ["run.best_effort", "run.mode_resolved", "run.finished"])
def test_known_event_types_are_present_on_both_sides(name: str):
    """Pins the specific value that shipped broken, so the general check above
    cannot pass vacuously if either reader silently returns an empty set."""
    assert name in _contract_event_types()
    assert name in _allowlist_from(_latest_allowlist_migration())


def test_the_migration_reader_actually_found_a_constraint():
    """Guards the guard: a parser that silently found nothing would make both
    directional assertions above trivially true."""
    path = _latest_allowlist_migration()
    assert re.search(r"ck_type_enum", path.read_text())
    assert len(_allowlist_from(path)) > 20


def test_a_later_migration_merely_mentioning_the_constraint_is_not_selected(tmp_path):
    """A migration that names ck_type_enum in prose must not shadow the one that
    actually installs the allowlist (CodeRabbit, PR #97)."""
    decoy = MIGRATIONS / "9999_decoy_for_test.py"
    decoy.write_text('"""Adds an index. Does not touch ck_type_enum."""\nrevision = "9999"\n')
    try:
        assert _latest_allowlist_migration() != decoy
        assert "run.best_effort" in _allowlist_from(_latest_allowlist_migration())
    finally:
        decoy.unlink()
