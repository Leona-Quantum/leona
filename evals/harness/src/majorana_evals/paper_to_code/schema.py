"""Schema for the paper-to-code benchmark (ai-ops#357 option 2, first increment).

A task asks a model to implement, in Qiskit, one specific, precisely-described circuit,
algorithm or subroutine taken from a real arXiv paper posted AFTER the training-data cutoff
of every model this benchmark is meant to grade — see
`../../paper-to-code-benchmark/SPEC.md` for the freshness argument and cutoff sourcing.

Grading is BEHAVIOURAL, not structural: each task carries its own `hidden_test` — Python
source defining `check(candidate)`, exactly the `qiskit_human_eval` convention already used
by `majorana_evals.public_benchmarks` — which builds the reference circuit/state described by
the paper and asserts the candidate's output is equivalent (statevector, unitary, or output
distribution, per `grading_method`) within a stated tolerance. There is no partial credit for
citing the right paper while implementing the wrong circuit: `check()` either raises or it
doesn't.

Every task's `quoted_excerpt` is copied verbatim from the source paper (short — a sentence or
a figure/algorithm caption, never the whole paper) so a reviewer can check the task statement
against the paper's own words without re-fetching it. `source.license` records why quoting
that excerpt is permitted (arXiv's own default license covers this for essentially all new
arXiv submissions).

**Freshness (a paper posted after every model's cutoff) is necessary but not sufficient for
the "a model can't have memorized this" claim.** A task can cite a brand-new paper while
asking a model to build something that construction predates the paper by years (a textbook
circuit the paper merely restates as a special case, or a standard ansatz template the paper
applies rather than invents) — a model needs no knowledge of THIS paper to pass such a task.
`novelty` records this honestly per task: `"paper-specific"` means the construction is the
paper's own contribution, or needs a parameter/structure only this paper gives (so passing
genuinely requires having read it); `"restated"` means the construction predates the paper
(a model could plausibly pass without ever having seen it). `novelty_reason` is the one-line
justification, checked by a human reviewer against the paper, not a self-assessment left
implicit. See `../../paper-to-code-benchmark/PROVENANCE.md`'s "How new is each task?" table
for the per-task classification and reasoning, and `SPEC.md`'s "Controls" section for how a
report separates the two — only the `paper-specific` score supports a "not memorizable"
claim; the `restated` tasks are still useful (they exercise the harness and give a broader
correctness signal) but must never be quoted as contamination-proof evidence."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

GradingMethod = Literal["statevector", "unitary", "distribution"]

#: "paper-specific": the construction is the paper's own contribution, or needs a
#: parameter/structure only this paper gives. "restated": the construction predates the
#: paper (a textbook result, or a standard technique the paper applies rather than
#: invents) — passing such a task does not by itself show a model read this paper.
Novelty = Literal["paper-specific", "restated"]

RunMode = Literal["live", "stub-canonical", "stub-garbage"]


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arxiv_id: str
    title: str
    authors: list[str]
    #: arXiv v1 submission date, ISO (YYYY-MM-DD) — the freshness this benchmark's whole
    #: anti-contamination argument rests on. Never the date a search snippet was seen.
    submitted: str
    venue: str | None = None
    #: Where in the paper the implementable piece lives, e.g. "Algorithm 2, Section 4" or
    #: "Figure 3, p.5".
    location: str
    url: str
    #: Why quoting `quoted_excerpt` is permitted — normally arXiv's own default license
    #: (non-exclusive, perpetual right to distribute), stated explicitly per case rather
    #: than assumed silently.
    license: str
    #: ISO date the paper was actually (re-)read at the source for THIS case.
    retrieved: str


class PaperToCodeTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    source: SourceRef
    #: The complete, self-contained instruction a model is given: what to implement, the
    #: exact function signature to preserve, and every parameter/convention needed to make
    #: the task well-posed (qubit ordering, endianness, which of several paper variants).
    #: A model is never expected to infer an unstated convention.
    prompt: str
    #: A short, verbatim quotation from the paper (a sentence, or a figure/algorithm
    #: caption) that the task statement is built from — lets a reviewer check the prompt
    #: against the paper's own words directly.
    quoted_excerpt: str
    entry_point: str
    #: Imports + function signature + docstring only (no body) — same convention as
    #: `qiskit_human_eval`'s `prompt` field. `scaffold + canonical_solution` is a complete,
    #: correct function.
    scaffold: str
    canonical_solution: str
    #: Python source defining `check(candidate)`, which raises on failure. Built and run
    #: exactly like `qiskit_human_eval.score_qiskit_human_eval_task`: candidate source +
    #: this test source + `check(entry_point)`, executed in a subprocess.
    hidden_test: str
    grading_method: GradingMethod
    #: Qubit count of the graded instance(s) — kept small enough for exact statevector/
    #: unitary comparison or a tractable output distribution.
    qubits: int = Field(gt=0, le=24)
    #: Required — see the module docstring. Whether passing this task actually requires
    #: having read THIS paper ("paper-specific") or could be done from prior knowledge
    #: alone ("restated"). Never left to a report reader to guess.
    novelty: Novelty
    #: Required, one line: the specific reason for the `novelty` classification above,
    #: checked against the paper by a human reviewer rather than left as a self-assessment.
    novelty_reason: str
    #: One line per non-obvious modeling choice: which paper variant, which convention,
    #: what was simplified and why it still tests the paper's actual content.
    notes: str | None = None

    @model_validator(mode="after")
    def _excerpt_is_nonempty(self) -> "PaperToCodeTask":
        if not self.quoted_excerpt.strip():
            raise ValueError("quoted_excerpt must not be empty — every task cites the paper's own words")
        if not self.hidden_test.strip():
            raise ValueError("hidden_test must not be empty")
        if not self.novelty_reason.strip():
            raise ValueError("novelty_reason must not be empty — the novelty classification needs a reason")
        return self


class TaskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    #: Denormalized from the task itself so a report is self-contained — a reader scoring
    #: "does this support a not-memorizable claim" never has to cross-reference the corpus.
    novelty: Novelty
    passed: bool
    #: Empty on a pass; on failure carries the guard's violation list or the subprocess's
    #: stderr tail, so a report shows why, not just that it failed.
    reasons: list[str] = Field(default_factory=list)
    wall_time_s: float = Field(ge=0)


class BenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benchmark: Literal["paper-to-code"] = "paper-to-code"
    run_mode: RunMode
    adapter_name: str
    #: `git rev-parse HEAD` in the worktree that produced this report, or None if not a git
    #: checkout (never fabricated) — same convention as `resource_estimation`/
    #: `public_benchmarks`.
    pipeline_commit_sha: str | None
    #: sha256 over the sorted, concatenated bytes of every case file actually loaded — same
    #: convention as `resource_estimation.loader.dataset_sha256` (this is our own curated
    #: corpus, not a single pinned upstream file).
    dataset_sha256: str
    total: int = Field(ge=0)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0.0, le=1.0)
    #: The SAME totals, restricted to `novelty="paper-specific"` tasks only. This is the
    #: number that actually supports a "a model can't have memorized this" claim — the
    #: `restated` tasks inflate `total`/`passed` above with constructions that predate the
    #: paper, so reporting only the combined figure would overstate what freshness buys.
    #: See SPEC.md's "Controls" section and PROVENANCE.md's "How new is each task?" table.
    paper_specific_total: int = Field(ge=0)
    paper_specific_passed: int = Field(ge=0)
    paper_specific_pass_rate: float = Field(ge=0.0, le=1.0)
    results: list[TaskResult]
    note: str | None = None
