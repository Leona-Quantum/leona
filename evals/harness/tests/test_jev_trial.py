"""Tests for the Jev offline trial (ai-ops#358): the curated-case loader, the
finder bridge (a real subprocess call into `findMethods` — needs `node` on PATH,
which this monorepo always assumes), the zero-spend controls end to end, and that
a live run refuses outright — before any network attempt — without
`TYPESAFE_API_KEY`.

No DATABASE_URL, no provider key, no sandbox: everything here is either pure Python
or a subprocess call into files already on disk in this worktree."""

from __future__ import annotations

import urllib.request

import pytest

from majorana_evals.jev_trial.controls import (
    LexicalOverlapRanker,
    OracleRanker,
    RandomRanker,
    StubJevClient,
)
from majorana_evals.jev_trial.curated_cases import PINNED_SHA256, load_curated_cases
from majorana_evals.jev_trial.finder_bridge import FinderBridgeError, rank_via_finder
from majorana_evals.jev_trial.jev_client import JevClient, JevKeyMissing, require_api_key
from majorana_evals.jev_trial.metrics import (
    brier_score,
    reciprocal_rank,
    reliability_bins,
    theoretical_chance_top1_rate,
    top_k_hit,
)
from majorana_evals.jev_trial.runner import run_jev_trial
from majorana_evals.jev_trial.schema import FinderCandidate, FinderRanking

KNOWN_DOMAIN_TOPICS = {
    "chemistry",
    "materials",
    "optimization",
    "machine-learning",
    "finance",
    "linear-algebra",
    "communication",
    "metrology",
    "cryptography",
}


# ---------------------------------------------------------------------------
# curated_cases loader
# ---------------------------------------------------------------------------


def test_loads_18_curated_cases_hash_pinned_and_unique():
    cases, digest = load_curated_cases()
    assert len(cases) == 18
    assert digest == PINNED_SHA256
    assert len({c.id for c in cases}) == len(cases)


def test_every_case_uses_a_known_domain_topic():
    cases, _ = load_curated_cases()
    for case in cases:
        assert case.domain in KNOWN_DOMAIN_TOPICS, case.id


def test_loader_rejects_a_corrupted_file(tmp_path):
    bad = tmp_path / "cases.yaml"
    bad.write_text("cases: []")
    cases, digest = load_curated_cases(bad)  # explicit path: not checked against the pin
    assert cases == []
    assert digest != PINNED_SHA256


def test_loader_rejects_duplicate_ids(tmp_path):
    bad = tmp_path / "cases.yaml"
    bad.write_text(
        "cases:\n"
        "  - {id: a, domain: chemistry, query: q, expected_slugs: [x], expected_pool_size: 1, derivation: d}\n"
        "  - {id: a, domain: chemistry, query: q, expected_slugs: [y], expected_pool_size: 1, derivation: d}\n"
    )
    with pytest.raises(ValueError, match="duplicate case ids"):
        load_curated_cases(bad)


# ---------------------------------------------------------------------------
# finder_bridge — a real subprocess call into the real findMethods
# ---------------------------------------------------------------------------


def test_finder_bridge_pool_sizes_match_expected_pool_size():
    cases, _ = load_curated_cases()
    corpus_size, rankings = rank_via_finder(cases)
    assert corpus_size > 0
    for case in cases:
        ranking = rankings[case.id]
        assert ranking.pool_size == case.expected_pool_size, case.id
        assert len(ranking.ranked) == ranking.pool_size
        assert len({c.slug for c in ranking.ranked}) == ranking.pool_size  # no duplicates


def test_finder_bridge_rejects_an_unknown_domain():
    from majorana_evals.jev_trial.schema import CuratedCase

    bogus = CuratedCase(
        id="bogus",
        domain="not-a-real-topic",
        query="q",
        expected_slugs=["x"],
        expected_pool_size=1,
        derivation="d",
    )
    with pytest.raises(FinderBridgeError, match="not a domain-facet TopicId"):
        rank_via_finder([bogus])


# ---------------------------------------------------------------------------
# metrics — pure functions
# ---------------------------------------------------------------------------


def test_top_k_hit_and_reciprocal_rank():
    assert top_k_hit(["a", "b", "c"], ["c"], 3) is True
    assert top_k_hit(["a", "b", "c"], ["c"], 2) is False
    assert reciprocal_rank(["a", "b", "c"], ["b"]) == pytest.approx(0.5)
    assert reciprocal_rank(["a", "b", "c"], ["z"]) == 0.0


def test_brier_score_perfect_and_worst_case():
    assert brier_score([(1.0, True), (1.0, True)]) == pytest.approx(0.0)
    assert brier_score([(1.0, False), (0.0, True)]) == pytest.approx(1.0)
    assert brier_score([]) is None


def test_reliability_bins_bucket_correctly():
    bins = reliability_bins([(0.05, True), (0.05, False), (0.95, True)], n_bins=2)
    assert len(bins) == 2
    assert bins[0].count == 2
    assert bins[0].empirical_hit_rate == pytest.approx(0.5)
    assert bins[1].count == 1
    assert bins[1].empirical_hit_rate == pytest.approx(1.0)


def test_theoretical_chance_top1_rate_is_mean_of_ratios():
    from majorana_evals.jev_trial.schema import CuratedCase

    cases = [
        CuratedCase(
            id="a",
            domain="chemistry",
            query="q",
            expected_slugs=["x"],
            expected_pool_size=4,
            derivation="d",
        ),
        CuratedCase(
            id="b",
            domain="chemistry",
            query="q",
            expected_slugs=["x", "y"],
            expected_pool_size=4,
            derivation="d",
        ),
    ]
    rate = theoretical_chance_top1_rate(cases, {"a": 4, "b": 4})
    assert rate == pytest.approx((0.25 + 0.5) / 2)


# ---------------------------------------------------------------------------
# Controls, end to end (the real finder_bridge, a zero-spend ranker)
# ---------------------------------------------------------------------------


def test_oracle_scores_perfect_on_every_metric():
    cases, digest = load_curated_cases()
    report = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=OracleRanker(), ranker_name="oracle"
    )
    assert report.top1_hit_rate == 1.0
    assert report.top3_hit_rate == 1.0
    assert report.mrr == 1.0
    assert report.brier_score == pytest.approx(0.0)
    assert all(c.top1_hit and c.top3_hit for c in report.cases)


def test_random_ranker_is_deterministic_across_runs():
    cases, digest = load_curated_cases()
    report_a = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=RandomRanker(seed=42), ranker_name="random"
    )
    report_b = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=RandomRanker(seed=42), ranker_name="random"
    )
    assert [c.ranked_slugs for c in report_a.cases] == [c.ranked_slugs for c in report_b.cases]


def test_random_ranker_differs_from_oracle_and_scores_far_from_perfect():
    cases, digest = load_curated_cases()
    report = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=RandomRanker(seed=1337), ranker_name="random"
    )
    assert report.top1_hit_rate < 1.0
    # A fixed seed's draw over 18 heterogeneous pools has real sampling variance
    # around the theoretical chance rate — assert it's in a broad, sane band rather
    # than pinning an exact figure the next corpus edit would break for no reason.
    assert 0.0 < report.top1_hit_rate < 0.75
    assert report.theoretical_chance_top1_rate == pytest.approx(0.2586, abs=0.01)


def test_stub_jev_flows_end_to_end_in_jevs_real_response_shape():
    cases, digest = load_curated_cases()
    report = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=StubJevClient(), ranker_name="stub-jev"
    )
    assert report.total_cases == len(cases)
    assert report.brier_score is not None  # stub-jev reports confidence, unlike current-finder
    for case in report.cases:
        assert case.ranked_slugs  # produced a real, non-empty ranking for every case


def test_lexical_control_beats_the_alphabetical_finder_and_bills_nothing():
    """The word-overlap control is the bar a live Jev score is read against. It must
    rank by content (so it clears the finder's alphabetical tie-break by a wide
    margin on this set) and must never report billed tokens."""

    cases, digest = load_curated_cases()
    lexical = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=LexicalOverlapRanker(), ranker_name="lexical"
    )
    finder = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=None, ranker_name="current-finder"
    )
    assert lexical.top1_hit_rate >= finder.top1_hit_rate + 0.4
    assert lexical.total_input_tokens is None
    assert all(c.input_tokens is None for c in lexical.cases)
    pools = {c.case_id: set(c.ranked_slugs) for c in finder.cases}
    for c in lexical.cases:  # a permutation of the same pool, nothing added or dropped
        assert set(c.ranked_slugs) == pools[c.case_id]


def _pool(*titles: str) -> FinderRanking:
    return FinderRanking(
        case_id="synthetic",
        domain="chemistry",
        pool_size=len(titles),
        ranked=[
            FinderCandidate(
                slug=f"s{i}", title=t, algorithm_family="f", description="", satisfied_count=1
            )
            for i, t in enumerate(titles)
        ],
    )


def test_lexical_control_ranks_the_overlapping_record_first():
    cases, _ = load_curated_cases()
    case = cases[0].model_copy(update={"query": "tensor hypercontraction please"})
    answer = LexicalOverlapRanker().rank(case, _pool("Grover search", "Tensor hypercontraction"))
    assert answer.ranked_slugs == ["s1", "s0"]


def test_lexical_control_with_no_overlap_keeps_the_finders_order():
    cases, _ = load_curated_cases()
    case = cases[0].model_copy(update={"query": "zzz qqq"})
    answer = LexicalOverlapRanker().rank(case, _pool("Beta", "Alpha", "Gamma"))
    assert answer.ranked_slugs == ["s0", "s1", "s2"]


def test_current_finder_ranker_reports_no_confidence():
    cases, digest = load_curated_cases()
    report = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=None, ranker_name="current-finder"
    )
    assert report.brier_score is None
    assert report.reliability_bins == []
    assert all(c.top1_confidence is None for c in report.cases)


# ---------------------------------------------------------------------------
# Key handling — never call the network without TYPESAFE_API_KEY
# ---------------------------------------------------------------------------


def test_require_api_key_raises_when_absent():
    with pytest.raises(JevKeyMissing):
        require_api_key({})


def test_require_api_key_raises_on_blank_value():
    with pytest.raises(JevKeyMissing):
        require_api_key({"TYPESAFE_API_KEY": "   "})


def test_require_api_key_returns_the_key_when_present():
    assert require_api_key({"TYPESAFE_API_KEY": "sk-test-123"}) == "sk-test-123"


@pytest.mark.parametrize("quoted", ['"sk-test-123"', "'sk-test-123'", ' "sk-test-123" '])
def test_require_api_key_strips_one_pair_of_env_file_quotes(quoted):
    # Jev answers a quoted key with a bare 401, and llm-keys.txt lines are .env style.
    assert require_api_key({"TYPESAFE_API_KEY": quoted}) == "sk-test-123"


def test_require_api_key_keeps_an_unmatched_quote():
    assert require_api_key({"TYPESAFE_API_KEY": '"sk-test-123'}) == '"sk-test-123'


def test_require_api_key_raises_on_a_pair_of_empty_quotes():
    with pytest.raises(JevKeyMissing):
        require_api_key({"TYPESAFE_API_KEY": '""'})


def test_jev_client_refuses_construction_with_empty_key():
    with pytest.raises(JevKeyMissing):
        JevClient(api_key="")


def test_live_ranker_build_never_touches_the_network_without_a_key(monkeypatch):
    """`_build_ranker("live-jev")` must raise JevKeyMissing before any HTTP attempt.
    Proven by making `urlopen` itself fail loudly if it is ever reached."""

    from majorana_evals.jev_trial.__main__ import _build_ranker

    def _forbidden(*args, **kwargs):
        raise AssertionError("urlopen must never be called when TYPESAFE_API_KEY is absent")

    monkeypatch.setattr(urllib.request, "urlopen", _forbidden)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(JevKeyMissing):
        _build_ranker("live-jev")
