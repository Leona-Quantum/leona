"""Every tier decision reads EVERY allowlist, because it goes through one helper.

`resolve_tier` takes `developer_emails`, `team_emails` and `pro_emails` as
separate defaulted keyword arguments. A caller that passes two and forgets the
third gets a tier that is wrong in the quietest possible direction: a paid
account resolved as free, refused at limits it does not have and denied sharing
it paid for, with nothing raising anywhere and every existing test green.

Adding the team allowlist gave seven existing call sites the chance to make
exactly that mistake. This is the gate that stops an eighth — a source scan, so
it fails on the line being written rather than on the behaviour that line breaks
three releases later.

Adding the PRO allowlist put the same hazard one level up, in `tier_of` itself:
a helper that forwards two of three lists is a single place where every call
site is quietly wrong. So there are now two gates here — the scan, and a
behavioural check that each list actually reaches a tier — plus the wiring test
that the two `from_env` readers name the same variables.

Deliberately a scan and not a type: Python has no typecheck step in this
repository's CI (confirmed — no mypy or pyright job in .github/workflows), so a
signature cannot enforce this on its own.
"""

import ast
import inspect
import pathlib
import types

import pytest

from majorana_api.settings import Settings
from majorana_api.tiers import (
    TIER_ALLOWLIST_ENV,
    EnvTierSources,
    TierSources,
    resolve_tier,
    tier_of,
)

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


# --- and the helper itself forwards all of them ------------------------------


def _allowlist_parameters() -> set[str]:
    """The `*_emails` keywords `resolve_tier` accepts, read off the signature."""
    return {
        name
        for name in inspect.signature(resolve_tier).parameters
        if name.endswith("_emails") and name != "email"
    }


def test_the_resolver_the_protocol_and_the_env_table_name_the_same_allowlists():
    """Three lists of names that have to agree, compared instead of trusted.

    `resolve_tier`'s keywords, `TierSources`' attributes and `TIER_ALLOWLIST_ENV`
    are written in three places, and the failure when they drift is not an error
    — it is an allowlist that is read from the environment and then never passed
    to anything, or passed and never read from the environment.
    """
    parameters = _allowlist_parameters()
    assert parameters == set(TIER_ALLOWLIST_ENV), (
        "resolve_tier's allowlists and TIER_ALLOWLIST_ENV disagree: "
        f"{parameters ^ set(TIER_ALLOWLIST_ENV)}"
    )
    assert set(TierSources.__annotations__) == parameters
    assert {field for field in EnvTierSources.__dataclass_fields__} == parameters


@pytest.mark.parametrize("allowlist", sorted(TIER_ALLOWLIST_ENV))
def test_tier_of_reads_every_allowlist(allowlist):
    """Each list, alone, moves an account off free — through `tier_of`.

    The scan above stops a call site from resolving a tier itself. This stops
    the other half: `tier_of` forwarding two of three lists, which would make
    every call site wrong at once and break nothing that raises. Parametrized
    over the env table, so a fourth allowlist is covered the moment it is
    declared rather than when somebody remembers to add a case.
    """
    subject = "someone@allowlisted.test"
    sources = types.SimpleNamespace(
        **{
            field: frozenset({subject} if field == allowlist else ())
            for field in TIER_ALLOWLIST_ENV
        }
    )
    account = types.SimpleNamespace(email=subject, plan="free")

    assert tier_of(account, sources) != "free", (
        f"{allowlist} reached tier_of and changed nothing; the account it names "
        "is metered as free, and nothing anywhere fails"
    )
    # And an address on none of them is still free, so the assertion above is
    # about this list rather than about `tier_of` granting something to anyone.
    empty = types.SimpleNamespace(**{field: frozenset() for field in TIER_ALLOWLIST_ENV})
    assert tier_of(account, empty) == "free"


def test_settings_carries_every_allowlist_the_resolver_reads():
    """`Settings` IS a `TierSources` — every route passes it as one.

    A field missing here is not a type error anywhere in this repository; it is
    an AttributeError inside `tier_of`, on a request, in production.
    """
    settings = Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
    )
    for field in TIER_ALLOWLIST_ENV:
        assert getattr(settings, field) == frozenset()


def test_both_env_readers_read_the_same_variables(monkeypatch):
    """The API's `Settings.from_env` and the worker's `EnvTierSources.from_env`.

    Two services, two readers, one set of variable names — which is the whole
    point of `TIER_ALLOWLIST_ENV`. When they disagreed the symptom was a Team
    account that could share from the web app and got a 403 from the control
    plane, or a run refused in the worker alone.
    """
    for field, variable in TIER_ALLOWLIST_ENV.items():
        monkeypatch.setenv(variable, f"{field}@env.test")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_test")
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.delenv("MAJORANA_LOCAL_DEV_AUTH", raising=False)

    settings = Settings.from_env()
    worker = EnvTierSources.from_env()
    for field in TIER_ALLOWLIST_ENV:
        expected = frozenset({f"{field}@env.test"})
        assert getattr(settings, field) == expected, field
        assert getattr(worker, field) == expected, field
