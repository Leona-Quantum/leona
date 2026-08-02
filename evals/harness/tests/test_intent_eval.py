"""Provider-isolated tests for the real-provider intent eval harness."""

import ast
import re
from pathlib import Path

import pytest
from majorana_evals.intent_eval import _load_intent_eval_cases, run_intent_corpus
from majorana_evals.intent_procedural import (
    INTENT_PROCEDURAL_VERSION,
    generate_procedural_intent_cases,
)
from majorana_evals.schema import IntentCase, load_intent_corpus
from majorana_llm import LLMResponse


class _ScriptedLLM:
    def __init__(self, responses: list[str]):
        self.responses = list(responses)

    async def complete(self, request, *, on_delta=None):
        return LLMResponse(
            text=self.responses.pop(0),
            model=request.model,
            input_tokens=1,
            output_tokens=1,
        )


async def test_intent_eval_scores_modes_and_cohorts():
    cases = [
        IntentCase(
            id="execute",
            split="calibration",
            cohort="basic",
            prompt="Bell state",
            expected_mode="execute",
        ),
        IntentCase(
            id="chat",
            split="calibration",
            cohort="underspecified",
            prompt="Optimize my data",
            expected_mode="chat",
        ),
    ]
    llm = _ScriptedLLM(
        [
            '{"intent":"execute","reason":"canonical circuit"}',
            '{"intent":"execute","reason":"action request"}',
        ]
    )

    report = await run_intent_corpus(cases, llm=llm)

    assert (report.correct, report.total, report.accuracy) == (1, 2, 0.5)
    assert report.by_cohort == {
        "basic": {"correct": 1, "total": 1},
        "underspecified": {"correct": 0, "total": 1},
    }
    assert [case.correct for case in report.cases] == [True, False]


def test_intent_corpus_split_is_a_real_holdout_boundary(tmp_path: Path):
    corpus = tmp_path / "intent.yaml"
    corpus.write_text(
        """\
- id: calibration-case
  split: calibration
  cohort: basic
  prompt: Bell state
  expected_mode: execute
- id: holdout-case
  split: holdout
  cohort: chat
  prompt: Explain Bell states
  expected_mode: chat
"""
    )

    selected = load_intent_corpus(corpus, split="holdout")

    assert [case.id for case in selected] == ["holdout-case"]


def test_intent_corpus_rejects_duplicate_ids(tmp_path: Path):
    corpus = tmp_path / "intent.yaml"
    corpus.write_text(
        """\
- id: duplicate
  split: calibration
  cohort: basic
  prompt: Bell state
  expected_mode: execute
- id: duplicate
  split: holdout
  cohort: chat
  prompt: Explain Bell states
  expected_mode: chat
"""
    )

    with pytest.raises(ValueError, match="case IDs must be unique"):
        load_intent_corpus(corpus)


def test_checked_in_corpus_is_balanced_across_splits_and_outcomes():
    corpus = load_intent_corpus("evals/intent-corpus.yaml")

    assert {case.split for case in corpus} == {"calibration", "holdout"}
    for split in ("calibration", "holdout"):
        selected = [case for case in corpus if case.split == split]
        assert sum(case.expected_mode == "execute" for case in selected) == 7
        assert sum(case.expected_mode == "chat" for case in selected) == 7
        assert {case.cohort for case in selected} >= {
            "basic",
            "intermediate",
            "research",
            "underspecified",
            "resource",
            "capability",
        }


def test_procedural_intent_cases_are_reproducible_seeded_and_balanced():
    first = generate_procedural_intent_cases(20260802, cases_per_family=2)
    repeated = generate_procedural_intent_cases(20260802, cases_per_family=2)
    different = generate_procedural_intent_cases(20260803, cases_per_family=2)

    assert [case.model_dump(mode="json") for case in first] == [
        case.model_dump(mode="json") for case in repeated
    ]
    assert [case.prompt for case in first] != [case.prompt for case in different]
    assert len(first) == 16
    assert len({case.id for case in first}) == 16
    assert sum(case.expected_mode == "execute" for case in first) == 8
    assert sum(case.expected_mode == "chat" for case in first) == 8
    assert all(case.split == "holdout" for case in first)
    assert all(
        case.id.startswith(f"intent-procedural-{INTENT_PROCEDURAL_VERSION}-s20260802-")
        for case in first
    )


def test_procedural_assignment_pairs_separate_input_readiness_from_resource_readiness():
    cases = generate_procedural_intent_cases(20260802)
    bounded = next(case for case in cases if "-bounded-assignment-execute-" in case.id)
    oversized = next(case for case in cases if "-oversized-assignment-chat-" in case.id)
    underspecified = next(case for case in cases if "-underspecified-chat-" in case.id)

    bounded_size = int(re.search(r"Assign (\d+) workers", bounded.prompt).group(1))
    bounded_costs = ast.literal_eval(
        re.search(r"cost matrix (\[\[.*?\]\])\. Enforce", bounded.prompt).group(1)
    )
    assert 4 <= bounded_size**2 <= 16
    assert len(bounded_costs) == bounded_size
    assert all(len(row) == bounded_size for row in bounded_costs)
    assert bounded.expected_mode == "execute"

    oversized_size = int(re.search(r"Assign (\d+) workers", oversized.prompt).group(1))
    stated_qubits = int(re.search(r"resulting (\d+)-qubit", oversized.prompt).group(1))
    assert stated_qubits == oversized_size**2 > 25
    assert "complete cost matrix" in oversized.prompt
    assert oversized.expected_mode == "chat"

    assert "cost matrix" not in underspecified.prompt
    assert underspecified.expected_mode == "chat"


def test_intent_loader_merges_static_holdout_and_procedural_cases():
    cases = _load_intent_eval_cases(
        "evals/intent-corpus.yaml",
        split="holdout",
        procedural_seed=20260802,
        procedural_cases_per_family=2,
    )

    assert len(cases) == 30
    assert len({case.id for case in cases}) == 30
    assert sum(case.expected_mode == "execute" for case in cases) == 15
    assert sum(case.expected_mode == "chat" for case in cases) == 15


@pytest.mark.parametrize("seed", [-1, 2**63])
def test_procedural_intent_seed_is_bounded(seed):
    with pytest.raises(ValueError, match="procedural intent seed"):
        generate_procedural_intent_cases(seed)


@pytest.mark.parametrize("count", [0, 21])
def test_procedural_intent_family_count_is_bounded(count):
    with pytest.raises(ValueError, match="procedural intent cases_per_family"):
        generate_procedural_intent_cases(1, cases_per_family=count)


def test_intent_loader_rejects_partial_or_calibration_procedural_configuration():
    with pytest.raises(ValueError, match="procedural_seed is required"):
        _load_intent_eval_cases(
            "evals/intent-corpus.yaml",
            split="holdout",
            procedural_seed=None,
            procedural_cases_per_family=1,
        )
    with pytest.raises(ValueError, match="cases belong to the holdout split"):
        _load_intent_eval_cases(
            "evals/intent-corpus.yaml",
            split="calibration",
            procedural_seed=1,
            procedural_cases_per_family=1,
        )
