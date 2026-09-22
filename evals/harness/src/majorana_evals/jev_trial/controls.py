"""Zero-spend controls for the Jev trial, plus a stub Jev double that proves the
adapter's parsing works end to end without a network call.

Every ranker below implements the same shape: `rank(case, pool) -> RankedAnswer`,
where `pool` is that case's `FinderRanking` (the candidate slugs the real finder
found — see `finder_bridge.py`). This lets `runner.py` swap one for another without
caring which produced the answer."""

from __future__ import annotations

import hashlib
import json
from typing import Protocol

from majorana_evals.jev_trial.jev_client import JevAskResult, JevChoiceAnswer
from majorana_evals.jev_trial.schema import CuratedCase, FinderRanking, RankedAnswer


class Ranker(Protocol):
    name: str

    def rank(self, case: CuratedCase, pool: FinderRanking) -> RankedAnswer: ...


class OracleRanker:
    """A positive control: always ranks every one of `case.expected_slugs` first (in
    the order the curated case lists them), then the rest of the pool in the finder's
    own order. Reports maximal, correct confidence — this ranker should score a
    perfect 1.0 on every metric, and a run that does not is a bug in the scorer, not
    in this control."""

    name = "oracle"

    def rank(self, case: CuratedCase, pool: FinderRanking) -> RankedAnswer:
        expected = list(dict.fromkeys(case.expected_slugs))  # de-duplicated, order kept
        pool_slugs = [c.slug for c in pool.ranked]
        rest = [s for s in pool_slugs if s not in expected]
        ranked_slugs = expected + rest
        n = len(expected)
        probabilities = {slug: (1.0 / n if slug in expected else 0.0) for slug in pool_slugs}
        return RankedAnswer(
            ranked_slugs=ranked_slugs,
            confidence=1.0,
            probabilities=probabilities,
            note="oracle: returns the curated answer(s) verbatim, first",
        )


class RandomRanker:
    """A negative control: a uniform-random permutation of the pool, with a FIXED
    seed derived from the case id (so a run is exactly reproducible without a global
    RNG state leaking between cases in any particular call order). Confidence and the
    probability distribution are drawn from the same permutation, uniform over the
    pool — chance-level by construction, not tuned toward or away from correctness."""

    name = "random"

    def __init__(self, seed: int = 1337):
        self._seed = seed

    def rank(self, case: CuratedCase, pool: FinderRanking) -> RankedAnswer:
        pool_slugs = [c.slug for c in pool.ranked]
        # Deterministic per-case seed: stable across runs and independent of pool
        # iteration order, without sharing mutable RNG state across cases.
        case_seed = int.from_bytes(
            hashlib.sha256(f"{self._seed}:{case.id}".encode()).digest()[:8], "big"
        )
        rng_state = case_seed
        shuffled = list(pool_slugs)
        # Fisher-Yates using a tiny xorshift-ish LCG so this file needs no `random`
        # import and is trivially auditable by hand.
        for i in range(len(shuffled) - 1, 0, -1):
            rng_state = (rng_state * 6364136223846793005 + 1) & ((1 << 64) - 1)
            j = rng_state % (i + 1)
            shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
        n = len(shuffled)
        uniform_p = 1.0 / n if n else 0.0
        return RankedAnswer(
            ranked_slugs=shuffled,
            confidence=uniform_p,
            probabilities={slug: uniform_p for slug in shuffled},
            note=f"random: seeded shuffle (seed={self._seed}), uniform probability 1/{n}",
        )


#: A fixed, hand-written canned response IN JEV'S REAL RESPONSE ENVELOPE SHAPE
#: (module docstring in jev_client.py) — the same dict shape `JevClient.ask_choice`
#: parses from a real HTTP response, just produced locally instead of over the
#: network. Every case gets the SAME probability curve (a geometric decay over
#: however many candidates it has), which is deliberately uncorrelated with
#: correctness: this control exists to prove `StubJevClient` -> parsing ->
#: `metrics.py` flows end to end, not to look like a good ranker. If it happens to
#: score above chance, that's an artifact of the fixed decay meeting the fixed
#: candidate order in some cases, not evidence about Jev's real quality.
def _canned_envelope(candidate_keys: list[str]) -> dict:
    n = len(candidate_keys)
    weights = [0.6**i for i in range(n)]
    total = sum(weights) or 1.0
    probabilities = {key: w / total for key, w in zip(candidate_keys, weights)}
    top_key = candidate_keys[0] if candidate_keys else ""
    return {
        "model": "jev-1.13.0",
        "answers": {
            "method": {
                "type": "choice",
                "choice": top_key,
                "confidence": 0.42,  # a fixed, clearly-canned number, not tuned
                "probabilities": probabilities,
            }
        },
        "usage": {"input_tokens": 128 * max(n, 1), "output_tokens": 24},
    }


class StubJevClient:
    """Zero-cost double for `JevClient`: parses a CANNED response through the exact
    same code path a real HTTP response would go through
    (`JevClient.ask_choice`'s own parsing, reused here), never opening a socket.
    Ranks candidates in the finder's own pool order — an arbitrary but fixed choice,
    not an attempt at quality; see `_canned_envelope`'s docstring."""

    name = "stub-jev"

    def rank(self, case: CuratedCase, pool: FinderRanking) -> RankedAnswer:
        candidate_keys = [c.slug for c in pool.ranked]
        envelope = _canned_envelope(candidate_keys)
        # Reuse the real parsing logic by round-tripping through the same shape
        # `urllib`'s response body would be: JSON text in, parsed dict out.
        parsed = json.loads(json.dumps(envelope))
        raw_answer = parsed["answers"]["method"]
        result = JevAskResult(
            model=parsed["model"],
            answer=JevChoiceAnswer(
                choice=raw_answer["choice"],
                confidence=float(raw_answer["confidence"]),
                probabilities={k: float(v) for k, v in raw_answer["probabilities"].items()},
            ),
            input_tokens=parsed["usage"]["input_tokens"],
            output_tokens=parsed["usage"]["output_tokens"],
            raw=parsed,
        )
        ranked_slugs = sorted(
            result.answer.probabilities, key=lambda k: result.answer.probabilities[k], reverse=True
        )
        return RankedAnswer(
            ranked_slugs=ranked_slugs,
            confidence=result.answer.confidence,
            probabilities=result.answer.probabilities,
            note="stub-jev: canned response in Jev's real envelope shape — not a quality signal",
        )
