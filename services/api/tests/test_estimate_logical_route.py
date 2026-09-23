"""`POST /v1/estimates/logical`: a stated logical cost, re-costed per point.

The route must say exactly what the estimator says — these tests compare its
output to direct `estimate()` calls rather than to numbers written down here,
so a change to the model moves both sides together and a change to the route's
plumbing (a swapped field, a dropped factory pass) is what fails.
"""

from __future__ import annotations

import asyncio
import math

import pytest
from fastapi import HTTPException
from majorana_estimation import (
    BUILTIN_ASSUMPTION_SETS,
    GIDNEY_2025,
    LogicalCost,
    estimate,
)
from pydantic import ValidationError

from majorana_api.catalog_estimate import TARGET_FAILURE_PROBABILITY
from majorana_api.routes import estimates as estimates_routes
from majorana_api.routes.estimates import (
    MAX_POINTS,
    LogicalEstimateRequest,
    LogicalPoint,
)


def _rsa(bits: int) -> LogicalPoint:
    """Gidney–Ekerå 2019's leading-order counts at `bits`, as the planner sends them.

    Their measurement depth is the serial chain the reaction time applies to,
    so it travels as `non_clifford_depth` and gives the estimator a floor.
    """
    lg = math.log2(bits)
    return LogicalPoint(
        label=f"RSA-{bits}",
        parameter_value=bits,
        logical_qubits=math.ceil(3 * bits + 0.002 * bits * lg),
        toffoli_count=round(0.3 * bits**3 + 0.0005 * bits**3 * lg),
        non_clifford_depth=round(500 * bits**2 + bits**2 * lg),
    )


def _call(body: LogicalEstimateRequest, scope):
    return asyncio.run(estimates_routes.estimate_logical(body, scope))


def test_each_point_is_what_the_estimator_says(scope):
    points = [_rsa(1024), _rsa(2048)]
    result = _call(LogicalEstimateRequest(points=points), scope)

    assert result.assumptions.identity == GIDNEY_2025.identity
    # No `+eps=`: a stated Toffoli count needs no rotation precision.
    assert result.assumptions.rotation_synthesis_epsilon is None
    assert [p.label for p in result.points] == ["RSA-1024", "RSA-2048"]
    for sent, got in zip(points, result.points, strict=True):
        logical = LogicalCost(
            logical_qubits=sent.logical_qubits,
            toffoli_count=sent.toffoli_count,
            non_clifford_depth=sent.non_clifford_depth,
        )
        direct = estimate(
            logical, GIDNEY_2025, target_failure_probability=TARGET_FAILURE_PROBABILITY
        )
        assert got.refused is None
        assert got.parameter_value == sent.parameter_value
        assert got.fastest is not None
        assert got.fastest.footprint.total_physical_qubits == direct.footprint.total_physical_qubits
        assert got.fastest.runtime.seconds == direct.runtime.seconds
        assert got.distance is not None
        assert got.distance.code_distance == direct.distance.code_distance
        # One factory is the other end of the trade, and it is a smaller machine.
        one = estimate(
            logical,
            GIDNEY_2025,
            target_failure_probability=TARGET_FAILURE_PROBABILITY,
            factory_count=1,
        )
        assert got.smallest is not None
        assert got.smallest.footprint.total_physical_qubits == one.footprint.total_physical_qubits
        assert (
            got.smallest.footprint.total_physical_qubits
            < got.fastest.footprint.total_physical_qubits
        )
        assert got.frontier
        # Every set the frontier names has its citation, stated once.
        assert {p.assumption_set for p in got.frontier} <= set(result.citations)

    # A bigger key costs more machine, which is the curve the planner draws.
    small, large = result.points
    assert (
        large.fastest.footprint.total_physical_qubits
        > small.fastest.footprint.total_physical_qubits
    )


def test_another_built_in_set_is_costed_under_its_own_name(scope):
    key = "composed-trapped-ion@v2"
    result = _call(LogicalEstimateRequest(points=[_rsa(2048)], assumptions=key), scope)
    assert result.assumptions.identity == BUILTIN_ASSUMPTION_SETS[key].identity
    assert result.points[0].fastest is not None


def test_an_unknown_set_is_refused_not_replaced(scope):
    with pytest.raises(HTTPException) as caught:
        _call(LogicalEstimateRequest(points=[_rsa(2048)], assumptions="gidney-2019@v1"), scope)
    assert caught.value.status_code == 422
    assert "gidney-2025@v2" in caught.value.detail


def test_a_point_with_no_magic_states_says_why_instead_of_costing_nothing(scope):
    result = _call(
        LogicalEstimateRequest(points=[LogicalPoint(label="queries only", logical_qubits=40)]),
        scope,
    )
    point = result.points[0]
    assert point.fastest is None and point.frontier is None
    assert point.refused is not None and "Toffoli or T" in point.refused


def test_with_no_serial_depth_the_point_is_one_factory_and_says_nothing_faster(scope):
    """No depth, no reaction floor, no crossover: the estimator costs one factory.

    The page has to say that runtime is one factory's throughput, so the route
    must not invent a second machine to compare it with.
    """
    point = LogicalPoint(label="no depth", logical_qubits=200, toffoli_count=10**9)
    got = _call(LogicalEstimateRequest(points=[point]), scope).points[0]
    assert got.fastest is not None
    assert got.fastest.runtime.factory_count == 1
    assert got.fastest.runtime.factory_crossover is None
    assert got.fastest.runtime.binding_term == "throughput"
    assert got.smallest is None


def test_one_uncostable_point_does_not_sink_the_curve(scope, monkeypatch):
    """Nothing inside the body's bounds makes the built-in sets refuse today
    (a 1e20-Toffoli, 1e8-qubit point is costed at distance 43), so the refusal
    is forced here to pin the per-point isolation, which is the route's own job.
    """
    real = estimates_routes.estimate

    def refusing(logical, *args, **kwargs):
        if logical.label == "refused":
            raise ValueError("no code distance protects this many operations")
        return real(logical, *args, **kwargs)

    monkeypatch.setattr(estimates_routes, "estimate", refusing)
    refused_point = LogicalPoint(label="refused", logical_qubits=10, toffoli_count=10)
    result = _call(LogicalEstimateRequest(points=[_rsa(2048), refused_point]), scope)
    ok, refused = result.points
    assert ok.fastest is not None
    assert refused.fastest is None and refused.frontier is None
    assert refused.refused == "no code distance protects this many operations"


@pytest.mark.parametrize(
    "bad",
    [
        {"points": []},
        {"points": [{"label": "x", "logical_qubits": 1}] * (MAX_POINTS + 1)},
        {"points": [{"label": "x", "logical_qubits": 0}]},
        {"points": [{"label": "x", "logical_qubits": 5, "toffoli_count": -1}]},
        {"points": [{"label": "x", "logical_qubits": 5, "t_count": 10**21}]},
        {"points": [{"label": "x", "logical_qubits": 5, "parameter_value": float("nan")}]},
        {"points": [{"label": "", "logical_qubits": 5}]},
        {"points": [{"label": "x", "logical_qubits": 5, "unexpected": 1}]},
    ],
)
def test_the_body_is_bounded(bad):
    with pytest.raises(ValidationError):
        LogicalEstimateRequest.model_validate(bad)
