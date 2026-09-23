"""Resource-estimation benchmark (ai-ops#357 option 1, first increment).

See `evals/resource-estimation-benchmark/SPEC.md` for the task format, grading rule, and
anti-contamination argument; `evals/resource-estimation-benchmark/README.md` for how to run
it; and `evals/resource-estimation-benchmark/PROVENANCE.md` for how every case was verified
and which candidates were dropped.
"""

from majorana_evals.resource_estimation.adapters import (
    ConstantGuessAdapter,
    ModelAdapter,
    PerturbedAdapter,
    ReferenceAdapter,
)
from majorana_evals.resource_estimation.grader import grade_task
from majorana_evals.resource_estimation.live_adapter import LiveModelAdapter
from majorana_evals.resource_estimation.loader import (
    DEFAULT_CASES_DIR,
    dataset_sha256,
    load_resource_estimation_tasks,
)
from majorana_evals.resource_estimation.runner import run_benchmark
from majorana_evals.resource_estimation.schema import (
    BenchmarkReport,
    CrossCheck,
    ModelAnswer,
    QuantityGrade,
    QuantityName,
    ResourceEstimationTask,
    SourceRef,
    TaskResult,
)

__all__ = [
    "ConstantGuessAdapter",
    "LiveModelAdapter",
    "ModelAdapter",
    "PerturbedAdapter",
    "ReferenceAdapter",
    "grade_task",
    "DEFAULT_CASES_DIR",
    "dataset_sha256",
    "load_resource_estimation_tasks",
    "run_benchmark",
    "BenchmarkReport",
    "CrossCheck",
    "ModelAnswer",
    "QuantityGrade",
    "QuantityName",
    "ResourceEstimationTask",
    "SourceRef",
    "TaskResult",
]
