from __future__ import annotations

import math

import pytest

from optimizer_protocol import ObjectiveBudgetExceeded, OptimizerProtocol, optimize_one_parameter


@pytest.mark.parametrize(
    "algorithm",
    ["scipy_minimize_scalar_bounded", "scipy_slsqp"],
)
def test_optimizers_share_bounds_and_recover_quadratic_minimum(algorithm: str) -> None:
    outcome = optimize_one_parameter(
        lambda theta: (theta - 0.25) ** 2 - 1.0,
        algorithm=algorithm,
    )
    assert outcome.success
    assert outcome.function_evaluations == len(outcome.trajectory)
    assert outcome.function_evaluations <= 256
    assert math.isclose(outcome.final_parameter, 0.25, abs_tol=1e-5)
    assert all(-math.pi <= point["theta"] <= math.pi for point in outcome.trajectory)


def test_objective_budget_is_hard_cap() -> None:
    with pytest.raises(ObjectiveBudgetExceeded):
        optimize_one_parameter(
            lambda theta: (theta - 0.25) ** 2,
            algorithm="scipy_slsqp",
            protocol=OptimizerProtocol(max_function_evaluations=1),
        )


def test_non_finite_energy_fails_closed() -> None:
    with pytest.raises(ValueError, match="non-finite"):
        optimize_one_parameter(
            lambda _theta: float("nan"),
            algorithm="scipy_slsqp",
        )


def test_slsqp_can_reach_a_frozen_boundary() -> None:
    outcome = optimize_one_parameter(
        lambda theta: (theta - math.pi) ** 2,
        algorithm="scipy_slsqp",
    )
    assert outcome.success
    assert math.isclose(outcome.final_parameter, math.pi, abs_tol=1e-6)


def test_deterministic_replay_has_identical_trajectory() -> None:
    objective = lambda theta: (theta + 0.125) ** 2
    left = optimize_one_parameter(objective, algorithm="scipy_slsqp")
    right = optimize_one_parameter(objective, algorithm="scipy_slsqp")
    assert left == right


def test_wall_time_limit_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    ticks = iter((0.0, 2.0))
    monkeypatch.setattr("optimizer_protocol.time.monotonic", lambda: next(ticks))
    with pytest.raises(TimeoutError, match="wall-time cap"):
        optimize_one_parameter(
            lambda theta: theta**2,
            algorithm="scipy_slsqp",
            protocol=OptimizerProtocol(wall_time_limit_s=1.0),
        )
