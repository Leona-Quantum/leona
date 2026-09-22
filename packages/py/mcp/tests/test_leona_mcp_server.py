"""The server over the MCP protocol itself, in memory, against the fake API.

`create_connected_server_and_client_session` runs the real initialize handshake
and JSON-RPC framing between an SDK client and this server, so what these tests
see is what an MCP client sees.
"""

from __future__ import annotations

import json

import httpx
import pytest
from leona_mcp_fixtures import FakeCatalogApi
from mcp.shared.memory import create_connected_server_and_client_session

from leona_mcp.client import CatalogClient
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
    assert result.instructions == INSTRUCTIONS
    for phrase in ("public, read-only API", "not stated in the record", "spends money"):
        assert phrase in result.instructions


async def test_tools_list_offers_exactly_three_read_only_tools(server, api):
    async with create_connected_server_and_client_session(server) as session:
        tools = (await session.list_tools()).tools
    assert sorted(t.name for t in tools) == ["get_method", "list_problem_areas", "search_methods"]
    for tool in tools:
        assert tool.annotations is not None
        assert tool.annotations.readOnlyHint is True
        assert tool.annotations.destructiveHint is False
        assert tool.description
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
