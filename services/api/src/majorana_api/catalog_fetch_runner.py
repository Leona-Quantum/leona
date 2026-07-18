"""Credential-separated fetch runner (Step 5b): the network-capable side of the
ADR-0017 split, run as a short-lived child process that holds no secrets.

The worker (which holds DATABASE_URL and the catalog authority config) never
touches the network itself. When a fetch is needed it spawns this module as a
child process whose environment is rebuilt from an allowlist -- DATABASE_URL,
SYSTEM_CATALOG_*, API keys, and every other parent variable are simply absent,
so even a fully compromised fetch cannot reach the database or any credential.
The child downloads one URL under a FetchPolicy, writes the raw bytes to a
parent-chosen quarantine path, and reports a JSON manifest on stdout; the parent
re-hashes the file on pickup and refuses a manifest/file mismatch.

The fetch spec travels over stdin, not argv, so the URL never appears in the
host's process list. This is the same spawn pattern as
packages/py/sandbox/local.py, applied to the opposite problem: there the child
may compute but not talk to the network freely; here the child may talk to the
network (within policy) but must know nothing.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import os
import signal
import ssl
import sys
import uuid
from pathlib import Path

from .catalog_fetch import (
    BlockedAddressError,
    FetchConnectionError,
    FetchError,
    FetchPolicy,
    FetchTimeoutError,
    HostNotAllowedError,
    PortNotAllowedError,
    RedirectRejectedError,
    ResponseTooLargeError,
    SchemeNotAllowedError,
    fetch_bounded,
)

# Mirrors packages/py/sandbox/local.py's allowlist: nothing here is a secret.
# SSL_CERT_FILE/SSL_CERT_DIR pass through so a hardened base image can pin its
# trust store; they name public CA bundles, not credentials.
_CHILD_ENV_ALLOWLIST = (
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
)

# Wall-clock slack the parent grants beyond the child's own fetch timeout
# before concluding the runner itself is wedged and killing it.
RUNNER_TIMEOUT_MARGIN_S = 10.0

_ERROR_KINDS: dict[type[FetchError], str] = {
    SchemeNotAllowedError: "scheme_not_allowed",
    HostNotAllowedError: "host_not_allowed",
    PortNotAllowedError: "port_not_allowed",
    BlockedAddressError: "blocked_address",
    RedirectRejectedError: "redirect_rejected",
    ResponseTooLargeError: "response_too_large",
    FetchTimeoutError: "fetch_timeout",
    FetchConnectionError: "connection_error",
}


def build_child_env() -> dict[str, str]:
    """The child's entire environment: allowlisted keys plus import paths.

    sys.path entries are filesystem locations, not secrets; passing them lets
    the child import majorana_api without inheriting PYTHONPATH-adjacent
    variables from the parent.
    """
    env = {key: os.environ[key] for key in _CHILD_ENV_ALLOWLIST if key in os.environ}
    env["PYTHONPATH"] = os.pathsep.join(path for path in sys.path if path)
    env["PYTHONUNBUFFERED"] = "1"
    return env


@dataclasses.dataclass(frozen=True)
class SubprocessFetchOutcome:
    """What the parent learns from one runner invocation. ok=False outcomes are
    deterministic rejections or runner failures; the output file only exists
    (and only counts) when ok is True and the hash re-check passed."""

    ok: bool
    error_kind: str | None
    message: str | None
    status_code: int | None
    content_type: str | None
    sha256: str | None
    bytes_written: int | None
    output_path: Path


def _failure(kind: str, message: str, output_path: Path) -> SubprocessFetchOutcome:
    return SubprocessFetchOutcome(
        ok=False,
        error_kind=kind,
        message=message[:500],
        status_code=None,
        content_type=None,
        sha256=None,
        bytes_written=None,
        output_path=output_path,
    )


async def fetch_in_subprocess(
    url: str,
    *,
    allowed_hosts: frozenset[str],
    quarantine_dir: Path,
    allowed_port: int = 443,
    max_bytes: int | None = None,
    timeout_s: float | None = None,
    allow_private_addresses: bool = False,
    ca_file: str | None = None,
) -> SubprocessFetchOutcome:
    """Run one policy-bounded fetch in a credential-stripped child process."""
    from .catalog_fetch import DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_S

    effective_timeout = timeout_s if timeout_s is not None else DEFAULT_TIMEOUT_S
    quarantine_dir.mkdir(parents=True, exist_ok=True)
    output_path = quarantine_dir / f"fetch-{uuid.uuid4().hex}.bin"
    spec = {
        "url": url,
        "allowed_hosts": sorted(allowed_hosts),
        "allowed_port": allowed_port,
        "max_bytes": max_bytes if max_bytes is not None else DEFAULT_MAX_BYTES,
        "timeout_s": effective_timeout,
        "allow_private_addresses": allow_private_addresses,
        "ca_file": ca_file,
        "output_path": str(output_path),
    }

    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "majorana_api.catalog_fetch_runner",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=build_child_env(),
        start_new_session=True,  # own process group so a wedged child dies whole
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(json.dumps(spec).encode()),
            timeout=effective_timeout + RUNNER_TIMEOUT_MARGIN_S,
        )
    except TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()
        output_path.unlink(missing_ok=True)
        return _failure(
            "runner_timeout", "fetch runner exceeded its wall-clock budget", output_path
        )

    if proc.returncode != 0 or not stdout:
        output_path.unlink(missing_ok=True)
        detail = stderr.decode("utf-8", "replace")
        return _failure("runner_crashed", f"exit={proc.returncode} stderr={detail}", output_path)

    try:
        manifest = json.loads(stdout)
    except json.JSONDecodeError:
        output_path.unlink(missing_ok=True)
        return _failure("runner_crashed", "runner produced unparseable manifest", output_path)

    if not manifest.get("ok"):
        output_path.unlink(missing_ok=True)
        return _failure(
            manifest.get("error_kind", "runner_crashed"),
            manifest.get("message", ""),
            output_path,
        )

    # Pickup integrity: the credentialed side never trusts the manifest alone.
    try:
        content = output_path.read_bytes()
    except OSError:
        return _failure(
            "manifest_mismatch", "manifest claimed success but file is unreadable", output_path
        )
    digest = hashlib.sha256(content).hexdigest()
    if digest != manifest.get("sha256") or len(content) != manifest.get("bytes_written"):
        output_path.unlink(missing_ok=True)
        return _failure("manifest_mismatch", "quarantined bytes do not match manifest", output_path)

    return SubprocessFetchOutcome(
        ok=True,
        error_kind=None,
        message=None,
        status_code=manifest.get("status_code"),
        content_type=manifest.get("content_type"),
        sha256=digest,
        bytes_written=len(content),
        output_path=output_path,
    )


def _child_main() -> int:
    spec = json.loads(sys.stdin.read())
    ca_file = spec.get("ca_file")
    policy = FetchPolicy(
        allowed_hosts=frozenset(spec["allowed_hosts"]),
        allowed_port=int(spec["allowed_port"]),
        max_bytes=int(spec["max_bytes"]),
        timeout_s=float(spec["timeout_s"]),
        allow_private_addresses=bool(spec.get("allow_private_addresses", False)),
        ssl_context=ssl.create_default_context(cafile=ca_file) if ca_file else None,
    )
    try:
        result = asyncio.run(fetch_bounded(spec["url"], policy=policy))
    except FetchError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error_kind": _ERROR_KINDS.get(type(exc), "fetch_error"),
                    "message": str(exc)[:500],
                }
            )
        )
        return 0  # a deterministic rejection is a successful runner outcome

    Path(spec["output_path"]).write_bytes(result.content)
    print(
        json.dumps(
            {
                "ok": True,
                "status_code": result.status_code,
                "content_type": result.content_type,
                "sha256": hashlib.sha256(result.content).hexdigest(),
                "bytes_written": len(result.content),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(_child_main())
