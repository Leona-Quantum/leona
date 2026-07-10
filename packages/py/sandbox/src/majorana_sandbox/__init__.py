"""majorana-sandbox — ephemeral execution of untrusted generated code.

Layers (05-security.md §1, plans/rebuild/08-phases.md §Phase 2 step 2):
1. `guard.check_python_code` — static defense-in-depth (allowlist imports, deny
   dangerous tokens/builtins).
2. `spec.preflight` — pre-dispatch caps incl. the ≤27-qubit lane ceiling.
3. A provider implementing the `Sandbox` protocol:
   - `VercelSandbox` — the real Firecracker boundary with EXPLICIT deny-all egress.
   - `LocalSubprocessSandbox` — a DEV/TEST double (timeout + memory rlimit only;
     NOT a security boundary, cannot deny network).

Always execute via `base.run(sandbox, spec)`, which applies the guard + preflight
before touching a provider."""

from majorana_sandbox.base import GuardRejection, Sandbox, run
from majorana_sandbox.guard import GuardResult, check_python_code
from majorana_sandbox.local import LocalSubprocessSandbox
from majorana_sandbox.spec import (
    DEFAULT_QUBIT_CEILING,
    ExecutionSpec,
    QubitCeilingExceeded,
    SandboxResult,
    preflight,
)
from majorana_sandbox.vercel import DENY_ALL_EGRESS, SandboxProviderError, VercelSandbox

__all__ = [
    "check_python_code",
    "GuardResult",
    "ExecutionSpec",
    "SandboxResult",
    "preflight",
    "QubitCeilingExceeded",
    "DEFAULT_QUBIT_CEILING",
    "Sandbox",
    "run",
    "GuardRejection",
    "LocalSubprocessSandbox",
    "VercelSandbox",
    "DENY_ALL_EGRESS",
    "SandboxProviderError",
]
