"""Classical baselines — the honest yardstick a quantum result is measured against
(05-security.md "No invented results"; benchmark suite categories E/F for QAOA/QUBO).

Ported from the legacy nameko `classical-baseline.ts`. Key architectural change:
the legacy code *generated Python* and ran it in the sandbox. Here the solver is
our own trusted, deterministic, size-capped code, so it runs directly in the
control plane — no untrusted code, no sandbox round-trip. The model supplies only
a *structured* problem instance; it never supplies code.

Size caps are enforced BEFORE solving so an oversized instance is rejected, never
silently truncated (the model cannot bypass them)."""

from __future__ import annotations

import itertools
from typing import Annotated, Literal

import numpy as np
from majorana_contracts.enums import BaselineKind
from pydantic import BaseModel, ConfigDict, Field

# Brute-force problems (maxcut/qubo/portfolio) are bounded by 2^n enumeration.
BRUTE_FORCE_MAX_N = 16
# Exact diagonalization is bounded by dense O(n^3) eigvalsh.
HAMILTONIAN_MAX_DIM = 64
# Upper bound on the maxcut edge list (a 16-node multigraph never needs more).
MAXCUT_MAX_EDGES = 512
# Numerical tolerance for the classical-vs-quantum comparison.
COMPARISON_TOLERANCE = 1e-9


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MaxCutInstance(_Base):
    kind: Literal["maxcut"] = "maxcut"
    edges: list[tuple[int, int, float]] = Field(
        min_length=1, description="Weighted edges [u, v, weight]; node ids are 0-based ints"
    )


class QuboInstance(_Base):
    kind: Literal["qubo"] = "qubo"
    Q: list[list[float]] = Field(description="Square QUBO matrix; minimizes x^T Q x over binary x")


class PortfolioInstance(_Base):
    kind: Literal["portfolio"] = "portfolio"
    expected_returns: list[float] = Field(min_length=1)
    covariance: list[list[float]]
    risk_aversion: float
    budget: int = Field(ge=1, description="Number of assets k to select")


class HamiltonianInstance(_Base):
    kind: Literal["hamiltonian"] = "hamiltonian"
    matrix: list[list[float]] = Field(
        description="Real symmetric Hamiltonian; ground state via eigvalsh"
    )


BaselineInstance = Annotated[
    MaxCutInstance | QuboInstance | PortfolioInstance | HamiltonianInstance,
    Field(discriminator="kind"),
]

_KIND_MAP = {
    "maxcut": BaselineKind.MAXCUT,
    "qubo": BaselineKind.QUBO,
    "portfolio": BaselineKind.PORTFOLIO,
    "hamiltonian": BaselineKind.HAMILTONIAN,
}
# maxcut is a MAXIMIZATION problem; everything else is MINIMIZATION.
_MAXIMIZE = {"maxcut"}


class BaselineSolution(BaseModel):
    kind: BaselineKind
    method: Literal["brute_force", "exact_diagonalization"]
    baseline_value: float
    baseline_solution: str | None = None
    selected_assets: list[int] | None = None
    n: int


class CapError(ValueError):
    """Raised when an instance is malformed or exceeds a hard size cap."""


class QuantumGap(BaseModel):
    gap_vs_quantum: float
    relative_gap: float
    classical_wins: bool


def _require_square(matrix: list[list[float]], label: str) -> int:
    n = len(matrix)
    if n == 0 or any(len(row) != n for row in matrix):
        raise CapError(f"{label} must be a non-empty square matrix")
    return n


def check_caps(instance: BaselineInstance) -> int:
    """Validate structure + enforce caps; return the problem size n. Raises CapError."""
    if isinstance(instance, MaxCutInstance):
        if len(instance.edges) > MAXCUT_MAX_EDGES:
            raise CapError(
                f"maxcut edge count {len(instance.edges)} exceeds cap {MAXCUT_MAX_EDGES}"
            )
        max_node = -1
        for u, v, _w in instance.edges:
            if u < 0 or v < 0:
                raise CapError("maxcut node ids must be non-negative integers")
            max_node = max(max_node, u, v)
        n = max_node + 1
        if n > BRUTE_FORCE_MAX_N:
            raise CapError(f"maxcut node count n={n} exceeds brute-force cap {BRUTE_FORCE_MAX_N}")
        return n
    if isinstance(instance, QuboInstance):
        n = _require_square(instance.Q, "qubo matrix Q")
        if n > BRUTE_FORCE_MAX_N:
            raise CapError(f"qubo dimension n={n} exceeds brute-force cap {BRUTE_FORCE_MAX_N}")
        return n
    if isinstance(instance, PortfolioInstance):
        n = len(instance.expected_returns)
        if _require_square(instance.covariance, "portfolio covariance") != n:
            raise CapError("portfolio covariance must be n x n matching expected_returns length")
        if instance.budget > n:
            raise CapError(f"portfolio budget {instance.budget} exceeds asset count {n}")
        if n > BRUTE_FORCE_MAX_N:
            raise CapError(f"portfolio n={n} exceeds brute-force cap {BRUTE_FORCE_MAX_N}")
        return n
    if isinstance(instance, HamiltonianInstance):
        n = _require_square(instance.matrix, "hamiltonian matrix")
        if n > HAMILTONIAN_MAX_DIM:
            raise CapError(f"hamiltonian dim n={n} exceeds cap {HAMILTONIAN_MAX_DIM}")
        return n
    raise CapError(f"unknown instance kind {instance!r}")


def solve(instance: BaselineInstance) -> BaselineSolution:
    """Solve a structured instance exactly. Caps are checked first."""
    n = check_caps(instance)
    kind = _KIND_MAP[instance.kind]

    if isinstance(instance, MaxCutInstance):
        best_value: float | None = None
        best_bits: tuple[int, ...] | None = None
        for bits in itertools.product((0, 1), repeat=n):
            cut = sum(w for u, v, w in instance.edges if bits[u] != bits[v])
            if best_value is None or cut > best_value:
                best_value, best_bits = cut, bits
        return BaselineSolution(
            kind=kind,
            method="brute_force",
            baseline_value=float(best_value),
            baseline_solution="".join(map(str, best_bits)),
            n=n,
        )

    if isinstance(instance, QuboInstance):
        Q = instance.Q
        best_value = None
        best_bits = None
        for bits in itertools.product((0, 1), repeat=n):
            total = sum(Q[i][j] for i in range(n) if bits[i] for j in range(n) if bits[j])
            if best_value is None or total < best_value:
                best_value, best_bits = total, bits
        return BaselineSolution(
            kind=kind,
            method="brute_force",
            baseline_value=float(best_value),
            baseline_solution="".join(map(str, best_bits)),
            n=n,
        )

    if isinstance(instance, PortfolioInstance):
        mu = instance.expected_returns
        sigma = instance.covariance
        best_value = None
        best_subset: tuple[int, ...] | None = None
        for subset in itertools.combinations(range(n), instance.budget):
            risk = sum(sigma[i][j] for i in subset for j in subset)
            ret = sum(mu[i] for i in subset)
            value = instance.risk_aversion * risk - ret
            if best_value is None or value < best_value:
                best_value, best_subset = value, subset
        bits = ["0"] * n
        for i in best_subset:
            bits[i] = "1"
        return BaselineSolution(
            kind=kind,
            method="brute_force",
            baseline_value=float(best_value),
            baseline_solution="".join(bits),
            selected_assets=list(best_subset),
            n=n,
        )

    # HamiltonianInstance
    H = np.array(instance.matrix, dtype=float)
    H = 0.5 * (H + H.T)  # symmetrize; eigvalsh assumes it
    ground = float(np.linalg.eigvalsh(H)[0])
    return BaselineSolution(
        kind=kind,
        method="exact_diagonalization",
        baseline_value=ground,
        baseline_solution=None,
        n=n,
    )


def compute_quantum_gap(kind: str, classical_value: float, quantum_value: float) -> QuantumGap:
    """Compare a quantum value against the classical baseline. maxcut is
    maximization (classical wins when strictly larger); all others minimize."""
    gap = quantum_value - classical_value
    relative = abs(gap) / max(abs(classical_value), 1e-12)
    if kind in _MAXIMIZE:
        classical_wins = classical_value > quantum_value + COMPARISON_TOLERANCE
    else:
        classical_wins = classical_value < quantum_value - COMPARISON_TOLERANCE
    return QuantumGap(gap_vs_quantum=gap, relative_gap=relative, classical_wins=classical_wins)
