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
from .frontier import (
    Frontier,
    FrontierPoint,
    compute_frontier,
    pareto_frontier,
    sweep_estimates,
)
from .logical import LogicalCost
from .provenance import (
    ASSUMPTION_SET_CONSTANT_FIELDS,
    ATLAS_PAPER_IDS,
    ConstantSource,
    SourceKind,
    all_builtin_sources,
    sources_for,
)
from .qref import (
    QREF_PACKAGE_VERSION_CHECKED_AGAINST,
    QREF_SCHEMA_VERSION,
    export_estimate_to_qref,
    export_logical_cost_to_qref,
    import_logical_cost_from_qref,
    validate_qref_document,
)
from .scaling import (
    ScalingCurve,
    ScalingLaw,
    ScalingPoint,
    compute_scaling_curve,
)

__all__ = [
    "ASSUMPTION_SET_CONSTANT_FIELDS",
    "ATLAS_PAPER_IDS",
    "BUILTIN_ASSUMPTION_SETS",
    "COMPOSED_TRAPPED_ION",
    "GIDNEY_2025",
    "MAX_CODE_DISTANCE",
    "QREF_PACKAGE_VERSION_CHECKED_AGAINST",
    "QREF_SCHEMA_VERSION",
    "AdvantageStatus",
    "AdvantageVerdict",
    "AssumptionSet",
    "ConstantSource",
    "DistanceChoice",
    "FactoryTiming",
    "Footprint",
    "Frontier",
    "FrontierPoint",
    "LogicalCost",
    "PatchFootprint",
    "PhysicalEstimate",
    "Runtime",
    "ScalingCurve",
    "ScalingLaw",
    "ScalingPoint",
    "SourceKind",
    "SpeedupClass",
    "ValueProvenance",
    "all_builtin_sources",
    "assess_advantage",
    "choose_code_distance",
    "compute_frontier",
    "compute_scaling_curve",
    "estimate",
    "export_estimate_to_qref",
    "export_logical_cost_to_qref",
    "import_logical_cost_from_qref",
    "pareto_frontier",
    "sources_for",
    "sweep_estimates",
    "validate_qref_document",
]
