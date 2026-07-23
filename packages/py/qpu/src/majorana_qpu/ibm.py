"""IBM Quantum adapter, flag-gated and fail-closed.

Enabling real submission requires ALL of:
  - MAJORANA_QPU_SUBMIT_ENABLED=true   (deployment-level owner decision)
  - MAJORANA_QPU_IBM_TOKEN             (IBM Quantum Platform API key)
  - qiskit + qiskit-ibm-runtime importable (not installed by default)

Anything missing produces a typed QpuDisabledError; nothing here guesses,
retries with defaults, or contacts IBM without every gate open. The channel is
"ibm_quantum_platform" — the classic "ibm_quantum" channel was sunset
2025-07-01 and no longer functions.

CI proves the gating only. The live submit path can be proven exclusively
against a real token, which is an owner decision (OWNER_TODO §1) — it is
written against the documented 0.48.x API surface and stays unexercised until
that decision lands.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from .models import (
    QpuJobRecord,
    QpuJobRequest,
    QpuJobStatus,
    QpuProviderKey,
    QpuSubmissionBlockReason,
)
from .pricing import estimate as rate_card_estimate
from .provider import QpuDisabledError

SUBMIT_FLAG = "MAJORANA_QPU_SUBMIT_ENABLED"
TOKEN_ENV = "MAJORANA_QPU_IBM_TOKEN"

_STATUS_MAP = {
    "QUEUED": QpuJobStatus.QUEUED,
    "RUNNING": QpuJobStatus.RUNNING,
    "DONE": QpuJobStatus.DONE,
    "ERROR": QpuJobStatus.ERROR,
    "CANCELLED": QpuJobStatus.CANCELLED,
}


def submission_block_reason(
    environ: dict[str, str] | None = None,
) -> QpuSubmissionBlockReason | None:
    """Why submission is blocked in this deployment, or None if every gate is open."""
    env = os.environ if environ is None else environ
    if env.get(SUBMIT_FLAG, "").lower() != "true":
        return QpuSubmissionBlockReason.SUBMISSION_DISABLED
    if not env.get(TOKEN_ENV, "").strip():
        return QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED
    try:
        import qiskit  # noqa: F401
        import qiskit_ibm_runtime  # noqa: F401
    except ImportError:
        return QpuSubmissionBlockReason.PROVIDER_DEPENDENCY_MISSING
    return None


class IbmRuntimeProvider:
    """Adapter over qiskit-ibm-runtime SamplerV2 (documented 0.48.x surface)."""

    def __init__(self, environ: dict[str, str] | None = None) -> None:
        self._environ = environ

    def estimate(self, request: QpuJobRequest):
        return rate_card_estimate(request.device_id, request.shots)

    def submit(self, request: QpuJobRequest) -> QpuJobRecord:
        reason = submission_block_reason(self._environ)
        if reason is not None:
            raise QpuDisabledError(reason)
        from qiskit import qasm3
        from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
        from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

        env = os.environ if self._environ is None else self._environ
        service = QiskitRuntimeService(
            channel="ibm_quantum_platform",
            token=env[TOKEN_ENV],
        )
        backend = service.least_busy(operational=True, simulator=False)
        circuit = qasm3.loads(request.qasm)
        isa_circuit = generate_preset_pass_manager(backend=backend, optimization_level=1).run(
            circuit
        )
        sampler = SamplerV2(mode=backend)
        sampler.options.default_shots = request.shots
        job = sampler.run([isa_circuit])
        return QpuJobRecord(
            provider=QpuProviderKey.IBM,
            provider_job_id=job.job_id(),
            device_id=request.device_id,
            shots=request.shots,
            status=_STATUS_MAP.get(str(job.status()), QpuJobStatus.QUEUED),
            submitted_at=datetime.now(UTC).isoformat(),
            source_fingerprint=request.source_fingerprint,
        )

    def poll(self, provider_job_id: str) -> QpuJobRecord:
        raise NotImplementedError(
            "polling requires the durable qpu_run job seam; it lands with the "
            "control-plane job table extension, not in the estimate slice"
        )

    def result(self, provider_job_id: str) -> QpuJobRecord:
        raise NotImplementedError(
            "result retrieval requires the durable qpu_run job seam; it lands "
            "with the control-plane job table extension, not in the estimate slice"
        )
