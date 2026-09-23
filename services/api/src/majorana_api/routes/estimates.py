"""Physical qubits and runtime for a logical cost the caller states.

The Atlas workflow planner (`apps/web/lib/workflow-planner/`) evaluates the
logical cost a paper states for an algorithm at the reader's problem size —
logical qubits, Toffoli gates, T gates — and labels each number with its kind
and source. This route turns those counts into a physical footprint and a
wall-clock under the estimator's built-in assumption sets, at up to
`MAX_POINTS` problem sizes at once so the planner can draw a scaling curve.

**Nothing here decides how a cost grows with the problem.** That is the
caller's stated formula, cited on the page beside the curve; this route only
re-costs each point it is given, exactly as `majorana_estimation.scaling`
does for a `ScalingLaw` (the split `packages/py/estimation/AGENTS.md` asks
for: the estimator knows hardware, the caller knows the algorithm).

**Authenticated on purpose.** It is integer arithmetic with no database, no
provider and no execution — the same shape as `POST /qpu/estimates` — but a
route that costs whatever body it is sent is a new anonymous surface under the
security gate (`05-security.md` §1a), so it takes a signed-in scope. It is in
`token_access.READ_WRITES` (proposal 7 Phase C, ai-ops 349/362), added
deliberately rather than by default once a token-holding caller (`leona_mcp`'s
`estimate_resources` MCP tool) needed it — see that list's own comment for why
a `read` token, not just `run`, may call this.

The request and response are route-local, like `QpuEstimateRequest`, rather
than contracts models: nothing but the planner reads them, and the layer
summaries inside the response (`FootprintSummary`, `RuntimeSummary`,
`AssumptionSetSummary`) are the contracts' own. The frontier is the one
departure: `FrontierPointSummary` carries its assumption set's full citation on
every point, about 3 KB each, which over a nine-point curve is most of the
response. Here each point names its set and `citations` states each set once.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException
from majorana_contracts import (
    AssumptionSetSummary,
    CodeDistanceSummary,
    CostOnSmallestMachine,
)
from majorana_estimation import (
    BUILTIN_ASSUMPTION_SETS,
    GIDNEY_2025,
    AssumptionSet,
    LogicalCost,
    estimate,
)
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope
from ..catalog_estimate import (
    TARGET_FAILURE_PROBABILITY,
    _footprint_summary,
    _frontier_summary,
    _runtime_summary,
    _summarize_assumptions,
)
from ..request_models import RequestModel

router = APIRouter()

#: Points per request. The planner draws a curve from nine; sixteen leaves room
#: without letting one request become a batch job.
MAX_POINTS = 16

#: Upper bounds on the counts. Generous — Gidney–Ekerå's 8192-bit Toffoli count
#: is about 1.7e11 and published chemistry T counts reach 1e15 — but finite, so
#: a body cannot ask the estimator to reason about numbers with hundreds of
#: digits.
MAX_LOGICAL_QUBITS = 10**8
MAX_GATE_COUNT = 10**20

_Count = Annotated[int, Field(ge=0, le=MAX_GATE_COUNT)]


class LogicalPoint(RequestModel):
    """One problem size and the logical cost its source states there.

    `non_clifford_depth` is the serial chain no number of factories can
    shorten. Zero means the source states none, and then the estimator has no
    reaction floor, so no factory crossover: the point is costed on one
    factory and its runtime is that factory's throughput, which is an upper
    end, not the fastest the algorithm could run.
    """

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=120)
    parameter_value: float | None = Field(
        default=None,
        allow_inf_nan=False,
        description="The problem parameter this point is at (echoed, never read).",
    )
    logical_qubits: int = Field(ge=1, le=MAX_LOGICAL_QUBITS)
    toffoli_count: _Count = 0
    t_count: _Count = 0
    non_clifford_depth: _Count = 0


class LogicalEstimateRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    points: list[LogicalPoint] = Field(min_length=1, max_length=MAX_POINTS)
    assumptions: str | None = Field(
        default=None,
        max_length=64,
        description=(
            "Registry key of a built-in assumption set (`gidney-2025@v2`, "
            "`composed-trapped-ion@v2`). Defaults to `gidney-2025@v2`."
        ),
    )


class PlanFrontierPoint(BaseModel):
    """`FrontierPointSummary` without the per-point citation (see the module docstring)."""

    assumption_set: str
    factory_count: int = Field(ge=0)
    total_physical_qubits: int = Field(ge=0)
    runtime_seconds: float = Field(gt=0)


class PhysicalPoint(BaseModel):
    """A point's physical cost, or why it has none.

    `fastest` is costed at the factory crossover (the estimator's default, past
    which more factories buy nothing) and `smallest` at one factory. Both ends
    are reported for the reason `CostOnSmallestMachine` gives: the crossover is
    the largest machine, and a reader shown only that number reads a correct
    figure as a broken one.
    """

    label: str
    parameter_value: float | None = None
    refused: str | None = Field(
        default=None,
        description=(
            "Why this point has no physical cost — no code distance in this "
            "assumption set can protect it, or it consumes no magic states."
        ),
    )
    distance: CodeDistanceSummary | None = None
    fastest: CostOnSmallestMachine | None = None
    smallest: CostOnSmallestMachine | None = None
    frontier: list[PlanFrontierPoint] | None = None


class LogicalEstimateResponse(BaseModel):
    assumptions: AssumptionSetSummary
    points: list[PhysicalPoint]
    citations: dict[str, str] = Field(
        description="Assumption-set identity -> its citation, once per set the frontier names."
    )


def _resolve(key: str | None) -> AssumptionSet:
    """A built-in set by registry key, never a silent fallback.

    No rotation precision is attached: a stated logical cost arrives as Toffoli
    and T counts, and `estimate()` never reads a precision, so naming one would
    put an `+eps=` on the identity that nothing here used.
    """
    wanted = key or GIDNEY_2025.identity
    try:
        return BUILTIN_ASSUMPTION_SETS[wanted]
    except KeyError:
        raise HTTPException(
            status_code=422,
            detail=f"unknown assumption set {wanted!r}; known: {sorted(BUILTIN_ASSUMPTION_SETS)}",
        ) from None


def _cost_point(point: LogicalPoint, assumptions: AssumptionSet) -> PhysicalPoint:
    base = PhysicalPoint(label=point.label, parameter_value=point.parameter_value)
    if point.toffoli_count == 0 and point.t_count == 0:
        # The estimator would cost this, as a machine with no factories and no
        # stated runtime. For a planner line that is almost always a count the
        # source did not give, not a Clifford-only algorithm, so say so.
        return base.model_copy(
            update={
                "refused": (
                    "No Toffoli or T count was stated at this size, so there is no "
                    "magic-state cost to turn into a machine."
                )
            }
        )
    try:
        logical = LogicalCost(
            logical_qubits=point.logical_qubits,
            toffoli_count=point.toffoli_count,
            t_count=point.t_count,
            non_clifford_depth=point.non_clifford_depth,
            label=point.label,
        )
        fastest = estimate(
            logical, assumptions, target_failure_probability=TARGET_FAILURE_PROBABILITY
        )
    except ValueError as exc:
        # A real answer about the hardware (no distance protects this many
        # operations), reported in the estimator's own words.
        return base.model_copy(update={"refused": str(exc)})

    smallest = None
    if fastest.runtime.factory_count > 1:
        smallest = estimate(
            logical,
            assumptions,
            target_failure_probability=TARGET_FAILURE_PROBABILITY,
            factory_count=1,
        )
    return base.model_copy(
        update={
            "distance": CodeDistanceSummary(
                code_distance=fastest.distance.code_distance,
                logical_operations=fastest.distance.logical_operations,
                required_error_per_operation=fastest.distance.required_error_per_operation,
                achieved_error_per_operation=fastest.distance.achieved_error_per_operation,
                physical_per_logical=fastest.distance.physical_per_logical,
            ),
            "fastest": CostOnSmallestMachine(
                footprint=_footprint_summary(fastest), runtime=_runtime_summary(fastest)
            ),
            "smallest": (
                None
                if smallest is None
                else CostOnSmallestMachine(
                    footprint=_footprint_summary(smallest), runtime=_runtime_summary(smallest)
                )
            ),
            "frontier": [
                PlanFrontierPoint(
                    assumption_set=point.assumption_set,
                    factory_count=point.factory_count,
                    total_physical_qubits=point.total_physical_qubits,
                    runtime_seconds=point.runtime_seconds,
                )
                for point in _frontier_summary(logical, assumptions).points
            ],
        }
    )


@router.post("/estimates/logical", response_model=LogicalEstimateResponse)
async def estimate_logical(
    body: LogicalEstimateRequest, scope: CurrentScope
) -> LogicalEstimateResponse:
    """Cost each stated logical point under one assumption set, plus its frontier.

    Every point is costed independently; one that cannot be costed carries its
    reason and the others still come back, so a curve with a gap at its large
    end shows the gap rather than failing whole.
    """
    del scope  # Authentication is the whole use: nothing here is per-workspace.
    assumptions = _resolve(body.assumptions)
    points = [_cost_point(point, assumptions) for point in body.points]
    # The frontier sweeps `assumptions` itself plus every other built-in set
    # (`_frontier_summary`), so those are the identities it can name.
    known = {assumptions.identity: assumptions.citation} | {
        other.identity: other.citation
        for other in BUILTIN_ASSUMPTION_SETS.values()
        if other.name != assumptions.name
    }
    named = {p.assumption_set for point in points for p in point.frontier or []}
    return LogicalEstimateResponse(
        assumptions=_summarize_assumptions(assumptions),
        points=points,
        citations={identity: known[identity] for identity in sorted(named)},
    )
