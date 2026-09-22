"""Vendor rate cards and deterministic pre-run estimates.

Numbers here carry their provenance. The Braket table was read from the
vendor's own pricing page; the IBM Open Plan allowance from IBM's plans
overview. IBM's *paid* per-minute rates are reported only by third parties as
of the confirmation date, so they do not appear here at all — an estimate we
cannot source from the vendor is an estimate we do not show.
"""

from __future__ import annotations

from .models import (
    EstimateBasis,
    QpuAccess,
    QpuBackendInfo,
    QpuCostEstimate,
    QpuProviderKey,
)

BRAKET_RATE_SOURCE = "https://aws.amazon.com/braket/pricing/"
IBM_PLAN_SOURCE = "https://quantum.cloud.ibm.com/docs/en/guides/plans-overview"
RATES_CONFIRMED_ON = "2026-07-23"

IBM_OPEN_PLAN_ALLOWANCE = "IBM Open Plan: up to 10 minutes of QPU time per rolling 28 days at no charge; jobs wait in a shared queue."

ESTIMATE_DISCLAIMER = (
    "Pre-run estimate from the provider's published rate card on the date shown. "
    "The provider bills actual usage; this is not a quote or an invoice."
)

FREE_QUEUE_DISCLAIMER = (
    "This device is reached through a free included allowance, not per-shot billing. "
    "Queue wait applies and the allowance is shared across all runs in the account."
)

# Qubit counts are deliberately omitted where the vendor rate page did not
# state them — the catalog shows what was verified, nothing more.
RATE_CARD: tuple[QpuBackendInfo, ...] = (
    QpuBackendInfo(
        provider=QpuProviderKey.IBM,
        device_id="ibm.open_plan",
        display_name="IBM Quantum · Open Plan queue",
        vendor="IBM",
        technology="superconducting",
        access=QpuAccess.FREE_QUEUE,
        allowance_note=IBM_OPEN_PLAN_ALLOWANCE,
        rate_source=IBM_PLAN_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
    QpuBackendInfo(
        provider=QpuProviderKey.BRAKET,
        device_id="braket.aqt.ibex_q1",
        display_name="AQT IBEX-Q1 (via Braket)",
        vendor="AQT",
        technology="trapped_ion",
        access=QpuAccess.ON_DEMAND,
        per_task_usd=0.30,
        per_shot_usd=0.02350,
        rate_source=BRAKET_RATE_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
    QpuBackendInfo(
        provider=QpuProviderKey.BRAKET,
        device_id="braket.ionq.forte",
        display_name="IonQ Forte (via Braket)",
        vendor="IonQ",
        technology="trapped_ion",
        access=QpuAccess.ON_DEMAND,
        per_task_usd=0.30,
        per_shot_usd=0.08000,
        rate_source=BRAKET_RATE_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
    QpuBackendInfo(
        provider=QpuProviderKey.BRAKET,
        device_id="braket.iqm.emerald",
        display_name="IQM Emerald (via Braket)",
        vendor="IQM",
        technology="superconducting",
        access=QpuAccess.ON_DEMAND,
        per_task_usd=0.30,
        per_shot_usd=0.00160,
        rate_source=BRAKET_RATE_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
    QpuBackendInfo(
        provider=QpuProviderKey.BRAKET,
        device_id="braket.iqm.garnet",
        display_name="IQM Garnet (via Braket)",
        vendor="IQM",
        technology="superconducting",
        access=QpuAccess.ON_DEMAND,
        per_task_usd=0.30,
        per_shot_usd=0.00145,
        rate_source=BRAKET_RATE_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
    QpuBackendInfo(
        provider=QpuProviderKey.BRAKET,
        device_id="braket.quera.aquila",
        display_name="QuEra Aquila (via Braket)",
        vendor="QuEra",
        technology="neutral_atom",
        access=QpuAccess.ON_DEMAND,
        per_task_usd=0.30,
        per_shot_usd=0.01000,
        rate_source=BRAKET_RATE_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
    QpuBackendInfo(
        provider=QpuProviderKey.BRAKET,
        device_id="braket.rigetti.cepheus",
        display_name="Rigetti Cepheus (via Braket)",
        vendor="Rigetti",
        technology="superconducting",
        access=QpuAccess.ON_DEMAND,
        per_task_usd=0.30,
        per_shot_usd=0.000425,
        rate_source=BRAKET_RATE_SOURCE,
        rate_confirmed_on=RATES_CONFIRMED_ON,
    ),
)

_BY_KEY = {backend.device_id: backend for backend in RATE_CARD}


class UnknownDeviceError(LookupError):
    pass


def backend_info(device_id: str) -> QpuBackendInfo:
    try:
        return _BY_KEY[device_id]
    except KeyError:
        raise UnknownDeviceError(device_id) from None


def list_backends() -> tuple[QpuBackendInfo, ...]:
    return RATE_CARD


def estimate(device_id: str, shots: int, *, circuits: int = 1) -> QpuCostEstimate:
    """Deterministic pre-run estimate from the published rate card only.

    `shots` is per circuit and `circuits` is how many circuits the submission
    sends: 1, or 3 for zero-noise extrapolation (the circuit and its 3x and 5x
    folds). Every circuit runs every shot, so the shots the provider executes
    are `shots * circuits`, and the estimate says so rather than quoting the
    single circuit the user drew.

    For a billed device each circuit is counted as its own provider task, so the
    task fee is multiplied too. That is the higher of the two ways a provider
    could bill a batch, and the right direction to be wrong in for a number shown
    before somebody spends money. For IBM's free queue there is no price to
    multiply; what grows is the allowance's QPU time, which `circuits` and
    `total_shots` let the page state.
    """
    backend = backend_info(device_id)
    if shots < 1:
        raise ValueError("shots must be at least 1")
    if circuits < 1:
        raise ValueError("circuits must be at least 1")
    total_shots = shots * circuits
    if backend.access is QpuAccess.FREE_QUEUE:
        return QpuCostEstimate(
            device_id=device_id,
            shots=shots,
            circuits=circuits,
            total_shots=total_shots,
            basis=EstimateBasis.FREE_TIER_ALLOWANCE,
            allowance_note=backend.allowance_note,
            rate_source=backend.rate_source,
            rate_confirmed_on=backend.rate_confirmed_on,
            disclaimer=FREE_QUEUE_DISCLAIMER,
        )
    assert backend.per_task_usd is not None and backend.per_shot_usd is not None
    task_fees = round(circuits * backend.per_task_usd, 6)
    shot_fees = round(total_shots * backend.per_shot_usd, 6)
    return QpuCostEstimate(
        device_id=device_id,
        shots=shots,
        circuits=circuits,
        total_shots=total_shots,
        basis=EstimateBasis.VENDOR_RATE_CARD,
        task_fee_usd=task_fees,
        shot_fees_usd=shot_fees,
        total_usd=round(task_fees + shot_fees, 6),
        rate_source=backend.rate_source,
        rate_confirmed_on=backend.rate_confirmed_on,
        disclaimer=ESTIMATE_DISCLAIMER,
    )
