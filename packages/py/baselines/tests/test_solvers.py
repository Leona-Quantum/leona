import math

import pytest
from majorana_baselines import (
    BRUTE_FORCE_MAX_N,
    CapError,
    HamiltonianInstance,
    MaxCutInstance,
    PortfolioInstance,
    QuboInstance,
    compute_quantum_gap,
    solve,
)


def test_maxcut_triangle_optimum():
    # Triangle with unit weights: best cut separates one node → value 2.
    sol = solve(MaxCutInstance(edges=[(0, 1, 1.0), (1, 2, 1.0), (0, 2, 1.0)]))
    assert sol.baseline_value == 2.0
    assert sol.method == "brute_force"
    assert set(sol.baseline_solution) == {"0", "1"}


def test_qubo_minimizes():
    # Diagonal Q with a negative entry: minimum selects that bit.
    sol = solve(QuboInstance(Q=[[-1.0, 0.0], [0.0, 2.0]]))
    assert sol.baseline_value == -1.0
    assert sol.baseline_solution == "10"


def test_portfolio_selects_budget_assets():
    sol = solve(
        PortfolioInstance(
            expected_returns=[0.1, 0.2, 0.15],
            covariance=[[0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1]],
            risk_aversion=1.0,
            budget=1,
        )
    )
    # One asset chosen; highest return net of equal risk → asset 1.
    assert sol.selected_assets == [1]
    assert sol.baseline_solution == "010"


def test_hamiltonian_ground_state():
    sol = solve(HamiltonianInstance(matrix=[[1.0, 0.0], [0.0, -1.0]]))
    assert math.isclose(sol.baseline_value, -1.0, abs_tol=1e-12)
    assert sol.method == "exact_diagonalization"


def test_caps_reject_oversized_instance():
    big = QuboInstance(Q=[[0.0] * (BRUTE_FORCE_MAX_N + 1) for _ in range(BRUTE_FORCE_MAX_N + 1)])
    with pytest.raises(CapError):
        solve(big)


def test_quantum_gap_direction():
    # maxcut maximizes: classical value 2 beats quantum 1 → classical wins.
    gap = compute_quantum_gap("maxcut", classical_value=2.0, quantum_value=1.0)
    assert gap.classical_wins
    # qubo minimizes: classical -1 beats quantum 0 → classical wins.
    gap = compute_quantum_gap("qubo", classical_value=-1.0, quantum_value=0.0)
    assert gap.classical_wins
    # tie within tolerance → nobody "wins".
    gap = compute_quantum_gap("qubo", classical_value=0.0, quantum_value=0.0)
    assert not gap.classical_wins
