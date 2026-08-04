"""Fault-tolerant resource estimation for Leona Quantum.

Nothing here executes a circuit, which is exactly why it works at 10^7 qubits
where a simulator does not: every layer is arithmetic over a named assumption
set. See `plans/leona-resource-estimation.md` for the derivation and
`plans/leona-estimator-provenance.md` for what was borrowed and from where.
"""

from .advantage import (
    BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND,
    AdvantageStatus,
    AdvantageVerdict,
    SpeedupClass,
    assess_advantage,
)
from .assumptions import BUILTIN_ASSUMPTION_SETS, GIDNEY_2025, AssumptionSet
from .estimate import (
    MAX_CODE_DISTANCE,
    DistanceChoice,
    Footprint,
    PhysicalEstimate,
    Runtime,
    choose_code_distance,
    estimate,
)
from .logical import LogicalCost

__all__ = [
    "BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND",
    "BUILTIN_ASSUMPTION_SETS",
    "GIDNEY_2025",
    "MAX_CODE_DISTANCE",
    "AdvantageStatus",
    "AdvantageVerdict",
    "AssumptionSet",
    "DistanceChoice",
    "Footprint",
    "LogicalCost",
    "PhysicalEstimate",
    "Runtime",
    "SpeedupClass",
    "assess_advantage",
    "choose_code_distance",
    "estimate",
]
