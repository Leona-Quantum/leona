"""Provider-agnostic QPU interface (Stage-8 plan, step 1).

Submission fails closed: a provider that is not explicitly enabled AND
credentialed reports a typed block reason instead of attempting anything.
Provider credentials live in the control plane only — never in sandboxes.
"""

from __future__ import annotations

from typing import Protocol

from .models import (
    QpuCostEstimate,
    QpuJobRecord,
    QpuJobRequest,
    QpuSubmissionBlockReason,
)


class QpuError(RuntimeError):
    pass


class QpuDisabledError(QpuError):
    def __init__(self, reason: QpuSubmissionBlockReason) -> None:
        super().__init__(reason.value)
        self.reason = reason


class QpuProvider(Protocol):
    def estimate(self, request: QpuJobRequest) -> QpuCostEstimate: ...

    def submit(self, request: QpuJobRequest) -> QpuJobRecord: ...

    def poll(self, provider_job_id: str) -> QpuJobRecord: ...

    def result(self, provider_job_id: str) -> QpuJobRecord: ...
