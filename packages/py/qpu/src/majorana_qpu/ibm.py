"""IBM Quantum adapter, flag-gated and fail-closed.

Enabling a real submission requires ALL of:
  - MAJORANA_QPU_SUBMIT_ENABLED=true   (deployment-level owner decision)
  - qiskit + qiskit-ibm-runtime importable (not installed by default)
  - **the submitting USER's own IBM Quantum API key**, stored per account

The third gate used to be `MAJORANA_QPU_IBM_TOKEN`, one operator-owned key
every account submitted through. It moved because it was in the wrong place:
IBM's free Open Plan allowance is ten minutes of QPU time per 28-day rolling
window per ACCOUNT, so one shared key meant one ten-minute budget for the whole
platform, every job appearing under the operator's identity, and any user's
mistake spending everybody else's allowance. Credentials now live in
`provider_credentials` (migration 0045), encrypted per user, and this module
reads no credential from the environment at all: a token is passed to
`IbmRuntimeProvider` explicitly by whoever loaded it for that user.

That is also why `submission_block_reason` takes `has_credential`. The first two
gates are deployment-wide and this file can answer them; the third is a question
about a caller, and a module that guessed at it would be answering for whichever
account the environment happened to describe.

Anything missing produces a typed QpuDisabledError; nothing here guesses,
retries with defaults, or contacts IBM without every gate open. The channel is
"ibm_quantum_platform" — the classic "ibm_quantum" channel was sunset
2025-07-01 and no longer functions.

CI proves the gating only. The live submit path can be proven exclusively
against a real key, which now belongs to a user rather than to the deployment —
it is written against the documented 0.48.x API surface and stays unexercised
until a real account connects one.
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

_STATUS_MAP = {
    "QUEUED": QpuJobStatus.QUEUED,
    "RUNNING": QpuJobStatus.RUNNING,
    "DONE": QpuJobStatus.DONE,
    "ERROR": QpuJobStatus.ERROR,
    "CANCELLED": QpuJobStatus.CANCELLED,
}


def submission_block_reason(
    environ: dict[str, str] | None = None,
    *,
    has_credential: bool = False,
) -> QpuSubmissionBlockReason | None:
    """Why submission is blocked for this caller, or None if every gate is open.

    `has_credential` is the caller's half of the answer: whether the account
    making this request has its own IBM key stored. It defaults to False so that
    a call site which has not yet been taught to ask fails CLOSED — the wrong
    direction here is a submission that proceeds without knowing whose key it
    would spend.

    Order is deployment first, caller second, dependency last: telling a user to
    connect an IBM account in a deployment that cannot submit at all would be
    asking them to fix something that is not theirs.
    """
    env = os.environ if environ is None else environ
    if env.get(SUBMIT_FLAG, "").lower() != "true":
        return QpuSubmissionBlockReason.SUBMISSION_DISABLED
    if not has_credential:
        return QpuSubmissionBlockReason.CREDENTIALS_UNCONFIGURED
    try:
        import qiskit  # noqa: F401
        import qiskit_ibm_runtime  # noqa: F401
    except ImportError:
        return QpuSubmissionBlockReason.PROVIDER_DEPENDENCY_MISSING
    return None


class IbmRuntimeProvider:
    """Adapter over qiskit-ibm-runtime SamplerV2 (documented 0.48.x surface).

    The token is supplied at construction and is never read from the
    environment. Whoever builds this has already decided whose credential it is
    — the worker loads and decrypts the submitting user's row — and an adapter
    that could fall back to an ambient key is an adapter that can silently bill
    the wrong account.

    `instance` is IBM's Service CRN. Optional: an account with a single Open Plan
    instance does not need it, and IBM resolves one. It is passed through when a
    user supplied it because Qiskit Runtime REST calls carry it as a
    `Service-CRN` header, and an account with more than one instance cannot be
    disambiguated without it.
    """

    def __init__(
        self,
        token: str,
        *,
        instance: str | None = None,
        environ: dict[str, str] | None = None,
    ) -> None:
        self._token = token
        self._instance = instance
        self._environ = environ

    def _block_reason(self) -> QpuSubmissionBlockReason | None:
        return submission_block_reason(
            self._environ, has_credential=bool((self._token or "").strip())
        )

    def _service_kwargs(self) -> dict[str, str]:
        """Credentials passed explicitly, never read from a saved account.

        IBM's own guidance for untrusted environments is to pass credentials on
        the call rather than rely on `save_account`, and a worker that read a
        saved account would use whichever user's key happened to be written to
        that container's disk first.
        """
        kwargs = {"channel": "ibm_quantum_platform", "token": self._token}
        if self._instance:
            kwargs["instance"] = self._instance
        return kwargs

    def estimate(self, request: QpuJobRequest):
        return rate_card_estimate(request.device_id, request.shots)

    def submit(self, request: QpuJobRequest) -> QpuJobRecord:
        reason = self._block_reason()
        if reason is not None:
            raise QpuDisabledError(reason)
        from qiskit import qasm3
        from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
        from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

        service = QiskitRuntimeService(**self._service_kwargs())
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

    def _service(self):
        from qiskit_ibm_runtime import QiskitRuntimeService

        return QiskitRuntimeService(**self._service_kwargs())

    def poll(self, provider_job_id: str) -> QpuJobRecord:
        """Current provider-side state of a submitted job; raw counts appear
        exactly when the provider reports DONE. Counts are whatever the
        primitive returned — never averaged, mitigated, or corrected here.

        Polls under the SAME user's credential the job was submitted with. IBM
        scopes a job to the account that created it, so a poll under anybody
        else's key would not find it — which is the reason the worker reloads
        the credential on the poll step rather than only on the submit step."""
        reason = self._block_reason()
        if reason is not None:
            raise QpuDisabledError(reason)
        job = self._service().job(provider_job_id)
        status = _STATUS_MAP.get(str(job.status()), QpuJobStatus.RUNNING)
        raw_counts: dict[str, int] | None = None
        error: str | None = None
        if status is QpuJobStatus.DONE:
            raw_counts = _first_register_counts(job.result())
            if raw_counts is None:
                # A DONE job whose result carries no sampled register cannot be
                # attested as a completed hardware run.
                status = QpuJobStatus.ERROR
                error = "provider result carried no sampled register counts"
        elif status is QpuJobStatus.ERROR:
            error = str(getattr(job, "error_message", lambda: None)() or "provider reported ERROR")
        return QpuJobRecord(
            provider=QpuProviderKey.IBM,
            provider_job_id=provider_job_id,
            device_id=str(getattr(job, "backend", lambda: None)() or "unknown"),
            shots=0,
            status=status,
            raw_counts=raw_counts,
            error=error,
            source_fingerprint="",
        )

    def result(self, provider_job_id: str) -> QpuJobRecord:
        return self.poll(provider_job_id)


def _first_register_counts(result: object) -> dict[str, int] | None:
    """Counts of the first sampled classical register in a SamplerV2 result.

    The register name depends on how the circuit measured (`meas` for
    measure_all, `c` for explicit registers), so this walks the DataBin
    rather than assuming a name."""
    try:
        pub_result = result[0]  # type: ignore[index]
        data = pub_result.data
        for name in getattr(data, "__dict__", {}) or {}:
            register = getattr(data, name)
            get_counts = getattr(register, "get_counts", None)
            if callable(get_counts):
                counts = get_counts()
                return {str(bits): int(count) for bits, count in counts.items()}
    except Exception:  # noqa: BLE001 — attestation must fail closed, not guess
        return None
    return None
