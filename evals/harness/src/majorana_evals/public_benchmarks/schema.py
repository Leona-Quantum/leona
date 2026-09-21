"""Report schema for the public-benchmark harness.

Deliberately separate from `majorana_evals.schema` (the internal corpus's `Expect`/`Report`
models): a public-benchmark task is graded by the BENCHMARK's own test, not by a hand-written
`Expect`, so the shapes do not share fields beyond what both genuinely mean the same thing."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

BenchmarkName = Literal["qiskit-human-eval", "qcircuiteval"]

#: What produced the model's answer: a real run, or a zero-cost stub used to test the
#: harness itself. Every report carries this so a report can never be read as a priced
#: result by accident.
RunMode = Literal["live", "stub-canonical", "stub-garbage"]


class PublicTask(BaseModel):
    """One benchmark task, normalized to what the harness needs regardless of source.

    `nala_prompt` is what is actually sent to Nala as `task_prompt` — for QCircuitEval this
    is close to the vendored `prompt` field verbatim (it was already written as a
    code-completion instruction); for Qiskit HumanEval it is the vendored scaffold wrapped
    in a short instruction (see `qiskit_human_eval.build_nala_prompt`). `canonical_solution`
    and the benchmark-specific grading fields are carried through so both scoring and the
    stub controls can use them without re-reading the raw dataset file.
    """

    model_config = ConfigDict(extra="forbid")

    benchmark: BenchmarkName
    task_id: str
    entry_point: str
    nala_prompt: str
    canonical_solution: str
    #: Verbatim scaffold/instructions from the dataset, kept for scoring
    #: (`exec(scaffold + completion)` needs the imports/signature the scaffold provides).
    scaffold: str
    #: Benchmark-specific grading contract, opaque to the harness core:
    #: - qiskit-human-eval: {"test": "<source defining check(candidate)>"}
    #: - qcircuiteval: the raw `canonical_class` dict plus `forbidden_imports`
    grading: dict[str, Any] = Field(default_factory=dict)
    category: str | None = None
    difficulty: str | None = None


class ModelCallUsage(BaseModel):
    """Aggregate `llm.call` usage for one model id, across every task in a report."""

    model_config = ConfigDict(extra="forbid")

    calls: int = Field(default=0, ge=0)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class PublicTaskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benchmark: BenchmarkName
    task_id: str
    passed: bool
    #: None when the harness could not even determine functional correctness (the
    #: QCircuitEval functional grader is not implemented — see PROVENANCE.md). `passed`
    #: in that case reflects the structural checks only, and this field says so plainly
    #: rather than letting a silent None read as a pass.
    functional_grading: Literal["implemented", "not_implemented"] = "implemented"
    run_status: str
    candidates_considered: int = Field(default=0, ge=0)
    reasons: list[str] = Field(default_factory=list)
    recorded_llm_calls: int = Field(default=0, ge=0)
    recorded_input_tokens: int = Field(default=0, ge=0)
    recorded_output_tokens: int = Field(default=0, ge=0)
    wall_time_s: float = Field(ge=0)
    #: sha256 of the finalized candidate source, or None when no candidate was delivered.
    #: The full source is not stored in the report (bench-14-sized reports would balloon);
    #: the fingerprint is enough to correlate a result against the run in the database.
    candidate_source_fingerprint: str | None = None


class PublicBenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benchmark: BenchmarkName
    run_mode: RunMode
    #: Model id actually used for the "generate" role at report time (model_for("generate")
    #: at the moment the report was written) — the single most cost-relevant model, recorded
    #: directly rather than left for a reader to infer from provider env state that no
    #: longer exists by the time the report is read.
    generate_model: str
    #: majorana_llm.models.resolve_provider() at report time ("openai" or "anthropic").
    provider_profile: str
    #: Prompt-construction convention version — bump when build_nala_prompt changes, so a
    #: report can be told apart from one scored against a differently-worded prompt.
    prompt_version: str
    #: `git rev-parse HEAD` in the worktree that produced this report, or None if not a git
    #: checkout (never fabricated).
    pipeline_commit_sha: str | None
    dataset_commit_sha: str
    dataset_sha256: dict[str, str]
    total: int = Field(ge=0)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0, le=1)
    total_wall_time_s: float = Field(ge=0)
    total_recorded_llm_calls: int = Field(default=0, ge=0)
    total_recorded_input_tokens: int = Field(default=0, ge=0)
    total_recorded_output_tokens: int = Field(default=0, ge=0)
    #: Usage broken down by the model id the provider/stub actually reported serving —
    #: what `pricing.price_full_run` prices against, since different roles can resolve to
    #: different models (the anthropic profile; the openai/deepseek profile currently puts
    #: every role on one model, so this collapses to a single key there).
    by_model: dict[str, ModelCallUsage] = Field(default_factory=dict)
    #: Usage broken down by the `llm.call` event's recorded `Stage` (plan/generate/verify/
    #: analyze). Note the production quirk this inherits rather than papers over:
    #: `MeteredAgentLLM._ROLE_STAGE` has no entry for the conversation-title call, so it
    #: defaults to Stage.GENERATE and is counted alongside `generate_circuit` here too —
    #: the same miscategorization a real billed run has, which is the point of measuring
    #: through the real event stream instead of a hand-built stage list.
    by_stage: dict[str, ModelCallUsage] = Field(default_factory=dict)
    results: list[PublicTaskResult]
    note: str | None = None
