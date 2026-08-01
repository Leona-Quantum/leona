"""Every tier decision reads BOTH allowlists, because it goes through one helper.

`resolve_tier` takes `developer_emails` and `team_emails` as separate defaulted
keyword arguments. A caller that passes one and forgets the other gets a tier
that is wrong in the quietest possible direction: a Team account resolved as
free, refused at limits it does not have and denied sharing it paid for, with
nothing raising anywhere and every existing test green.

Adding the team allowlist gave seven existing call sites the chance to make
exactly that mistake. This is the gate that stops an eighth — a source scan, so
it fails on the line being written rather than on the behaviour that line breaks
three releases later.

Deliberately a scan and not a type: Python has no typecheck step in this
repository's CI (confirmed — no mypy or pyright job in .github/workflows), so a
signature cannot enforce this on its own.
"""

import ast
import pathlib

import pytest

SERVICES = pathlib.Path(__file__).resolve().parents[3] / "services"

#: Modules allowed to call `resolve_tier` directly, each with the reason.
#: Empty of production code on purpose — every entry here is a place the gate
#: below cannot help.
ALLOWED = {
    # Defines it.
    "api/src/majorana_api/tiers.py": "the resolver and `tier_of` itself live here",
}


def _python_sources() -> list[pathlib.Path]:
    return [
        path
        for path in SERVICES.rglob("*.py")
        # Tests vary one input at a time on purpose; the rule is about the
        # code that runs in production.
        if "/tests/" not in path.as_posix()
    ]


def _direct_calls(path: pathlib.Path) -> list[int]:
    """Line numbers of `resolve_tier(...)` calls in this file."""
    tree = ast.parse(path.read_text(), filename=str(path))
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = (
            func.id
            if isinstance(func, ast.Name)
            else func.attr
            if isinstance(func, ast.Attribute)
            else None
        )
        if name == "resolve_tier":
            lines.append(node.lineno)
    return lines


def test_tier_resolution_goes_through_one_helper():
    offenders = []
    for path in _python_sources():
        relative = path.relative_to(SERVICES).as_posix()
        if relative in ALLOWED:
            continue
        for line in _direct_calls(path):
            offenders.append(f"{relative}:{line}")
    assert not offenders, (
        "these call `resolve_tier` directly instead of `tiers.tier_of`, and so "
        "decide a tier from whichever allowlists they remembered to pass: "
        f"{offenders}. Use `tier_of(account, settings)`; in the worker, "
        "`tier_of(user, EnvTierSources.from_env())`."
    )


def test_the_scan_can_actually_find_something(tmp_path):
    """Positive control. Without it, a scan that parses nothing passes."""
    planted = tmp_path / "planted.py"
    planted.write_text(
        "from x import resolve_tier\n\n\ndef f(u):\n    return resolve_tier(u.email)\n"
    )
    assert _direct_calls(planted) == [5]


def test_the_scan_reads_a_real_file_tree():
    """And a second control: the scan must be looking at actual sources.

    A `SERVICES` path that resolved wrong would make the gate above vacuous —
    zero files scanned is zero offenders found.
    """
    sources = _python_sources()
    assert len(sources) > 20, f"only {len(sources)} sources found under {SERVICES}"
    assert any(p.name == "tiers.py" for p in sources), SERVICES


@pytest.mark.parametrize("relative", sorted(ALLOWED))
def test_every_exemption_still_exists(relative):
    """An exemption for a file that has moved is an exemption for nothing."""
    assert (SERVICES / relative).is_file(), f"{relative} is exempted but is not there"
