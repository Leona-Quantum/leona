"""Wraps `JevClient` as a `controls.Ranker` for the Atlas method-ranking question.

Kept separate from `jev_client.py` (the transport) and `controls.py` (the zero-spend
doubles) so the one place that actually builds a network-bound request from a
`CuratedCase` + `FinderRanking` is easy to find and easy to keep out of every
zero-spend code path."""

from __future__ import annotations

from majorana_evals.jev_trial.jev_client import JevChoiceQuestion, JevClient
from majorana_evals.jev_trial.schema import CuratedCase, FinderRanking, RankedAnswer

#: The id used for the (only) question in every request — arbitrary, but fixed so a
#: response is always shaped `{"answers": {"method": {...}}}`.
QUESTION_ID = "method"


def _criteria(pool: FinderRanking) -> dict[str, str]:
    return {c.slug: f"{c.title} ({c.algorithm_family}). {c.description}" for c in pool.ranked}


class LiveJevRanker:
    """Sends ONE real "choice" question per case: state = the case's natural-language
    problem statement; criteria = every candidate the finder's own domain filter
    already narrowed to (see finder_bridge.py) — this ranker is never handed the full
    284-record corpus, only the same pool the current finder ranks. That is the fair
    comparison the offline trial is measuring: given the SAME candidate set, does
    Jev's ranking beat the current finder's satisfied-count-and-alphabetical order?"""

    name = "live-jev"

    def __init__(self, client: JevClient):
        self._client = client

    def rank(self, case: CuratedCase, pool: FinderRanking) -> RankedAnswer:
        question = JevChoiceQuestion(
            instructions=(
                "Which of these Atlas catalog methods best fits the user's stated "
                f"problem: {case.query}"
            ),
            criteria=_criteria(pool),
        )
        result = self._client.ask_choice(
            state=case.query, question_id=QUESTION_ID, question=question
        )
        ranked_slugs = sorted(
            result.answer.probabilities, key=lambda k: result.answer.probabilities[k], reverse=True
        )
        return RankedAnswer(
            ranked_slugs=ranked_slugs,
            confidence=result.answer.confidence,
            probabilities=result.answer.probabilities,
            note=f"live-jev: model={result.model}, input_tokens={result.input_tokens}",
            input_tokens=result.input_tokens,
        )
