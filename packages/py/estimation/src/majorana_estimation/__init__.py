"""Fault-tolerant resource estimation for Leona Quantum.

Nothing here executes a circuit, which is exactly why it works at 10^7 qubits
where a simulator does not: every layer is arithmetic over a named assumption
set.

**Sourcing spec: `docs/estimation/assumption-sets.md`** — which paper states
which value, what each set departs from, and the rule for adding one. It lives
in this repository on purpose: the two planning documents this docstring used to
cite (`plans/leona-resource-estimation.md` for the derivation,
`plans/leona-estimator-provenance.md` for what was borrowed from Qualtran) are
outside it, so nobody working from a checkout could open the thing being called
authoritative. That is the same defect the UI spec had, found the same way.
"""

from .advantage import (
    BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND,
    AdvantageStatus,
    AdvantageVerdict,
    SpeedupClass,
    assess_advantage,
)
from .assumptions import (
    BUILTIN_ASSUMPTION_SETS,
    COMPOSED_TRAPPED_ION,
    GIDNEY_2025,
    AssumptionSet,
    FactoryTiming,
    PatchFootprint,
    ValueProvenance,
)
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
    "COMPOSED_TRAPPED_ION",
    "GIDNEY_2025",
    "MAX_CODE_DISTANCE",
    "AdvantageStatus",
    "AdvantageVerdict",
    "AssumptionSet",
    "DistanceChoice",
    "FactoryTiming",
    "Footprint",
    "LogicalCost",
    "PatchFootprint",
    "PhysicalEstimate",
    "Runtime",
    "SpeedupClass",
    "ValueProvenance",
    "assess_advantage",
    "choose_code_distance",
    "estimate",
]
