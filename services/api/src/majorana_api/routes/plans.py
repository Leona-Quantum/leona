"""`POST /v1/plans`: the Atlas workflow planner's pipeline and cited costs, for a caller.

The agent connector's `plan_workflow` tool (ai-ops 382 option 1, Phase B slice S2;
VISION §5.8 "plan: the pipeline of blocks and its sourced cost"). A caller sends a
problem, its sizes and, optionally, which method to use at a stage, and gets back what
`/repository/plan` shows for the same inputs: the stages of the pipeline, each with the
methods that could fill it, and the cost lines with their kind (exact, a bound, leading
order, a paper's numerical estimate, a scaling with no constant, ...) and their source.
`estimate_point` is the logical cost the page would hand `POST /v1/estimates/logical`,
ready to be sent there for physical qubits and runtime.

**The numbers are the page's.** The planner is TypeScript (`apps/web/lib/workflow-
planner/`) and this answers from its Python port, `leona_planner`, which CI holds
equal to it on a grid of about 900 inputs (`packages/py/planner/tests/test_planner_parity.py`).
The request is the planner's structured input, the shape `StudioPlanLink` validates
less the sentence: the caller is a model, and sends numbers rather than prose.

**Stateless and arithmetic only.** No session is opened and nothing is written: no row,
no usage event, no provider, no execution. Numbers are never stored (`routes/runs.py`
states that rule); a plan is recomputed from its inputs on every call.

**Not a §1a change** (`~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md`, as
narrowed on ai-ops 217): it is authenticated through `CurrentScope` like every other
route, so there is no new anonymous door; it adds no credential and no provider; and it
executes and fetches nothing on anyone's behalf. It is in `token_access.READ_WRITES`,
beside `/estimates/logical`, because it does no more than a GET would.

**Bounded.** Every parameter is checked against its planner range before anything runs
(`leona_planner.input_errors`; a bad value is a 422 naming the range, where the page
would mark it invalid), at most `MAX_CHOICES` stage choices are taken, and the work is
fixed: one walk of a graph of about 120 nodes to depth 3, and closed-form formulas, with
no loop that grows with any value sent. Measured on an Apple M1 Pro (CPython 3.12,
mean of 300 calls, `leona_planner.plan_workflow` alone, 2026-09-25): 0.062 ms for
ground-state energy, the deepest pipeline, and 0.038 ms for factoring. The Cloud Run vCPU
was not measured. At the per-token ceiling (`DEFAULT_TOKEN_LIMIT`, 600 a minute) that is
tens of milliseconds of planning a minute per token; request parsing and auth cost more.
"""

from __future__ import annotations

from typing import Any

import leona_planner
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope
from ..request_models import RequestModel

router = APIRouter()

#: Keys a params map may carry. Every problem declares at most four; the cap only
#: stops a body from making the validator walk thousands of keys before refusing them.
MAX_PARAMS = 32
PLAN_INPUT_INVALID = "plan_input_invalid"


class PlanRequest(RequestModel):
    """The planner's structured input: `StudioPlanLink` less its sentence.

    `params` and `choices` are typed loosely here on purpose: a wrong value is refused
    by `leona_planner.input_errors` with the parameter's range in words, which a
    calling model can act on, rather than by a bare "validation failed".
    """

    model_config = ConfigDict(extra="forbid")

    problem: str = Field(
        min_length=1, max_length=64, description="A planner problem id, e.g. `factoring`."
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        max_length=MAX_PARAMS,
        description=(
            "Parameter key to the value the caller sets, or null to clear a stated "
            "assumption. A parameter left out keeps its assumption, or stays unset."
        ),
    )
    choices: dict[str, Any] = Field(
        default_factory=dict,
        max_length=leona_planner.MAX_CHOICES,
        description="Stage path, as the answer's stages carry it, to the method id to use there.",
    )


class Bilingual(BaseModel):
    en: str
    ja: str


class NodeRef(BaseModel):
    id: str
    label: Bilingual


class MethodRef(NodeRef):
    stated_cost: Bilingual | None = Field(
        description="The method's cost as its primary source states it, `$…$` math intact."
    )


class Repeat(BaseModel):
    mark: Bilingual
    count: Bilingual


class PlanStage(BaseModel):
    path: str
    depth: int
    capability: NodeRef
    method: MethodRef | None
    choice: str = Field(description="reader, published, preferred, first or none: why this method.")
    reason: Bilingual | None
    alternatives: list[NodeRef]
    repeat: Repeat | None
    stop: str | None = Field(description="cycle or depth when the walk stopped here, else null.")


class CostLine(BaseModel):
    id: str
    label: Bilingual
    value: int | float | None = Field(
        description="Null when a parameter it needs is missing (see `missing`). On a "
        "`scaling` line it is a magnitude, never a count."
    )
    unit: Bilingual
    formula: str
    kind: str
    source: str | None = Field(
        description="A key of `sources`, or null for Leona's own arithmetic."
    )
    qualifier: str | None
    note: Bilingual | None
    missing: list[str]
    counts: dict[str, Any] | None


class PlanParam(BaseModel):
    key: str
    label: Bilingual
    unit: Bilingual | None
    value: int | float | None
    origin: str = Field(description="reader, assumed, unset or invalid.")
    assumed_reason: Bilingual | None
    assumed_source: str | None
    min: int | float
    max: int | float
    integer: bool


class PlanSource(BaseModel):
    paper_id: str
    title: str
    authors: str
    year: str
    url: str | None
    locator: Bilingual
    quote: str


class PlanNote(BaseModel):
    id: str
    text: Bilingual


class IgnoredChoice(BaseModel):
    path: str
    method: str
    reason: str


class EstimatePoint(BaseModel):
    label: str
    parameter_value: int | float | None
    logical_qubits: int
    toffoli_count: int
    t_count: int
    non_clifford_depth: int


class PlanProblem(BaseModel):
    id: str
    label: Bilingual
    capability: str


class PlanResponse(BaseModel):
    problem: PlanProblem
    params: list[PlanParam]
    stages: list[PlanStage]
    compile_stages: list[PlanStage]
    lines: list[CostLine]
    classical: list[CostLine]
    published: list[CostLine]
    logical: dict[str, str | None] = Field(
        description="logical_qubits, toffolis, t_gates, queries, serial_depth: the id of the line standing for each, or null."
    )
    notes: list[PlanNote]
    estimate_point: EstimatePoint | None = Field(
        description="The body `POST /v1/estimates/logical` takes for this plan, or null when "
        "the plan states no logical qubit count and no Toffoli or T count."
    )
    sources: dict[str, PlanSource]
    ignored_choices: list[IgnoredChoice]


@router.post("/plans", response_model=PlanResponse)
async def plan(body: PlanRequest, scope: CurrentScope) -> dict[str, Any]:
    """Plan `body.problem` at `body.params` with `body.choices`.

    422, with every problem named, for an unknown problem, an undeclared parameter, a
    value outside its range or not a whole number where one is needed, or a choice
    that is not a stage path and a method id. A choice the planner could not follow
    (no such stage, or a method that does not fill it) is not an error: the answer
    lists it under `ignored_choices`, and the stage keeps its default.
    """
    del scope  # Authentication is the whole use: nothing here is per-workspace.
    errors = leona_planner.input_errors(body.problem, body.params, body.choices)
    if errors:
        raise HTTPException(
            422,
            detail={
                "error": "; ".join(errors[:8]),
                "reason": PLAN_INPUT_INVALID,
                "errors": errors[:32],
            },
        )
    return leona_planner.plan_workflow(body.problem, body.params, body.choices)
