"""`plan_workflow`: the MCP tool over `POST /v1/plans`, against a recorded transport.

The numbers are the API's (`services/api/tests/test_plan_route.py` runs the whole chain,
MCP tool to route to planner, and writes the README example from it). These tests hold
what this package adds: the request it sends, the language it answers in, and a
`summary` that never states a number without its kind and source.
"""

from __future__ import annotations

import json

from mcp.shared.memory import create_connected_server_and_client_session

from leona_mcp.server import PLAN_CATALOG, PLAN_DESCRIPTION, _plan_summary, build_server

_TOKEN = "lq_pat_plan_workflow_tool_test_token_000"  # noqa: S105 - a fixture value


def _b(en: str, ja: str | None = None) -> dict[str, str]:
    return {"en": en, "ja": ja if ja is not None else f"ja:{en}"}


def _line(line_id, label, value, unit, kind, source, *, missing=(), qualifier=None):
    return {
        "id": line_id,
        "label": _b(label),
        "value": value,
        "unit": _b(unit),
        "formula": "f",
        "kind": kind,
        "source": source,
        "qualifier": qualifier,
        "note": None,
        "missing": list(missing),
        "counts": None,
    }


#: A plan in the API's shape, small and made up: this file tests wording, not numbers.
PLAN = {
    "problem": {
        "id": "factoring",
        "label": _b("Factor an integer (RSA)"),
        "capability": "hidden-period-finding",
    },
    "params": [
        {
            "key": "bits",
            "label": _b("Size of the number (bits)"),
            "unit": None,
            "value": 2048,
            "origin": "reader",
            "assumed_reason": None,
            "assumed_source": None,
            "min": 8,
            "max": 16384,
            "integer": True,
        }
    ],
    "stages": [
        {
            "path": "hidden-period-finding",
            "depth": 0,
            "capability": {"id": "hidden-period-finding", "label": _b("Find a hidden period")},
            "method": {
                "id": "cyclic-period-finding",
                "label": _b("Cyclic period finding"),
                "stated_cost": None,
            },
            "choice": "preferred",
            "reason": None,
            "alternatives": [],
            "repeat": None,
            "stop": None,
        }
    ],
    "compile_stages": [],
    "lines": [
        _line(
            "ge2021-qubits",
            "Logical qubits",
            6190,
            "logical qubits",
            "leading-order",
            "ge2021-logical",
        ),
        _line(
            "ge2021-toffolis",
            "Toffoli gates",
            2624225017.856,
            "Toffoli gates",
            "leading-order",
            "ge2021-logical",
        ),
        _line("x-missing", "Something", None, "gates", "exact", None, missing=["orbitals"]),
        _line("x-scaling", "Leading term", 10000, "", "scaling", "ge2021-logical"),
    ],
    "classical": [],
    "published": [
        _line(
            "g2025-machine",
            "Noisy qubits",
            1000000,
            "physical qubits",
            "published",
            "ge2021-logical",
            qualifier="<",
        ),
    ],
    "logical": {
        "logical_qubits": "ge2021-qubits",
        "toffolis": "ge2021-toffolis",
        "t_gates": None,
        "queries": None,
        "serial_depth": None,
    },
    "notes": [{"id": "n", "text": _b("A note.")}],
    "estimate_point": {
        "label": "factoring (Leona planner)",
        "parameter_value": 2048,
        "logical_qubits": 6190,
        "toffoli_count": 2624225018,
        "t_count": 0,
        "non_clifford_depth": 0,
    },
    "sources": {
        "ge2021-logical": {
            "paper_id": "arxiv:1905.09749",
            "title": "How to factor 2048 bit RSA integers in 8 hours using 20 million noisy qubits",
            "authors": "Craig Gidney, Martin Ekerå",
            "year": "2019",
            "url": "https://arxiv.org/abs/1905.09749",
            "locator": _b("abstract"),
            "quote": "uses 3n + 0.002n lg n logical qubits",
        }
    },
    "ignored_choices": [],
}


class _Recording:
    def __init__(self, status: int, payload: dict) -> None:
        self.status, self.payload = status, payload
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, json.loads(body) if body else None))
        return self.status, json.dumps(self.payload).encode()


def _patch(monkeypatch, status=200, payload=PLAN):
    import leona_mcp.server as server_module

    transport = _Recording(status, payload)
    client = server_module.Client(api_url="https://api.example", token=_TOKEN, transport=transport)
    monkeypatch.setattr(server_module.Client, "from_env", classmethod(lambda cls: client))
    return transport


async def test_the_tool_sends_the_planner_input_and_answers_in_english(monkeypatch):
    transport = _patch(monkeypatch)
    async with create_connected_server_and_client_session(build_server()) as session:
        result = await session.call_tool(
            "plan_workflow",
            {
                "problem": "factoring",
                "params": {"bits": 2048},
                "choices": {"hidden-period-finding": "cyclic-period-finding"},
            },
        )
    assert result.isError is False, result.content[0].text
    [(method, url, body)] = transport.calls
    assert (method, url) == ("POST", "https://api.example/v1/plans")
    assert body == {
        "problem": "factoring",
        "params": {"bits": 2048},
        "choices": {"hidden-period-finding": "cyclic-period-finding"},
    }
    answer = json.loads(result.content[0].text)
    assert answer["lines"][0]["label"] == "Logical qubits"
    assert answer["sources"]["ge2021-logical"]["locator"] == "abstract"
    assert "summary" in answer


async def test_the_tool_answers_in_japanese_when_asked(monkeypatch):
    _patch(monkeypatch)
    async with create_connected_server_and_client_session(build_server()) as session:
        result = await session.call_tool(
            "plan_workflow", {"problem": "factoring", "language": "ja"}
        )
    answer = json.loads(result.content[0].text)
    assert answer["lines"][0]["label"] == "ja:Logical qubits"


async def test_an_unknown_problem_is_refused_before_any_request(monkeypatch):
    transport = _patch(monkeypatch)
    async with create_connected_server_and_client_session(build_server()) as session:
        result = await session.call_tool("plan_workflow", {"problem": "teleportation"})
    assert result.isError is True
    assert transport.calls == []


async def test_a_value_out_of_range_comes_back_in_the_apis_words(monkeypatch):
    refusal = {
        "title": "bits must be a whole number from 8 to 16384; got 7",
        "reason": "plan_input_invalid",
    }
    _patch(monkeypatch, status=422, payload=refusal)
    async with create_connected_server_and_client_session(build_server()) as session:
        result = await session.call_tool(
            "plan_workflow", {"problem": "factoring", "params": {"bits": 7}}
        )
    assert result.isError is True
    assert "from 8 to 16384" in result.content[0].text


def test_the_summary_states_no_number_without_its_kind_and_source():
    summary = _plan_summary(_en(PLAN))
    assert (
        "Logical qubits: 6,190 logical qubits [leading-order; Gidney & Ekerå 2019 (arxiv:1905.09749), abstract]"
        in summary
    )
    assert "Toffoli gates: 2.62e9 Toffoli gates [leading-order;" in summary
    assert (
        "Something: not computed, needs orbitals [exact; no paper: Leona's own arithmetic]"
        in summary
    )
    assert "Leading term: 10,000, a magnitude with no constant, not a count [scaling;" in summary
    assert "Noisy qubits: < 1,000,000 physical qubits [published;" in summary
    assert "A note." in summary
    assert "pass estimate_point to estimate_resources" in summary
    assert "verified" not in summary.lower()


def _en(plan):
    from leona_mcp.server import _in_language

    return _in_language(plan, "en")


def test_the_description_teaches_every_problem_parameter_and_root_choice_from_the_catalog():
    """Generated, not hand-written: every problem, parameter key and root method the
    committed catalog holds is named in the description."""
    assert len(PLAN_CATALOG["problems"]) >= 11
    for problem in PLAN_CATALOG["problems"]:
        assert f"'{problem['id']}'" in PLAN_DESCRIPTION
        for spec in problem["params"]:
            assert spec["key"] in PLAN_DESCRIPTION
        for method in problem["root"]["methods"]:
            assert method["id"] in PLAN_DESCRIPTION
