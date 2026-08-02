"""Verify an IBM Cloud API key without qiskit, and without storing it.

## Why this exists

A credential that is stored unverified fails inside a job, hours later, on a
screen nobody is looking at, attributed to a hardware run that never happened.
Verifying at connect time turns "your quantum job failed" into "that key was not
accepted, check you copied all 44 characters" — a sentence the user can act on
while they still have the IBM dashboard open.

## Why it does not use qiskit-ibm-runtime

`qiskit-ibm-runtime` is not installed in the API image (`services/worker` pulls
`majorana-qpu[ibm]`; `services/api` does not), so the only verification the API
could do through it is none. It does not need it: an IBM Cloud API key is
exchanged for a bearer token by an ordinary form POST to IBM's IAM endpoint,

    POST https://iam.cloud.ibm.com/identity/token
    Content-Type: application/x-www-form-urlencoded
    grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=<KEY>

which answers 200 with an `access_token` for a good key and refuses a bad one.
That is the same credential exchange the runtime client performs on its first
call, so a key this accepts is a key the worker can use.

## Why stdlib urllib and not an HTTP library

The API image is built with `uv sync --all-packages --frozen --no-dev`, and the
only HTTP client in this repository — `httpx` — is in the dev group. Verifying a
credential with a library that is not in the production image is a route that
works in every test and 500s in production.

The choice was not made on that argument alone. A sibling project had an adapter
that worked under `curl` and failed under `urllib` against one particular host,
so this exact request was run against `iam.cloud.ibm.com` with a deliberately
invalid key before the code was written, under both clients:

    curl   -> HTTP 400  {"errorCode":"BXNIM0415E","errorMessage":"Provided API key could not be found.", ...}
    urllib -> HTTP 400  {"errorCode":"BXNIM0415E","errorMessage":"Provided API key could not be found.", ...}

Same status, same body, no TLS difference. (An invalid key is a safe probe: it
uses no real credential and creates nothing.)

## What never happens here

The key is not logged, not returned, not stored, and not put into any exception
message. IBM does not echo the key in its error bodies — the probe above shows
what it does return — but `_scrub` checks anyway before any provider text is
carried into a user-facing sentence, because "the upstream does not currently
echo the secret" is a property of somebody else's code.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable

IAM_TOKEN_URL = "https://iam.cloud.ibm.com/identity/token"
IAM_GRANT_TYPE = "urn:ibm:params:oauth:grant-type:apikey"

#: Short on purpose. This runs inside a request a person is waiting on, and the
#: honest answer to a slow IAM is "we could not reach IBM, try again" rather than
#: a spinner that lasts until the proxy gives up.
DEFAULT_TIMEOUT_S = 8.0

#: IBM Quantum Platform API keys are 44 characters. Not enforced as equality —
#: a format that changes would then refuse every valid key without IBM ever
#: being asked — but a bound above it stops an oversized body being POSTed
#: anywhere, and a bound below it catches the truncated paste locally.
MIN_KEY_CHARS = 8
MAX_KEY_CHARS = 512


class IbmCredentialRejected(Exception):
    """IBM answered, and the answer was no.

    The message is a sentence for the person who pasted the key. Distinct from
    `IbmVerificationUnavailable` because the user acts differently: this one
    means go back to the IBM dashboard, the other means try again in a minute.
    """


class IbmVerificationUnavailable(Exception):
    """IBM could not be reached, or answered something unusable.

    Never conflated with rejection. Telling somebody their key is wrong because
    a TLS handshake timed out sends them to regenerate a credential that was
    fine.
    """


#: `(url, body, headers, timeout) -> (status, body_bytes)`; raises for transport
#: failures. Injectable so the refusal, the outage and the malformed-response
#: paths are all testable without a network and without a real key.
Transport = Callable[[str, bytes, dict[str, str], float], "tuple[int, bytes]"]


#: Bytes of an IAM response we are willing to read. A token response is a few
#: hundred bytes and the largest refusal observed is under one kilobyte, so this
#: is three orders of magnitude of headroom.
#:
#: It exists because `timeout=` on `urlopen` is a per-socket-operation timeout,
#: NOT a deadline: a peer that sends one byte at a time resets it on every read.
#: Measured against a local drip server — 3.66s elapsed under a 1.0s timeout,
#: and it scales with the number of bytes sent — and an uncapped `read()` pulled
#: back 41,943,059 bytes in a single call. That body flows into
#: `_rejection_sentence` and out through the problem document's `title`, so an
#: unbounded read turns a 44-character PUT into a 40 MB response and a 40 MB log
#: line. Reaching this requires IBM's own IAM endpoint to misbehave, which is
#: why it is a cap rather than an alarm.
MAX_RESPONSE_BYTES = 64_000


def _urlopen_post(url: str, body: bytes, headers: dict[str, str], timeout: float):
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed https URL
            # `read(N)` rather than `read()`. A truncated body simply fails to
            # parse as JSON, which is already a handled path — the malformed
            # response case — and reports "IBM's answer could not be read"
            # rather than the process dying on memory.
            return response.status, response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as exc:
        # A refusal is an HTTPError to urllib and an ANSWER to us: 400 carries
        # IBM's reason, and treating it as a transport failure would report
        # "could not reach IBM" for the most common case there is.
        return exc.code, exc.read(MAX_RESPONSE_BYTES)


def _scrub(text: str, secret: str) -> str:
    """Provider text, or a neutral sentence if it contains the secret.

    Not a redaction that replaces the secret in place: a message built around a
    secret is a message whose shape leaks its length, and there is nothing in
    IBM's error bodies worth that. If the key appears at all, none of the body
    is used.
    """
    if secret and secret in text:
        return ""
    return text


def _rejection_sentence(status: int, payload: dict, api_key: str) -> str:
    """What the user reads when IBM refuses the key."""
    detail = _scrub(str(payload.get("errorMessage") or ""), api_key).strip()
    code = _scrub(str(payload.get("errorCode") or ""), api_key).strip()
    base = (
        "IBM did not accept this API key. Check that you copied the whole key "
        "(it is 44 characters) from the IBM Quantum Platform dashboard, and that "
        "it has not been deleted there."
    )
    if detail and code:
        return f"{base} IBM said: {detail} ({code})"
    if detail:
        return f"{base} IBM said: {detail}"
    return f"{base} IBM answered HTTP {status}."


def verify_ibm_api_key(
    api_key: str,
    *,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    transport: Transport | None = None,
) -> None:
    """Return quietly if IBM exchanges this key for a token; raise otherwise.

    Raises `IbmCredentialRejected` when IBM answers and refuses, and
    `IbmVerificationUnavailable` when IBM cannot be reached or answers something
    that is not a token grant. Returns nothing: the access token IBM hands back
    lives for an hour, is useless to us afterwards, and is a second secret we
    would then be responsible for — so it is read for its presence and dropped.
    """
    key = api_key.strip()
    if not MIN_KEY_CHARS <= len(key) <= MAX_KEY_CHARS:
        raise IbmCredentialRejected(
            "That does not look like an IBM Quantum API key. Keys are 44 "
            "characters; copy the whole value from the IBM Quantum Platform "
            "dashboard."
        )
    post = transport or _urlopen_post
    body = urllib.parse.urlencode({"grant_type": IAM_GRANT_TYPE, "apikey": key}).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    try:
        status, raw = post(IAM_TOKEN_URL, body, headers, timeout_s)
    except Exception:
        # Deliberately broad and deliberately `from None`. Broad because every
        # transport failure is the same answer to the user and an unhandled one
        # here would be a 500 on a route whose job is to produce a sentence;
        # `from None` because the frame that raised is the frame holding the key,
        # and a chained traceback is how it reaches a log aggregator.
        raise IbmVerificationUnavailable(
            "IBM's credential service could not be reached; the key was not stored."
        ) from None

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            payload = {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}

    if status == 200:
        if payload.get("access_token"):
            return
        # A 200 with no token is not a verified key. Accepting it would store a
        # credential on the strength of a status code, which is the failure this
        # whole function exists to move earlier.
        raise IbmVerificationUnavailable(
            "IBM's credential service returned an unexpected response; the key was not stored."
        )
    if 400 <= status < 500:
        raise IbmCredentialRejected(_rejection_sentence(status, payload, key))
    raise IbmVerificationUnavailable(
        "IBM's credential service is not answering right now; the key was not stored."
    )
