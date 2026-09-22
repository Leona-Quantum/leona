"""What a personal access token may reach, and the two controls that keep it true.

Proposal 7 Phase B, owner ruling **ai-ops 362 option 1**. `auth/token_access.py` holds
the policy; this file holds the arguments that the policy is still the policy after
somebody adds a route.

Two of these tests are not about a scenario at all. They are **enumeration tests**:
they walk the live OpenAPI schema and the real token generator, so the thing that
fails when this feature rots is a check rather than a customer.
"""

from __future__ import annotations

import hashlib
import re
import tomllib
import uuid
from pathlib import Path

import pytest
from majorana_contracts.tokens import TOKEN_PREFIX, TokenScope

from majorana_api.app import create_app
from majorana_api.auth import token_access
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.settings import Settings

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

READ_ONLY = frozenset({str(TokenScope.READ)})
READ_AND_RUN = frozenset({str(TokenScope.READ), str(TokenScope.RUN)})

_WRITE_METHODS = ("POST", "PATCH", "PUT", "DELETE")


def _templates() -> list[tuple[str, str]]:
    """Every (method, path) the app actually serves under /v1, from its own schema.

    Read from `app.openapi()` rather than by walking `app.routes`: FastAPI 0.121
    resolves routes lazily, so `app.routes` holds `_IncludedRouter` placeholders and
    walking it silently returns almost nothing — which would make every enumeration
    below pass over an empty set. `test_the_route_census_is_not_empty` is the guard
    against exactly that, and it is why it exists.
    """
    spec = create_app(Settings(**SETTINGS_KWARGS)).openapi()
    return [
        (method.upper(), path)
        for path, operations in spec["paths"].items()
        for method in operations
        if method.upper() in ("GET", *_WRITE_METHODS) and path.startswith("/v1/")
    ]


def _template_without_prefix(path: str) -> str:
    """The value FastAPI puts in `scope["route"]`: as the sub-router registered it."""
    return path.removeprefix("/v1")


def test_the_route_census_is_not_empty():
    """A guard on the instrument, not on the product.

    Every enumeration in this file is of the form "for each route, assert something".
    An empty census satisfies all of them vacuously, and that is not a hypothetical:
    walking `app.routes` instead of the schema returns 15 placeholders and 0 usable
    paths on this FastAPI. So the census is asserted to be large before anything is
    concluded from it.
    """
    census = _templates()
    assert len(census) > 100, f"route census is {len(census)}; the enumeration is not looking"
    assert any(method in _WRITE_METHODS for method, _ in census)


def test_every_write_route_is_refused_unless_it_was_deliberately_allowed():
    """The default-shut rule, asserted over the WHOLE route table.

    This is the test that makes "a route added next month is unreachable by every
    existing token" a fact rather than an intention. It fails the moment somebody adds
    a write route AND adds it to an allowlist in `token_access` without thinking, and
    it fails the moment the default stops being refusal.
    """
    allowed = token_access.READ_WRITES | token_access.RUN_WRITES
    for method, path in _templates():
        if method not in _WRITE_METHODS:
            continue
        template = _template_without_prefix(path)
        refusal = token_access.check(method, template, path, READ_AND_RUN)
        if (method, template) in allowed:
            assert refusal is None, f"{method} {path} is allowlisted but refused"
        else:
            assert refusal is not None, (
                f"{method} {path} is reachable by a token and is in no allowlist. "
                "If that is intended, add it to token_access.READ_WRITES or RUN_WRITES "
                "with the reason; if not, this test just caught it."
            )


def test_hardware_submission_is_refused_and_no_scope_can_grant_it():
    """The ruling's deferral: "hardware jobs come later under their own permission".

    Two assertions, because the deferral is enforced twice. The route is refused by the
    default-shut rule even to the widest token that can be minted; and there is no
    scope that could be added to a request to change that, because `TokenScope` has no
    hardware member. The second is what stops a future reader from "fixing" the first
    by inventing a scope string.
    """
    refusal = token_access.check("POST", "/qpu/submissions", "/v1/qpu/submissions", READ_AND_RUN)
    assert refusal is not None
    assert refusal.reason == token_access.FORBIDDEN_ROUTE
    assert {str(scope) for scope in TokenScope} == {"read", "run"}


@pytest.mark.parametrize(
    "template",
    ["/qpu/credentials", "/billing/status", "/tokens"],
    ids=["ibm-key", "billing", "the-tokens-themselves"],
)
def test_the_three_surfaces_the_owner_excluded_are_not_even_readable(template):
    """ "It would never work on the pages that hold their IBM key, billing, or account
    deletion" — ai-ops 362's own background, and the tokens list on top of it, because
    a credential that can enumerate an account's other credentials is reconnaissance.
    """
    refusal = token_access.check("GET", template, f"/v1{template}", READ_AND_RUN)
    assert refusal is not None
    assert refusal.reason == token_access.FORBIDDEN_ROUTE


def test_a_read_token_may_read_and_estimate_but_not_start_a_run():
    assert token_access.check("GET", "/runs", "/v1/runs", READ_ONLY) is None
    assert token_access.check("POST", "/qpu/estimates", "/v1/qpu/estimates", READ_ONLY) is None

    refusal = token_access.check("POST", "/runs", "/v1/runs", READ_ONLY)
    assert refusal is not None
    # A DIFFERENT reason from a forbidden route: this one is fixable by minting a
    # token with more scope, and the person reading the error needs to be told which
    # of the two situations they are in.
    assert refusal.reason == token_access.INSUFFICIENT_SCOPE


def test_a_run_token_may_start_and_cancel_a_run():
    for method, template in sorted(token_access.RUN_WRITES):
        assert token_access.check(method, template, f"/v1{template}", READ_AND_RUN) is None


def test_a_path_outside_the_versioned_api_is_refused_whatever_the_template_says():
    """The mount point is checked, not assumed. A second mount of the same sub-router
    would otherwise let an allowlisted template through at an unreviewed address."""
    refusal = token_access.check("GET", "/runs", "/internal/runs", READ_AND_RUN)
    assert refusal is not None
    assert refusal.reason == token_access.FORBIDDEN_ROUTE


def test_the_gitleaks_rule_matches_a_real_token():
    """The control for the detection rule in `.gitleaks.toml`.

    A suppression that suppresses nothing is harmless; a DETECTION rule that detects
    nothing is a gate reporting clean because it is blind, and this one guards a
    credential no other scanner has in its dictionary. So the regex is run against a
    token from the real generator — not a hand-written lookalike, which is how a rule
    ends up matching only the example somebody typed while writing it.
    """
    config = tomllib.loads(
        (Path(__file__).resolve().parents[3] / ".gitleaks.toml").read_text(encoding="utf-8")
    )
    [rule] = [r for r in config["rules"] if r["id"] == "leona-personal-access-token"]
    pattern = re.compile(rule["regex"])

    for _ in range(50):
        minted = tokens_repo.new_token()
        assert pattern.search(minted), f"the gitleaks rule does not match a real token: {minted!r}"

    # And the negative controls: a rule that matched these would fire on documentation.
    assert not pattern.search(TOKEN_PREFIX)
    assert not pattern.search(f"{TOKEN_PREFIX}tooshort")


def test_a_minted_token_hashes_to_what_the_auth_path_looks_up():
    """Mint and resolve must agree about the digest, or every token is a 401.

    Asserted directly rather than through a request, because a request needs Postgres
    and this property does not: it is that one function's output is the other's key.
    """
    minted = tokens_repo.new_token()
    assert minted.startswith(TOKEN_PREFIX)
    digest = tokens_repo.hash_token(minted)
    # Compared against `hashlib` directly, not against a second call to the same
    # function: `hash_token(x) == hash_token(x)` is true of any pure function at all
    # and would stay green if the digest were md5, or the empty string.
    assert digest == hashlib.sha256(minted.encode("utf-8")).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{64}", digest), "0069's check constraint wants lower-case hex"
    assert tokens_repo.hash_token(minted + "x") != digest


@pytest.mark.parametrize(
    ("asked", "expected"),
    [
        (None, ["read"]),
        ([], ["read"]),
        ([TokenScope.READ], ["read"]),
        ([TokenScope.RUN], ["read", "run"]),
        ([TokenScope.RUN, TokenScope.READ], ["read", "run"]),
        ([TokenScope.RUN, TokenScope.RUN], ["read", "run"]),
    ],
    ids=["none", "empty", "read", "run-alone", "both", "duplicated"],
)
def test_every_token_reads_and_run_is_additive(asked, expected):
    """`{run}` alone is not a thing a token can be. The database says so too
    (`ck_personal_access_tokens_scopes`); this is the half that runs without one."""
    assert tokens_repo.normalise_scopes(asked) == expected


# --------------------------------------------------------------- the scope a token gets


class _FakeMembership:
    def __init__(self, role: str) -> None:
        self.role = role


class _FakeWorkspace:
    def __init__(self, id_) -> None:
        self.id = id_


class _FakeUser:
    def __init__(self, id_) -> None:
        self.id = id_
        self.active_workspace_id = None


async def _scope_for(monkeypatch, token, *, membership=_FakeMembership("owner"), live=True):
    """Run the real `get_scope` with the two database reads stubbed.

    Written without a database on purpose. The live suite proves the same branch
    against Postgres, but it is `skipif`-gated on `DATABASE_URL` and therefore runs
    nowhere a developer can see it — which was measured, not assumed: replacing
    `if token is not None` with `if False` in `get_scope` left every runnable test in
    this service green. A rule whose only check cannot be run locally is a rule that
    gets refactored away between one CI run and the next.
    """
    from majorana_api.auth import deps
    from majorana_api.repos import system

    user = _FakeUser(uuid.UUID("01930000-0000-7000-8000-00000000aaaa"))
    personal = _FakeWorkspace(uuid.UUID("01930000-0000-7000-8000-00000000bbbb"))

    async def _find_membership(_session, *, workspace_id, user_id):
        return membership

    async def _find_live_workspace(_session, *, workspace_id):
        return _FakeWorkspace(workspace_id) if live else None

    async def _resolve_active(_session, *, user, personal_workspace_id):
        return system.ActiveWorkspace(workspace_id=personal_workspace_id, role="owner")

    async def _set_rls(*_args, **_kwargs):
        return None

    monkeypatch.setattr(system, "find_membership", _find_membership)
    monkeypatch.setattr(system, "find_live_workspace", _find_live_workspace)
    monkeypatch.setattr(system, "resolve_active_workspace", _resolve_active)
    monkeypatch.setattr(deps, "set_rls_context", _set_rls)

    return await deps.get_scope(
        identity=(user, personal),
        session=object(),
        settings=Settings(**SETTINGS_KWARGS),
        token=token,
    )


def _token(workspace_id: uuid.UUID):
    from majorana_api.auth.deps import PresentedToken

    return PresentedToken(
        id=uuid.UUID("01930000-0000-7000-8000-00000000cccc"),
        user_id=uuid.UUID("01930000-0000-7000-8000-00000000aaaa"),
        workspace_id=workspace_id,
        scopes=READ_ONLY,
    )


async def test_a_token_scopes_the_request_to_the_workspace_it_was_minted_in(monkeypatch):
    """Not the caller's active workspace, which is what a browser session would get.

    The two ids differ here on purpose: a `get_scope` that ignored the token entirely
    would return the personal workspace and look perfectly healthy.
    """
    minted_in = uuid.UUID("01930000-0000-7000-8000-00000000dddd")
    scope = await _scope_for(monkeypatch, _token(minted_in))
    assert scope.workspace_id == minted_in

    # And the control: no token, and the same call resolves the browser's way.
    browser = await _scope_for(monkeypatch, None)
    assert browser.workspace_id == uuid.UUID("01930000-0000-7000-8000-00000000bbbb")


@pytest.mark.parametrize(
    ("membership", "live"),
    [(None, True), (_FakeMembership("owner"), False)],
    ids=["no-longer-a-member", "workspace-deleted"],
)
async def test_a_token_whose_workspace_is_gone_is_refused_not_redirected(
    monkeypatch, membership, live
):
    """404, and specifically NOT a quiet fall back to the personal workspace.

    `resolve_active_workspace` does fall back, deliberately, because locking a person
    out of their own account is worse. For a token the trade runs the other way: a
    silent move would keep an automation working while writing into a tenant nobody
    pointed it at.
    """
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as raised:
        await _scope_for(
            monkeypatch,
            _token(uuid.UUID("01930000-0000-7000-8000-00000000dddd")),
            membership=membership,
            live=live,
        )
    assert raised.value.status_code == 404
