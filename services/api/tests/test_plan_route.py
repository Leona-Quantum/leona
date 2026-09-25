"""`POST /v1/plans`: the agent connector's `plan_workflow`, end to end.

DB-free, like `test_check_circuit_route.py`, whose token harness this copies: the route
stores nothing, and the token path's database reads are stubbed at the repository
functions the real auth chain calls, so `get_verified_token` -> `token_access.check`
-> `get_identity` -> `get_scope` all run as in production.

The planner's numbers are `packages/py/planner/tests/test_planner_parity.py`'s business (the
port against the TS planner on ~900 inputs). This file holds the route: that it hands
back exactly what the port answers, refuses what it should with words a model can act
on, admits a `read` token, and that the MCP tool reaches it through `leona_client`. It
also writes the MCP README's plan example from a real call.
"""

from __future__ import annotations

import contextlib
import json
import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import anyio
import httpx
import leona_planner
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TOKEN_PREFIX

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import system
from majorana_api.routes import plans as plans_routes
from majorana_api.settings import Settings

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

RSA_2048 = {"problem": "factoring", "params": {"bits": 2048}}


@pytest.fixture
def scope() -> Scope:
    return Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=Role.OWNER)


def _session_client(scope: Scope) -> httpx.AsyncClient:
    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# --------------------------------------------------------------------------- the route


async def test_the_route_answers_exactly_what_the_planner_port_answers(scope):
    """Nothing between the port and the caller adds, drops or re-types a field: the
    response model is documentation, and a count stays an int (`6190`, not `6190.0`)."""
    async with _session_client(scope) as client:
        response = await client.post("/v1/plans", json=RSA_2048)
    assert response.status_code == 200, response.text
    expected = json.loads(json.dumps(leona_planner.plan_workflow("factoring", {"bits": 2048})))
    assert response.json() == expected
    assert '"value":6190,' in response.text.replace(" ", "")


@pytest.mark.parametrize(
    "problem, params, choices",
    [
        ("ground-state", {"lambda": 500, "orbitals": 100}, {}),
        ("ground-state", {"lambda": 500}, {"ground-state-energy": "variational-ground-state"}),
        ("search", {"domainSize": 1e30, "oracleToffolis": 1e15}, {}),
        ("linear-ode", {}, {}),
        ("hamiltonian-simulation", {"lambda": 1e12, "time": 1e12}, {}),
    ],
)
async def test_every_answer_the_port_gives_survives_the_response_model(
    scope, problem, params, choices
):
    body = {"problem": problem, "params": params, "choices": choices}
    async with _session_client(scope) as client:
        response = await client.post("/v1/plans", json=body)
    assert response.status_code == 200, response.text
    expected = leona_planner.plan_workflow(problem, params, choices)
    assert response.json() == json.loads(json.dumps(expected, allow_nan=False))


@pytest.mark.parametrize(
    "body, words",
    [
        (
            {"problem": "factoring", "params": {"bits": 7}},
            "bits must be a whole number from 8 to 16384; got 7",
        ),
        ({"problem": "factoring", "params": {"bits": 2048.5}}, "bits must be a whole number"),
        ({"problem": "factoring", "params": {"bits": "2048"}}, "bits must be a number or null"),
        ({"problem": "factoring", "params": {"kappa": 3}}, "factoring has no parameter 'kappa'"),
        ({"problem": "teleportation"}, "unknown problem 'teleportation'"),
        (
            {"problem": "search", "params": {"domainSize": 1e31}},
            "domainSize must be a whole number from 2 to 1e+30",
        ),
        (
            {"problem": "factoring", "choices": {"hidden-period-finding": "Shor's"}},
            "is not a method id",
        ),
    ],
)
async def test_a_bad_input_is_a_422_that_says_what_is_wrong(scope, body, words):
    async with _session_client(scope) as client:
        response = await client.post("/v1/plans", json=body)
    assert response.status_code == 422, response.text
    problem = response.json()
    assert problem["reason"] == plans_routes.PLAN_INPUT_INVALID
    assert words in problem["title"], problem["title"]


async def test_the_body_is_bounded_before_the_planner_sees_it(scope):
    too_many = {f"hidden-period-finding/s{i}": "cyclic-period-finding" for i in range(33)}
    async with _session_client(scope) as client:
        choices = await client.post("/v1/plans", json={"problem": "factoring", "choices": too_many})
        params = await client.post(
            "/v1/plans", json={"problem": "factoring", "params": {f"p{i}": 1 for i in range(33)}}
        )
        extra = await client.post("/v1/plans", json={**RSA_2048, "text": "Factor RSA-2048"})
    assert (choices.status_code, params.status_code, extra.status_code) == (422, 422, 422)


async def test_a_choice_the_planner_cannot_follow_is_answered_not_refused(scope):
    body = {
        "problem": "factoring",
        "choices": {"hidden-period-finding": "variational-ground-state"},
    }
    async with _session_client(scope) as client:
        response = await client.post("/v1/plans", json=body)
    assert response.status_code == 200, response.text
    [ignored] = response.json()["ignored_choices"]
    assert "not a method that realises hidden-period-finding" in ignored["reason"]


async def test_no_credential_is_a_401():
    app = create_app(Settings(**SETTINGS_KWARGS))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/plans", json=RSA_2048)
    assert response.status_code == 401


def test_the_mcp_tools_catalog_names_the_problems_and_parameters_the_port_has():
    """The tool description is generated from `leona_mcp/plan_catalog.json`, which the TS
    test holds current against the TS planner; this holds it against the port the
    route actually answers from, which is the other thing a caller's request meets."""
    import leona_mcp.server as server_module
    from leona_planner._data import load

    data = load()
    catalog = {
        p["id"]: [s["key"] for s in p["params"]] for p in server_module.PLAN_CATALOG["problems"]
    }
    port = {p.id: [s.key for s in p.params] for p in data.problems.values()}
    assert catalog == port


# --------------------------------------------------------------------------- token caller

_TOKEN = TOKEN_PREFIX + "plan_route_test_token_00000000000000000"  # noqa: S105 - fixture value


class _Lookup:
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
    """The real app with the token path's database reads stubbed at the repository
    functions `auth/deps.py` calls (the same stubs as `test_check_circuit_route.py`)."""
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    row = SimpleNamespace(
        id=uuid.uuid4(), user_id=user_id, workspace_id=workspace_id, scopes=list(scopes)
    )
    user = SimpleNamespace(
        id=user_id, workos_user_id="user_plan_route", email="a@plan.test", display_name="A"
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


async def test_a_read_only_token_may_plan(monkeypatch):
    """The `token_access.READ_WRITES` entry, through the whole auth chain: planning is
    arithmetic, so a token minted only to read may do it, as it may estimate.

    Mutation check performed by hand: with `("POST", "/plans")` removed from
    `READ_WRITES`, this test failed with a 403 `token_route_forbidden` (the default-shut
    rule), as did the MCP end-to-end test below; restored."""
    app = _token_app(monkeypatch, ["read"])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {_TOKEN}"},
    ) as client:
        response = await client.post("/v1/plans", json=RSA_2048)
    assert response.status_code == 200, response.text
    assert response.json()["lines"][0]["id"] == "ge2021-qubits"


# --------------------------------------------------------------------------- end to end


@contextlib.asynccontextmanager
async def _mcp_over_the_app(monkeypatch):
    """An MCP session with `leona-mcp` whose `leona_client.Client` reaches THIS app with a
    `read` token: `plan_workflow` (leona_mcp) -> `Client.plan_workflow` (leona_client,
    its real transport seam) -> POST /v1/plans -> `leona_planner`; and the same for
    `estimate_resources` -> POST /v1/estimates/logical -> the estimator."""
    import leona_mcp.server as server_module
    from mcp.shared.memory import create_connected_server_and_client_session

    app = _token_app(monkeypatch, ["read"])
    asgi = httpx.ASGITransport(app=app)
    sent: list[tuple[str, str, dict]] = []

    async def call_app(method, url, headers, body):
        async with httpx.AsyncClient(transport=asgi, base_url="http://test") as client:
            response = await client.request(method, url, headers=headers, content=body)
        return response.status_code, response.content

    def transport(method, url, headers, body):
        sent.append((method, url, json.loads(body)))
        return anyio.from_thread.run(call_app, method, url, headers, body)

    client = server_module.Client(api_url="http://test", token=_TOKEN, transport=transport)
    monkeypatch.setattr(server_module.Client, "from_env", classmethod(lambda cls: client))
    async with create_connected_server_and_client_session(server_module.build_server()) as session:
        yield session, sent


async def test_the_mcp_tool_reaches_the_planner_through_the_client_and_the_route(monkeypatch):
    async with _mcp_over_the_app(monkeypatch) as (session, sent):
        result = await session.call_tool("plan_workflow", RSA_2048)
    assert result.isError is False, result.content[0].text
    body = json.loads(result.content[0].text)
    assert body["lines"][0]["label"] == "Logical qubits (Gidney–Ekerå 2019)"
    assert "6,190 logical qubits [leading-order; Gidney & Ekerå 2019" in body["summary"]
    [(method, url, payload)] = sent
    assert (method, url) == ("POST", "http://test/v1/plans")
    assert payload == {**RSA_2048, "choices": {}}


# --------------------------------------------------------------------------- the README

README = Path(__file__).resolve().parents[3] / "packages" / "py" / "mcp" / "README.md"
_START = "<!-- plan-workflow-example:start (generated by test_plan_route.py) -->"
_END = "<!-- plan-workflow-example:end -->"
#: `LEONA_WRITE_PLAN_EXAMPLE=1 uv run pytest services/api/tests/test_plan_route.py -k readme`
#: rewrites the block from a fresh run instead of comparing against it.
_WRITE = os.environ.get("LEONA_WRITE_PLAN_EXAMPLE") == "1"


def _json_block(value) -> str:
    return "```json\n" + json.dumps(value, indent=2, ensure_ascii=False) + "\n```"


def _to_ten_digits(value):
    """Every float to ten significant digits, for comparing only. The estimator's runtime
    and the planner's non-integer lines go through libm, whose last digits can differ
    between the Mac that wrote the README and CI's Linux; the README keeps the digits a
    real run printed."""
    if isinstance(value, float):
        return float(f"{value:.10g}")
    if isinstance(value, dict):
        return {k: _to_ten_digits(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_ten_digits(v) for v in value]
    return value


def _json_blocks(text: str) -> list:
    blocks, rest = [], text
    while "```json\n" in rest:
        rest = rest.split("```json\n", 1)[1]
        block, rest = rest.split("\n```", 1)
        blocks.append(json.loads(block))
    return blocks


async def test_the_readme_example_is_what_the_planner_and_the_estimator_answer(monkeypatch):
    """The MCP README's plan example is this test's output, not prose: a real
    `plan_workflow` call through the whole chain, then a real `estimate_resources` call
    with the `estimate_point` it returned. The answers are shown in part (the fields
    named in the README), copied from the real ones here, not typed."""
    async with _mcp_over_the_app(monkeypatch) as (session, _sent):
        planned = await session.call_tool("plan_workflow", RSA_2048)
        assert planned.isError is False, planned.content[0].text
        plan = json.loads(planned.content[0].text)
        point = plan["estimate_point"]
        estimated = await session.call_tool("estimate_resources", {"points": [point]})
        assert estimated.isError is False, estimated.content[0].text
        physical = json.loads(estimated.content[0].text)

    plan_excerpt = {
        "summary": plan["summary"],
        "lines": [
            {
                key: line[key]
                for key in ("id", "label", "value", "unit", "kind", "source", "formula")
            }
            for line in plan["lines"]
        ],
        "logical": plan["logical"],
        "estimate_point": point,
    }
    [costed] = physical["points"]
    physical_excerpt = {
        "assumptions": physical["assumptions"]["identity"],
        "points": [
            {key: costed[key] for key in ("label", "refused", "distance", "fastest", "smallest")}
        ],
    }
    block = "\n\n".join(
        [
            _START,
            "The agent calls:",
            _json_block({"tool": "plan_workflow", "arguments": RSA_2048}),
            "Leona answers (the summary, the cost lines, and the point to cost; the full answer "
            "also carries every stage, its alternatives and the methods' stated costs, the "
            "sources with their quotes, and the published whole-machine figures):",
            _json_block(plan_excerpt),
            "The agent passes `estimate_point` on:",
            _json_block({"tool": "estimate_resources", "arguments": {"points": [point]}}),
            "Leona answers (the costed point; the full answer adds the frontier and each "
            "assumption set's citation):",
            _json_block(physical_excerpt),
            _END,
        ]
    )
    text = README.read_text(encoding="utf-8")
    start, end = text.index(_START), text.index(_END) + len(_END)
    if _WRITE:
        README.write_text(text[:start] + block + text[end:], encoding="utf-8")
        return
    committed = text[start:end]
    assert _to_ten_digits(_json_blocks(committed)) == _to_ten_digits(_json_blocks(block)), (
        "The README's plan_workflow example no longer matches what the route answers. "
        "Regenerate it: LEONA_WRITE_PLAN_EXAMPLE=1 uv run pytest "
        "services/api/tests/test_plan_route.py -k readme"
    )
    prose = [line for line in committed.splitlines() if not line.startswith(("{", "}", " ", "`"))]
    assert prose == [
        line for line in block.splitlines() if not line.startswith(("{", "}", " ", "`"))
    ]
