"""Shared bounded optimizer policy for both H2 runtime adapters."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Callable, Literal

import numpy as np
from scipy.optimize import minimize, minimize_scalar

OptimizerAlgorithm = Literal[
    "scipy_minimize_scalar_bounded",
    "scipy_slsqp",
    "scipy_cobyla",
]


class ObjectiveBudgetExceeded(RuntimeError):
    """Raised before an objective call would exceed the hard budget."""


@dataclass(frozen=True)
class OptimizerProtocol:
    lower_bound: float = -math.pi
    upper_bound: float = math.pi
    initial_parameter: float = 0.0
    energy_tolerance: float = 1.0e-12
    max_function_evaluations: int = 256
    max_iterations: int = 256
    wall_time_limit_s: float = 60.0
    cobyla_initial_trust_region_radius: float = 1.0
    cobyla_final_trust_region_radius: float = 1.0e-8
    cobyla_constraint_tolerance: float = 1.0e-12


@dataclass(frozen=True)
class OptimizationOutcome:
    algorithm: OptimizerAlgorithm
    success: bool
    message: str
    iterations: int
    function_evaluations: int
    gradient_evaluations: int
    final_parameter: float
    best_energy_ha: float
    trajectory: tuple[dict[str, float], ...]


def optimize_one_parameter(
    energy: Callable[[float], float],
    *,
    algorithm: OptimizerAlgorithm,
    protocol: OptimizerProtocol = OptimizerProtocol(),
) -> OptimizationOutcome:
    """Optimize a scalar under identical, finite, framework-neutral limits."""

    started = time.monotonic()
    trajectory: list[dict[str, float]] = []
    iteration_count = 0

    def record_iteration(_parameter: np.ndarray) -> None:
        nonlocal iteration_count
        iteration_count += 1

    def guarded_energy(theta_like: float | np.ndarray) -> float:
        if len(trajectory) >= protocol.max_function_evaluations:
            raise ObjectiveBudgetExceeded(
                f"objective evaluation cap {protocol.max_function_evaluations} reached"
            )
        if time.monotonic() - started > protocol.wall_time_limit_s:
            raise TimeoutError(f"optimizer wall-time cap {protocol.wall_time_limit_s:.1f}s reached")
        theta = float(np.asarray(theta_like, dtype=float).reshape(-1)[0])
        if not math.isfinite(theta):
            raise ValueError("optimizer proposed a non-finite parameter")
        value = float(energy(theta))
        if not math.isfinite(value):
            raise ValueError("objective returned a non-finite energy")
        trajectory.append({"theta": theta, "energy_ha": value})
        return value

    if algorithm == "scipy_minimize_scalar_bounded":
        result = minimize_scalar(
            guarded_energy,
            method="bounded",
            bounds=(protocol.lower_bound, protocol.upper_bound),
            options={
                "xatol": protocol.energy_tolerance,
                "maxiter": protocol.max_iterations,
            },
        )
        final_parameter = float(result.x)
        gradient_evaluations = 0
    elif algorithm == "scipy_slsqp":
        result = minimize(
            guarded_energy,
            x0=np.asarray([protocol.initial_parameter], dtype=float),
            method="SLSQP",
            jac=None,
            bounds=[(protocol.lower_bound, protocol.upper_bound)],
            options={
                "ftol": protocol.energy_tolerance,
                "maxiter": protocol.max_iterations,
                "disp": False,
            },
            callback=record_iteration,
        )
        final_parameter = float(np.asarray(result.x, dtype=float)[0])
        gradient_evaluations = int(getattr(result, "njev", 0) or 0)
    elif algorithm == "scipy_cobyla":
        # COBYLA's `tol` is a lower bound on the final trust-region size.
        # It is deliberately distinct from the energy acceptance tolerance.
        result = minimize(
            guarded_energy,
            x0=np.asarray([protocol.initial_parameter], dtype=float),
            method="COBYLA",
            jac=None,
            bounds=[(protocol.lower_bound, protocol.upper_bound)],
            options={
                "rhobeg": protocol.cobyla_initial_trust_region_radius,
                "tol": protocol.cobyla_final_trust_region_radius,
                "catol": protocol.cobyla_constraint_tolerance,
                # SciPy defines COBYLA maxiter as the objective-call limit.
                # guarded_energy independently enforces the same hard cap.
                "maxiter": protocol.max_function_evaluations,
                "disp": False,
            },
            callback=record_iteration,
        )
        final_parameter = float(np.asarray(result.x, dtype=float)[0])
        gradient_evaluations = 0
    else:  # pragma: no cover
        raise ValueError(f"unsupported optimizer algorithm {algorithm!r}")

    if not trajectory:
        raise ValueError("optimizer completed without evaluating the objective")
    return OptimizationOutcome(
        algorithm=algorithm,
        success=bool(result.success),
        message=str(result.message),
        iterations=int(getattr(result, "nit", iteration_count)),
        function_evaluations=len(trajectory),
        gradient_evaluations=gradient_evaluations,
        final_parameter=final_parameter,
        best_energy_ha=float(result.fun),
        trajectory=tuple(trajectory),
    )
