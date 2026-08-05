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
import signal
import sys
import tempfile
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


def _rlimit_bootstrap(memory_mb: int, cpu_s: int) -> str:
    """Source prepended to the child's own `-c` script, applying limits to
    itself right after exec().

    This used to run via `preexec_fn`, which forces CPython's subprocess
    machinery off the posix_spawn fast path and onto a plain fork() of the
    *caller* — here, the long-running worker process, which already carries a
    live asyncio loop, a DB connection pool, and OTel exporter threads.
    Forking a multi-threaded process is unsafe on macOS (only the forking
    thread survives into the child; anything the other threads held a lock on
    — malloc arenas inside Accelerate/BLAS, Objective-C runtime state — can
    wedge or crash the child before it ever reaches exec()). That surfaced as
    every candidate in a run dying with exit_code 3 and empty stdout/stderr,
    even though the same generated code ran cleanly through this same sandbox
    in isolation. Setting the limits from inside the child's own script
    instead runs after exec() has already replaced the process image, so
    there is nothing left over from the parent to be unsafe about, and
    asyncio.create_subprocess_exec can use posix_spawn again.
    """
    soft_bytes = memory_mb * 1024 * 1024
    return (
        "import resource as _majorana_resource\n"
        "for _majorana_res, _majorana_limit in "
        f"(( _majorana_resource.RLIMIT_AS, {soft_bytes}), "
        f"(_majorana_resource.RLIMIT_CPU, {cpu_s})):\n"
        "    try:\n"
        "        _majorana_resource.setrlimit(_majorana_res, (_majorana_limit, _majorana_limit))\n"
        "    except (ValueError, OSError):\n"
        "        pass\n"
    )


class LocalSubprocessSandbox:
    provider = "local-subprocess"

    @property
    def environment_id(self) -> str:
        dependencies: dict[str, str | None] = {}
        for name in (
            "qiskit",
            "cirq",
            "pennylane",
            "amazon-braket-sdk",
            "numpy",
            "scipy",
        ):
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
        # No start_new_session/process-group kill here: that flag unconditionally
        # forces CPython's subprocess machinery to fork() the caller instead of
        # using posix_spawn (see subprocess.Popen._execute_child — start_new_session
        # disqualifies the posix_spawn fast path independently of preexec_fn).
        # Forking this worker process — which already carries a live asyncio loop,
        # a DB connection pool, and OTel exporter threads — is unsafe on macOS and
        # was the actual cause of every candidate dying with exit_code 3 and no
        # output, even after preexec_fn was removed. A killpg'd process group was
        # defense-in-depth for a generated child spawning its own children; the
        # static guard (guard.py) already blocks subprocess/os.fork/os.spawn/os.exec
        # before generated code runs, so a single proc.kill() is sufficient here.
        # Captured to files, not PIPE. A handful of candidates in real (not
        # isolated-repro) worker runs came back with exit_code 3 and BOTH
        # stdout and stderr completely empty, even for code that later ran
        # clean — including cases where the process plainly ran for close to
        # a second before dying. A child that dies abruptly (killed, crashed
        # in a native extension) can close its pipe before asyncio's
        # kqueue-driven pipe protocol delivers the buffered bytes it already
        # wrote, so `communicate()` returns nothing it never lost — it just
        # never got it. Files have no such handoff: the child's writes land
        # on disk directly, and the parent reads them only after the process
        # has fully exited.
        with tempfile.TemporaryDirectory(prefix="majorana-sandbox-") as capture_dir:
            stdout_path = Path(capture_dir) / "stdout"
            stderr_path = Path(capture_dir) / "stderr"
            with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
                proc = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-I",  # isolated mode: no user site, no PYTHON* env influence
                    "-c",
                    _rlimit_bootstrap(spec.memory_mb, spec.timeout_s + 1) + compose_execution(spec),
                    stdout=stdout_file,
                    stderr=stderr_file,
                    env=env,
                )
                timed_out = False
                try:
                    await asyncio.wait_for(proc.wait(), timeout=spec.timeout_s)
                except TimeoutError:
                    timed_out = True
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
                    await proc.wait()
            if timed_out:
                stdout, stderr = b"", b"timed out"
            else:
                stdout = stdout_path.read_bytes()
                stderr = stderr_path.read_bytes()

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
