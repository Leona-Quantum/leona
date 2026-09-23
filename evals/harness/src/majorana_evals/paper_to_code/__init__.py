"""Paper-to-code benchmark (ai-ops#357 option 2, first increment).

See `evals/paper-to-code-benchmark/SPEC.md` for the task format, freshness/cutoff argument,
and grading rule; `evals/paper-to-code-benchmark/README.md` for how to run it; and
`evals/paper-to-code-benchmark/PROVENANCE.md` for how every case was sourced and verified."""

from majorana_evals.paper_to_code.adapters import CanonicalAdapter, GarbageAdapter, ModelAdapter
from majorana_evals.paper_to_code.grader import score_paper_to_code_task
from majorana_evals.paper_to_code.loader import (
    DEFAULT_CASES_DIR,
    dataset_sha256,
    load_paper_to_code_tasks,
)
from majorana_evals.paper_to_code.runner import run_benchmark
from majorana_evals.paper_to_code.schema import (
    BenchmarkReport,
    PaperToCodeTask,
    SourceRef,
    TaskResult,
)

__all__ = [
    "CanonicalAdapter",
    "GarbageAdapter",
    "ModelAdapter",
    "score_paper_to_code_task",
    "DEFAULT_CASES_DIR",
    "dataset_sha256",
    "load_paper_to_code_tasks",
    "run_benchmark",
    "BenchmarkReport",
    "PaperToCodeTask",
    "SourceRef",
    "TaskResult",
]
