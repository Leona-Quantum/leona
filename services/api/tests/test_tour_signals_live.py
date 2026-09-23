"""`POST /v1/tour-signals` over real HTTP, against real Postgres (migration 0071).

Anonymous end to end — no `Scope`, no `dependency_overrides` for identity, on
purpose: this route takes no credential, so there is nothing to override. What
is only checkable here rather than in a repository unit test:

- **Status codes are the contract.** 204 on success, 422 for an unknown track,
  step or kind (or a malformed body), 413 over the byte cap — a caller learns
  which by the code, and only the route decides it.
- **The upsert is really an upsert over HTTP**, not only in
  `repos/tour_signals.py`'s own unit test: two identical posts leave one row
  with `count = 2`.
- **Nothing identifying reaches the table or a log line.** A request carrying
  a distinctive `X-Forwarded-For` and `User-Agent` is posted, and neither
  string appears in the stored row or in anything the logging module captured
  during the call (05-security.md §1a, "logs proven secret/PII-free").
"""

from __future__ import annotations

import datetime as dt
import logging
import os

import httpx
import pytest
import sqlalchemy as sa
from majorana_api.app import create_app
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import TourSignalCount
from majorana_api.settings import Settings

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="tour signal routes need DATABASE_URL"
)

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
    # Ships OFF (settings.py's own docstring says why: the k6 abuse run could
    # not be completed cleanly — see docs/gates/k6-tour-signals-2026-09-23.md).
    # Every test below is ABOUT the enabled route, so it turns the flag on;
    # test_the_flag_off_by_default_404s_rather_than_answering is the one test
    # that deliberately does not.
    tour_signals_enabled=True,
)


@pytest.fixture
async def client():
    settings = Settings(**SETTINGS_KWARGS)
    app = create_app(settings)
    engine = engine_from_env()
    app.state.engine = engine
    app.state.session_factory = session_factory(engine)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http_client:
        yield http_client
    await engine.dispose()


@pytest.fixture(autouse=True)
async def _clean_table():
    """Every test in this file gets a table with no rows of its OWN making.

    Deleted rather than truncated so a concurrent live suite touching an
    unrelated table is unaffected, and deleted by a fresh connection rather
    than reusing the app's engine, so this runs even if a test above left the
    app's engine disposed.
    """
    engine = engine_from_env()
    async with engine.begin() as conn:
        await conn.execute(sa.delete(TourSignalCount))
    yield
    async with engine.begin() as conn:
        await conn.execute(sa.delete(TourSignalCount))
    await engine.dispose()


async def _count_rows(engine) -> list[tuple]:
    async with engine.begin() as conn:
        result = await conn.execute(
            sa.select(
                TourSignalCount.day,
                TourSignalCount.track,
                TourSignalCount.step,
                TourSignalCount.kind,
                TourSignalCount.count,
            )
        )
        return list(result.all())


async def test_the_flag_off_by_default_404s_rather_than_answering():
    """`tour_signals_enabled` defaults to `False` — settings.py's own docstring
    says why (the k6 run, attempted twice, could not be completed cleanly on a
    contended host). A deployment that has not flipped it on should look like
    one where the route does not exist: 404, not 422 or 204 or 413.
    """
    settings = Settings(**{k: v for k, v in SETTINGS_KWARGS.items() if k != "tour_signals_enabled"})
    assert settings.tour_signals_enabled is False
    app = create_app(settings)
    engine = engine_from_env()
    app.state.engine = engine
    app.state.session_factory = session_factory(engine)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/tour-signals", json={"track": "build", "step": "code", "kind": "step_done"}
        )
    await engine.dispose()
    assert response.status_code == 404


class TestValidSignal:
    async def test_a_known_signal_is_stored_as_one_row_with_count_one(self, client):
        response = await client.post(
            "/v1/tour-signals", json={"track": "build", "step": "code", "kind": "step_done"}
        )
        assert response.status_code == 204
        assert response.content == b""

        engine = engine_from_env()
        rows = await _count_rows(engine)
        await engine.dispose()
        assert len(rows) == 1
        day, track, step, kind, count = rows[0]
        assert day == dt.datetime.now(dt.UTC).date()
        assert (track, step, kind, count) == ("build", "code", "step_done", 1)

    async def test_the_same_signal_twice_upserts_to_count_two(self, client):
        body = {"track": "build", "step": "code", "kind": "step_done"}
        first = await client.post("/v1/tour-signals", json=body)
        second = await client.post("/v1/tour-signals", json=body)
        assert first.status_code == 204
        assert second.status_code == 204

        engine = engine_from_env()
        rows = await _count_rows(engine)
        await engine.dispose()
        assert len(rows) == 1
        assert rows[0][4] == 2

    async def test_a_show_track_and_its_own_step_are_accepted(self, client):
        # "show-cirq" is a Show-me micro-tour, not a track; its steps ("code",
        # "convert") are the same ids `build` uses, which is deliberate reuse
        # (copyKey), not a collision this route should refuse.
        response = await client.post(
            "/v1/tour-signals",
            json={"track": "show-cirq", "step": "convert", "kind": "ask_show_me"},
        )
        assert response.status_code == 204

    async def test_a_track_level_signal_uses_the_no_step_sentinel(self, client):
        # tour_started/tour_done/ask_nala/ask_show_me name no specific step at
        # their call sites in tour-runtime.tsx/tour-card.tsx; signal.ts sends
        # TOUR_SIGNAL_NO_STEP ("_track") for `step` in that case.
        response = await client.post(
            "/v1/tour-signals",
            json={"track": "build", "step": "_track", "kind": "tour_started"},
        )
        assert response.status_code == 204

        engine = engine_from_env()
        rows = await _count_rows(engine)
        await engine.dispose()
        assert rows == [(dt.datetime.now(dt.UTC).date(), "build", "_track", "tour_started", 1)]


class TestValidation:
    @pytest.mark.parametrize(
        "body",
        [
            {"track": "not-a-real-track", "step": "code", "kind": "step_done"},
            {"track": "build", "step": "not-a-real-step", "kind": "step_done"},
            {"track": "build", "step": "code", "kind": "not_a_real_kind"},
            {"track": "", "step": "code", "kind": "step_done"},
            {"track": "build", "step": "code"},
            {"kind": "step_done"},
            {},
        ],
    )
    async def test_unknown_or_malformed_values_are_refused_not_stored(self, client, body):
        response = await client.post("/v1/tour-signals", json=body)
        assert response.status_code == 422

        engine = engine_from_env()
        rows = await _count_rows(engine)
        await engine.dispose()
        assert rows == []

    async def test_track_must_be_within_the_length_the_model_bounds(self, client):
        response = await client.post(
            "/v1/tour-signals",
            json={"track": "x" * 65, "step": "code", "kind": "step_done"},
        )
        assert response.status_code == 422

    async def test_malformed_json_is_422_not_500(self, client):
        response = await client.post(
            "/v1/tour-signals",
            content=b"this is not json",
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 422

    async def test_a_body_over_the_byte_cap_is_413_and_never_reaches_the_table(self, client):
        # Well-formed JSON, but padded past MAX_TOUR_SIGNAL_BODY_BYTES with an
        # oversized (but individually within-model-bounds) field value would
        # not even parse as one of the three known fields, so pad with
        # whitespace inside the JSON instead — this exercises the SIZE check,
        # not the field-length check exercised above.
        padded = (
            b'{"track": "build", "step": "code", "kind": "step_done", "padding": "'
            + b"x" * 2000
            + b'"}'
        )
        response = await client.post(
            "/v1/tour-signals", content=padded, headers={"content-type": "application/json"}
        )
        assert response.status_code == 413

        engine = engine_from_env()
        rows = await _count_rows(engine)
        await engine.dispose()
        assert rows == []

    async def test_an_ordinary_body_under_the_cap_is_the_control_for_413(self, client):
        response = await client.post(
            "/v1/tour-signals", json={"track": "build", "step": "code", "kind": "step_done"}
        )
        assert response.status_code == 204


class TestNothingIdentifying:
    async def test_no_identifying_data_stored_or_logged(self, client, caplog):
        """Post with a distinctive IP and user agent; neither may survive it.

        `caplog` at the root logger, not just `majorana_api.*`, so a leak
        through a library logger (uvicorn's own access log is a separate
        stream outside Python `logging` under `ASGITransport` and is not
        exercised by this in-process test — see the PR body for that scope
        boundary) would still be caught if anything in this call chain used
        `logging` to report it.
        """
        distinctive_ip = "203.0.113.77"
        distinctive_ua = "leona-test-agent/canary-9f8c2b1e"

        with caplog.at_level(logging.DEBUG):
            response = await client.post(
                "/v1/tour-signals",
                json={"track": "build", "step": "code", "kind": "step_done"},
                headers={"X-Forwarded-For": distinctive_ip, "User-Agent": distinctive_ua},
            )
        assert response.status_code == 204

        for record in caplog.records:
            assert distinctive_ip not in record.getMessage()
            assert distinctive_ua not in record.getMessage()

        engine = engine_from_env()
        rows = await _count_rows(engine)
        await engine.dispose()
        assert len(rows) == 1
        # The row is exactly (day, track, step, kind, count) — five columns,
        # none of which could hold an address or a user agent even if one were
        # handed to it. Asserted on the ORM's own declared columns rather than
        # a hard-coded list, so a column added to the model without a matching
        # assertion here fails LOUDLY rather than passing by omission.
        assert {c.name for c in TourSignalCount.__table__.columns} == {
            "day",
            "track",
            "step",
            "kind",
            "count",
        }
