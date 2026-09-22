import pytest

from majorana_qpu import (
    EstimateBasis,
    QpuAccess,
    UnknownDeviceError,
    backend_info,
    estimate,
    list_backends,
)


def test_every_backend_carries_its_provenance():
    for backend in list_backends():
        assert backend.rate_source.startswith("https://")
        assert backend.rate_confirmed_on == "2026-07-23"
        if backend.access is QpuAccess.ON_DEMAND:
            assert backend.per_task_usd is not None
            assert backend.per_shot_usd is not None
        else:
            assert backend.allowance_note, "a free-queue device must say what the allowance is"


def test_on_demand_estimate_is_task_fee_plus_shots():
    result = estimate("braket.ionq.forte", shots=1000)
    assert result.basis is EstimateBasis.VENDOR_RATE_CARD
    assert result.task_fee_usd == 0.30
    assert result.shot_fees_usd == pytest.approx(80.0)
    assert result.total_usd == pytest.approx(80.30)
    assert result.rate_source == "https://aws.amazon.com/braket/pricing/"
    assert "not a quote" in result.disclaimer


def test_cheapest_superconducting_estimate_stays_deterministic():
    result = estimate("braket.rigetti.cepheus", shots=4096)
    assert result.shot_fees_usd == pytest.approx(4096 * 0.000425)
    assert result.total_usd == pytest.approx(0.30 + 4096 * 0.000425)


def test_free_queue_estimate_has_no_dollar_total():
    result = estimate("ibm.open_plan", shots=4096)
    assert result.basis is EstimateBasis.FREE_TIER_ALLOWANCE
    assert result.total_usd is None
    assert result.task_fee_usd is None
    assert result.allowance_note and "28 days" in result.allowance_note


def test_unknown_device_and_bad_shots_fail_closed():
    with pytest.raises(UnknownDeviceError):
        estimate("braket.acme.nonexistent", shots=10)
    with pytest.raises(ValueError):
        estimate("braket.ionq.forte", shots=0)
    with pytest.raises(UnknownDeviceError):
        backend_info("nope")


def test_an_estimate_for_three_circuits_counts_every_task_and_every_shot():
    """Zero-noise extrapolation sends three circuits. Each is its own task and
    runs every shot, so both the task fee and the shot fees triple."""
    from majorana_qpu import estimate

    one = estimate("braket.ionq.forte", 100)
    three = estimate("braket.ionq.forte", 100, circuits=3)
    assert (one.circuits, one.total_shots) == (1, 100)
    assert (three.circuits, three.total_shots, three.shots) == (3, 300, 100)
    assert three.task_fee_usd == pytest.approx(3 * one.task_fee_usd)
    assert three.shot_fees_usd == pytest.approx(3 * one.shot_fees_usd)
    assert three.total_usd == pytest.approx(3 * one.total_usd)


def test_zero_circuits_is_refused():
    from majorana_qpu import estimate

    with pytest.raises(ValueError):
        estimate("ibm.open_plan", 10, circuits=0)
