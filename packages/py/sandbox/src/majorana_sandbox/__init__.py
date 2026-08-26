"""majorana-sandbox — ephemeral execution of untrusted generated code.

Layers (plans/rebuild/05-security.md §1, plans/archive/rebuild/08-phases.md §Phase 2
step 2 — archived; the live stage map is plans/roadmap/00-INDEX.md):
1. `guard.check_python_code` — static defense-in-depth (allowlist imports, deny
   dangerous tokens/builtins).
2. `spec.preflight` — pre-dispatch caps incl. the ≤27-qubit lane ceiling.
3. A provider implementing the `Sandbox` protocol:
   - `VercelSandbox` — the real Firecracker boundary with EXPLICIT deny-all egress.
   - `LocalSubprocessSandbox` — a DEV/TEST double (timeout + memory rlimit only;
     NOT a security boundary, cannot deny network).

Always execute via `base.run(sandbox, spec)`, which applies the guard + preflight
before touching a provider.

One deliberate second door: `trusted.run_trusted` executes a program THIS repo
authored and registered by digest, in the same boundary, without the
generated-code import allowlist — because that allowlist describes what a model
may import, not what we may. See trusted.py's docstring for what keeps user text
out of it."""

from majorana_sandbox.base import GuardRejection, Sandbox, run
from majorana_sandbox.guard import GuardResult, check_python_code
from majorana_sandbox.local import LocalSubprocessSandbox
from majorana_sandbox.spec import (
    DEFAULT_MEMORY_MB,
    DEFAULT_QUBIT_CEILING,
    MAX_MEMORY_MB,
    ExecutionSpec,
    QubitCeilingExceeded,
    SandboxResult,
    preflight,
)
from majorana_sandbox.trusted import (
    MAX_PAYLOAD_BYTES,
    TrustedPayloadTooLarge,
    TrustedProgramRejected,
    TrustedRegistrySealed,
    compose_trusted,
    is_registered,
    register_trusted_program,
    run_trusted,
    seal_trusted_registry,
    trusted_registry_is_sealed,
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
    "DEFAULT_MEMORY_MB",
    "MAX_MEMORY_MB",
    "Sandbox",
    "run",
    "GuardRejection",
    "LocalSubprocessSandbox",
    "VercelSandbox",
    "DENY_ALL_EGRESS",
    "SandboxProviderError",
    "register_trusted_program",
    "is_registered",
    "compose_trusted",
    "run_trusted",
    "seal_trusted_registry",
    "trusted_registry_is_sealed",
    "TrustedProgramRejected",
    "TrustedPayloadTooLarge",
    "TrustedRegistrySealed",
    "MAX_PAYLOAD_BYTES",
]
