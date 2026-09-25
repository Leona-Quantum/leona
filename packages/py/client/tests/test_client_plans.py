"""`Client.plan_workflow`: POST /v1/plans, offline, with a recording transport.

What the route answers is `services/api/tests/test_plan_route.py`; this holds the
request the client sends and how a refusal reaches the caller.
"""

from __future__ import annotations

import json

import pytest

from leona_client.client import Client, LeonaClientError

_TOKEN = "lq_pat_test_token_never_leaves_this_file"  # noqa: S105 - a fixture value


class Recording:
    def __init__(self, status: int, payload: dict) -> None:
        self.status, self.payload = status, payload
        self.calls: list[tuple[str, str, dict, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), json.loads(body) if body else None))
        return self.status, json.dumps(self.payload).encode()


def test_plan_workflow_posts_the_planner_input_and_returns_the_answer_as_sent():
    transport = Recording(200, {"problem": {"id": "factoring"}, "lines": []})
    client = Client(api_url="https://api.test", token=_TOKEN, transport=transport)
    answer = client.plan_workflow(
        "factoring", {"bits": 2048}, {"hidden-period-finding": "cyclic-period-finding"}
    )
    assert answer == {"problem": {"id": "factoring"}, "lines": []}
    [(method, url, headers, body)] = transport.calls
    assert (method, url) == ("POST", "https://api.test/v1/plans")
    assert headers["Authorization"] == f"Bearer {_TOKEN}"
    assert body == {
        "problem": "factoring",
        "params": {"bits": 2048},
        "choices": {"hidden-period-finding": "cyclic-period-finding"},
    }


def test_plan_workflow_sends_empty_maps_rather_than_nulls():
    transport = Recording(200, {})
    Client(api_url="https://api.test", token=_TOKEN, transport=transport).plan_workflow("search")
    assert transport.calls[0][3] == {"problem": "search", "params": {}, "choices": {}}


def test_a_refused_value_is_raised_in_the_apis_words():
    refusal = {
        "title": "bits must be a whole number from 8 to 16384; got 7",
        "reason": "plan_input_invalid",
    }
    client = Client(api_url="https://api.test", token=_TOKEN, transport=Recording(422, refusal))
    with pytest.raises(LeonaClientError, match="from 8 to 16384") as caught:
        client.plan_workflow("factoring", {"bits": 7})
    assert caught.value.reason == "plan_input_invalid"


def test_plan_workflow_needs_a_token_and_says_where_to_get_one():
    transport = Recording(200, {})
    with pytest.raises(LeonaClientError, match="LEONA_API_TOKEN"):
        Client(api_url="https://api.test", token=None, transport=transport).plan_workflow("search")
    assert transport.calls == []
