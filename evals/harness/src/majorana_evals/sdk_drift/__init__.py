"""SDK-drift benchmark (ai-ops#357 option 3, first increment).

See `evals/sdk-drift-benchmark/SPEC.md` for the task format and grading rule;
`evals/sdk-drift-benchmark/README.md` for how to run it; and
`evals/sdk-drift-benchmark/PROVENANCE.md` for the per-task Qiskit release-note citations."""

from majorana_evals.sdk_drift.adapters import CanonicalAdapter, ModelAdapter, OutdatedAdapter
from majorana_evals.sdk_drift.grader import qiskit_installed_version, score_sdk_drift_task
from majorana_evals.sdk_drift.loader import (
    DEFAULT_CASES_DIR,
    dataset_sha256,
    load_sdk_drift_tasks,
)
from majorana_evals.sdk_drift.prompt_neutrality import leaked_identifiers
from majorana_evals.sdk_drift.runner import run_benchmark
from majorana_evals.sdk_drift.schema import (
    BenchmarkReport,
    QiskitChangeRef,
    SdkDriftTask,
    TaskResult,
)

__all__ = [
    "CanonicalAdapter",
    "ModelAdapter",
    "OutdatedAdapter",
    "qiskit_installed_version",
    "score_sdk_drift_task",
    "DEFAULT_CASES_DIR",
    "dataset_sha256",
    "load_sdk_drift_tasks",
    "leaked_identifiers",
    "run_benchmark",
    "BenchmarkReport",
    "QiskitChangeRef",
    "SdkDriftTask",
    "TaskResult",
]
