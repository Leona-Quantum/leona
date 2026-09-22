"""Schema for the resource-estimation benchmark (ai-ops#357 option 1, first increment).

Unlike `majorana_evals.public_benchmarks` (which drives Nala's OWN code-generation pipeline
against a vendored third-party dataset), this benchmark tests a MODEL's ability to answer a
structured numeric question directly: given a fully-specified algorithm, problem size, and
hardware/QEC assumption set, estimate the logical qubits, T- or Toffoli-gate count, physical
qubits and/or runtime that a real paper reports for that exact configuration. Every reference
value traces to one paper's specific table/page/equation — never to Leona's own estimator
(`packages/py/estimation`) — see `../resource-estimation-benchmark/SPEC.md`'s
anti-contamination argument for why that separation is the whole credibility case for this
benchmark.

Quantities are graded independently, and only when the source paper actually pins them for
that case: `ResourceEstimationTask.quantities_pinned` names exactly which. T-count and
Toffoli-count are DELIBERATELY separate fields, never auto-converted into each other (the
conventional ~4-T-per-Toffoli relationship is architecture- and compilation-dependent, not an
exact identity) — a task asks for whichever gate type its source paper actually reports, and
grades only that one; a case that gives both (e.g. Kivlichan et al. 2020) pins and grades both
independently.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

QuantityName = Literal[
    "logical_qubits", "t_count", "toffoli_count", "physical_qubits", "runtime_value"
]

QUANTITY_NAMES: tuple[QuantityName, ...] = (
    "logical_qubits",
    "t_count",
    "toffoli_count",
    "physical_qubits",
    "runtime_value",
)

#: Fixed, deterministic conversion table for `runtime_value` only — the one quantity here
#: with a genuine, exact unit conversion (unlike T vs Toffoli, which is not exact and is
#: therefore never converted). "months" uses a 30-day convention, stated because some
#: sources (e.g. Beverland et al. 2022) report runtime rounded to "1 month".
RUNTIME_UNIT_SECONDS: dict[str, float] = {
    "seconds": 1.0,
    "minutes": 60.0,
    "hours": 3600.0,
    "days": 86400.0,
    "months": 30.0 * 86400.0,
    "years": 365.25 * 86400.0,
}

RunMode = Literal["live", "stub-reference", "stub-perturbed-10x", "stub-constant-guess"]


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arxiv_id: str
    title: str
    authors: list[str]
    venue: str | None = None
    #: Exact table/page/equation the reference numbers come from, e.g.
    #: "Table 2 (ours 2019 parallel row) p.3 and Table 3 p.16".
    location: str
    url: str
    #: ISO date the paper was actually (re-)read at the source for THIS case — never the
    #: date a search snippet was seen.
    retrieved: str


class CrossCheck(BaseModel):
    """An independent second-tool estimate, run once during case curation from the same
    logical resource counts the case cites — never re-run automatically by the harness (the
    tool is an optional dev extra, not a runtime dependency; see pyproject.toml). `ran=False`
    means no second tool could be applied and `note` says why (e.g. no clean gate count to
    feed it)."""

    model_config = ConfigDict(extra="forbid")

    ran: bool
    tool: str | None = None
    command: str | None = None
    inputs: dict | None = None
    result: dict | None = None
    #: Plain-language verdict — including an HONEST "disagrees by Nx" when it does. Agreement
    #: is not required for a case to be valid; disagreement with a stated, understood cause
    #: (e.g. a generic estimator can't reproduce a paper's bespoke architecture) is still
    #: informative and is recorded, never hidden.
    agreement: str | None = None
    note: str | None = None


class ResourceEstimationTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    algorithm: str
    problem_size: dict
    hardware_assumptions: dict
    #: The complete, self-contained text handed to a model under test — states the
    #: algorithm, problem size, and every hardware/QEC assumption needed to determine the
    #: pinned quantities up to the stated tolerance. Nothing a grader needs is left implicit
    #: here even though it is also broken out structurally above, so a model is never
    #: expected to infer an assumption from a field name.
    prompt: str
    #: Every numeric assumption the reference values depend on, copied/paraphrased from the
    #: source with its own location — the paper trail a reviewer checks case-by-case.
    assumptions: list[str]
    quantities_pinned: list[QuantityName]
    reference: dict[QuantityName, float]
    #: Only meaningful (and required) for "runtime_value"; other quantities are always
    #: counted directly (qubits, gate counts).
    units: dict[QuantityName, str] = Field(default_factory=dict)
    tolerance_log10: dict[QuantityName, float]
    #: Free-text justification per quantity, keyed the same as `tolerance_log10` — MUST say
    #: why that particular band, from how precisely the source itself pins the number (a
    #: rounded headline vs. an exact table entry vs. an internally inconsistent paper).
    tolerance_rationale: dict[QuantityName, str]
    source: SourceRef
    cross_check: CrossCheck
    notes: str | None = None

    @model_validator(mode="after")
    def _quantities_consistent(self) -> "ResourceEstimationTask":
        pinned = set(self.quantities_pinned)
        if not pinned:
            raise ValueError("quantities_pinned must be non-empty")
        if len(pinned) != len(self.quantities_pinned):
            raise ValueError("quantities_pinned has duplicates")
        for field_name, mapping in (
            ("reference", self.reference),
            ("tolerance_log10", self.tolerance_log10),
            ("tolerance_rationale", self.tolerance_rationale),
        ):
            missing = pinned - set(mapping)
            if missing:
                raise ValueError(
                    f"{field_name} missing entries for pinned quantities: {sorted(missing)}"
                )
            extra = set(mapping) - pinned
            if extra:
                raise ValueError(
                    f"{field_name} has entries for quantities NOT in quantities_pinned "
                    f"(a case must pin only what it actually grades): {sorted(extra)}"
                )
        if "runtime_value" in pinned:
            unit = self.units.get("runtime_value")
            if unit not in RUNTIME_UNIT_SECONDS:
                raise ValueError(
                    f"runtime_value is pinned but units['runtime_value']={unit!r} is not "
                    f"one of {sorted(RUNTIME_UNIT_SECONDS)}"
                )
        for quantity, tol in self.tolerance_log10.items():
            if not (0.0 < tol < 1.0):
                raise ValueError(
                    f"{quantity}: tolerance_log10={tol} must be strictly between 0 and 1 — "
                    "a band of 1.0 or more (a full order of magnitude) could not be told "
                    "apart from the benchmark's own 10x-perturbation negative control"
                )
        for quantity, value in self.reference.items():
            if value <= 0:
                raise ValueError(f"{quantity}: reference value {value} must be positive")
        return self


class ModelAnswer(BaseModel):
    """What a `ModelAdapter` returns for one task. `values` carries only the quantities the
    adapter chose to answer — a missing key is graded as "no answer", never coerced to 0 or
    dropped from scoring."""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    values: dict[QuantityName, float | None] = Field(default_factory=dict)
    #: Required (and only meaningful) when "runtime_value" is present in `values`.
    runtime_unit: str | None = None
    #: Free text / raw completion, kept for a real adapter's audit trail; never scored.
    raw: str | None = None


class QuantityGrade(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quantity: QuantityName
    reference_value: float
    model_value: float | None
    #: None exactly when no score could be computed (missing answer, non-positive value, or
    #: unrecognized unit) — never coerced to 0.0, which would be indistinguishable from a
    #: genuinely large log-relative error.
    log10_abs_error: float | None
    tolerance_log10: float
    passed: bool
    score: float = Field(ge=0.0, le=1.0)
    reason: str | None = None


class TaskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    grades: list[QuantityGrade]
    #: True only when every pinned quantity passed its own band.
    passed: bool
    #: Mean of per-quantity scores (each in [0, 1]).
    score: float = Field(ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)


class BenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benchmark: Literal["resource-estimation"] = "resource-estimation"
    run_mode: RunMode
    adapter_name: str
    #: `git rev-parse HEAD` in the worktree that produced this report, or None if not a git
    #: checkout (never fabricated) — same convention as public_benchmarks.runner.
    pipeline_commit_sha: str | None
    #: sha256 over the sorted, concatenated bytes of every case file actually loaded — so a
    #: report can be told apart from one scored against a different or edited case set.
    dataset_sha256: str
    total: int = Field(ge=0)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0.0, le=1.0)
    mean_score: float = Field(ge=0.0, le=1.0)
    results: list[TaskResult]
    note: str | None = None
