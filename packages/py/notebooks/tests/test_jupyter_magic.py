"""The `%nala` magic's request shaping, with a recording transport and no IPython."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from leona_notebooks.jupyter import Client, NalaError, run_cell, run_line


class Recording:
    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, json.loads(body) if body else None))
        assert headers["Authorization"] == "Bearer tok"
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _client(responses):
    transport = Recording(responses)
    return Client(api_url="https://api.test", token="tok", transport=transport), transport


def test_pull_saves_the_versions_ipynb(tmp_path: Path) -> None:
    client, transport = _client(
        [
            (200, {"id": "nb1", "current_version_seq": 2}),
            (200, {"seq": 2, "status": "ready", "ipynb": {"nbformat": 4, "cells": []}}),
        ]
    )
    out = tmp_path / "x.ipynb"
    message = run_line(f"pull nb1 -o {out}", client=client)
    assert "saved" in message and json.loads(out.read_text())["nbformat"] == 4
    assert [c[1] for c in transport.calls] == [
        "https://api.test/v1/notebooks/nb1",
        "https://api.test/v1/notebooks/nb1/versions/2",
    ]


def test_pull_compiles_the_spec_when_no_executed_copy_exists(tmp_path: Path) -> None:
    spec = {"slug": "s", "title": "T", "cells": [{"id": "c01", "kind": "code", "source": "x=1\n"}]}
    client, _ = _client([(200, {"seq": 1, "status": "ready", "ipynb": None, "spec": spec})])
    out = tmp_path / "y.ipynb"
    run_line(f"pull nb1 --version 1 -o {out}", client=client)
    assert json.loads(out.read_text())["cells"][0]["source"] == "x=1\n"


def test_push_imports_the_file(tmp_path: Path) -> None:
    path = tmp_path / "mine.ipynb"
    path.write_text(json.dumps({"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []}))
    client, transport = _client([(200, {"notebook": {"id": "nb9", "title": "Mine"}})])
    message = run_line(f'push {path} --title "Mine"', client=client)
    assert "nb9" in message
    method, url, body = transport.calls[0]
    assert (method, url) == ("POST", "https://api.test/v1/notebooks/import")
    assert body["title"] == "Mine" and body["execute"] is True and body["ipynb"]["nbformat"] == 4


def test_ask_posts_a_turn_and_waits_for_the_reply() -> None:
    client, transport = _client(
        [
            (200, {"turn": {"seq": 3}, "run_id": "r"}),
            (200, {"items": [{"role": "user", "seq": 3, "content": "q"}]}),
            (
                200,
                {
                    "items": [
                        {"role": "user", "seq": 3, "content": "q"},
                        {"role": "nala", "seq": 4, "content": "Because H."},
                    ]
                },
            ),
        ]
    )
    sleeps: list[float] = []
    reply = client.ask("nb1", "why?", wait_s=10, poll_s=0.01, sleep=sleeps.append)
    assert reply == "Because H." and len(sleeps) == 1
    assert transport.calls[0][2] == {"message": "why?"}


def test_errors_are_problem_titles_and_usage_is_checked() -> None:
    client, _ = _client([(404, {"title": "notebook not found", "status": 404})])
    with pytest.raises(NalaError, match="404: notebook not found"):
        run_line("versions missing", client=client)
    with pytest.raises(NalaError, match="usage"):
        run_cell("explain nb1", "body", client=client)
    with pytest.raises(NalaError, match="unknown command"):
        run_line("dance", client=Client(api_url="x", token="t", transport=lambda *a: (200, b"{}")))


def test_missing_token_is_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    with pytest.raises(NalaError, match="LEONA_API_TOKEN"):
        Client.from_env()
