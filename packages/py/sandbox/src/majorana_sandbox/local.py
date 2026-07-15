"""LocalSubprocessSandbox — a DEV/TEST double, NOT a security boundary.

It runs code in a child process with a wall-clock timeout and an address-space
(memory) rlimit, so the runtime caps in the hostile-payload suite (infinite loop,
memory bomb) can be asserted without a cloud provider. It CANNOT deny network
egress — that is the real provider's job (vercel.py). Never use this to execute
genuinely untrusted code in production; the static guard (base.run) is the only
thing standing between it and the host, which is not enough on its own.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import resource
import signal
import sys
import time
from pathlib import Path
from importlib import metadata

from majorana_sandbox.spec import (
    MAX_OUTPUT_BYTES,
    ExecutionSpec,
    SandboxResult,
    compose_execution,
    parse_protected_result,
)

# Minimal, side-effect-free environment for the child (mirrors the legacy runner's
# allowlist so the child sees no host credentials or config).
_ENV_ALLOWLIST = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE")


def _limits(memory_mb: int, cpu_s: int):
    def _apply() -> None:
        # Best-effort: RLIMIT_AS is enforced on Linux (CI) but macOS reserves huge
        # virtual space and rejects a finite cap, so a failure here must not abort
        # the spawn. The authoritative memory cap is the provider microVM, not this
        # double.
        soft_bytes = memory_mb * 1024 * 1024
        for res, limit in ((resource.RLIMIT_AS, soft_bytes), (resource.RLIMIT_CPU, cpu_s)):
            try:
                resource.setrlimit(res, (limit, limit))
            except (ValueError, OSError):
                pass

    return _apply


class LocalSubprocessSandbox:
    provider = "local-subprocess"

    @property
    def environment_id(self) -> str:
        dependencies: dict[str, str | None] = {}
        for name in ("qiskit", "cirq", "pennylane", "numpy", "scipy"):
            try:
                dependencies[name] = metadata.version(name)
            except metadata.PackageNotFoundError:
                dependencies[name] = None
        manifest = json.dumps(
            {
                "python": platform.python_version(),
                "implementation": platform.python_implementation(),
                "system": platform.system(),
                "release": platform.release(),
                "machine": platform.machine(),
                "dependencies": dependencies,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return f"local:{hashlib.sha256(manifest.encode()).hexdigest()}"

    async def _execute(self, spec: ExecutionSpec) -> SandboxResult:
        env = {key: os.environ[key] for key in _ENV_ALLOWLIST if key in os.environ}
        env["PYTHONUNBUFFERED"] = "1"
        started = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",  # isolated mode: no user site, no PYTHON* env influence
            "-c",
            compose_execution(spec),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            preexec_fn=_limits(spec.memory_mb, spec.timeout_s + 1),
            start_new_session=True,  # own process group so we can kill children
        )
        timed_out = False
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=spec.timeout_s)
        except TimeoutError:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await proc.wait()
            stdout, stderr = b"", b"timed out"

        duration_ms = int((time.monotonic() - started) * 1000)
        out, out_trunc = _truncate(stdout)
        err, err_trunc = _truncate(stderr)
        exit_code = -signal.SIGKILL if timed_out else (proc.returncode or 0)
        if timed_out:
            err = (err + "\n" if err else "") + f"killed: exceeded {spec.timeout_s}s timeout"
        protected_result = None
        if spec.protected_result_path is not None:
            result_path = Path(spec.protected_result_path)
            try:
                protected_result = parse_protected_result(result_path.read_bytes())
            except OSError:
                pass
            finally:
                result_path.unlink(missing_ok=True)
        return SandboxResult(
            ok=(not timed_out) and exit_code == 0,
            exit_code=exit_code,
            duration_ms=duration_ms,
            memory_mb=None,
            stdout=out,
            stderr=err,
            truncated=out_trunc or err_trunc,
            provider=self.provider,
            protected_result=protected_result,
        )


def _truncate(raw: bytes) -> tuple[str, bool]:
    if len(raw) <= MAX_OUTPUT_BYTES:
        return raw.decode("utf-8", "replace"), False
    return raw[:MAX_OUTPUT_BYTES].decode("utf-8", "replace"), True
