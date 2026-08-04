"""The advantage verdict, from what Babbush et al. actually says.

This exists so the catalogue cannot silently sort a Grover-style entry beside
Shor. Babbush et al. (PRX Quantum 2, 010103) remains the most useful single
result for a product that must not overclaim.

## The bound this module used to enforce does not exist

Until 2026-08-05 this file carried
`BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND = 68`, described as the ceiling under
which a quadratic speedup still beats classical "inside a two-week budget", and
gated the verdict on it. **The paper contains no such claim.** arXiv:2011.04149v2
was downloaded and searched: the words *oracle*, *binary operation* and *week*
appear nowhere in it, and its only occurrence of "68" is bibliography entry
[68]. Three fabricated elements in one sentence, spread across six documents,
and tagged in one of them as verified against the source.

**What the paper gives instead is breakeven runtimes, and they are worse for
the quantum computer than the invented ceiling was.** Its model: a Toffoli costs
`5.5d` surface-code cycles, so `t_G ~ 170 us` at `d = 30` and a 1 us cycle; a
primitive of `G` Toffolis costs `t_Q = 170 us * G`; breakeven against a classical
adversary with parallel speedup `S` is `T* = t_Q * (t_Q*S/t_C)^(1/(d-1))`. Its two
worked quadratic examples (Table I):

- the most generous case it can construct — `G = 100` Toffolis, which it says it
  finds hard to imagine anything useful fitting inside — breaks even in 2.4 hours
  against **one** classical core, 100 days against a thousand, 280 years against
  a million;
- its one realistically compiled example, quantum-accelerated simulated annealing
  on a 512-spin Sherrington-Kirkpatrick instance: 320 days, 880 years, 880
  millennia.

So a quadratic speedup is **not** advantage-bearing on early fault-tolerant
hardware, full stop, and there is no oracle size that rescues it — which is why
`assess_advantage` no longer takes one. The conclusion survives a tenfold faster
factory (Table II: 1.0 day and 8.8 years at `R = 10`), and quartic speedups look
significantly more practical. Both of those the paper does state.

The verdict is deliberately not a score. Three regimes behave completely
differently and must not be presented as one number.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

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

        Note this is deliberately *narrower* than `ADVANTAGE_BEARING`, and it
        stays narrower now that nothing but a superpolynomial speedup can reach
        `ADVANTAGE_BEARING` at all. The two are separate on purpose: whatever a
        later verdict admits — a quartic speedup with its crossover actually
        computed, say — it will still be a more fragile claim than Shor, and
        flattening the two into one ordering is what the ledger exists to
        prevent. Collapsing this into `status is ADVANTAGE_BEARING` because they
        happen to coincide today is how the distinction gets lost.
        """
        return (
            self.status is AdvantageStatus.ADVANTAGE_BEARING
            and self.speedup is SpeedupClass.SUPERPOLYNOMIAL
        )


def assess_advantage(speedup: SpeedupClass) -> AdvantageVerdict:
    """Classify a claimed speedup. `UNDETERMINED` is a real answer, not a failure.

    **`oracle_binary_operations` is gone rather than ignored.** It existed to be
    compared against a ceiling that is not in the cited paper (see the module
    docstring), so there is nothing for a caller to supply. A parameter kept for
    compatibility and quietly disregarded would leave every existing call site
    reading as though the size still mattered.
    """
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
        return AdvantageVerdict(
            status=AdvantageStatus.NOT_ADVANTAGE_BEARING,
            speedup=speedup,
            reason=(
                "Error-correction constant factors swallow a quadratic speedup on "
                "early fault-tolerant hardware. The cited paper's most generous "
                "case — a primitive of only 100 Toffoli gates, which it says it "
                "finds hard to imagine anything useful fitting inside — needs 100 "
                "days of quantum runtime to break even against a thousand parallel "
                "classical cores, and its one realistically compiled example needs "
                "880 years. Adding qubits does not help: this is a runtime argument "
                "and amplitude amplification is serial in its iterations. The "
                "conclusion holds even with a tenfold faster magic-state factory."
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
