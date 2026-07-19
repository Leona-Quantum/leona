"""DB-free adversarial checks for the Step 5b pinned HTTPS fetcher."""

import asyncio
import hashlib
import os

import pytest

from majorana_api.catalog_fetch import (
    QASMBENCH_COMMIT,
    FetchRejectedError,
    FetchRequest,
    fetch_https,
    qasmbench_request,
)


class _Writer:
    def __init__(self):
        self.written = b""
        self.closed = False

    def write(self, value):
        self.written += value

    async def drain(self):
        return None

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None


def _connection(response: bytes, observed: dict):
    async def open_connection(host, port, **kwargs):
        observed.update(host=host, port=port, kwargs=kwargs)
        reader = asyncio.StreamReader(limit=16 * 1024)
        reader.feed_data(response)
        reader.feed_eof()
        writer = _Writer()
        observed["writer"] = writer
        return reader, writer

    return open_connection


async def _resolver(_host, _port):
    return ["93.184.216.34"]


def test_qasmbench_request_is_commit_pinned_and_path_bounded():
    request = qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm")
    assert request.host == "raw.githubusercontent.com"
    assert QASMBENCH_COMMIT in request.path
    assert request.immutable_ref == QASMBENCH_COMMIT


@pytest.mark.parametrize(
    "path",
    ["../secret.qasm", "/etc/passwd.qasm", "README.md", "other/file.qasm"],
)
def test_qasmbench_request_rejects_unapproved_paths(path):
    with pytest.raises(FetchRejectedError, match="path is not allowed"):
        qasmbench_request(path)


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"],
)
async def test_fetch_rejects_non_global_dns_results_before_connect(address):
    connected = False

    async def resolver(_host, _port):
        return [address]

    async def open_connection(*_args, **_kwargs):
        nonlocal connected
        connected = True
        raise AssertionError("must not connect")

    with pytest.raises(FetchRejectedError) as raised:
        await fetch_https(
            qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm"),
            resolver=resolver,
            open_connection=open_connection,
        )
    assert raised.value.code == "blocked_destination"
    assert connected is False


async def test_fetch_connects_to_validated_ip_with_original_tls_name():
    content = b"OPENQASM 2.0;\n"
    response = b"HTTP/1.1 200 OK\r\nContent-Length: 14\r\n\r\n" + content
    observed = {}
    result = await fetch_https(
        qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm"),
        resolver=_resolver,
        open_connection=_connection(response, observed),
    )
    assert observed["host"] == "93.184.216.34"
    assert observed["port"] == 443
    assert observed["kwargs"]["server_hostname"] == "raw.githubusercontent.com"
    assert observed["writer"].closed is True
    assert result.content == content
    assert result.source_blob_sha256 == hashlib.sha256(content).hexdigest()


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (b"HTTP/1.1 302 Found\r\nLocation: https://example.com/x\r\n\r\n", "redirect_rejected"),
        (
            b"HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\n\r\n",
            "encoded_body_rejected",
        ),
        (b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", "stream_encoding_rejected"),
        (b"HTTP/1.1 200 OK\r\nContent-Length: 999999\r\n\r\n", "oversized"),
    ],
)
async def test_fetch_rejects_unsafe_http_responses(response, code):
    with pytest.raises(FetchRejectedError) as raised:
        await fetch_https(
            qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm"),
            resolver=_resolver,
            open_connection=_connection(response, {}),
        )
    assert raised.value.code == code


async def test_fetch_rejects_arbitrary_connector_host():
    request = FetchRequest(
        connector_id="user",
        host="example.com",
        path="/payload.qasm",
        immutable_ref="x",
        upstream_identity="payload.qasm",
    )
    with pytest.raises(FetchRejectedError) as raised:
        await fetch_https(request)
    assert raised.value.code == "connector_policy"


async def test_fetch_rejects_manually_constructed_path_on_allowed_host():
    request = FetchRequest(
        connector_id="qasmbench",
        host="raw.githubusercontent.com",
        path=f"/another/repository/{QASMBENCH_COMMIT}/payload.qasm",
        immutable_ref=QASMBENCH_COMMIT,
        upstream_identity="payload.qasm",
    )
    with pytest.raises(FetchRejectedError) as raised:
        await fetch_https(request)
    assert raised.value.code == "connector_policy"


async def test_fetch_rejects_archive_magic_even_with_qasm_path():
    content = b"PK\x03\x04payload"
    response = b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n" + content
    with pytest.raises(FetchRejectedError) as raised:
        await fetch_https(
            qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm"),
            resolver=_resolver,
            open_connection=_connection(response, {}),
        )
    assert raised.value.code == "archive_rejected"


async def test_fetch_rejects_non_qasm_content():
    content = b"<html>not source</html>"
    response = b"HTTP/1.1 200 OK\r\nContent-Length: 23\r\n\r\n" + content
    with pytest.raises(FetchRejectedError) as raised:
        await fetch_https(
            qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm"),
            resolver=_resolver,
            open_connection=_connection(response, {}),
        )
    assert raised.value.code == "unexpected_content"


@pytest.mark.skipif(
    os.environ.get("MAJORANA_RUN_NETWORK_TESTS") != "1",
    reason="explicit opt-in required for real network access",
)
async def test_qasmbench_real_network_smoke():
    result = await fetch_https(qasmbench_request("medium/ghz_state_n23/ghz_state_n23.qasm"))
    assert result.content.startswith(b"OPENQASM 2.0;")
    assert len(result.content) == 1154
    assert len(result.source_blob_sha256) == 64
