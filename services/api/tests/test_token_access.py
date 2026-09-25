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
READ_AND_HARDWARE = frozenset({str(TokenScope.READ), str(TokenScope.HARDWARE)})
READ_RUN_AND_HARDWARE = frozenset(
    {str(TokenScope.READ), str(TokenScope.RUN), str(TokenScope.HARDWARE)}
)

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

    Checked against the WIDEST token a person can mint (`READ_RUN_AND_HARDWARE`, since
    ai-ops 376 added a third scope) — this sweep is about whether a route has a way in
    at all, not about which scope it needs; the scope-specific half (hardware needs
    `hardware`, not merely `run`) is `test_a_hardware_token_may_submit_but_neither_a_
    read_nor_a_run_only_token_may` below.
    """
    allowed = token_access.READ_WRITES | token_access.RUN_WRITES | token_access.HARDWARE_WRITES
    for method, path in _templates():
        if method not in _WRITE_METHODS:
            continue
        template = _template_without_prefix(path)
        refusal = token_access.check(method, template, path, READ_RUN_AND_HARDWARE)
        if (method, template) in allowed:
            assert refusal is None, f"{method} {path} is allowlisted but refused"
        else:
            assert refusal is not None, (
                f"{method} {path} is reachable by a token and is in no allowlist. "
                "If that is intended, add it to token_access.READ_WRITES or RUN_WRITES "
                "with the reason; if not, this test just caught it."
            )


def test_a_hardware_token_may_submit_but_neither_a_read_nor_a_run_only_token_may():
    """The deferral's resolution (ai-ops 376, option 2): hardware is now grantable,
    but ONLY by its own scope — not by `run`, and not by `read` alone.

    Three calls, three different outcomes, because that is the whole shape of the
    ruling: a `hardware` token may submit; a `read`-only token is refused with
    INSUFFICIENT_SCOPE (fixable by minting a wider token); and — the case that would
    silently reintroduce the old conflation — a `run`-only token, which can already
    start Leona's own verified runs, is ALSO refused with INSUFFICIENT_SCOPE rather
    than let through on the strength of `run`. `TokenScope` closing at three members
    (not two) is asserted here too, so a fourth appearing later is caught by this
    file rather than discovered in production.
    """
    template, path = "/qpu/submissions", "/v1/qpu/submissions"

    assert token_access.check("POST", template, path, READ_AND_HARDWARE) is None

    read_only = token_access.check("POST", template, path, READ_ONLY)
    assert read_only is not None
    assert read_only.reason == token_access.INSUFFICIENT_SCOPE

    run_only = token_access.check("POST", template, path, READ_AND_RUN)
    assert run_only is not None
    assert run_only.reason == token_access.INSUFFICIENT_SCOPE

    assert {str(scope) for scope in TokenScope} == {"read", "run", "hardware"}
    assert ("POST", template) in token_access.HARDWARE_WRITES
    assert ("POST", template) not in token_access.RUN_WRITES
    assert ("POST", template) not in token_access.READ_WRITES


def test_hardware_does_not_widen_what_a_run_token_could_already_reach():
    """The other direction of the same independence: minting `hardware` on top of
    `run` must not be required for, or accidentally required by, anything `run`
    already does alone. `RUN_WRITES` is swept with a `hardware`-only token (no
    `run`) and every entry must still refuse — hardware access is not a backdoor
    into starting runs."""
    hardware_only = frozenset({str(TokenScope.READ), str(TokenScope.HARDWARE)})
    for method, template in sorted(token_access.RUN_WRITES):
        refusal = token_access.check(method, template, f"/v1{template}", hardware_only)
        assert refusal is not None, f"{method} {template} was reachable by hardware alone"
        assert refusal.reason == token_access.INSUFFICIENT_SCOPE


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


def test_a_run_token_may_call_a_qapp_as_an_api_but_a_read_token_may_not():
    """ai-ops 349 option 2's "call it as an API" line, named explicitly rather than
    left to ride on the generic sweep above: a future edit that dropped this one
    entry from `RUN_WRITES` would still pass every OTHER test in this file, because
    the census and the run-token sweep only prove properties of whatever the set
    happens to contain, never that this particular route is in it.
    """
    template = "/qapps/{slug}/executions"
    path = "/v1/qapps/bell-pair-abc123/executions"
    assert (("POST", template)) in token_access.RUN_WRITES

    assert token_access.check("POST", template, path, READ_AND_RUN) is None

    refusal = token_access.check("POST", template, path, READ_ONLY)
    assert refusal is not None
    # Fixable by minting a wider token, not "sign in on the website instead" — the
    # same distinction `test_a_read_token_may_read_and_estimate_but_not_start_a_run`
    # pins for `/runs`.
    assert refusal.reason == token_access.INSUFFICIENT_SCOPE


def test_a_run_token_may_check_a_circuit_but_a_read_token_may_not():
    """The agent connector's `check_circuit` (ai-ops 382 option 1), named rather than
    left to the generic sweeps, for the reason the Qapp test above gives: those sweeps
    prove properties of whatever the sets contain, never that this route is in one.

    `run`, not `read`, although the route stores nothing like `/estimates/logical`
    (which IS in `READ_WRITES`): a check parses and simulates the caller's circuit and
    its broken copies on Leona's CPU, which is spending compute on the caller's behalf.
    """
    template, path = "/checks/circuit", "/v1/checks/circuit"
    assert ("POST", template) in token_access.RUN_WRITES
    assert ("POST", template) not in token_access.READ_WRITES

    assert token_access.check("POST", template, path, READ_AND_RUN) is None

    refusal = token_access.check("POST", template, path, READ_ONLY)
    assert refusal is not None
    assert refusal.reason == token_access.INSUFFICIENT_SCOPE

    hardware_only = token_access.check("POST", template, path, READ_AND_HARDWARE)
    assert hardware_only is not None
    assert hardware_only.reason == token_access.INSUFFICIENT_SCOPE


@pytest.mark.parametrize(
    ("method", "template", "path"),
    [
        ("POST", "/notebooks", "/v1/notebooks"),
        ("POST", "/notebooks/import", "/v1/notebooks/import"),
        ("POST", "/notebooks/{notebook_id}/turns", "/v1/notebooks/nb1/turns"),
        ("POST", "/notebooks/{notebook_id}/run", "/v1/notebooks/nb1/run"),
        ("POST", "/notebooks/{notebook_id}/versions", "/v1/notebooks/nb1/versions"),
        ("POST", "/notebooks/{notebook_id}/attempts", "/v1/notebooks/nb1/attempts"),
        ("POST", "/courses/{course_id}/generate", "/v1/courses/c1/generate"),
    ],
    ids=[
        "generate",
        "import",
        "turn",
        "rerun",
        "authored-version",
        "graded-attempt",
        "course-generate",
    ],
)
def test_each_new_run_write_is_allowed_with_run_and_refused_with_only_read(method, template, path):
    """The Bridge lane's ai-ops 362 addition, one entry at a time — named
    explicitly, like `test_a_run_token_may_call_a_qapp_as_an_api_but_a_read_token_
    may_not` above, so dropping ONE of these seven entries from `RUN_WRITES` fails
    THIS test rather than hiding inside the generic sweep in
    `test_a_run_token_may_start_and_cancel_a_run`, which only proves properties of
    whatever the set happens to contain.

    Mutation check performed by hand: removed `("POST", "/notebooks/import")` from
    `RUN_WRITES`, saw the `import` case go red with every other case still green,
    restored it; repeated for `("POST", "/courses/{course_id}/generate")` and saw
    the `course-generate` case (and only that one) go red. Both restored before
    this file was committed.
    """
    assert (method, template) in token_access.RUN_WRITES

    assert token_access.check(method, template, path, READ_AND_RUN) is None

    refusal = token_access.check(method, template, path, READ_ONLY)
    assert refusal is not None
    assert refusal.reason == token_access.INSUFFICIENT_SCOPE


@pytest.mark.parametrize(
    ("method", "template", "path"),
    [
        ("DELETE", "/notebooks/{notebook_id}", "/v1/notebooks/nb1"),
        ("PATCH", "/notebooks/{notebook_id}", "/v1/notebooks/nb1"),
        (
            "POST",
            "/notebooks/{notebook_id}/share-links",
            "/v1/notebooks/nb1/share-links",
        ),
        (
            "DELETE",
            "/notebooks/{notebook_id}/share-links/{link_id}",
            "/v1/notebooks/nb1/share-links/l1",
        ),
        ("POST", "/comments", "/v1/comments"),
        ("PATCH", "/comments/{comment_id}", "/v1/comments/c1"),
        ("DELETE", "/comments/{comment_id}", "/v1/comments/c1"),
        ("POST", "/courses", "/v1/courses"),
        ("POST", "/courses/{course_id}/turns", "/v1/courses/c1/turns"),
        ("DELETE", "/courses/{course_id}", "/v1/courses/c1"),
        ("PATCH", "/courses/{course_id}", "/v1/courses/c1"),
    ],
    ids=[
        "delete-notebook",
        "patch-notebook",
        "create-share-link",
        "revoke-share-link",
        "create-comment",
        "patch-comment",
        "delete-comment",
        "create-course",
        "course-turn",
        "delete-course",
        "patch-course",
    ],
)
def test_writes_the_bridge_lane_deliberately_left_out_stay_refused_even_with_run(
    method, template, path
):
    """The other half of the ai-ops 362 change: none of these widened by accident.
    A token making something public (a share link) is an account-level act, not a
    run; deleting/editing a notebook or course is neither reading nor starting a
    run; comments are conversation, not notebook content. Hardware submission
    (`POST /qpu/submissions`) used to be here too — refused outright, no scope
    able to reach it — until ai-ops 376 gave it one; it has its own coverage now,
    in `test_a_hardware_token_may_submit_but_neither_a_read_nor_a_run_only_token_
    may`, because unlike everything still in this list it IS reachable, just not
    by `run` (checked with `READ_AND_RUN` here, which still has no `hardware`).
    """
    assert (method, template) not in token_access.RUN_WRITES
    assert (method, template) not in token_access.READ_WRITES

    refusal = token_access.check(method, template, path, READ_AND_RUN)
    assert refusal is not None
    assert refusal.reason == token_access.FORBIDDEN_ROUTE


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
        ([TokenScope.HARDWARE], ["read", "hardware"]),
        ([TokenScope.HARDWARE, TokenScope.READ], ["read", "hardware"]),
        ([TokenScope.HARDWARE, TokenScope.HARDWARE], ["read", "hardware"]),
        ([TokenScope.RUN, TokenScope.HARDWARE], ["read", "run", "hardware"]),
    ],
    ids=[
        "none",
        "empty",
        "read",
        "run-alone",
        "both",
        "duplicated",
        "hardware-alone",
        "hardware-and-read",
        "hardware-duplicated",
        "run-and-hardware",
    ],
)
def test_every_token_reads_and_run_and_hardware_are_additive(asked, expected):
    """`{run}` and `{hardware}` alone are not things a token can be. The database
    says so too (`ck_personal_access_tokens_scopes`); this is the half that runs
    without one. `run-and-hardware` is the case that would silently regress if
    `normalise_scopes` ever made one imply the other: both must survive
    independently, in the fixed `read, run, hardware` order, and neither
    duplicates."""
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


# ------------------------------------------------------------------ idempotency shape


def test_the_idempotency_hash_covers_what_decides_the_token_and_nothing_else():
    """The three fields that decide what the token IS. A retry differing in any of
    them is a different ask under a used key, which is a 409 and not a replay."""
    base = dict(name="editor", expires_in_days=30, scopes=["read"])
    digest = tokens_repo.idempotency_request_hash(**base)

    # Independent of dict ordering and of the order scopes arrive in.
    assert digest == tokens_repo.idempotency_request_hash(
        scopes=["read"], expires_in_days=30, name="editor"
    )
    assert tokens_repo.idempotency_request_hash(
        name="editor", expires_in_days=30, scopes=["run", "read"]
    ) == tokens_repo.idempotency_request_hash(
        name="editor", expires_in_days=30, scopes=["read", "run"]
    )

    for changed in (
        dict(base, name="a different purpose"),
        dict(base, expires_in_days=31),
        dict(base, scopes=["read", "run"]),
    ):
        assert tokens_repo.idempotency_request_hash(**changed) != digest, changed

    # And the separator does its job: two different splits of the same characters
    # must not collide, which a naive concatenation would allow.
    assert tokens_repo.idempotency_request_hash(
        name="ab", expires_in_days=1, scopes=["read"]
    ) != tokens_repo.idempotency_request_hash(name="a", expires_in_days=1, scopes=["read"])
