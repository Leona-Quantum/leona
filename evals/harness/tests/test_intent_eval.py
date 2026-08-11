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
        self.request = None

    async def complete(self, request, *, on_delta=None):
        self.request = request
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


async def test_a_followup_case_reaches_the_router_as_conversation_history():
    """The corpus can describe a follow-up; this asserts the harness delivers
    one. If run_intent_corpus drops `history`, every follow-up case silently
    becomes a standalone prompt and the cohort keeps reporting a score."""
    case = IntentCase(
        id="followup",
        split="holdout",
        cohort="followup",
        prompt="Build it now.",
        expected_mode="execute",
        history=[
            {"role": "user", "content": "Partition six suppliers, weights A-B 5, A-C 2."},
            {"role": "assistant", "content": "That is a weighted MaxCut over six nodes."},
        ],
    )
    llm = _ScriptedLLM(['{"intent":"execute","reason":"referential action"}'])

    report = await run_intent_corpus([case], llm=llm)

    assert report.correct == 1
    assert [message.model_dump() for message in llm.request.messages] == [
        {"role": "user", "content": "Partition six suppliers, weights A-B 5, A-C 2."},
        {"role": "user", "content": "User message:\nBuild it now."},
    ]
    assert "weighted MaxCut" not in llm.request.user


async def test_a_standalone_case_still_reaches_the_router_with_no_history():
    case = IntentCase(
        id="standalone",
        split="holdout",
        cohort="basic",
        prompt="Create and measure a Bell state.",
        expected_mode="execute",
    )
    llm = _ScriptedLLM(['{"intent":"execute","reason":"canonical circuit"}'])

    await run_intent_corpus([case], llm=llm)

    assert llm.request.messages is None, "no history must stay the single-user request"
    assert llm.request.user == "User message:\nCreate and measure a Bell state."


async def test_an_attached_source_case_reaches_the_auto_router_as_ready_input():
    case = IntentCase(
        id="attached-source",
        split="holdout",
        cohort="attachment",
        prompt="Run and verify this attached circuit.",
        expected_mode="execute",
        has_source_code=True,
    )
    llm = _ScriptedLLM(['{"intent":"execute","reason":"attached code is runnable"}'])

    report = await run_intent_corpus([case], llm=llm)

    assert report.correct == 1
    assert "source code is attached" in llm.request.user


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
        assert sum(case.expected_mode == "execute" for case in selected) == 10
        assert sum(case.expected_mode == "chat" for case in selected) == 10
        assert {case.cohort for case in selected} >= {
            "attachment",
            "basic",
            "intermediate",
            "research",
            "underspecified",
            "resource",
            "capability",
            "followup",
        }


def test_the_followup_cohort_actually_carries_history_both_ways():
    """A follow-up case with no history is a standalone prompt wearing the
    cohort's name — it would score the router on something else entirely and
    still report as coverage of conversation routing."""
    corpus = load_intent_corpus("evals/intent-corpus.yaml")
    followups = [case for case in corpus if case.cohort == "followup"]

    assert len(followups) >= 8
    assert all(case.history for case in followups)
    assert all(case.history[-1].role == "assistant" for case in followups), (
        "a follow-up answers the assistant's last turn"
    )
    # Both directions, or the cohort only proves history can make routing sticky
    # and never that it can be resisted.
    assert sum(case.expected_mode == "execute" for case in followups) >= 3
    assert sum(case.expected_mode == "chat" for case in followups) >= 3


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
    assert sum(case.expected_mode == "execute" for case in first) == 12
    assert sum(case.expected_mode == "chat" for case in first) == 4
    assert all(case.split == "holdout" for case in first)
    assert all(
        case.id.startswith(f"intent-procedural-{INTENT_PROCEDURAL_VERSION}-s20260802-")
        for case in first
    )


def test_procedural_assignment_pairs_separate_input_readiness_from_local_capacity():
    cases = generate_procedural_intent_cases(20260802)
    bounded = next(case for case in cases if "-bounded-assignment-execute-" in case.id)
    oversized = next(case for case in cases if "-oversized-assignment-artifact-" in case.id)
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
    assert oversized.expected_mode == "execute"

    assert "cost matrix" not in underspecified.prompt
    assert underspecified.expected_mode == "chat"


def test_intent_loader_merges_static_holdout_and_procedural_cases():
    cases = _load_intent_eval_cases(
        "evals/intent-corpus.yaml",
        split="holdout",
        procedural_seed=20260802,
        procedural_cases_per_family=2,
    )

    assert len(cases) == 36
    assert len({case.id for case in cases}) == 36
    assert sum(case.expected_mode == "execute" for case in cases) == 22
    assert sum(case.expected_mode == "chat" for case in cases) == 14


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
