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

from majorana_sandbox.spec import (
    MAX_OUTPUT_BYTES,
    ExecutionSpec,
    SandboxResult,
    compose_execution,
    parse_protected_result,
)

# The one value that must never change silently. Asserted by CI.
DENY_ALL_EGRESS = "deny-all"

# Custom OCI image with the pinned scientific/quantum stack (qiskit/pennylane/cirq/
# braket/qibo/qulacs), built from infra/sandbox/Dockerfile and published to the Vercel
# Container Registry.
#
# THIS NAME CARRIES NO TAG, so it resolves to `latest` — moving that tag IS the deploy,
# with no redeploy of anything here. Nothing publishes it automatically: a PR touching
# infra/sandbox/** builds the image, imports all six frameworks and runs a Bell pair on
# each under `--network none`, and stops there. `latest` moves only when a human
# verifies a dated tag in a real sandbox and promotes it. The procedure, the
# verification step and the rollback are in docs/runbooks/sandbox-image.md, and they
# exist because #262 shipped three framework lanes against a rootfs that was never
# rebuilt: live, inert, and ModuleNotFoundError for every user until it was.
DEFAULT_IMAGE = "majorana-runner"

_RUN_DIR = "/tmp/run"  # read-only rootfs except /tmp (05-security.md §1)


class SandboxProviderError(RuntimeError):
    pass


def _create_kwargs(spec: ExecutionSpec, image: str) -> dict[str, Any]:
    """Build the AsyncSandbox.create(...) kwargs. Isolated so tests can assert the
    deny-all egress policy without a live provider."""
    # Vercel provisions 2 GiB per requested vCPU. Map the provider-neutral memory
    # contract onto the smallest sandbox that satisfies it instead of silently
    # dropping ExecutionSpec.memory_mb at the production boundary.
    vcpus = max(1, (spec.memory_mb + 2047) // 2048)
    return {
        "image": image,
        "timeout": spec.timeout_s * 1000,  # SDK takes milliseconds
        "resources": {"vcpus": vcpus},
        "network_policy": DENY_ALL_EGRESS,  # <-- the invariant
        "env": {},  # no credentials inside the sandbox, ever
    }


class VercelSandbox:
    provider = "vercel"

    def __init__(self, image: str = DEFAULT_IMAGE) -> None:
        self._image = image

    @property
    def environment_id(self) -> str:
        """Pinned runner identity recorded with reproducibility evidence."""
        return f"vercel:{self._image}"

    async def _execute(self, spec: ExecutionSpec) -> SandboxResult:
        try:
            from vercel.sandbox.aio import Sandbox as AsyncSandbox  # type: ignore
            from vercel.sandbox import (  # type: ignore
                Resources,
                SandboxAuthError,
                SandboxPermissionError,
            )
        except Exception as exc:  # pragma: no cover - exercised only without the SDK
            raise SandboxProviderError(
                "install majorana-sandbox[vercel] and provide Vercel OIDC/token auth"
            ) from exc

        started = time.monotonic()
        try:
            create_kwargs = _create_kwargs(spec, self._image)
            create_kwargs["resources"] = Resources(**create_kwargs["resources"])
            sandbox = await AsyncSandbox.create(**create_kwargs)
        except SandboxAuthError as exc:
            raise SandboxProviderError(
                "Vercel sandbox authentication failed; provide Vercel OIDC/token auth"
            ) from exc
        except SandboxPermissionError as exc:
            raise SandboxProviderError(
                "Vercel sandbox authorization failed (HTTP 403); verify the runtime "
                "token can access VERCEL_PROJECT_ID under VERCEL_TEAM_ID"
            ) from exc
        except Exception as exc:
            raise SandboxProviderError("Vercel sandbox could not be created") from exc
        try:
            await sandbox.write_files(
                [
                    {
                        "path": f"{_RUN_DIR}/main.py",
                        "content": compose_execution(spec).encode("utf-8"),
                    }
                ]
            )
            result = await sandbox.run_command(
                cmd="python", args=["-I", f"{_RUN_DIR}/main.py"], cwd=_RUN_DIR
            )
            exit_code = result.exit_code
            stdout = (await result.stdout())[:MAX_OUTPUT_BYTES]
            stderr = (await result.stderr())[:MAX_OUTPUT_BYTES]
            protected_result = None
            if spec.protected_result_path is not None:
                try:
                    protected_result = parse_protected_result(
                        await sandbox.read_file(spec.protected_result_path)
                    )
                except Exception:
                    # Interchange and SDK observations are optional. A missing or
                    # malformed sidecar must never discard a successful native run.
                    pass
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
            protected_result=protected_result,
        )
