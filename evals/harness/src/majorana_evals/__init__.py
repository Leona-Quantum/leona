"""majorana-evals — corpus loader + harness that runs the pipeline over corpus
cases and scores them (plans/rebuild/08-phases.md §Phase 2 step 7)."""

from majorana_evals.runner import run_case, run_corpus, top_measured_bitstring
from majorana_evals.routing import score_seeded_corpus
from majorana_evals.schema import (
    CaseResult,
    CorpusCase,
    Expect,
    Report,
    RoutingCaseResult,
    RoutingMetrics,
    RoutingOutcome,
    RoutingReport,
    SeededCase,
    load_corpus,
    load_seeded_corpus,
)

__all__ = [
    "CorpusCase",
    "Expect",
    "CaseResult",
    "Report",
    "RoutingCaseResult",
    "RoutingMetrics",
    "RoutingOutcome",
    "RoutingReport",
    "SeededCase",
    "load_corpus",
    "load_seeded_corpus",
    "run_case",
    "run_corpus",
    "score_seeded_corpus",
    "top_measured_bitstring",
]
