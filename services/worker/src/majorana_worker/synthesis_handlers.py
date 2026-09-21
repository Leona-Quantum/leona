"""Job handler for targeted synthesis (proposal 3, `circuit.synthesize`).

Runs every compiler in Studio's trusted compiler lane against a device or a
generic connectivity target, and checks every resulting candidate for
equivalence against the ORIGINAL circuit independently — via
`majorana_verification`, never a compiler's own claim. This project's own
research found a TKET optimisation pass that returned a circuit its caller
believed was equivalent and was not; this handler is what stops that belief
from reaching Studio unchecked.

Sibling of `handlers.handle_circuit_optimize`, which this reuses the exact
sandbox/event/run-state pattern of: one Run row, one `run_trusted` sandbox
call (now carrying every requested compiler in a single payload, via
`optimizer_kernel.synthesize_operations`), one `synthesis.result` event.

**Why the equivalence check runs HERE, in this process, and not in the
sandbox.** It needs no SDK the sandbox uniquely provides — Qiskit's simulator
primitives (`qiskit.quantum_info.Operator`/`Statevector`) are already a
production dependency of this worker process via
`majorana_verification` -> `majorana_openqasm` -> `qiskit`, used today for
exactly this kind of independent check. And it operates only on
already-schema-validated closed `CircuitOptimizationOperation` lists — never
on source code, never on anything a user or a compiler wrote as an
expression. So this does not widen the sandbox/execution boundary
`05-security.md` §1a gates: no new anonymous route, no new credential, no
new provider, nothing that executes or fetches on a user's behalf. The six
compiler SDKs themselves stay exactly where ai-ops#186 put them — the
sandbox — and this handler adds no new SDK to either side.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from majorana_contracts import (
    CircuitCompiler,
    Scope,
    SynthesisCandidate,
    SynthesisConnectivity,
    SynthesisObjective,
    SynthesisRequest,
    SynthesisResult,
)
from majorana_contracts.enums import Role, RunStatus, Stage
from majorana_frameworks.optimizers import (
    CircuitOptimizationError,
    CompiledCandidate,
    build_synthesis_kernel_payload,
    kernel_path,
    kernel_source,
    synthesis_candidates_from_kernel,
)
from majorana_frameworks.optimizers import _fingerprint as _studio_fingerprint
from majorana_qpu import QpuProviderKey, UnknownDeviceError, backend_info
from majorana_sandbox import DEFAULT_MEMORY_MB, Sandbox, register_trusted_program, run_trusted
from majorana_verification import equivalent_operations

from majorana_api.db import AsyncSession
from majorana_api.repos import runs as runs_repo

log = logging.getLogger(__name__)

# Same file `handlers.py` registers at ITS import — `register_trusted_program`
# is idempotent (it adds a digest to a set), so calling it again here is a
# no-op in the shipped path and makes this module self-contained for a caller
# (a test, a script) that imports it without going through `handlers.py`.
_SYNTHESIS_KERNEL = kernel_source()
register_trusted_program(kernel_path())

#: `SynthesisRequest` fixes the compiler effort at the strongest generic
#: level every adapter offers — see `build_synthesis_kernel_payload`'s own
#: comment. `objective` picks which candidate to highlight, not a
#: per-compiler knob.
_OBJECTIVE_METRIC: dict[SynthesisObjective, str] = {
    SynthesisObjective.DEPTH: "depth",
    SynthesisObjective.TWO_QUBIT_COUNT: "two_qubit_gate_count",
    SynthesisObjective.T_COUNT: "t_count",
}


def _scope_from_payload(payload: dict[str, Any]) -> Scope:
    return Scope(
        user_id=uuid.UUID(payload["user_id"]),
        workspace_id=uuid.UUID(payload["workspace_id"]),
        role=Role.MEMBER,  # write, never admin — least authority that can execute
    )


def resolve_connectivity(
    target_device_id: str | None, target_connectivity: SynthesisConnectivity | None
) -> tuple[SynthesisConnectivity, str]:
    """A generic connectivity is used verbatim; a device resolves to one from
    its published `technology` — the only device fact this repo's catalog
    (`majorana_qpu.pricing.RATE_CARD`) carries (no per-device coupling map
    exists here; see `SynthesisTarget`'s own docstring).

    Trapped-ion and neutral-atom qubits are not fixed to a lattice, so
    `all_to_all` is a fact about the modality, not an approximation. A
    superconducting device is heavy-hex for IBM's own public architecture,
    and `grid` — named as an approximation, not a vendor's real map — for
    every other superconducting vendor this catalog lists.

    Raises `CircuitOptimizationError("target_unknown_device", ...)` for an
    unrecognised `device_id`, safe to show to the caller (same convention
    every other named refusal in this lane uses).
    """

    if target_connectivity is not None:
        return (
            target_connectivity,
            f"generic {target_connectivity.value} connectivity, as requested.",
        )
    assert target_device_id is not None  # SynthesisTarget guarantees exactly one is set
    try:
        device = backend_info(target_device_id)
    except UnknownDeviceError:
        raise CircuitOptimizationError(
            "target_unknown_device", f"{target_device_id!r} is not a known device."
        ) from None
    if device.technology in ("trapped_ion", "neutral_atom"):
        return SynthesisConnectivity.ALL_TO_ALL, (
            f"{device.display_name} ({device.technology.replace('_', ' ')}) is treated as "
            "all-to-all connectivity: this modality's qubits are not fixed to a lattice."
        )
    if device.provider is QpuProviderKey.IBM:
        return SynthesisConnectivity.HEAVY_HEX, (
            f"{device.display_name} is routed onto IBM's published heavy-hex architecture."
        )
    return SynthesisConnectivity.GRID, (
        f"{device.display_name} (superconducting) is approximated as a grid coupling map: "
        "this repository carries no published per-device coupling map for this vendor."
    )


def _synthesis_candidate(
    compiled: CompiledCandidate, qubit_count: int, request: SynthesisRequest
) -> SynthesisCandidate:
    """Attach the independent equivalence verdict and assemble the contract object.

    A candidate that failed or was unsupported at compile time never reaches
    the equivalence check at all — there is nothing to check, and
    `SynthesisCandidate`'s own validator refuses an unsupported/failed
    candidate that carries one.
    """

    if compiled.status != "succeeded":
        return SynthesisCandidate(
            compiler=compiled.compiler,
            status=compiled.status,  # type: ignore[arg-type]
            reason=compiled.reason,
            warnings=[],
        )
    assert (
        compiled.operations is not None
        and compiled.before is not None
        and compiled.after is not None
    )
    equivalence = equivalent_operations(qubit_count, request.operations, compiled.operations)
    warnings = list(compiled.warnings)
    if equivalence.checked and not equivalence.equivalent:
        warnings.append(
            f"NOT equivalent to the original circuit ({equivalence.detail}); this candidate "
            "cannot be applied."
        )
    elif not equivalence.checked:
        warnings.append(f"Equivalence {equivalence.detail}; this candidate cannot be applied.")
    return SynthesisCandidate(
        compiler=compiled.compiler,
        status="succeeded",
        reason=None,
        compiler_version=compiled.compiler_version,
        operations=compiled.operations,
        before=compiled.before,
        after=compiled.after,
        equivalence=equivalence,
        warnings=warnings,
    )


def _best_candidate(
    candidates: list[SynthesisCandidate], objective: SynthesisObjective
) -> CircuitCompiler | None:
    """The lowest-`objective` candidate among those PROVEN equivalent.

    A candidate that failed the equivalence check, or that could not be
    checked at all (too wide), is never a `best_candidate_compiler` — "the
    check is not decoration" applies here most directly: a smaller circuit
    nobody has proven is the same program is not a better answer.
    """

    metric = _OBJECTIVE_METRIC[objective]
    eligible = [
        candidate
        for candidate in candidates
        if candidate.status == "succeeded"
        and candidate.equivalence is not None
        and candidate.equivalence.checked
        and candidate.equivalence.equivalent
        and getattr(candidate.after, metric) is not None
    ]
    if not eligible:
        return None
    best = min(
        eligible, key=lambda candidate: (getattr(candidate.after, metric), candidate.compiler.value)
    )
    return best.compiler


async def handle_circuit_synthesize(
    session: AsyncSession, payload: dict[str, Any], *, sandbox: Sandbox | None = None
) -> None:
    """Compile Studio's closed circuit IR against a target with every
    compiler in the lane, then independently verify each candidate.

    The durable Run row and its `synthesis.result` event provide queueing,
    cancellation, replay, and dead-letter recovery, the same as
    `handle_circuit_optimize`. Never creates an artifact version; the result
    is returned for Studio comparison only.
    """

    from .handlers import RepoEventSink, RepoRunStateStore, _default_sandbox

    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    run = await runs_repo.get_run(scope, session, run_id)
    store = RepoRunStateStore(scope, session, run_id)
    if RunStatus(run.status) is not RunStatus.QUEUED:
        return
    request = SynthesisRequest.model_validate(payload["circuit_synthesis"])
    sink = RepoEventSink(scope, session, run_id)
    await store.set_status(RunStatus.RUNNING, started_at_now=True)
    await sink.emit("run.started", {}, event_id=uuid.uuid5(run_id, "run.started"))
    await sink.emit(
        "stage.started",
        {"stage": Stage.COMPILE},
        event_id=uuid.uuid5(run_id, "stage.started:compile"),
    )
    started = asyncio.get_running_loop().time()
    timeout_s = min(float(run.timeout_s or 60), 60.0)

    try:
        connectivity, resolved_note = resolve_connectivity(
            request.target.device_id, request.target.connectivity
        )
    except CircuitOptimizationError as exc:
        await _finish_synthesis_failure(
            store, sink, code=exc.code, message=str(exc), started=started
        )
        return

    kernel_payload = build_synthesis_kernel_payload(request, connectivity=connectivity)
    try:
        sandbox_result = await run_trusted(
            sandbox or _default_sandbox(),
            program=_SYNTHESIS_KERNEL,
            payload=kernel_payload,
            result_path=f"/tmp/leona-synthesize-{run_id.hex}.json",
            entrypoint="_main_synthesize",
            timeout_s=max(1, int(timeout_s)),
            memory_mb=DEFAULT_MEMORY_MB,
        )
    except Exception as exc:
        log.warning(
            "circuit synthesis %s could not run in the sandbox: %s", run_id, type(exc).__name__
        )
        elapsed = asyncio.get_running_loop().time() - started
        await _finish_synthesis_failure(
            store,
            sink,
            code="compiler_timeout" if elapsed >= timeout_s else "compiler_internal_error",
            message=(
                f"synthesis exceeded the {int(timeout_s)} second limit."
                if elapsed >= timeout_s
                else f"synthesis could not run ({type(exc).__name__})."
            ),
            started=started,
        )
        return

    kernel_result = sandbox_result.protected_result
    if kernel_result is None:
        elapsed = asyncio.get_running_loop().time() - started
        timed_out = elapsed >= timeout_s or sandbox_result.duration_ms >= timeout_s * 1000
        log.warning(
            "circuit synthesis %s returned no sidecar (exit %s, %sms): %s",
            run_id,
            sandbox_result.exit_code,
            sandbox_result.duration_ms,
            sandbox_result.stderr[-400:],
        )
        await _finish_synthesis_failure(
            store,
            sink,
            code="compiler_timeout" if timed_out else "compiler_internal_error",
            message=(
                f"synthesis exceeded the {int(timeout_s)} second limit."
                if timed_out
                else "synthesis failed internally in the sandbox."
            ),
            started=started,
        )
        return

    try:
        compiled_candidates = synthesis_candidates_from_kernel(request, kernel_result)
    except CircuitOptimizationError as exc:
        await _finish_synthesis_failure(
            store, sink, code=exc.code, message=str(exc), started=started
        )
        return

    if await store.current_status() is RunStatus.CANCELLED:
        return

    candidates = [
        _synthesis_candidate(compiled, request.qubit_count, request)
        for compiled in compiled_candidates
    ]
    best = _best_candidate(candidates, request.objective)
    result = SynthesisResult(
        qubit_count=request.qubit_count,
        target=request.target,
        resolved_connectivity=connectivity,
        resolved_note=resolved_note,
        objective=request.objective,
        input_fingerprint=_studio_fingerprint(request.operations),
        candidates=candidates,
        best_candidate_compiler=best,
    )
    await sink.emit(
        "synthesis.result",
        {"accepted": True, "reason": None, "result": result.model_dump(mode="json")},
    )
    duration_ms = int((asyncio.get_running_loop().time() - started) * 1000)
    await sink.emit(
        "stage.finished", {"stage": Stage.COMPILE, "ok": True, "duration_ms": duration_ms}
    )
    succeeded = sum(1 for candidate in candidates if candidate.status == "succeeded")
    equivalent = sum(
        1
        for candidate in candidates
        if candidate.equivalence is not None and candidate.equivalence.equivalent
    )
    await store.finish(
        RunStatus.SUCCEEDED,
        {
            "status": RunStatus.SUCCEEDED,
            "reason_code": "circuit_synthesis_completed",
            "residual_risks": (
                f"{succeeded} of {len(candidates)} compilers produced a candidate; "
                f"{equivalent} independently confirmed equivalent. Applying a candidate "
                "creates an edited Studio draft that must be verified again before use as "
                "evidence."
            ),
        },
        residual_risks=(
            "Targeted-synthesis candidates were independently equivalence-checked, but "
            "applying one requires fresh verification of the resulting draft."
        ),
    )


async def _finish_synthesis_failure(
    store: Any,
    sink: Any,
    *,
    code: str,
    message: str,
    started: float,
) -> None:
    duration_ms = int((asyncio.get_running_loop().time() - started) * 1000)
    await sink.emit("synthesis.result", {"accepted": False, "reason": message, "result": None})
    await sink.emit(
        "stage.finished",
        {"stage": Stage.COMPILE, "ok": False, "duration_ms": duration_ms},
    )
    await sink.emit("run.error", {"stage": Stage.COMPILE, "code": code, "message": message})
    await store.finish(
        RunStatus.FAILED,
        {"status": RunStatus.FAILED, "reason_code": code, "residual_risks": message},
        residual_risks=message,
    )
