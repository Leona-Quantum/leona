"""Shared mock HTTPS server for the catalog fetch test suites.

Serves fixed adversarial routes over TLS with a throwaway self-signed
certificate; nothing here touches a real external host.
"""

import contextlib
import ssl
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


class FetchFixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/ok":
            body = b"hello from mock server"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "https://example.com/evil")
            self.end_headers()
        elif self.path == "/big":
            self.send_response(200)
            self.end_headers()
            try:
                for _ in range(64):
                    self.wfile.write(b"x" * 4096)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the client is expected to abort once max_bytes is exceeded
        elif self.path == "/slow":
            self.send_response(200)
            self.end_headers()
            time.sleep(2)
            self.wfile.write(b"late")
        else:
            self.send_response(404)
            self.end_headers()


def generate_self_signed_cert(cert_dir: Path) -> tuple[Path, Path]:
    """Write a 1-day self-signed cert for 127.0.0.1; returns (key, cert) paths."""
    key, cert = cert_dir / "key.pem", cert_dir / "cert.pem"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-days",
            "1",
            "-subj",
            "/CN=127.0.0.1",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )
    return key, cert


@contextlib.contextmanager
def run_mock_https_server(cert_dir: Path):
    """Yields (port, cert_path) for a loopback HTTPS server running the
    fixture routes; shuts the server down on exit."""
    key, cert = generate_self_signed_cert(cert_dir)
    server = HTTPServer(("127.0.0.1", 0), FetchFixtureHandler)
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))
    server.socket = ssl_ctx.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port, cert
    finally:
        server.shutdown()
        thread.join(timeout=2)
