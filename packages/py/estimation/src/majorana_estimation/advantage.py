"""The advantage verdict, with the Babbush bound as a real predicate.

This exists so the catalogue cannot silently sort a Grover-style entry beside
Shor. Babbush et al. (PRX Quantum 2, 010103) is the most useful single result
for a product that must not overclaim: for a quadratic speedup to overcome
error-correction constant factors inside a two-week runtime budget, the oracle
may contain **at most 68 binary operations** — far too few for anything
non-trivial, and the conclusion survives a better-than-tenfold improvement in
logical gate rate.

The verdict is deliberately not a score. Three regimes behave completely
differently and must not be presented as one number.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .assumptions import require_count

BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND = 68
"""Maximum oracle binary operations for a quadratic speedup to pay, in two weeks."""

BABBUSH_CITATION = (
    "Babbush et al., Focus beyond Quadratic Speedups for Error-Corrected Quantum "
    "Advantage, PRX Quantum 2, 010103 (arXiv:2011.04149)"
)


class SpeedupClass(str, Enum):
    SUPERPOLYNOMIAL = "superpolynomial"
    QUARTIC = "quartic"
    QUADRATIC = "quadratic"
    SIMULATION = "simulation"
    """Quantum simulation of quantum systems: the commercially motivating middle."""
    UNKNOWN = "unknown"


class AdvantageStatus(str, Enum):
    ADVANTAGE_BEARING = "advantage_bearing"
    NOT_ADVANTAGE_BEARING = "not_advantage_bearing"
    UNDETERMINED = "undetermined"


@dataclass(frozen=True)
class AdvantageVerdict:
    status: AdvantageStatus
    speedup: SpeedupClass
    reason: str
    citation: str | None = None

    @property
    def may_be_ranked_beside_superpolynomial(self) -> bool:
        """Only a superpolynomial speedup may be sorted beside Shor.

        Note this is deliberately *narrower* than `ADVANTAGE_BEARING`. A
        quadratic speedup whose oracle fits inside the 68-operation ceiling is
        genuinely advantage-bearing — Babbush says so — but it is a different
        and far more fragile claim, and flattening the two into one ordering is
        exactly what the ledger exists to prevent.
        """
        return (
            self.status is AdvantageStatus.ADVANTAGE_BEARING
            and self.speedup is SpeedupClass.SUPERPOLYNOMIAL
        )


def assess_advantage(
    speedup: SpeedupClass,
    *,
    oracle_binary_operations: int | None = None,
) -> AdvantageVerdict:
    """Classify a claimed speedup. `UNDETERMINED` is a real answer, not a failure."""
    if speedup is SpeedupClass.SUPERPOLYNOMIAL:
        return AdvantageVerdict(
            status=AdvantageStatus.ADVANTAGE_BEARING,
            speedup=speedup,
            reason=(
                "A superpolynomial speedup is not sensitive to error-correction "
                "constant factors; this is the one regime where a resource "
                "estimate is decision-grade."
            ),
        )

    if speedup is SpeedupClass.QUADRATIC:
        if oracle_binary_operations is not None:
            # A negative count would slip under the ceiling and come back
            # advantage-bearing, which is the one answer this must never give
            # by accident.
            require_count(oracle_binary_operations, "oracle_binary_operations", minimum=0)
        if oracle_binary_operations is None:
            return AdvantageVerdict(
                status=AdvantageStatus.UNDETERMINED,
                speedup=speedup,
                reason=(
                    "A quadratic speedup only pays when the oracle is smaller than "
                    f"{BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND} binary operations, and the "
                    "oracle size was not stated. Undetermined, not advantage-bearing."
                ),
                citation=BABBUSH_CITATION,
            )
        if oracle_binary_operations > BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND:
            return AdvantageVerdict(
                status=AdvantageStatus.NOT_ADVANTAGE_BEARING,
                speedup=speedup,
                reason=(
                    f"The oracle needs {oracle_binary_operations} binary operations, above "
                    f"the {BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND}-operation ceiling at "
                    "which a quadratic speedup still beats classical inside a two-week "
                    "budget. Adding qubits does not help: the bound is a runtime "
                    "argument and amplitude amplification is serial in its iterations."
                ),
                citation=BABBUSH_CITATION,
            )
        return AdvantageVerdict(
            status=AdvantageStatus.ADVANTAGE_BEARING,
            speedup=speedup,
            reason=(
                f"The oracle fits inside the {BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND}-operation "
                "ceiling, which is a narrow regime and should be stated as such."
            ),
            citation=BABBUSH_CITATION,
        )

    if speedup is SpeedupClass.QUARTIC:
        return AdvantageVerdict(
            status=AdvantageStatus.UNDETERMINED,
            speedup=speedup,
            reason=(
                "Quartic speedups look significantly more practical than quadratic "
                "ones, but the crossover still depends on the oracle cost and has "
                "not been computed here."
            ),
            citation=BABBUSH_CITATION,
        )

    if speedup is SpeedupClass.SIMULATION:
        return AdvantageVerdict(
            status=AdvantageStatus.UNDETERMINED,
            speedup=speedup,
            reason=(
                "Simulation advantage is a moving target set by the best classical "
                "method for the specific instance, not by an asymptotic class. It "
                "requires a named classical baseline to be a verdict at all."
            ),
        )

    return AdvantageVerdict(
        status=AdvantageStatus.UNDETERMINED,
        speedup=SpeedupClass.UNKNOWN,
        reason="No speedup class was stated, so no verdict is available.",
    )
