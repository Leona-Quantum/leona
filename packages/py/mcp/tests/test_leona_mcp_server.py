"""The server over the MCP protocol itself, in memory, against the fake API.

`create_connected_server_and_client_session` runs the real initialize handshake
and JSON-RPC framing between an SDK client and this server, so what these tests
see is what an MCP client sees.
"""

from __future__ import annotations

import json

import httpx
import pytest
from leona_client import CatalogClient
from leona_mcp_fixtures import FakeCatalogApi
from mcp.shared.memory import create_connected_server_and_client_session

from leona_mcp import __version__
from leona_mcp.server import INSTRUCTIONS, SERVER_NAME, build_server


@pytest.fixture
def api() -> FakeCatalogApi:
    return FakeCatalogApi()


@pytest.fixture
def server(api):
    return build_server(CatalogClient("https://api.example", transport=api.transport()))


async def test_initialize_names_the_server_and_says_what_it_does_not_do(server):
    async with create_connected_server_and_client_session(server) as session:
        # The helper runs initialize before yielding and keeps the result to itself,
        # so run the handshake once more to read what the server answers.
        result = await session.initialize()
    assert result.serverInfo.name == SERVER_NAME
    assert result.serverInfo.version == __version__
    assert result.instructions == INSTRUCTIONS
    for phrase in (
        "public, read-only API",
        "not stated in the record",
        "spends money",
        "LEONA_API_TOKEN",
        "verifier_decision",
    ):
        assert phrase in result.instructions


async def test_tools_list_offers_the_three_atlas_tools_read_only_and_six_acting_ones(server, api):
    async with create_connected_server_and_client_session(server) as session:
        tools = (await session.list_tools()).tools
    assert sorted(t.name for t in tools) == [
        "check_circuit",
        "estimate_resources",
        "get_method",
        "get_run",
        "list_my_runs",
        "list_problem_areas",
        "run_qapp",
        "run_verified",
        "search_methods",
    ]
    by_name = {tool.name: tool for tool in tools}
    for name in ("search_methods", "get_method", "list_problem_areas"):
        tool = by_name[name]
        assert tool.annotations is not None
        assert tool.annotations.readOnlyHint is True
        assert tool.annotations.destructiveHint is False
        assert tool.description
    # The acting tools need a token and are not marked read-only; run_verified and
    # run_qapp each have a side effect (a new run, a new Qapp execution) and are
    # not marked idempotent either.
    for name in ("run_verified", "run_qapp"):
        assert by_name[name].annotations.readOnlyHint is False
        assert by_name[name].annotations.idempotentHint is False
    # check_circuit stores nothing and answers the same input the same way.
    for name in ("get_run", "list_my_runs", "estimate_resources", "check_circuit"):
        assert by_name[name].annotations.readOnlyHint is True
    for name in by_name:
        assert by_name[name].annotations.destructiveHint is False
    search = next(t for t in tools if t.name == "search_methods")
    assert set(search.inputSchema["properties"]) == {
        "query",
        "problem_area",
        "max_qubits",
        "max_depth",
        "hardware",
        "match_all",
        "limit",
        "offset",
    }
    assert "unranked" in search.description and "sorted by slug" in search.description
    # Listing tools reads nothing from the API.
    assert api.requests == []


async def test_tools_call_search_methods_returns_the_filtered_rows(server, api):
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool(
            "search_methods", {"query": "phase estimation", "max_qubits": 2}
        )
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert result.structuredContent == body
    assert [r["slug"] for r in body["results"]] == ["quantum-phase-estimation"]
    assert body["results"][0]["limits"][1] == {
        "limit": "qubits",
        "verdict": "not-stated",
        "detail": "Qubits: not stated in the source.",
    }
    assert {r.url.path for r in api.requests} == {"/v1/catalog/entries"}


async def test_tools_call_get_method_and_a_miss_is_an_error_result(server):
    async with create_connected_server_and_client_session(server) as session:
        hit = await session.call_tool("get_method", {"slug": "shor-period-finding"})
        miss = await session.call_tool("get_method", {"slug": "no-such-method"})
        bad_area = await session.call_tool("search_methods", {"problem_area": "biology"})
        bad_limit = await session.call_tool("search_methods", {"max_qubits": -1})
    detail = json.loads(hit.content[0].text)
    assert detail["speedup_class"] == {
        "value": "FTQC required",
        "from": 'the record\'s "Readiness" row',
    }
    assert detail["url"] == "https://leonaqt.com/repository/shor-period-finding"
    assert miss.isError is True and "no-such-method" in miss.content[0].text
    assert bad_area.isError is True and "chemistry" in bad_area.content[0].text
    assert bad_limit.isError is True


async def test_tools_call_list_problem_areas(server):
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("list_problem_areas", {})
    body = json.loads(result.content[0].text)
    assert body["records_in_atlas"] == 10
    assert [a["id"] for a in body["problem_areas"]] == [
        "chemistry",
        "optimization",
        "machine-learning",
        "cryptography",
    ]


async def test_an_unreachable_api_is_an_error_result_not_a_crash():
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    server = build_server(CatalogClient("https://api.example", transport=httpx.MockTransport(down)))
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("list_problem_areas", {})
    assert result.isError is True
    assert "Could not reach the Atlas API" in result.content[0].text


# --------------------------------------------------------------------- acting tools
#
# `_token_client()` calls `leona_client.Client.from_env()`, so these patch that
# classmethod (on the same class object `leona_mcp.server` imported) rather than
# the server's own `build_server`, which only ever configures the Atlas tools'
# `CatalogClient`.

_TEST_TOKEN = "lq_pat_do_not_leak_this_test_token_00000"  # noqa: S105 - a fixture value, not a secret
_RUN_ID = "11111111-1111-1111-1111-111111111111"
_CONVERSATION_ID = "22222222-2222-2222-2222-222222222222"
_WORKSPACE_ID = "33333333-3333-3333-3333-333333333333"
_USER_ID = "44444444-4444-4444-4444-444444444444"


def _run_json(*, status="succeeded", verifier_decision=None, verification_summary=None):
    return {
        "id": _RUN_ID,
        "conversation_id": _CONVERSATION_ID,
        "workspace_id": _WORKSPACE_ID,
        "user_id": _USER_ID,
        "task_prompt": "Build a GHZ state and verify it",
        "mode": "execute",
        "status": status,
        "framework": "qiskit",
        "created_at": "2026-09-23T00:00:00Z",
        "verifier_decision": verifier_decision,
        "verification_summary": verification_summary,
    }


class _Recording:
    """The same transport shape `leona_notebooks`'s tests use: a plain
    `(method, url, headers, body) -> (status, bytes)` callable."""

    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _patch_token_client(monkeypatch, responses, *, token=_TEST_TOKEN):
    import leona_mcp.server as server_module

    transport = _Recording(responses)
    fake = server_module.Client(api_url="https://api.example", token=token, transport=transport)
    monkeypatch.setattr(server_module.Client, "from_env", classmethod(lambda cls: fake))
    return transport


async def test_run_verified_starts_and_polls_to_a_verified_result(monkeypatch):
    transport = _patch_token_client(
        monkeypatch,
        [
            (201, _run_json(status="queued")),
            (
                200,
                _run_json(
                    status="succeeded",
                    verifier_decision="pass",
                    verification_summary={
                        "decision": "pass",
                        "reason_code": "ok",
                        "candidate_defect_observed": False,
                        "retry_target": "none",
                    },
                ),
            ),
        ],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool(
            "run_verified", {"prompt": "Build a GHZ state and verify it"}
        )
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["status"] == "succeeded"
    assert body["verifier_decision"] == "pass"
    assert body["verified"] is True
    assert transport.calls[0][0] == "POST"
    assert transport.calls[0][1].endswith("/v1/runs")
    assert transport.calls[0][2]["Authorization"] == f"Bearer {_TEST_TOKEN}"
    assert transport.calls[0][3] == {
        "task_prompt": "Build a GHZ state and verify it",
        "framework": "qiskit",
    }
    assert transport.calls[1][1].endswith(f"/v1/runs/{_RUN_ID}")


async def test_run_verified_a_succeeded_status_is_not_claimed_verified_without_pass(monkeypatch):
    _patch_token_client(
        monkeypatch,
        [
            (201, _run_json(status="queued")),
            (
                200,
                _run_json(
                    status="succeeded",
                    verifier_decision="fail",
                    verification_summary={
                        "decision": "fail",
                        "reason_code": "candidate_defect",
                        "candidate_defect_observed": True,
                        "retry_target": "code_generation",
                    },
                ),
            ),
        ],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_verified", {"prompt": "Build a Bell pair"})
    body = json.loads(result.content[0].text)
    assert body["status"] == "succeeded"
    assert body["verifier_decision"] == "fail"
    assert body["verified"] is False


async def test_run_verified_a_failed_run_comes_back_as_data_not_a_crash(monkeypatch):
    _patch_token_client(
        monkeypatch, [(201, _run_json(status="queued")), (200, _run_json(status="failed"))]
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_verified", {"prompt": "Do something impossible"})
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["status"] == "failed"
    assert body["verified"] is False


async def test_run_verified_a_timeout_is_a_clear_error_not_a_long_wait(monkeypatch):
    """`run_verified` polls off the event loop via `anyio.to_thread.run_sync`,
    which itself depends on real wall-clock time to hand control back — so unlike
    the plain-`Client`-level timeout test in `packages/py/client`, this cannot
    fake `time.monotonic()` globally without also breaking anyio's own thread
    handoff (observed: doing so left the test's OWN await hanging on
    `StopIteration` from a starved iterator, consumed by unrelated code paths
    that also call the patched global). Instead this shortens the real poll
    interval so the minimum allowed `wait_s=1` elapses in about a second."""
    import leona_mcp.server as server_module

    _patch_token_client(
        monkeypatch,
        [(201, _run_json(status="queued"))] + [(200, _run_json(status="running"))] * 200,
    )
    monkeypatch.setattr(server_module, "DEFAULT_POLL_S", 0.02)
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_verified", {"prompt": "A slow one", "wait_s": 1})
    assert result.isError is True
    assert "did not reach a terminal state" in result.content[0].text
    assert _RUN_ID in result.content[0].text


async def test_run_verified_with_no_token_set_gives_clear_guidance_not_a_crash(monkeypatch):
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_verified", {"prompt": "Anything"})
    assert result.isError is True
    assert "LEONA_API_TOKEN" in result.content[0].text
    assert "Account" in result.content[0].text


@pytest.mark.parametrize("tool", ["get_run", "list_my_runs", "estimate_resources", "check_circuit"])
async def test_the_other_acting_tools_also_need_a_token(monkeypatch, tool):
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    server = build_server()
    args = {
        "get_run": {"run_id": _RUN_ID},
        "list_my_runs": {},
        "estimate_resources": {
            "points": [{"label": "x", "logical_qubits": 4, "toffoli_count": 100}]
        },
        "check_circuit": {"qasm": "OPENQASM 3.0;", "kind": "state", "reference": "bell"},
    }[tool]
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool(tool, args)
    assert result.isError is True
    assert "LEONA_API_TOKEN" in result.content[0].text


async def test_a_token_the_feature_switch_refuses_is_a_clear_error(monkeypatch):
    """The "tokens switched off" state (`MAJORANA_PERSONAL_ACCESS_TOKENS=false`,
    the shipped default): every token, valid or not, is a plain 401 "invalid
    token" from `get_verified_token` — before any route or scope check. Wire
    shape checked live against `create_app()`: RFC 7807 Problem+JSON, the
    message under "title", no "detail" key."""
    _patch_token_client(
        monkeypatch, [(401, {"type": "about:blank", "title": "invalid token", "status": 401})]
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_verified", {"prompt": "Anything"})
    assert result.isError is True
    assert "401" in result.content[0].text
    assert "invalid token" in result.content[0].text


async def test_a_read_only_token_is_told_to_mint_one_with_run_scope(monkeypatch):
    # Real wire shape, checked live against `create_app()`: the API's error
    # middleware answers RFC 7807 Problem+JSON. `token_access.check`'s message is
    # under "title", and "reason" sits at the top level — there is no "detail" key.
    _patch_token_client(
        monkeypatch,
        [
            (
                403,
                {
                    "type": "about:blank",
                    "title": "this token can read but not start runs; mint one with the run scope",
                    "status": 403,
                    "code": "http_error",
                    "reason": "token_scope_insufficient",
                },
            )
        ],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_verified", {"prompt": "Anything"})
    assert result.isError is True
    assert "run scope" in result.content[0].text


async def test_get_run_and_list_my_runs_read_a_run(monkeypatch):
    transport = _patch_token_client(
        monkeypatch, [(200, _run_json(status="succeeded", verifier_decision="pass"))]
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("get_run", {"run_id": _RUN_ID})
    assert result.isError is False
    assert json.loads(result.content[0].text)["id"] == _RUN_ID
    assert transport.calls[0][0] == "GET"
    assert transport.calls[0][3] is None


async def test_list_my_runs_wraps_the_list(monkeypatch):
    _patch_token_client(
        monkeypatch, [(200, [_run_json(status="succeeded"), _run_json(status="running")])]
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("list_my_runs", {"limit": 5})
    body = json.loads(result.content[0].text)
    assert [run["status"] for run in body["runs"]] == ["succeeded", "running"]


async def test_estimate_resources_calls_the_planner_route(monkeypatch):
    response = {
        "assumptions": {
            "identity": "gidney-2025@v2",
            "citation": "Gidney & Ekerå 2025",
            "physical_error_rate": 1e-3,
            "cycle_time_ns": 1000,
            "code": "surface",
        },
        "points": [
            {"label": "x", "parameter_value": None, "refused": "No Toffoli or T count was stated."}
        ],
        "citations": {"gidney-2025@v2": "Gidney & Ekerå 2025"},
    }
    transport = _patch_token_client(monkeypatch, [(200, response)])
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool(
            "estimate_resources",
            {"points": [{"label": "x", "logical_qubits": 4}]},
        )
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["points"][0]["refused"]
    assert transport.calls[0][1].endswith("/v1/estimates/logical")
    assert transport.calls[0][3] == {
        "points": [
            {
                "label": "x",
                "logical_qubits": 4,
                "toffoli_count": 0,
                "t_count": 0,
                "non_clifford_depth": 0,
            }
        ]
    }


_EXECUTION_ID = "55555555-5555-5555-5555-555555555555"
_QAPP_ID = "66666666-6666-6666-6666-666666666666"
_VERSION_ID = "77777777-7777-7777-7777-777777777777"


def _execution_json(*, status="queued", result=None, error_code=None):
    return {
        "id": _EXECUTION_ID,
        "qapp_id": _QAPP_ID,
        "qapp_version_id": _VERSION_ID,
        "status": status,
        "inputs": {"state": "phi_plus", "basis": "Z", "shots": 256},
        "result": result,
        "error_code": error_code,
        "created_at": "2026-09-23T00:00:00Z",
    }


async def test_run_qapp_starts_and_polls_to_a_terminal_result(monkeypatch):
    """`run_qapp` calls the SAME `POST /v1/qapps/{slug}/executions` route the
    Qapp's own page calls, and polls the SAME `GET /v1/qapps/executions/{id}` a
    browser session would — proved here at the wire level, not just the client's."""
    transport = _patch_token_client(
        monkeypatch,
        [
            (202, _execution_json(status="queued")),
            (200, _execution_json(status="running")),
            (200, _execution_json(status="succeeded", result={"correlation": 1.0})),
        ],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool(
            "run_qapp",
            {
                "slug": "bell-pair-abc123",
                "inputs": {"state": "phi_plus", "basis": "Z", "shots": 256},
            },
        )
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["status"] == "succeeded"
    assert body["result"] == {"correlation": 1.0}
    assert transport.calls[0][0] == "POST"
    assert transport.calls[0][1].endswith("/v1/qapps/bell-pair-abc123/executions")
    assert transport.calls[0][2]["Authorization"] == f"Bearer {_TEST_TOKEN}"
    assert transport.calls[0][3] == {"inputs": {"state": "phi_plus", "basis": "Z", "shots": 256}}
    assert transport.calls[1][1].endswith(f"/v1/qapps/executions/{_EXECUTION_ID}")


async def test_run_qapp_a_failed_execution_comes_back_as_data_not_a_crash(monkeypatch):
    _patch_token_client(
        monkeypatch,
        [
            (202, _execution_json(status="queued")),
            (200, _execution_json(status="failed", error_code="sandbox_timeout")),
        ],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_qapp", {"slug": "bell-pair-abc123"})
    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["status"] == "failed"
    assert body["error_code"] == "sandbox_timeout"


async def test_run_qapp_defaults_to_empty_inputs_when_omitted(monkeypatch):
    """`inputs` is optional on the tool (for a Qapp whose schema defaults every
    field), and omitting it must reach the API as `{"inputs": {}}`, never a
    missing key — `ExecuteQappRequest.inputs` on the server side defaults the
    same way, but a client that dropped the key entirely would be relying on
    that default rather than stating its own."""
    transport = _patch_token_client(
        monkeypatch,
        [(202, _execution_json(status="queued")), (200, _execution_json(status="succeeded"))],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_qapp", {"slug": "bell-pair-abc123"})
    assert result.isError is False
    assert transport.calls[0][3] == {"inputs": {}}


async def test_run_qapp_a_timeout_is_a_clear_error_not_a_long_wait(monkeypatch):
    """Same reasoning and technique as `test_run_verified_a_timeout_is_a_clear_error_
    not_a_long_wait`: real wall-clock time backs anyio's thread handoff, so this
    shortens the real poll interval rather than faking `time.monotonic()`."""
    import leona_mcp.server as server_module

    _patch_token_client(
        monkeypatch,
        [(202, _execution_json(status="queued"))]
        + [(200, _execution_json(status="running"))] * 200,
    )
    monkeypatch.setattr(server_module, "DEFAULT_POLL_S", 0.02)
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_qapp", {"slug": "bell-pair-abc123", "wait_s": 1})
    assert result.isError is True
    assert "did not reach a terminal state" in result.content[0].text
    assert _EXECUTION_ID in result.content[0].text


async def test_run_qapp_with_no_token_set_gives_clear_guidance_not_a_crash(monkeypatch):
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_qapp", {"slug": "bell-pair-abc123"})
    assert result.isError is True
    assert "LEONA_API_TOKEN" in result.content[0].text
    assert "Account" in result.content[0].text


async def test_run_qapp_a_read_only_token_is_told_to_mint_one_with_run_scope(monkeypatch):
    # Same wire shape `test_a_read_only_token_is_told_to_mint_one_with_run_scope`
    # checks for `run_verified`: RFC 7807 Problem+JSON, refusal text under
    # "title", "reason" at the top level, no "detail" key — because this is the
    # SAME `token_access.check` a `run`-scoped route always answers with.
    _patch_token_client(
        monkeypatch,
        [
            (
                403,
                {
                    "type": "about:blank",
                    "title": "this token can read but not start runs; mint one with the run scope",
                    "status": 403,
                    "code": "http_error",
                    "reason": "token_scope_insufficient",
                },
            )
        ],
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_qapp", {"slug": "bell-pair-abc123"})
    assert result.isError is True
    assert "run scope" in result.content[0].text


async def test_run_qapp_a_private_or_missing_qapp_is_not_found_not_a_crash(monkeypatch):
    _patch_token_client(
        monkeypatch, [(404, {"type": "about:blank", "title": "qapp not found", "status": 404})]
    )
    server = build_server()
    async with create_connected_server_and_client_session(server) as session:
        result = await session.call_tool("run_qapp", {"slug": "someone-elses-private-qapp"})
    assert result.isError is True
    assert "qapp not found" in result.content[0].text


async def test_the_token_never_appears_in_any_tool_output_or_log(monkeypatch, caplog):
    _patch_token_client(
        monkeypatch,
        [
            (201, _run_json(status="queued")),
            (200, _run_json(status="succeeded", verifier_decision="pass")),
            (200, _run_json(status="succeeded", verifier_decision="pass")),
            (200, [_run_json(status="succeeded")]),
            (202, _execution_json(status="queued")),
            (200, _execution_json(status="succeeded", result={"correlation": 1.0})),
        ],
    )
    server = build_server()
    with caplog.at_level("DEBUG"):
        async with create_connected_server_and_client_session(server) as session:
            results = [
                await session.call_tool("run_verified", {"prompt": "Anything"}),
                await session.call_tool("get_run", {"run_id": _RUN_ID}),
                await session.call_tool("list_my_runs", {}),
                await session.call_tool("run_qapp", {"slug": "bell-pair-abc123"}),
            ]
    for result in results:
        for block in result.content:
            assert _TEST_TOKEN not in block.text
    for record in caplog.records:
        assert _TEST_TOKEN not in record.getMessage()
