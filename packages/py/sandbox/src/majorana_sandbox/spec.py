"""Execution spec, result, and pre-dispatch caps. The qubit ceiling is checked
BEFORE any sandbox is created (05-security.md §1: pre-flight qubit ceiling computed
from the plan's resource estimate), so an over-budget run never consumes a sandbox."""

from __future__ import annotations

from pydantic import BaseModel, Field

# 05-security.md §1 caps for the default lane.
DEFAULT_TIMEOUT_S = 120
MAX_TIMEOUT_S = 120
DEFAULT_MEMORY_MB = 2048
DEFAULT_QUBIT_CEILING = 27  # ≤27-qubit default lane (AD-12); Modal heavy lane deferred.
MAX_OUTPUT_BYTES = 1_048_576  # 1 MiB, matching the legacy runner.


class ExecutionSpec(BaseModel):
    """One unit of work for a sandbox. `code` is untrusted; everything else is
    control-plane policy."""

    code: str = Field(min_length=1)
    timeout_s: int = Field(default=DEFAULT_TIMEOUT_S, ge=1, le=MAX_TIMEOUT_S)
    memory_mb: int = Field(default=DEFAULT_MEMORY_MB, ge=64)
    qubits_estimate: int | None = Field(
        default=None,
        ge=1,
        description="From the plan; checked against the lane ceiling pre-dispatch",
    )
    qubit_ceiling: int = Field(default=DEFAULT_QUBIT_CEILING, ge=1)


class SandboxResult(BaseModel):
    """What the control plane records as a sandbox.result event. Mirrors the
    contracts SandboxResult event payload."""

    ok: bool
    exit_code: int
    duration_ms: int = Field(ge=0)
    memory_mb: int | None = None
    stdout: str
    stderr: str
    truncated: bool = False
    provider: str


class QubitCeilingExceeded(ValueError):
    """Raised pre-dispatch when a plan's qubit estimate exceeds the lane ceiling.
    The orchestrator surfaces this as a run.error, not a sandbox failure — no
    sandbox is created."""


def preflight(spec: ExecutionSpec) -> None:
    """Enforce pre-dispatch caps. Raises before a sandbox is ever created."""
    if spec.qubits_estimate is not None and spec.qubits_estimate > spec.qubit_ceiling:
        raise QubitCeilingExceeded(
            f"plan estimates {spec.qubits_estimate} qubits, exceeding the "
            f"{spec.qubit_ceiling}-qubit default-lane ceiling; the Modal heavy lane "
            "is not yet enabled (build the routing seam, not the lane — AD-12)"
        )
