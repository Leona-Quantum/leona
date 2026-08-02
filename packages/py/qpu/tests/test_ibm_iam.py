"""Verifying an IBM API key: what is accepted, what is refused, what is scrubbed.

Three outcomes that must stay three, because a user acts differently on each:
IBM refused the key, IBM could not be reached, IBM said yes. Collapsing the
first two sends somebody to regenerate a credential that was fine.

Everything here runs against an injected transport. The one call this module
makes against the real `iam.cloud.ibm.com` was made once, by hand, with a
deliberately invalid key, and its result is recorded in `majorana_qpu.iam`'s
docstring — a network call in a unit suite is a test that fails on a train.
"""

import json

import pytest

from majorana_qpu import (
    IbmCredentialRejected,
    IbmVerificationUnavailable,
    verify_ibm_api_key,
)
from majorana_qpu.iam import IAM_GRANT_TYPE, IAM_TOKEN_URL

#: 44 characters, the length IBM issues. Not a real key and not derived from one.
FAKE_KEY = "k" * 44


def _transport(status: int, payload):
    """A transport that answers with exactly this, and records what it was sent."""
    seen: dict = {}

    def post(url, body, headers, timeout):
        seen["url"] = url
        seen["body"] = body.decode("utf-8")
        seen["headers"] = headers
        seen["timeout"] = timeout
        raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        return status, raw

    post.seen = seen
    return post


def test_a_good_key_is_accepted_quietly():
    post = _transport(200, {"access_token": "a-bearer-token", "expires_in": 3600})
    assert verify_ibm_api_key(FAKE_KEY, transport=post) is None


def test_the_request_is_the_documented_iam_grant():
    """Shape pinned, because it is the whole of the verification.

    A request that posted the key to the wrong URL, or under the wrong
    grant_type, would fail every real key while passing any test that only
    checked which exception came back.
    """
    post = _transport(200, {"access_token": "t"})
    verify_ibm_api_key(FAKE_KEY, transport=post)
    assert post.seen["url"] == IAM_TOKEN_URL
    assert post.seen["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    assert f"grant_type={IAM_GRANT_TYPE.replace(':', '%3A')}" in post.seen["body"]
    assert f"apikey={FAKE_KEY}" in post.seen["body"]


def test_the_access_token_is_not_returned():
    """It expires in an hour, we have no use for it, and a secret we keep is a
    secret we are responsible for."""
    post = _transport(200, {"access_token": "a-bearer-token"})
    assert verify_ibm_api_key(FAKE_KEY, transport=post) is None


def test_a_200_without_a_token_is_not_a_verified_key():
    """Accepting it would store a credential on the strength of a status code."""
    post = _transport(200, {"expires_in": 3600})
    with pytest.raises(IbmVerificationUnavailable):
        verify_ibm_api_key(FAKE_KEY, transport=post)


def test_ibms_refusal_is_a_rejection_not_an_outage():
    """The real 400 body, recorded from `iam.cloud.ibm.com` with an invalid key."""
    post = _transport(
        400,
        {
            "errorCode": "BXNIM0415E",
            "errorMessage": "Provided API key could not be found.",
        },
    )
    with pytest.raises(IbmCredentialRejected) as excinfo:
        verify_ibm_api_key(FAKE_KEY, transport=post)
    message = str(excinfo.value)
    assert "44 characters" in message
    assert "could not be found" in message
    assert "BXNIM0415E" in message


def test_a_server_error_is_an_outage_not_a_rejection():
    post = _transport(503, {"errorMessage": "service unavailable"})
    with pytest.raises(IbmVerificationUnavailable):
        verify_ibm_api_key(FAKE_KEY, transport=post)


def test_a_transport_failure_is_an_outage():
    def exploding(url, body, headers, timeout):
        raise OSError("connection reset by peer")

    with pytest.raises(IbmVerificationUnavailable):
        verify_ibm_api_key(FAKE_KEY, transport=exploding)


def test_a_transport_failure_does_not_chain_the_frame_holding_the_key():
    """`from None`, and it matters.

    The frame that raised is the frame with the key in its locals, and a chained
    traceback is exactly how it reaches a log aggregator.
    """

    def exploding(url, body, headers, timeout):
        raise OSError(f"connection to host failed while sending {FAKE_KEY}")

    with pytest.raises(IbmVerificationUnavailable) as excinfo:
        verify_ibm_api_key(FAKE_KEY, transport=exploding)
    assert excinfo.value.__cause__ is None
    assert FAKE_KEY not in str(excinfo.value)


def test_an_unparseable_body_still_produces_the_right_kind_of_answer():
    post = _transport(400, b"<html>gateway</html>")
    with pytest.raises(IbmCredentialRejected) as excinfo:
        verify_ibm_api_key(FAKE_KEY, transport=post)
    assert "HTTP 400" in str(excinfo.value)


def test_provider_text_that_echoes_the_key_is_dropped_entirely():
    """The upstream not echoing secrets today is a property of somebody else's code.

    Not a redaction in place: a message built around a secret leaks its length,
    and there is nothing in an IAM error body worth that.
    """
    post = _transport(400, {"errorMessage": f"apikey {FAKE_KEY} is not valid"})
    with pytest.raises(IbmCredentialRejected) as excinfo:
        verify_ibm_api_key(FAKE_KEY, transport=post)
    assert FAKE_KEY not in str(excinfo.value)


def test_a_truncated_paste_is_refused_without_contacting_ibm():
    """The commonest user error, answered locally and without a round trip."""

    def must_not_run(url, body, headers, timeout):
        raise AssertionError("an obviously malformed key must not be sent anywhere")

    with pytest.raises(IbmCredentialRejected) as excinfo:
        verify_ibm_api_key("abc", transport=must_not_run)
    assert "44" in str(excinfo.value)


def test_no_exception_this_module_raises_ever_carries_the_key():
    """One assertion over every path, so a new branch has to opt out deliberately."""
    cases = [
        (400, {"errorMessage": FAKE_KEY}),
        (401, {"errorCode": FAKE_KEY}),
        (500, {"errorMessage": FAKE_KEY}),
        (200, {"nope": FAKE_KEY}),
    ]
    for status, payload in cases:
        with pytest.raises((IbmCredentialRejected, IbmVerificationUnavailable)) as excinfo:
            verify_ibm_api_key(FAKE_KEY, transport=_transport(status, payload))
        assert FAKE_KEY not in str(excinfo.value), f"HTTP {status} leaked the key"
