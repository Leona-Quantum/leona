"""VercelSandbox — the real isolation boundary (Firecracker microVM, AD-6).

THE SECURITY INVARIANT LIVES HERE: every sandbox is created with an EXPLICIT
deny-all egress policy. The Vercel default is allow-all (research-corrected in
DECISIONS.md 2026-07-09), so passing `network_policy="deny-all"` is mandatory,
code-reviewed, and CI-tested. A sandbox that can reach the internet is a
release-blocking bug (AGENTS.md rule 3, 05-security.md §1).

Zero credentials are ever placed inside the sandbox env — the control plane does
all Neon/WorkOS/LLM calls. The `vercel` SDK is imported lazily so the guard + local
double install without it.
"""

from __future__ import annotations

import time
from typing import Any

from majorana_sandbox.spec import MAX_OUTPUT_BYTES, ExecutionSpec, SandboxResult

# The one value that must never change silently. Asserted by CI.
DENY_ALL_EGRESS = "deny-all"

# Custom OCI image with the pinned scientific/quantum stack (qiskit/pennylane/cirq).
# The tag is a control-plane constant; the image itself is built + scanned weekly.
DEFAULT_IMAGE = "majorana-runner"

_RUN_DIR = "/tmp/run"  # read-only rootfs except /tmp (05-security.md §1)


class SandboxProviderError(RuntimeError):
    pass


def _create_kwargs(spec: ExecutionSpec, image: str) -> dict[str, Any]:
    """Build the AsyncSandbox.create(...) kwargs. Isolated so tests can assert the
    deny-all egress policy without a live provider."""
    return {
        "image": image,
        "timeout": spec.timeout_s * 1000,  # SDK takes milliseconds
        "network_policy": DENY_ALL_EGRESS,  # <-- the invariant
        "env": {},  # no credentials inside the sandbox, ever
    }


class VercelSandbox:
    provider = "vercel"

    def __init__(self, image: str = DEFAULT_IMAGE) -> None:
        self._image = image

    async def _execute(self, spec: ExecutionSpec) -> SandboxResult:
        try:
            from vercel.sandbox.aio import Sandbox as AsyncSandbox  # type: ignore
            from vercel.sandbox import SandboxAuthError  # type: ignore
        except Exception as exc:  # pragma: no cover - exercised only without the SDK
            raise SandboxProviderError(
                "install majorana-sandbox[vercel] and provide Vercel OIDC/token auth"
            ) from exc

        started = time.monotonic()
        try:
            sandbox = await AsyncSandbox.create(**_create_kwargs(spec, self._image))
        except SandboxAuthError as exc:
            raise SandboxProviderError(
                "Vercel sandbox authentication failed; provide Vercel OIDC/token auth"
            ) from exc
        except Exception as exc:
            raise SandboxProviderError("Vercel sandbox could not be created") from exc
        try:
            await sandbox.write_files(
                [{"path": f"{_RUN_DIR}/main.py", "content": spec.code.encode("utf-8")}]
            )
            result = await sandbox.run_command(
                cmd="python", args=["-I", f"{_RUN_DIR}/main.py"], cwd=_RUN_DIR
            )
            exit_code = result.exit_code
            stdout = (await result.stdout())[:MAX_OUTPUT_BYTES]
            stderr = (await result.stderr())[:MAX_OUTPUT_BYTES]
        finally:
            await sandbox.stop()

        return SandboxResult(
            ok=exit_code == 0,
            exit_code=exit_code,
            duration_ms=int((time.monotonic() - started) * 1000),
            memory_mb=None,
            stdout=stdout,
            stderr=stderr,
            truncated=len(stdout) >= MAX_OUTPUT_BYTES or len(stderr) >= MAX_OUTPUT_BYTES,
            provider=self.provider,
        )
