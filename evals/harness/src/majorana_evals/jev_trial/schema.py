"""Report schema for the Jev offline trial (ai-ops#358, owner: "option 1. i have
created account" — trial Jev, TypeSafe AI's decision model, offline on Atlas method
ranking, no user data, against a curated ground truth).

Deliberately separate from `majorana_evals.public_benchmarks.schema`: that package
scores generated CODE against a benchmark's own executable test; this one scores a
RANKING (of existing catalog records) against a small curated answer set, and never
calls the product's run pipeline, sandbox, or database at all — see the package
`__init__.py` docstring."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: What produced a ranking: the real production finder, an oracle/random zero-spend
#: control, a canned-response double proving the Jev adapter's parsing end to end, or
#: an actual network call to Jev. Every report carries this so a report can never be
#: mistaken for a priced result by accident (same reason
#: `public_benchmarks.schema.RunMode` exists).
RankerName = Literal["current-finder", "oracle", "random", "stub-jev", "lexical", "live-jev"]


class CuratedCase(BaseModel):
    """One row of `evals/jev-trial/curated-cases.yaml`. See that file's own header
    and `evals/jev-trial/DERIVATION.md` for how `expected_slugs` was derived —
    mechanically, from the catalog's own topic tags or title text, never invented."""

    model_config = ConfigDict(extra="forbid")

    id: str
    domain: str
    query: str
    expected_slugs: list[str] = Field(min_length=1)
    expected_pool_size: int = Field(ge=1)
    derivation: str


class FinderCandidate(BaseModel):
    """One record in a domain pool, as the finder-rank.mts bridge reports it —
    the fields `apps/web/lib/repository/finder.ts`'s `findMethods` itself ranked on."""

    model_config = ConfigDict(extra="forbid")

    slug: str
    title: str
    algorithm_family: str
    description: str
    satisfied_count: int = Field(ge=0)


class FinderRanking(BaseModel):
    """The production finder's own ranking for one case, as returned by
    `finder_bridge.rank_via_finder` (a direct call into `findMethods`, not a
    reimplementation — see that module's docstring)."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    domain: str
    pool_size: int = Field(ge=0)
    ranked: list[FinderCandidate]


class RankedAnswer(BaseModel):
    """One ranker's answer for one case, normalized to what scoring needs regardless
    of source (the real finder, a control, or a real/stub Jev call).

    `probabilities` is Jev's own per-candidate distribution when the ranker is Jev
    (real or stub) or a control built to mimic one; it is None for the current
    finder, which reports no probability at all — `findMethods` ranks by a
    satisfied-criteria count and tie-breaks, never a calibrated score (see
    `FinderCandidate.satisfied_count` above and DERIVATION.md's "what the current
    finder actually ranks on" finding)."""

    model_config = ConfigDict(extra="forbid")

    ranked_slugs: list[str]
    #: Jev's scalar confidence in its own top pick (`answers.<q>.confidence` in the
    #: real API — see jev_client.py). None when the ranker has no such notion
    #: (current-finder, random) or is a control that reports a fixed placeholder.
    confidence: float | None = None
    #: slug -> probability, only for a ranker that reports a full distribution
    #: (oracle/random/stub-jev/live-jev). Used for the calibration metrics.
    probabilities: dict[str, float] | None = None
    #: Raw text describing what produced this answer — the stub's fixed script, the
    #: HTTP status if a live call failed, etc. Never silently swallowed.
    note: str | None = None
    #: Billed input tokens as the provider reported them (`usage.input_tokens`).
    #: Only a live call has one; every zero-spend ranker leaves it None.
    input_tokens: int | None = Field(default=None, ge=0)


class CaseScore(BaseModel):
    """One ranker's scored result for one curated case."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    ranker: RankerName
    ranked_slugs: list[str]
    top1_hit: bool
    top3_hit: bool
    reciprocal_rank: float = Field(ge=0.0, le=1.0)
    #: Only populated for a ranker that reports confidence/probabilities
    #: (oracle/random/stub-jev/live-jev) — used to build the aggregate calibration.
    top1_confidence: float | None = None
    top1_correct: bool | None = None
    #: Copied from `RankedAnswer.input_tokens`; None for every zero-spend ranker.
    input_tokens: int | None = Field(default=None, ge=0)


class ReliabilityBin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Half-open [lower, upper) confidence range this bin covers.
    lower: float
    upper: float
    count: int = Field(ge=0)
    mean_confidence: float | None = None
    empirical_hit_rate: float | None = None


class JevTrialReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ranker: RankerName
    generated_at: str
    #: `git rev-parse HEAD` in the worktree that produced this report, or None.
    pipeline_commit_sha: str | None
    curated_cases_sha256: str
    corpus_size: int = Field(ge=0)
    total_cases: int = Field(ge=0)
    #: mean(|expected_slugs| / pool_size) across cases — the top-1 hit rate a
    #: UNIFORM-RANDOM ranker would score IN EXPECTATION (not the single seeded draw
    #: below, which has real sampling variance at n=18 cases — see metrics.py's
    #: `theoretical_chance_top1_rate` docstring). Carried on every report, including
    #: current-finder's and oracle's, purely as a fixed reference point so a reader
    #: never has to recompute it to judge whether "random" scored near chance.
    theoretical_chance_top1_rate: float = Field(ge=0.0, le=1.0)
    top1_hit_rate: float = Field(ge=0.0, le=1.0)
    top3_hit_rate: float = Field(ge=0.0, le=1.0)
    mrr: float = Field(ge=0.0, le=1.0)
    #: None unless the ranker reports confidence (oracle/random/stub-jev/live-jev).
    brier_score: float | None = None
    reliability_bins: list[ReliabilityBin] = Field(default_factory=list)
    #: Sum of per-case `input_tokens`, i.e. what a live run was billed for (output
    #: is unbilled per typesafe.ai). None when no case made a live call.
    total_input_tokens: int | None = Field(default=None, ge=0)
    cases: list[CaseScore]
    note: str | None = None
