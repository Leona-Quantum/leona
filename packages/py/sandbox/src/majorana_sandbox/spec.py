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
    trusted_setup: str = ""
    trusted_observer: str = ""
    protected_result_path: str | None = None
    source_fingerprint: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


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
    setup = textwrap.indent(spec.trusted_setup.strip(), "    ")
    observer = textwrap.indent(spec.trusted_observer.strip(), "    ")
    fingerprint = (
        f'    _majorana_observation["source_fingerprint"] = {spec.source_fingerprint!r}\n'
        if spec.source_fingerprint is not None
        else ""
    )
    return f"""def _majorana_host_run():
    import builtins as _majorana_builtins
    import json as _majorana_json
    _majorana_open = _majorana_builtins.open
    _majorana_json_dump = _majorana_json.dump
    _majorana_json_dumps = _majorana_json.dumps
    _majorana_exception = _majorana_builtins.Exception
    _majorana_getattr = _majorana_builtins.getattr
    _majorana_hasattr = _majorana_builtins.hasattr
    _majorana_int = _majorana_builtins.int
    _majorana_len = _majorana_builtins.len
    _majorana_list = _majorana_builtins.list
    _majorana_sorted = _majorana_builtins.sorted
    _majorana_str = _majorana_builtins.str
    _majorana_sum = _majorana_builtins.sum
    _majorana_type = _majorana_builtins.type
    _majorana_namespace = {{"__name__": "__main__"}}
    _majorana_observation = {{}}
{fingerprint.rstrip()}
{setup}
    _majorana_builtins.exec(
        _majorana_builtins.compile({spec.code!r}, "<majorana-generated>", "exec"),
        _majorana_namespace,
    )
    _majorana_result = _majorana_namespace.get("RESULT")
    if _majorana_result is not None:
        try:
            _majorana_json_dumps(_majorana_result)
            _majorana_observation["result"] = _majorana_result
        except _majorana_exception:
            _majorana_observation["result_error"] = "not_json_serializable"
{observer}
    try:
        _majorana_serialized_observation = _majorana_json_dumps(_majorana_observation)
        if _majorana_len(_majorana_serialized_observation.encode("utf-8")) > {MAX_OUTPUT_BYTES}:
            _majorana_observation = {{
                "source_fingerprint": {spec.source_fingerprint!r},
                "evidence_error": "protected_result_too_large",
            }}
    except _majorana_exception:
        # One unserializable VALUE must not cost every other one.
        #
        # This used to replace the whole observation with an error, and the cost of
        # that was found rather than reasoned about: `qml.to_openqasm` returns a
        # transformed QNode, so `interchange_qasm` held a function, so every
        # PennyLane run in the product lost its resource metrics, native
        # statevector, sampled counts and optimization record — all of them
        # serializable, all discarded for a neighbour. The observation is provider-
        # owned evidence collected by several independent blocks; they fail
        # independently and must survive independently.
        #
        # The names of the dropped keys are kept, so a gap is legible as a gap
        # rather than looking like a block that never ran.
        _majorana_dropped = []
        _majorana_kept = {{}}
        for _majorana_key, _majorana_value in _majorana_builtins.sorted(
            _majorana_observation.items(), key=lambda _pair: _majorana_str(_pair[0])
        ):
            try:
                _majorana_json_dumps({{_majorana_key: _majorana_value}})
            except _majorana_exception:
                _majorana_dropped.append(_majorana_str(_majorana_key))
                continue
            _majorana_kept[_majorana_key] = _majorana_value
        _majorana_kept["evidence_error"] = "protected_result_not_json_serializable"
        _majorana_kept["evidence_dropped_keys"] = _majorana_dropped
        _majorana_kept["source_fingerprint"] = {spec.source_fingerprint!r}
        try:
            # The size check above lives INSIDE the try that just raised, so it
            # never ran for this path. While this handler replaced the observation
            # with two keys it was bounded by accident; keeping every serializable
            # key means the ceiling has to be applied again here, or one bad value
            # in a large observation writes an unbounded sidecar — which the
            # reader then rejects wholesale, turning a partial loss into a total
            # one. `test_the_byte_ceiling_still_applies_to_a_RECOVERED_observation`
            # fails without these three lines.
            _majorana_recovered = _majorana_json_dumps(_majorana_kept)
            if _majorana_len(_majorana_recovered.encode("utf-8")) > {MAX_OUTPUT_BYTES}:
                raise _majorana_builtins.ValueError("protected_result_too_large")
            _majorana_observation = _majorana_kept
        except _majorana_exception:
            # A key that serializes alone but not together is not a thing json
            # does; if it somehow happens, fall back to what this always did.
            _majorana_observation = {{
                "source_fingerprint": {spec.source_fingerprint!r},
                "evidence_error": "protected_result_not_json_serializable",
            }}
    with _majorana_open(
        {spec.protected_result_path!r}, "w", encoding="utf-8"
    ) as _majorana_result_file:
        _majorana_json_dump(_majorana_observation, _majorana_result_file)

_majorana_host_run()
"""
