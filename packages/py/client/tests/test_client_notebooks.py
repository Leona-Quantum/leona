"""`Client`'s notebook methods — generalised from `leona_notebooks.jupyter.Client`
verbatim; `leona_notebooks`'s own tests (`test_jupyter_magic.py`,
`test_cli_control_plane.py`) exercise the `%nala`-facing subclass end to end, so
these cover the base class directly and the one behaviour that changed on purpose:
`pull()` on the base class refuses a version with no rendered `ipynb`, rather than
rendering one from a `spec` — that needs `leona_notebooks.ipynb`, which this
package does not depend on.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from leona_client.client import Client, LeonaClientError


class Recording:
    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _client(responses):
    transport = Recording(responses)
    return Client(api_url="https://api.test", token="tok", transport=transport), transport


def test_create_posts_the_brief_dropping_none_fields():
    client, transport = _client(
        [(200, {"notebook": {"id": "nb1", "title": "t"}, "version": {"seq": 1}, "run_id": "r1"})]
    )
    created = client.create("teach me a qubit", kind=None, audience={"level": "newcomer"})
    assert created["notebook"]["id"] == "nb1"
    assert transport.calls[0][2] == {
        "brief": "teach me a qubit",
        "audience": {"level": "newcomer"},
    }


def test_versions_and_version():
    client, _ = _client(
        [
            (200, {"items": [{"seq": 1, "status": "ready", "created_by": "nala"}]}),
            (200, {"seq": 1, "status": "ready", "created_by": "nala"}),
        ]
    )
    rows = client.versions("nb1")
    assert rows[0]["seq"] == 1
    detail = client.version("nb1", 1)
    assert detail["status"] == "ready"


def test_pull_writes_a_version_that_already_has_an_ipynb(tmp_path: Path):
    client, _ = _client(
        [
            (200, {"id": "nb1", "current_version_seq": 2}),
            (200, {"seq": 2, "status": "ready", "ipynb": {"nbformat": 4, "cells": []}}),
        ]
    )
    out = tmp_path / "x.ipynb"
    client.pull("nb1", None, out)
    assert json.loads(out.read_text())["nbformat"] == 4


def test_pull_refuses_a_version_with_no_rendered_ipynb(tmp_path: Path):
    """The base `Client` cannot render a `spec` into an `.ipynb` — that needs
    `leona_notebooks.ipynb`/`spec`, which this package does not depend on. It
    fails clearly rather than writing nothing or guessing."""
    client, _ = _client([(200, {"seq": 3, "status": "ready", "spec": {"slug": "x"}})])
    with pytest.raises(LeonaClientError, match="no rendered ipynb"):
        client.pull("nb1", 3, tmp_path / "x.ipynb")


def test_status_summary_reports_cell_counts():
    client, _ = _client(
        [
            (200, {"items": [{"seq": 1, "status": "ready", "created_by": "nala"}]}),
            (
                200,
                {
                    "seq": 1,
                    "status": "ready",
                    "created_by": "nala",
                    "report": {
                        "cells": [
                            {"status": "ok"},
                            {"status": "error"},
                            {"status": "skipped"},
                        ]
                    },
                },
            ),
        ]
    )
    summary = client.status_summary("nb1")
    assert "1 ran, 1 failed, 1 not run" in summary


def test_ask_polls_for_a_later_reply_and_stops_when_none_arrives():
    client, _ = _client(
        [
            (200, {"turn": {"seq": 1}}),
            (200, {"items": [{"role": "user", "seq": 1, "content": "hi"}]}),
        ]
    )
    with pytest.raises(LeonaClientError, match="has not replied yet"):
        client.ask("nb1", "hi", wait_s=0, poll_s=0, sleep=lambda _s: None)
