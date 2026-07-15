"""Execution spec, result, and pre-dispatch caps. The qubit ceiling is checked
BEFORE any sandbox is created (05-security.md §1: pre-flight qubit ceiling computed
from the plan's resource estimate), so an over-budget run never consumes a sandbox."""

from __future__ import annotations

import json
import textwrap
from typing import Any

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
    trusted_observer: str = ""
    protected_result_path: str | None = None


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
    protected_result: dict[str, Any] | None = None


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


def parse_protected_result(raw: bytes | None) -> dict[str, Any] | None:
    """Decode a bounded provider-read sidecar; malformed optional data is ignored."""
    if raw is None or len(raw) > MAX_OUTPUT_BYTES:
        return None
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def compose_execution(spec: ExecutionSpec) -> str:
    """Wrap generated code with provider-owned observation and serialization."""
    if not spec.trusted_observer or spec.protected_result_path is None:
        return spec.code
    observer = textwrap.indent(spec.trusted_observer.strip(), "    ")
    return f"""def _majorana_host_run():
    import builtins as _majorana_builtins
    import json as _majorana_json
    _majorana_namespace = {{"__name__": "__main__"}}
    _majorana_observation = {{}}
    _majorana_builtins.exec(
        _majorana_builtins.compile({spec.code!r}, "<majorana-generated>", "exec"),
        _majorana_namespace,
    )
{observer}
    with _majorana_builtins.open(
        {spec.protected_result_path!r}, "w", encoding="utf-8"
    ) as _majorana_result_file:
        _majorana_json.dump(_majorana_observation, _majorana_result_file)

_majorana_host_run()
"""
