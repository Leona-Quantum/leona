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
        run_cell("dance nb1", "body", client=client)
    with pytest.raises(NalaError, match="unknown command"):
        run_line("dance", client=Client(api_url="x", token="t", transport=lambda *a: (200, b"{}")))


def test_missing_token_is_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    with pytest.raises(NalaError, match="LEONA_API_TOKEN"):
        Client.from_env()


# --------------------------------------------------------------------------- new


def test_new_creates_polls_and_pulls_with_every_preference(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    client, transport = _client(
        [
            (200, {"notebook": {"id": "nb1"}, "version": {"seq": 1}, "run_id": "r1"}),
            (200, {"id": "nb1", "current_version_seq": 1, "latest_status": "ready"}),
            (200, {"seq": 1, "status": "ready", "ipynb": {"nbformat": 4, "cells": []}}),
        ]
    )
    message = run_line(
        'new "teach me a coin" --level newcomer --no-analogies --math full --lang ja',
        client=client,
    )
    assert "created nb1" in message
    assert (tmp_path / "leona-nb1.ipynb").exists()

    create_method, create_url, create_body = transport.calls[0]
    assert (create_method, create_url) == ("POST", "https://api.test/v1/notebooks")
    assert create_body == {
        "brief": "teach me a coin",
        "audience": {"level": "newcomer"},
        "style": {"analogies": False, "math_level": "full", "language": "ja"},
        "response_locale": "ja",
    }
    # wait_for_version's poll already confirmed the seq; pull must reuse it
    # rather than asking the API to resolve current_version_seq a second time.
    assert [c[1] for c in transport.calls[1:]] == [
        "https://api.test/v1/notebooks/nb1",
        "https://api.test/v1/notebooks/nb1/versions/1",
    ]


def test_new_reports_a_failed_generation_without_writing_a_file(tmp_path: Path) -> None:
    client, _ = _client(
        [
            (200, {"notebook": {"id": "nb1"}, "version": {"seq": 1}, "run_id": "r1"}),
            (200, {"id": "nb1", "current_version_seq": None, "latest_status": "failed"}),
        ]
    )
    with pytest.raises(NalaError, match="failed to generate"):
        run_line('new "a broken brief"', client=client)
    assert not (tmp_path / "leona-nb1.ipynb").exists()


def test_new_requires_a_brief() -> None:
    with pytest.raises(NalaError, match="usage"):
        run_line("new", client=Client(api_url="x", token="t", transport=lambda *a: (200, b"{}")))


def test_wait_for_version_polls_until_ready_and_ticks_each_time() -> None:
    client, _ = _client(
        [
            (200, {"id": "nb1", "current_version_seq": None, "latest_status": "running"}),
            (200, {"id": "nb1", "current_version_seq": None, "latest_status": "running"}),
            (200, {"id": "nb1", "current_version_seq": 3, "latest_status": "ready"}),
        ]
    )
    ticks: list[None] = []
    sleeps: list[float] = []
    notebook = client.wait_for_version(
        "nb1", wait_s=10, poll_s=0.01, sleep=sleeps.append, on_tick=lambda: ticks.append(None)
    )
    assert notebook["current_version_seq"] == 3
    assert len(ticks) == 2 and len(sleeps) == 2


def test_wait_for_version_times_out_rather_than_polling_forever() -> None:
    client, _ = _client(
        [(200, {"id": "nb1", "current_version_seq": None, "latest_status": "running"})] * 3
    )
    with pytest.raises(NalaError, match="still generating"):
        client.wait_for_version("nb1", wait_s=0, poll_s=0.01, sleep=lambda _s: None)


# --------------------------------------------------------------------------- push --to


def test_push_to_pushes_a_new_version_of_a_notebook_you_own(tmp_path: Path) -> None:
    path = tmp_path / "mine.ipynb"
    path.write_text(json.dumps({"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []}))
    client, transport = _client([(200, {"version": {"seq": 4}, "run_id": "r2"})])
    message = run_line(f'push {path} --to nb1 --message "fixed the coin"', client=client)
    assert "pushed v4 to nb1" in message
    method, url, body = transport.calls[0]
    assert (method, url) == ("POST", "https://api.test/v1/notebooks/nb1/versions")
    assert body["message"] == "fixed the coin"
    assert body["execute"] is True
    assert body["ipynb"]["nbformat"] == 4


def test_push_to_with_no_run_does_not_ask_for_execution(tmp_path: Path) -> None:
    path = tmp_path / "mine.ipynb"
    path.write_text(json.dumps({"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []}))
    client, transport = _client([(200, {"version": {"seq": 5}, "run_id": None})])
    message = run_line(f"push {path} --to nb1 --no-run", client=client)
    assert "not re-run" in message
    assert transport.calls[0][2]["execute"] is False


# --------------------------------------------------------------------------- status


def test_status_summary_reports_the_newest_version_and_cell_counts() -> None:
    client, transport = _client(
        [
            (
                200,
                {
                    "items": [
                        {"seq": 1, "status": "ready", "created_by": "user"},
                        {"seq": 2, "status": "ready", "created_by": "nala"},
                    ]
                },
            ),
            (
                200,
                {
                    "seq": 2,
                    "status": "ready",
                    "created_by": "nala",
                    "message": "fixed the coin",
                    "report": {
                        "cells": [
                            {"id": "c1", "status": "ok"},
                            {"id": "c2", "status": "ok"},
                            {"id": "c3", "status": "error"},
                            {"id": "c4", "status": "not_run"},
                        ]
                    },
                },
            ),
        ]
    )
    message = run_line("status nb1", client=client)
    assert "v2 ready (by nala)" in message
    assert "message: fixed the coin" in message
    assert "cells: 2 ran, 1 failed, 1 not run" in message
    assert transport.calls[1][1] == "https://api.test/v1/notebooks/nb1/versions/2"


def test_status_summary_with_no_versions() -> None:
    client, _ = _client([(200, {"items": []})])
    assert run_line("status nb1", client=client) == "nb1: no versions yet"


# --------------------------------------------------------------------------- explain


def test_explain_cell_magic_asks_at_the_given_level() -> None:
    client, transport = _client(
        [
            (200, {"turn": {"seq": 1}, "run_id": "r"}),
            (200, {"items": [{"role": "nala", "seq": 2, "content": "Line 1 makes a qubit."}]}),
        ]
    )
    reply = run_cell(
        "explain nb1 --level newcomer", "qc = QuantumCircuit(1)\nqc.h(0)", client=client
    )
    assert reply == "Line 1 makes a qubit."
    message = transport.calls[0][2]["message"]
    assert message.startswith("Explain this code line by line for a newcomer:")
    assert "qc.h(0)" in message


def test_explain_defaults_to_engineer_level() -> None:
    client, transport = _client(
        [
            (200, {"turn": {"seq": 1}, "run_id": "r"}),
            (200, {"items": [{"role": "nala", "seq": 2, "content": "ok"}]}),
        ]
    )
    run_cell("explain nb1", "x = 1", client=client)
    assert transport.calls[0][2]["message"].startswith(
        "Explain this code line by line for a engineer:"
    )


# --------------------------------------------------------------------------- fix


def test_fix_reads_the_last_traceback_and_asks() -> None:
    client, transport = _client(
        [
            (200, {"turn": {"seq": 1}, "run_id": "r"}),
            (200, {"items": [{"role": "nala", "seq": 2, "content": "You divided by zero."}]}),
        ]
    )

    def fake_context() -> tuple[str, str]:
        return "1 / 0", "ZeroDivisionError: division by zero"

    reply = run_line("fix nb1", client=client, fix_context=fake_context)
    assert reply == "You divided by zero."
    message = transport.calls[0][2]["message"]
    assert "This cell failed in my Jupyter:" in message
    assert "1 / 0" in message
    assert "ZeroDivisionError: division by zero" in message
    assert message.endswith("Explain what went wrong and give me the corrected cell.")


def test_fix_with_nothing_failed_is_a_clear_error() -> None:
    client = Client(api_url="x", token="t", transport=lambda *a: (200, b"{}"))
    with pytest.raises(NalaError, match="nothing has failed"):
        run_line("fix nb1", client=client, fix_context=lambda: None)


def test_fix_without_any_context_source_is_a_clear_error() -> None:
    client = Client(api_url="x", token="t", transport=lambda *a: (200, b"{}"))
    with pytest.raises(NalaError, match="only works inside a live IPython"):
        run_line("fix nb1", client=client)
