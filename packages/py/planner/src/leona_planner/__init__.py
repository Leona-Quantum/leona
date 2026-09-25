"""The Atlas workflow planner's arithmetic in Python (ai-ops 382, Phase B slice S2).

The planner is TypeScript (`apps/web/lib/workflow-planner/`), because the page runs it
on every keystroke. The agent connector's `plan_workflow` tool reaches Leona over HTTP
with a personal access token, and Next.js has no token path, so `POST /v1/plans`
answers from this port instead. Owner ruling, ai-ops 382: "Port only the arithmetic to
Python now. CI runs both on a grid of inputs and fails if any number differs."

- `plan_workflow(problem, params, choices)` — stages and cited cost lines, as JSON.
- `input_errors(problem, params, choices)` — what the API refuses before planning.

Everything that is not arithmetic (the problems, the layer graph, every word a line
prints, the sources) is data generated from the TS planner: `planner_data.json`. See
`AGENTS.md` before changing a formula.
"""

from .plan import (
    MAX_CHOICES,
    MAX_METHOD_CHARS,
    MAX_PATH_CHARS,
    UnknownProblem,
    input_errors,
    number,
    plan_workflow,
    problem_ids,
    within_spec,
)

__all__ = [
    "MAX_CHOICES",
    "MAX_METHOD_CHARS",
    "MAX_PATH_CHARS",
    "UnknownProblem",
    "input_errors",
    "number",
    "plan_workflow",
    "problem_ids",
    "within_spec",
]
