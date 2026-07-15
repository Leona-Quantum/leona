"""The Sandbox protocol every provider implements, plus the shared guard+preflight
gate. A concrete sandbox NEVER runs code that fails the static guard or the qubit
ceiling — those checks happen here so no provider can skip them."""

from __future__ import annotations

from typing import Protocol

from majorana_sandbox.guard import check_python_code
from majorana_sandbox.spec import ExecutionSpec, SandboxResult, preflight


class GuardRejection(ValueError):
    def __init__(self, violations: list[str], reason: str) -> None:
        super().__init__(reason)
        self.violations = violations


class Sandbox(Protocol):
    """Providers implement `_execute`; callers use `run`, which applies the guard
    and pre-flight caps first."""

    provider: str

    async def _execute(self, spec: ExecutionSpec) -> SandboxResult:
        """Provider-specific execution. Assume the code already passed the guard."""
        ...


async def run(sandbox: Sandbox, spec: ExecutionSpec) -> SandboxResult:
    """Guarded entry point: static guard → pre-flight caps → provider execute.
    Raises GuardRejection / QubitCeilingExceeded before any sandbox is created."""
    # Only generated code is inspected here. ``trusted_epilogue`` is control-plane
    # instrumentation assembled after generation and executed by the provider.
    guard = check_python_code(spec.code)
    if not guard.ok:
        raise GuardRejection(guard.violations, guard.reason or "blocked by static guard")
    preflight(spec)
    return await sandbox._execute(spec)
