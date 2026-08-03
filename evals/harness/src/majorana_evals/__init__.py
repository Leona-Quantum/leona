"""majorana-evals — corpus loader + harness that runs the pipeline over corpus
cases and scores them (plans/rebuild/08-phases.md §Phase 2 step 7)."""

from majorana_evals.runner import run_case, run_corpus, summarize_results, top_measured_bitstring
from majorana_evals.procedural import (
    PROCEDURAL_GENERATOR_VERSION,
    PROCEDURAL_SURFACE_VERSION,
    generate_procedural_cases,
)
from majorana_evals.routing import score_seeded_corpus
from majorana_evals.schema import (
    CaseAggregate,
    CaseResult,
    CorpusCase,
    Expect,
    ExpectedCountMarginal,
    ExpectedValueRange,
    MetamorphicAggregate,
    Report,
    RoutingCaseResult,
    RoutingMetrics,
    RoutingOutcome,
    RoutingReport,
    SeededCase,
    SliceAggregate,
    load_corpus,
    load_seeded_corpus,
)

__all__ = [
    "CorpusCase",
    "Expect",
    "ExpectedCountMarginal",
    "ExpectedValueRange",
    "MetamorphicAggregate",
    "CaseResult",
    "CaseAggregate",
    "Report",
    "SliceAggregate",
    "RoutingCaseResult",
    "RoutingMetrics",
    "RoutingOutcome",
    "RoutingReport",
    "PROCEDURAL_GENERATOR_VERSION",
    "PROCEDURAL_SURFACE_VERSION",
    "SeededCase",
    "load_corpus",
    "load_seeded_corpus",
    "run_case",
    "run_corpus",
    "generate_procedural_cases",
    "score_seeded_corpus",
    "summarize_results",
    "top_measured_bitstring",
]
