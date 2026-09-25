"""`POST /v1/checks/circuit`: the agent connector's `check_circuit`, end to end.

DB-free on purpose. The route stores nothing, and the token path's two database reads
(resolving the token, provisioning the user) are stubbed at the repository functions the
real auth chain calls, so `get_verified_token` -> `token_access.check` -> `get_identity`
-> `get_scope` all run as in production. `authz/test_check_circuit_token_access_live.py`
proves the same token outcomes against real Postgres; it is skipped wherever
`DATABASE_URL` is unset, which is every developer machine, so this file is the one that
runs on them.

Judging happens in the check engine's child process (`judge_checks`). Every test here runs
with every OpenQASM parser in THIS process made to raise (`_this_process_never_parses`),
which is the rule: the API never parses a caller's program itself. Circuits are at most 13
qubits and mostly 2-3; the refusal cases are sized so that even a regressed guard would
build something small (a hundred thousand qubits, not a hundred million), because on macOS
the child's memory cap is not enforced.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import anyio
import httpx
import pytest
from leona_notebooks.checks import (
    CHECK_BUDGET_S,
    MAX_CAPTURE_QASM_CHARS,
    MUTATION_MAX_QUBITS_STATE,
    MUTATION_MAX_QUBITS_UNITARY,
)
from majorana_contracts import MAX_CIRCUIT_CHECK_QASM_CHARS, Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TOKEN_PREFIX

from majorana_api import circuit_check
from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import system
from majorana_api.routes import checks as checks_routes
from majorana_api.settings import Settings

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

HEADER = 'OPENQASM 3.0;\ninclude "stdgates.inc";\n'
BELL = HEADER + "qubit[2] q;\nh q[0];\ncx q[0], q[1];\n"
#: Qiskit's QFT on 3 qubits, written out by hand: the rotations, then the final swap
#: that puts the output back in Qiskit's qubit order.
QFT3_ROTATIONS = (
    HEADER + "qubit[3] q;\nh q[2];\ncp(pi/2) q[1], q[2];\ncp(pi/4) q[0], q[2];\n"
    "h q[1];\ncp(pi/2) q[0], q[1];\nh q[0];\n"
)
QFT3 = QFT3_ROTATIONS + "swap q[0], q[2];\n"


def _doubling_chain(depth: int) -> str:
    """`g0` is one gate; each `gN` calls `g(N-1)` twice, so `g{depth}` is 2**depth."""
    lines = ["qubit[1] q;", "gate g0 a { h a; }"]
    lines += [f"gate g{i} a {{ g{i - 1} a; g{i - 1} a; }}" for i in range(1, depth + 1)]
    return HEADER + "\n".join([*lines, f"g{depth} q[0];"]) + "\n"


STATE_BELL = {"kind": "state", "subject": "circuit", "reference": "bell"}
UNITARY_QFT3 = {"kind": "unitary", "subject": "circuit", "reference": "qft(3)"}


def _body(qasm: str, prop: dict) -> dict:
    return {"qasm": qasm, "property": prop}


@pytest.fixture(autouse=True)
def _this_process_never_parses(monkeypatch):
    """Every OpenQASM 3 parser this test process could reach raises if called, for every
    test in this file. The route's judging happens in the engine's child process, which
    these patches cannot reach, so the tests pass only while that stays true: a route
    that parsed the caller's program in the API process (where a slow path cannot be
    killed) would fail every test here, not just one."""
    import openqasm3
    import qiskit.qasm3
    import qiskit_qasm3_import

    def refuse(*_args, **_kwargs):
        raise AssertionError("the API process parsed a caller's OpenQASM itself")

    monkeypatch.setattr(openqasm3, "parse", refuse)
    monkeypatch.setattr(qiskit_qasm3_import, "parse", refuse)
    monkeypatch.setattr(qiskit_qasm3_import, "convert", refuse)
    monkeypatch.setattr(qiskit.qasm3, "loads", refuse)


# --------------------------------------------------------------------------- the limits


def test_the_circuit_ceiling_is_the_notebook_capture_ceiling():
    """The contract restates `MAX_CAPTURE_QASM_CHARS` (it may import nothing internal);
    this is what keeps the two from drifting apart."""
    assert MAX_CIRCUIT_CHECK_QASM_CHARS == MAX_CAPTURE_QASM_CHARS


def test_the_route_spends_no_more_than_a_notebook_run_and_judges_only_what_it_can_mutate():
    assert circuit_check.CIRCUIT_CHECK_BUDGET_S <= CHECK_BUDGET_S
    assert circuit_check.CIRCUIT_CHECK_BUDGET_S <= circuit_check.CIRCUIT_CHECK_KILL_AFTER_S
    # Under the client's 60 s urllib timeout, with room for a queue of one.
    assert circuit_check.CIRCUIT_CHECK_KILL_AFTER_S <= 20
    assert circuit_check.MAX_QUBITS == {
        "state": MUTATION_MAX_QUBITS_STATE,
        "distribution": MUTATION_MAX_QUBITS_STATE,
        "energy": 10,
        "unitary": MUTATION_MAX_QUBITS_UNITARY,
    }
    # One child at a time per API process: ~145 MiB app + ~120 MiB child + 150 MiB
    # headroom fits a 512 MiB instance once (API_MEMORY_MI=512 in infra/fleet.env).
    assert checks_routes.CIRCUIT_CHECK_CONCURRENCY == 1
    assert circuit_check.CHILD_MEMORY_HEADROOM_BYTES <= 150 * 2**20


# --------------------------------------------------------------------------- session caller


@pytest.fixture
def scope() -> Scope:
    return Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=Role.OWNER)


def _session_client(scope: Scope, **settings) -> httpx.AsyncClient:
    """A signed-in browser's request: the scope dependency answers directly."""
    app = create_app(Settings(**{**SETTINGS_KWARGS, **settings}))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_a_passing_check_comes_back_with_its_teeth_measured(scope):
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(BELL, STATE_BELL))
    assert response.status_code == 200, response.text
    verdict = response.json()["verdict"]
    assert verdict["status"] == "pass"
    assert verdict["basis"] == "circuit"
    assert verdict["checked_against"].startswith("the Bell state")
    assert verdict["qubits"] == 2
    teeth = verdict["teeth"]
    assert teeth["status"] == "measured"
    # Three broken copies change the Bell state and all three are caught; the fourth
    # (the reversed-order copy) makes the same symmetric state and is left out.
    assert (teeth["mutants"], teeth["caught"], teeth["equivalent"]) == (3, 3, 1)


async def test_a_qft_missing_its_final_swap_fails_with_that_diagnosis(scope):
    async with _session_client(scope) as client:
        good = await client.post("/v1/checks/circuit", json=_body(QFT3, UNITARY_QFT3))
        bad = await client.post("/v1/checks/circuit", json=_body(QFT3_ROTATIONS, UNITARY_QFT3))
    # The control first: the same rotations WITH the swap pass, so the fail below is
    # about the swap and not about how the rotations were written.
    assert good.json()["verdict"]["status"] == "pass"
    verdict = bad.json()["verdict"]
    assert bad.status_code == 200
    assert verdict["status"] == "fail"
    assert "without its final swaps" in verdict["detail"]
    assert verdict["teeth"]["status"] == "not_measured"
    assert "only on a check that passes" in verdict["teeth"]["reason"]


async def test_a_circuit_over_the_width_ceiling_is_inconclusive_not_an_error(scope):
    wide = HEADER + f"qubit[{MUTATION_MAX_QUBITS_STATE + 1}] q;\nh q[0];\n"
    async with _session_client(scope) as client:
        response = await client.post(
            "/v1/checks/circuit",
            json=_body(wide, {"kind": "state", "subject": "circuit", "reference": "bell"}),
        )
    assert response.status_code == 200
    verdict = response.json()["verdict"]
    assert verdict["status"] == "inconclusive"
    # The route's ceiling (width_caps), not the engine's default of 24 for a state check.
    assert (
        f"has {MUTATION_MAX_QUBITS_STATE + 1} qubits; this check judges at most "
        f"{MUTATION_MAX_QUBITS_STATE}"
    ) in verdict["detail"]
    assert verdict["teeth"]["status"] == "not_measured"
    assert verdict["teeth"]["reason"]


@pytest.mark.parametrize(
    ("qasm", "prop", "words"),
    [
        (HEADER + "qubit[100000] q;\n", UNITARY_QFT3, "100000 qubits"),
        (HEADER + "qubit[2*3] q;\n", UNITARY_QFT3, "size is not a number"),
        (_doubling_chain(12), UNITARY_QFT3, "4,000 gate applications"),
        (
            HEADER + "qubit[10] q;\nctrl(9) @ x " + ", ".join(f"q[{i}]" for i in range(10)) + ";\n",
            {"kind": "state", "subject": "circuit", "reference": "uniform(10)"},
            "one dense matrix",
        ),
        (
            HEADER + "qubit[1] q;\nfor int i in [0:1000000000] { h q[0]; }\n",
            {"kind": "state", "subject": "circuit", "amplitudes": {"0": 1}},
            "control flow",
        ),
    ],
    ids=[
        "a-hundred-thousand-qubits",
        "register-sized-by-an-expression",
        "gate-definitions-that-double-twelve-times",
        "a-ten-qubit-controlled-gate",
        "a-billion-iteration-loop",
    ],
)
async def test_what_would_be_expensive_to_build_is_refused_from_the_syntax_tree(
    scope, qasm, prop, words
):
    """Each of these is a few lines that would, if built, allocate or simulate far more
    than its length: refused as `inconclusive` by the engine's syntax-tree bound in the
    child, before Qiskit's importer is handed the program."""
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(qasm, prop))
    assert response.status_code == 200, response.text
    verdict = response.json()["verdict"]
    assert verdict["status"] == "inconclusive"
    assert words in verdict["detail"]
    assert verdict["teeth"]["status"] == "not_measured"


async def test_nested_gate_definitions_come_back_inconclusive_fast_not_as_a_hang(scope):
    """The case PR 1011's review measured on the importer: nested gate definitions make
    `qasm3.loads` itself exponential (514 characters took 8.2 s, about x2.2 per level).
    Twelve doubling levels (2**12 = 4,096 gate applications) are refused from the tree in
    the child, and the whole request, child start-up included, comes back under 2 s."""
    started = time.perf_counter()
    async with _session_client(scope) as client:
        response = await client.post(
            "/v1/checks/circuit", json=_body(_doubling_chain(12), UNITARY_QFT3)
        )
    elapsed = time.perf_counter() - started
    assert response.status_code == 200, response.text
    assert response.json()["verdict"]["status"] == "inconclusive"
    assert elapsed < 2.0, f"took {elapsed:.2f} s"


@pytest.mark.parametrize(
    ("qasm", "prop", "words"),
    [
        (BELL, {"kind": "state", "subject": "circuit", "reference": "ghz(13)"}, "on 13"),
        (QFT3, {"kind": "unitary", "subject": "circuit", "reference": "qft(9)"}, "on 9"),
        (
            BELL,
            {
                "kind": "state",
                "subject": "circuit",
                "reference_qasm": HEADER + "qubit[13] r;\nh r[0];\n",
            },
            "on 13",
        ),
    ],
    ids=["a-13-qubit-reference-state", "a-9-qubit-reference-unitary", "a-13-qubit-reference-qasm"],
)
async def test_an_expectation_wider_than_the_circuit_is_a_fail_and_is_never_built(
    scope, qasm, prop, words
):
    """The engine reads an expectation's width (from the library name, or the reference
    circuit's syntax tree) BEFORE it builds the expectation. Wider than a narrower circuit
    is a real disagreement, so a `fail` naming both widths, not an `inconclusive`. The
    widths sit one past each ceiling on purpose: if the width check regressed, the child
    would build a small reference and answer the same `fail` in different words, so the
    wording is what these pin, and nothing large is ever allocated."""
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(qasm, prop))
    assert response.status_code == 200, response.text
    verdict = response.json()["verdict"]
    assert verdict["status"] == "fail"
    assert words in verdict["detail"]
    assert verdict["teeth"]["status"] == "not_measured"


@pytest.mark.parametrize(
    ("qasm", "words"),
    [
        ("OPENQASM 3.0; qubit[2] q; h q[0", "does not parse: L1:C31: unexpected end of input"),
        (HEADER + "qubit[1] q;\nfoo q[0];\n", "gate 'foo' is not defined"),
        ('OPENQASM 3.0;\ninclude "mygates.inc";\nqubit[1] q;\n', "non-stdgates imports"),
    ],
    ids=["syntax", "undefined-gate", "foreign-include"],
)
async def test_a_circuit_that_does_not_parse_is_a_400_with_the_parsers_words(scope, qasm, words):
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(qasm, UNITARY_QFT3))
    assert response.status_code == 400
    body = response.json()
    assert body["reason"] == "qasm_unreadable"
    assert words in body["title"]


async def test_a_reference_circuit_that_does_not_parse_is_a_400_too(scope):
    prop = {"kind": "state", "subject": "circuit", "reference_qasm": "OPENQASM 3.0; qubit q; h"}
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(BELL, prop))
    assert response.status_code == 400
    assert response.json()["title"].startswith("The check's reference circuit does not parse")


async def test_a_value_check_is_refused_with_the_words_that_say_where_it_belongs(scope):
    prop = {"kind": "value", "subject": "circuit", "value": 0.5}
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(BELL, prop))
    assert response.status_code == 400
    body = response.json()
    assert body["title"] == "a value check needs a value, not a circuit; check it in a notebook"
    assert body["reason"] == "value_check_needs_a_notebook"


async def test_a_circuit_over_the_character_ceiling_is_refused_by_the_contract(scope):
    too_long = BELL + "// " + "x" * MAX_CIRCUIT_CHECK_QASM_CHARS
    async with _session_client(scope) as client:
        response = await client.post("/v1/checks/circuit", json=_body(too_long, STATE_BELL))
    assert response.status_code == 422


async def test_the_per_account_ceiling_answers_429_before_any_judging(scope, monkeypatch):
    calls: list[str] = []
    real = circuit_check.judge_circuit

    async def counting(*args, **kwargs):
        calls.append("judged")
        return await real(*args, **kwargs)

    monkeypatch.setattr(checks_routes, "judge_circuit", counting)
    async with _session_client(scope, check_rate_limit_per_minute=1) as client:
        first = await client.post("/v1/checks/circuit", json=_body(BELL, STATE_BELL))
        second = await client.post("/v1/checks/circuit", json=_body(BELL, STATE_BELL))
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["reason"] == "check_rate_limited"
    assert second.headers["Retry-After"]
    assert calls == ["judged"]  # the refused one cost no CPU


async def test_no_credential_is_a_401():
    app = create_app(Settings(**SETTINGS_KWARGS))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/checks/circuit", json=_body(BELL, STATE_BELL))
    assert response.status_code == 401


# --------------------------------------------------------------------------- token caller

_TOKEN = TOKEN_PREFIX + "check_circuit_route_test_token_0000000000"  # noqa: S105 - fixture value


class _Lookup:
    """The short-lived session `get_verified_token` opens to resolve a token."""

    def __init__(self, user) -> None:
        self._user = user

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc) -> bool:
        return False

    async def get(self, _model, _key):
        return self._user

    async def commit(self) -> None:
        return None


def _token_app(monkeypatch, scopes: list[str]):
    """The real app with the personal-access-token path's database reads stubbed at the
    repository functions `auth/deps.py` calls. Everything between them — the route
    template lookup, `token_access.check`, the token limiter, `get_identity`, `get_scope`
    — is the production code."""
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    row = SimpleNamespace(
        id=uuid.uuid4(), user_id=user_id, workspace_id=workspace_id, scopes=list(scopes)
    )
    user = SimpleNamespace(
        id=user_id, workos_user_id="user_check_route", email="a@check.test", display_name="A"
    )

    async def resolve_presented(_session, presented, **_kwargs):
        return row if presented == _TOKEN else None

    async def get_or_provision_user(_session, **_kwargs):
        return user, SimpleNamespace(id=workspace_id)

    async def find_membership(_session, **_kwargs):
        return SimpleNamespace(role="owner")

    async def find_live_workspace(_session, **_kwargs):
        return SimpleNamespace(id=workspace_id)

    async def no_rls(*_args, **_kwargs):
        return None

    monkeypatch.setattr(tokens_repo, "resolve_presented", resolve_presented)
    monkeypatch.setattr(system, "get_or_provision_user", get_or_provision_user)
    monkeypatch.setattr(system, "find_membership", find_membership)
    monkeypatch.setattr(system, "find_live_workspace", find_live_workspace)
    monkeypatch.setattr(auth_deps, "set_rls_context", no_rls)

    app = create_app(Settings(**{**SETTINGS_KWARGS, "personal_access_tokens_enabled": True}))
    app.state.auth_session_factory = lambda: _Lookup(user)
    app.dependency_overrides[auth_deps.get_session] = lambda: object()
    return app


def _token_client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {_TOKEN}"},
    )


async def test_a_read_only_token_is_refused_the_run_scope_not_the_route(monkeypatch):
    """INSUFFICIENT_SCOPE, not FORBIDDEN_ROUTE: the holder is told to mint a token with
    `run`, not to go and sign in on the website."""
    app = _token_app(monkeypatch, ["read"])
    async with _token_client(app) as client:
        response = await client.post("/v1/checks/circuit", json=_body(BELL, STATE_BELL))
    assert response.status_code == 403
    body = response.json()
    assert body["reason"] == "token_scope_insufficient"
    assert "run scope" in body["title"]


async def test_a_run_token_may_check_a_circuit(monkeypatch):
    """The allowlist entry in `token_access.RUN_WRITES`, through the whole auth chain.

    Mutation check performed by hand: with `("POST", "/checks/circuit")` removed from
    `RUN_WRITES`, this test failed with a 403 `token_route_forbidden` (the default-shut
    rule), as did the read-only test above (`token_route_forbidden` where it expects
    `token_scope_insufficient`) and the end-to-end test below; restored. The schema walk
    in `test_token_access.py` stayed GREEN under that mutation, correctly: it catches a
    route reachable but unlisted, not a route listed nowhere. The named policy test
    `test_a_run_token_may_check_a_circuit_but_a_read_token_may_not` there is what fails
    without a request."""
    app = _token_app(monkeypatch, ["read", "run"])
    async with _token_client(app) as client:
        response = await client.post("/v1/checks/circuit", json=_body(BELL, STATE_BELL))
    assert response.status_code == 200, response.text
    assert response.json()["verdict"]["status"] == "pass"


# --------------------------------------------------------------------------- end to end


@contextlib.asynccontextmanager
async def _mcp_over_the_app(monkeypatch):
    """An MCP client session with `leona-mcp`, whose `leona_client.Client` reaches THIS
    app: `check_circuit` (leona_mcp) -> `Client.check_circuit` (leona_client, through its
    real `(method, url, headers, body)` transport seam) -> POST /v1/checks/circuit (a
    `run` token, the real auth chain) -> `judge_circuit` -> the check-cell engine.

    Yields the session and the list of requests the client sent.
    """
    import leona_mcp.server as server_module
    from mcp.shared.memory import create_connected_server_and_client_session

    app = _token_app(monkeypatch, ["read", "run"])
    asgi = httpx.ASGITransport(app=app)
    sent: list[tuple[str, str, dict]] = []

    async def call_app(method, url, headers, body):
        async with httpx.AsyncClient(transport=asgi, base_url="http://test") as client:
            response = await client.request(method, url, headers=headers, content=body)
        return response.status_code, response.content

    def transport(method, url, headers, body):
        # The client is synchronous and the MCP tool runs it in a worker thread, so the
        # async app is reached through that thread's portal back to the event loop.
        sent.append((method, url, json.loads(body)))
        return anyio.from_thread.run(call_app, method, url, headers, body)

    client = server_module.Client(api_url="http://test", token=_TOKEN, transport=transport)
    monkeypatch.setattr(server_module.Client, "from_env", classmethod(lambda cls: client))
    async with create_connected_server_and_client_session(server_module.build_server()) as session:
        yield session, sent


async def test_the_mcp_tool_reaches_the_engine_through_the_client_and_the_route(monkeypatch):
    """The whole chain, once. The circuit is a hand-written QFT on 3 qubits missing its
    final swap, the mistake the engine's unitary diagnosis names, so the words at the
    end of the chain are the engine's and not anything a layer in between wrote."""
    async with _mcp_over_the_app(monkeypatch) as (session, sent):
        result = await session.call_tool(
            "check_circuit",
            {"qasm": QFT3_ROTATIONS, "kind": "unitary", "reference": "qft(3)"},
        )

    assert result.isError is False, result.content[0].text
    body = json.loads(result.content[0].text)
    assert body["status"] == "fail"
    assert body["passed"] is False
    assert "without its final swaps" in body["detail"]
    assert "Qiskit's QFT on 3 qubits" in body["summary"]
    assert body["teeth"]["status"] == "not_measured"
    [(method, url, payload)] = sent
    assert (method, url) == ("POST", "http://test/v1/checks/circuit")
    assert payload["property"]["subject"] == "circuit"


# --------------------------------------------------------------------------- the README

README = Path(__file__).resolve().parents[3] / "packages" / "py" / "mcp" / "README.md"
_START = "<!-- check-circuit-example:start (generated by test_check_circuit_route.py) -->"
_END = "<!-- check-circuit-example:end -->"
#: `LEONA_WRITE_CHECK_EXAMPLE=1 uv run pytest services/api/tests/test_check_circuit_route.py
#: -k readme` rewrites the block from a fresh run instead of comparing against it.
_WRITE = os.environ.get("LEONA_WRITE_CHECK_EXAMPLE") == "1"


def _json_block(value) -> str:
    return "```json\n" + json.dumps(value, indent=2, ensure_ascii=False) + "\n```"


#: A residual below 1e-9 ("1.28e-15" on the machine that wrote the README) is rounding,
#: and its digits depend on the BLAS the runner's numpy uses. Compared as "~0" so a
#: Linux CI runner and a Mac agree; the README keeps the digits a real run printed.
_ROUNDING = re.compile(r"\b\d\.\d{2}e-(?:0*(?:9|[1-9]\d+))\b")


def _same_up_to_rounding(text: str) -> str:
    return _ROUNDING.sub("~0", text)


async def test_the_readme_example_is_what_the_engine_answers(monkeypatch):
    """The MCP README's QFT example is this test's output, not prose: two real calls
    through the whole chain (the first QFT the agent writes, missing its final swap, then
    the fixed one). A README showing a verdict the engine no longer gives fails here."""
    calls = [
        {"qasm": QFT3_ROTATIONS, "kind": "unitary", "reference": "qft(3)"},
        {"qasm": QFT3, "kind": "unitary", "reference": "qft(3)"},
    ]
    answers = []
    async with _mcp_over_the_app(monkeypatch) as (session, _sent):
        for arguments in calls:
            result = await session.call_tool("check_circuit", arguments)
            assert result.isError is False, result.content[0].text
            answers.append(json.loads(result.content[0].text))
    assert [answer["status"] for answer in answers] == ["fail", "pass"]
    assert answers[1]["teeth"]["status"] == "measured"

    block = "\n\n".join(
        [
            _START,
            "The agent's first attempt leaves out the final swap. It calls:",
            _json_block({"tool": "check_circuit", "arguments": calls[0]}),
            "Leona answers:",
            _json_block(answers[0]),
            "The agent adds `swap q[0], q[2];` at the end and calls again:",
            _json_block({"tool": "check_circuit", "arguments": calls[1]}),
            "Leona answers:",
            _json_block(answers[1]),
            _END,
        ]
    )
    text = README.read_text(encoding="utf-8")
    start, end = text.index(_START), text.index(_END) + len(_END)
    if _WRITE:
        README.write_text(text[:start] + block + text[end:], encoding="utf-8")
        return
    assert _same_up_to_rounding(text[start:end]) == _same_up_to_rounding(block), (
        "The README's check_circuit example no longer matches what the engine answers. "
        "Regenerate it: LEONA_WRITE_CHECK_EXAMPLE=1 uv run pytest "
        "services/api/tests/test_check_circuit_route.py -k readme"
    )
