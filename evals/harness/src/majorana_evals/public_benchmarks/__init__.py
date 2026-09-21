"""Public-benchmark harness (proposal 1, ai-ops-approved 2026-09-20): run Nala against
Qiskit HumanEval and QCircuitEval through the SAME production code path
(`majorana_worker.handlers.handle_run_execute` driving `majorana_agent.SimpleCircuitPipeline`,
exactly as `majorana_evals.runner` already does for the internal corpus), score with each
benchmark's own tests where that is safe to do, and report token usage + wall time for
pricing. See `evals/public-benchmarks/*/PROVENANCE.md` for dataset sourcing and the
QCircuitEval scoring gap (structural checks only — no functional grader is implemented;
see that file before trusting a QCircuitEval pass/fail).

This module never makes a paid call on its own: `run_public_task`/`run_public_benchmark`
take an injected `LLMClient`, and `stub_llm.StubPipelineLLM` is a zero-cost double for
testing the harness end to end (see its docstring for the positive/negative control
design)."""

from majorana_evals.public_benchmarks.pricing import (
    ModelPrice,
    PricingAssumptions,
    RunPricing,
    price_full_run,
)
from majorana_evals.public_benchmarks.qcircuiteval import (
    load_qcircuiteval_tasks,
    score_qcircuiteval_task,
)
from majorana_evals.public_benchmarks.qiskit_human_eval import (
    load_qiskit_human_eval_tasks,
    score_qiskit_human_eval_task,
)
from majorana_evals.public_benchmarks.runner import run_public_benchmark, run_public_task
from majorana_evals.public_benchmarks.schema import (
    ModelCallUsage,
    PublicBenchmarkReport,
    PublicTask,
    PublicTaskResult,
)
from majorana_evals.public_benchmarks.stub_llm import StubPipelineLLM

__all__ = [
    "ModelCallUsage",
    "ModelPrice",
    "PricingAssumptions",
    "PublicBenchmarkReport",
    "PublicTask",
    "PublicTaskResult",
    "RunPricing",
    "StubPipelineLLM",
    "load_qcircuiteval_tasks",
    "load_qiskit_human_eval_tasks",
    "price_full_run",
    "run_public_benchmark",
    "run_public_task",
    "score_qcircuiteval_task",
    "score_qiskit_human_eval_task",
]
