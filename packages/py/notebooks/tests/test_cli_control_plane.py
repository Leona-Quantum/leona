"""`leona-notebooks new|pull|push|status` — the CLI subcommands that share
`leona_notebooks.jupyter.Client` with the `%nala` Jupyter magic. Each command
rebuilds its args into the exact `%nala ...` line and hands it to the same
`run_line`, so these tests monkeypatch `Client.from_env` with a fake transport
rather than re-testing request shaping already covered by `test_jupyter_magic.py`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from leona_notebooks import cli
from leona_notebooks.jupyter import Client


class Recording:
    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _run(monkeypatch: pytest.MonkeyPatch, argv: list[str], responses: list[tuple[int, dict]]):
    transport = Recording(responses)
    fake = Client(api_url="https://api.test", token="tok", transport=transport)
    monkeypatch.setattr(Client, "from_env", classmethod(lambda cls, transport=None: fake))
    exit_code = cli.main(argv)
    return exit_code, transport


def test_cli_new_builds_the_nala_line_and_pulls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(tmp_path)
    exit_code, transport = _run(
        monkeypatch,
        ["new", "teach me a coin", "--level", "newcomer", "--no-analogies", "-o", "out.ipynb"],
        [
            (200, {"notebook": {"id": "nb1"}, "version": {"seq": 1}, "run_id": "r1"}),
            (200, {"id": "nb1", "current_version_seq": 1, "latest_status": "ready"}),
            (200, {"seq": 1, "status": "ready", "ipynb": {"nbformat": 4, "cells": []}}),
        ],
    )
    assert exit_code == 0
    assert (tmp_path / "out.ipynb").exists()
    create_body = transport.calls[0][2]
    assert create_body["brief"] == "teach me a coin"
    assert create_body["audience"] == {"level": "newcomer"}
    assert create_body["style"] == {"analogies": False}
    assert "created nb1" in capsys.readouterr().out


def test_cli_pull_saves_the_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    exit_code, _ = _run(
        monkeypatch,
        ["pull", "nb1", "-o", "lesson.ipynb"],
        [
            (200, {"id": "nb1", "current_version_seq": 2}),
            (200, {"seq": 2, "status": "ready", "ipynb": {"nbformat": 4, "cells": []}}),
        ],
    )
    assert exit_code == 0
    assert (tmp_path / "lesson.ipynb").exists()


def test_cli_push_with_to_pushes_a_new_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "mine.ipynb"
    path.write_text(json.dumps({"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []}))
    exit_code, transport = _run(
        monkeypatch,
        ["push", str(path), "--to", "nb1", "--message", "fixed it", "--no-run"],
        [(200, {"version": {"seq": 3}, "run_id": None})],
    )
    assert exit_code == 0
    method, url, body = transport.calls[0]
    assert (method, url) == ("POST", "https://api.test/v1/notebooks/nb1/versions")
    assert body == {
        "ipynb": {"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []},
        "message": "fixed it",
        "execute": False,
    }
    assert "pushed v3" in capsys.readouterr().out


def test_cli_status_prints_the_summary(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run(
        monkeypatch,
        ["status", "nb1"],
        [
            (200, {"items": [{"seq": 1, "status": "ready", "created_by": "user"}]}),
            (200, {"seq": 1, "status": "ready", "created_by": "user"}),
        ],
    )
    assert exit_code == 0
    assert "v1 ready (by user)" in capsys.readouterr().out


def test_cli_reports_a_nala_error_on_stderr_and_exits_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, _ = _run(monkeypatch, ["status", "missing"], [(404, {"title": "not found"})])
    assert exit_code == 1
    assert "error:" in capsys.readouterr().err
