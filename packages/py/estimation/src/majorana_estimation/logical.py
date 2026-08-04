"""Architecture-independent logical cost of a circuit.

This is the boundary that makes the estimator honest: a `LogicalCost` says
nothing about hardware, and an `AssumptionSet` says nothing about the
algorithm. Every physical number is a pure function of exactly one of each,
which is what lets the same circuit be re-costed when the hardware assumptions
move — and they move often (three algorithmic papers took RSA-2048 from 20
million qubits to under one million with no hardware assumption changing).
"""

from __future__ import annotations

from dataclasses import dataclass

from .assumptions import require_count


@dataclass(frozen=True)
class LogicalCost:
    """What the algorithm needs, before any hardware is named."""

    logical_qubits: int
    """Algorithm qubits including ancillas, not just the register width."""

    toffoli_count: int = 0
    t_count: int = 0
    """Standalone T gates, i.e. not already counted inside `toffoli_count`."""

    non_clifford_depth: int = 0
    """Length of the serial non-Clifford dependency chain.

    This is the one number no amount of hardware can improve, so an estimate
    that omits it silently promises a speedup that parallelism cannot deliver.
    Defaults to 0, which means "unknown"; `magic_states` is then the only
    runtime driver and the reaction-limited floor is reported as not binding.
    """

    label: str = ""

    def __post_init__(self) -> None:
        require_count(self.logical_qubits, "logical_qubits", minimum=1)
        for name in ("toffoli_count", "t_count", "non_clifford_depth"):
            require_count(getattr(self, name), name, minimum=0)
        if self.is_clifford_only and self.non_clifford_depth:
            # There is no non-Clifford chain to have a depth. Left unchecked,
            # `_runtime` would charge a feed-forward reaction per layer for
            # operations that never wait on a measurement.
            #
            # Rejecting is the honest narrow fix; the general answer is a
            # separate Clifford/logical-cycle depth with its own cycle cost,
            # which this model does not yet have. Until it does, a Clifford-only
            # circuit's runtime is not something this package can state.
            raise ValueError(
                "non_clifford_depth must be 0 for a circuit with no magic states: "
                "a Clifford-only circuit has no non-Clifford dependency chain. "
                "Modelling its wall-clock needs a Clifford-depth metric this "
                "package does not have yet."
            )

    def magic_states(self, *, t_per_toffoli: int) -> int:
        """Total distilled states consumed, under a stated Toffoli convention.

        The convention is a parameter rather than a constant because it is one
        of the three unsourced numbers the whole estimate is sensitive to: 4 per
        Toffoli with measurement-and-fixup, 7 without.
        """
        require_count(t_per_toffoli, "t_per_toffoli", minimum=1)
        return self.toffoli_count * t_per_toffoli + self.t_count

    @property
    def is_clifford_only(self) -> bool:
        """No magic states means no distillation, and the cost model degenerates."""
        return self.toffoli_count == 0 and self.t_count == 0
