"""A provider credential must not reach Sentry, and the scrubber is not why.

This file exists because the first attempt at that guarantee protected the wrong
mechanism. `observability._scrub_event` filters `event["request"]["data"]` — a
real hazard, but one sentry-sdk's own `EventScrubber` already covers, because
`api_key` is in its default denylist. What actually shipped the key was frame
locals: `include_local_variables` defaults to True, the scrubber that filters
those matches on VARIABLE name, and the FastAPI handler parameter on
`PUT /v1/qpu/credentials` is named `body` — which is not in any denylist, and
whose repr is a pydantic model repr containing the key in plaintext.

So the tests below assert the property (no plaintext anywhere in the event), not
the implementation. A future edit that swaps the mechanism keeps them passing;
one that reintroduces locals does not.
"""

import json
import os
from unittest import mock

import pytest

from majorana_api import observability

#: Not a real IBM key, and not derived from one. 44 characters, because that is
#: the length IBM issues and a length-shaped fixture is the one that would catch
#: a truncating "fix".
FAKE_KEY = "A" * 44


def _init_kwargs(monkeypatch) -> dict:
    """The kwargs `init_telemetry` passes to `sentry_sdk.init`."""
    import sentry_sdk

    captured: dict = {}

    def fake_init(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(sentry_sdk, "init", fake_init)
    monkeypatch.setitem(os.environ, "SENTRY_DSN", "https://public@example.invalid/1")
    monkeypatch.delitem(os.environ, "OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    observability.init_telemetry("api")
    return captured


def test_frame_locals_are_not_sent(monkeypatch):
    """The measured leak, pinned.

    `include_local_variables=False` is the only thing standing between a 500 in
    the connect handler and a user's IBM key in an external error tracker. It is
    asserted by name here because there is nothing else to assert — the absence
    of a feature has no positive signature in an event.
    """
    assert _init_kwargs(monkeypatch)["include_local_variables"] is False


def test_the_handler_parameter_name_is_not_covered_by_sentrys_denylist():
    """Why the fix is not "add the name to a denylist".

    If this ever starts failing because sentry-sdk added `body` to its defaults,
    that is good news and the comment in `observability` should be updated — but
    `credential` would still be uncovered, and so would the next local nobody
    thought of. The point of the assertion is that name-matching is the wrong
    layer, and it is written to keep saying so.
    """
    from sentry_sdk.scrubber import DEFAULT_DENYLIST

    denied = {entry.lower() for entry in DEFAULT_DENYLIST}
    assert "body" not in denied
    assert "credential" not in denied


@pytest.mark.parametrize(
    "data",
    [
        {"provider": "ibm", "api_key": FAKE_KEY},
        json.dumps({"provider": "ibm", "api_key": FAKE_KEY}),
    ],
    ids=["parsed-body", "raw-body"],
)
def test_no_request_body_shape_carries_the_key_out(data):
    """Belt and braces on the body, in both shapes sentry-sdk produces.

    A parsed JSON body arrives as a dict; one it could not parse arrives as a
    string, and there is no safe way to redact a field out of a string whose
    structure is unknown — so the whole value goes.
    """
    event = observability._scrub_event({"request": {"data": data}}, None)
    assert FAKE_KEY not in json.dumps(event)


def test_an_event_with_no_request_block_is_left_alone():
    """The common case must not be corrupted by the uncommon one."""
    event = {"exception": {"values": []}}
    assert observability._scrub_event(dict(event), None) == event


def test_init_is_skipped_entirely_without_a_dsn(monkeypatch):
    """No DSN, no Sentry — local dev and CI run with zero observability config,
    and a test that passed only because Sentry was silently inert would be the
    wrong kind of green."""
    import sentry_sdk

    monkeypatch.delitem(os.environ, "SENTRY_DSN", raising=False)
    monkeypatch.delitem(os.environ, "OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    with mock.patch.object(sentry_sdk, "init") as init:
        observability.init_telemetry("api")
    init.assert_not_called()
