import asyncio
import logging
import re
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

import majorana_worker.__main__ as worker_main
from majorana_api.vqe_runtime_profiles import production_runtime_profile
from majorana_vqe.models import Framework


pytestmark = pytest.mark.anyio


async def test_readiness_probe_failure_is_isolated_and_persisted_fail_closed(monkeypatch):
    """One broken runtime must not hide the readiness of every other runtime.

    The first probe deliberately contains a secret-looking exception message.
    Only its class may influence the persisted digest and structured log.
    """

    profiles = (
        production_runtime_profile(Framework.QISKIT),
        production_runtime_profile(Framework.PENNYLANE),
    )
    monkeypatch.setattr(worker_main, "_vqe_runtime_profiles", lambda: profiles)

    probe = AsyncMock(side_effect=[RuntimeError("do-not-log-this-secret"), "a" * 64])
    monkeypatch.setattr(worker_main, "probe_runtime_profile", probe)

    persisted: list[dict] = []

    async def fake_upsert(_session, **values):
        persisted.append(values)

    monkeypatch.setattr(worker_main.system, "upsert_vqe_runtime_readiness", fake_upsert)

    commit = AsyncMock()

    @asynccontextmanager
    async def factory():
        yield type("Session", (), {"commit": commit})()

    records: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        worker_main,
        "_structured_log",
        lambda level, message, **values: records.append((level, message, values)),
    )

    await worker_main._publish_vqe_runtime_readiness(factory, worker_id="worker-test")

    assert probe.await_count == 2
    assert commit.await_count == 2
    assert [row["runtime_profile_id"] for row in persisted] == [
        profile.binding.runtime_profile_id for profile in profiles
    ]
    assert persisted[0]["status"] == "unavailable"
    assert persisted[0]["detail_sha256"] != "a" * 64
    assert re.fullmatch(r"[0-9a-f]{64}", persisted[0]["detail_sha256"])
    assert persisted[1]["status"] == "ready"
    assert persisted[1]["detail_sha256"] == "a" * 64
    assert persisted[0]["generation"] == persisted[1]["generation"]
    assert persisted[0]["expires_at"] > persisted[0]["observed_at"]

    assert [record[0] for record in records] == ["ERROR", "INFO"]
    assert records[0][2]["failure_code"] == "readiness_probe_internal_error"
    assert records[1][2]["failure_code"] == "none"
    assert "do-not-log-this-secret" not in repr(records)


async def test_readiness_loop_does_not_stop_and_does_not_log_exception_values(
    monkeypatch, caplog
):
    publish = AsyncMock(side_effect=RuntimeError("do-not-log-this-secret"))
    monkeypatch.setattr(worker_main, "_publish_vqe_runtime_readiness", publish)
    monkeypatch.setattr(worker_main, "VQE_READINESS_INTERVAL_S", 0.001)
    stop = asyncio.Event()

    with caplog.at_level(logging.ERROR):
        task = asyncio.create_task(
            worker_main._run_vqe_readiness_loop(
                object(), worker_id="worker-test", stop=stop
            )
        )
        for _ in range(100):
            if publish.await_count >= 2:
                break
            await asyncio.sleep(0.001)
        stop.set()
        await task

    assert publish.await_count >= 2
    assert "RuntimeError" in caplog.text
    assert "do-not-log-this-secret" not in caplog.text
