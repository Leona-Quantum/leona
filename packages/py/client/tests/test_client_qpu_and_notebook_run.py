"""`Client` additions for the Bridge lane (ai-ops 362, 2026-09-23): QPU device
listing and pricing, and the extra notebook calls `%nala run` needs
(`rerun`/`wait_for_version_seq`/`push_version(run_until=...)`).

Offline, with the same recording fake transport `test_client_notebooks.py` and
`test_client_runs.py` already use.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from leona_client.client import Client, LeonaClientError

_TOKEN = "lq_pat_test_token_never_leaves_this_file"  # noqa: S105 - a fixture value


class Recording:
    def __init__(self, responses: list[tuple[int, dict | list]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict | list | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _client(responses):
    transport = Recording(responses)
    return Client(api_url="https://api.test", token=_TOKEN, transport=transport), transport


# --------------------------------------------------------------------------- qpu


def test_qpu_backends_unwraps_the_list():
    client, transport = _client(
        [(200, {"backends": [{"device_id": "ibm.open_plan"}, {"device_id": "ibm.kyiv"}]})]
    )
    backends = client.qpu_backends()
    assert [b["device_id"] for b in backends] == ["ibm.open_plan", "ibm.kyiv"]
    assert transport.calls[0][1] == "https://api.test/v1/qpu/backends"


def test_qpu_estimate_posts_device_shots_and_zne():
    client, transport = _client(
        [(200, {"device_id": "ibm.open_plan", "shots": 100, "basis": "free_queue"})]
    )
    result = client.qpu_estimate("ibm.open_plan", 100)
    assert result["basis"] == "free_queue"
    assert transport.calls[0][2] == {"device_id": "ibm.open_plan", "shots": 100, "zne": False}


def test_qpu_estimate_passes_zne_through():
    client, transport = _client([(200, {"device_id": "d", "shots": 5})])
    client.qpu_estimate("d", 5, zne=True)
    assert transport.calls[0][2]["zne"] is True


# ------------------------------------------------------------------- notebook run


def test_rerun_posts_with_no_body():
    client, transport = _client([(200, {"version": {"seq": 3}, "run_id": "r1"})])
    result = client.rerun("nb1")
    assert result["version"]["seq"] == 3
    method, url, body = transport.calls[0]
    assert (method, url, body) == ("POST", "https://api.test/v1/notebooks/nb1/run", None)


def test_push_version_omits_run_until_by_default(tmp_path: Path):
    path = _write_ipynb(tmp_path)
    client, transport = _client([(200, {"version": {"seq": 2}})])
    client.push_version("nb1", path)
    body = transport.calls[0][2]
    assert "run_until" not in body


def test_push_version_includes_run_until_when_given(tmp_path: Path):
    path = _write_ipynb(tmp_path)
    client, transport = _client([(200, {"version": {"seq": 2}})])
    client.push_version("nb1", path, run_until="c03")
    assert transport.calls[0][2]["run_until"] == "c03"


def _write_ipynb(dir_path: Path) -> Path:
    path = dir_path / "mine.ipynb"
    path.write_text(json.dumps({"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []}))
    return path


def test_wait_for_version_seq_polls_the_exact_seq_until_terminal():
    client, _ = _client(
        [
            (200, {"seq": 2, "status": "queued"}),
            (200, {"seq": 2, "status": "running"}),
            (200, {"seq": 2, "status": "ready", "report": {"cells": []}}),
        ]
    )
    ticks: list[None] = []
    version = client.wait_for_version_seq(
        "nb1", 2, wait_s=10, poll_s=0.01, sleep=lambda _s: None, on_tick=lambda: ticks.append(None)
    )
    assert version["status"] == "ready"
    assert len(ticks) == 2


def test_wait_for_version_seq_times_out_rather_than_polling_forever():
    client, _ = _client([(200, {"seq": 2, "status": "running"})] * 3)
    with pytest.raises(LeonaClientError, match="still running"):
        client.wait_for_version_seq("nb1", 2, wait_s=0, poll_s=0.01, sleep=lambda _s: None)


def test_wait_for_version_seq_does_not_get_distracted_by_a_different_seq_racing_ahead():
    """The whole reason this exists rather than reusing `wait_for_version`: another
    version can become current while THIS one is still running, and a caller that
    asked to wait for seq 2 must not be handed seq 3's report instead."""
    client, _ = _client(
        [
            (200, {"seq": 2, "status": "running"}),
            (200, {"seq": 2, "status": "ready", "report": {"cells": []}}),
        ]
    )
    version = client.wait_for_version_seq("nb1", 2, wait_s=10, poll_s=0.01, sleep=lambda _s: None)
    assert version["seq"] == 2
