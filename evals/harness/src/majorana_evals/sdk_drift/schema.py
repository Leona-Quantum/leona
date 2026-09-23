"""Schema for the SDK-drift benchmark (ai-ops#357 option 3, first increment).

A task asks a model to implement a small Qiskit routine using ONE specific API area that
changed between Qiskit 0.46, the 1.x line, and the 2.x line (`execute()` removed, primitives
V1 -> V2, `qiskit.providers.aer` -> `qiskit_aer`, `qiskit.algorithms` moved out of core,
`qiskit.opflow` removed, transpile()/QuantumCircuit argument changes, etc. — see
`../../sdk-drift-benchmark/PROVENANCE.md` for the citation behind every task). Each task
carries TWO reference solutions:

- `canonical_solution` — the MODERN idiom. Must pass against the Qiskit version pinned in
  this repo's sandbox image / `uv.lock` (`qiskit==2.5.2` — see SPEC.md).
- `outdated_solution` — the deliberately OLD idiom a model trained on pre-1.0/pre-2.0
  Qiskit code would plausibly write. Must FAIL against the pinned Qiskit version, and that
  failure must be attributable to the cited drift (`expected_failure_pattern` — a regex
  checked against the failing subprocess's stderr) rather than to an unrelated bug, a
  timeout, or a syntax error.

Grading reuses the same `hidden_test` / subprocess convention as `paper_to_code` and
`qiskit_human_eval`: candidate source + `hidden_test` + `check(entry_point)`, run in a
subprocess. The `expected_failure_pattern` check is specific to this benchmark — it is what
proves the outdated control fails FOR THE RIGHT REASON, not just fails somehow."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RunMode = Literal["live", "stub-canonical", "stub-outdated"]


class QiskitChangeRef(BaseModel):
    """The migration-guide/release-note citation this task is built from. Every field is
    checkable against the cited URL — see PROVENANCE.md for the verbatim confirmation quote
    per task."""

    model_config = ConfigDict(extra="forbid")

    #: Short label for the API area, e.g. "execute-removed", "primitives-v1-to-v2".
    drift_topic: str
    #: A short code snippet or API name showing the OLD idiom.
    old_api: str
    #: A short code snippet or API name showing the NEW idiom that replaces it.
    new_api: str
    #: The Qiskit version the change landed in, as precisely as the source states it,
    #: e.g. "1.0.0" or "2.0.0".
    changed_in_version: str
    #: The exact release-note / migration-guide URL documenting the change.
    release_note_url: str
    #: A short verbatim quote (kept under ~25 words) from that page confirming the change.
    release_note_quote: str


class SdkDriftTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    change: QiskitChangeRef
    #: The complete, self-contained instruction: what routine to implement, the exact
    #: function signature to preserve, and enough context that a correct MODERN-idiom
    #: implementation is well-posed without needing the old API at all.
    prompt: str
    entry_point: str
    #: Imports + function signature + docstring only (no body) — shared by both the
    #: canonical and outdated solutions below.
    scaffold: str
    #: Body only, modern idiom. `scaffold + canonical_solution` must pass `hidden_test`
    #: against the pinned Qiskit version.
    canonical_solution: str
    #: Body only, deliberately pre-1.0/pre-2.0 idiom. `scaffold + outdated_solution` must
    #: FAIL `hidden_test` against the pinned Qiskit version, for the reason named by
    #: `expected_failure_pattern`.
    outdated_solution: str
    #: Python source defining `check(candidate)`, which raises on failure. Same convention
    #: as `paper_to_code.schema.PaperToCodeTask.hidden_test`.
    hidden_test: str
    #: A regex checked (case-insensitively) against the failing outdated run's captured
    #: stderr — confirms the negative control fails FOR THE DRIFT REASON, not for an
    #: unrelated bug, a timeout, or a plain syntax error.
    expected_failure_pattern: str
    #: The Qiskit version this task was authored/verified against (should match the
    #: repo-pinned version at authoring time; recorded per task so a drift re-check can
    #: report "was verified against X, now running against Y").
    qiskit_pin_at_authoring: str
    notes: str | None = None


class TaskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    passed: bool
    reasons: list[str] = Field(default_factory=list)
    #: Only meaningful when `passed=False`: whether the failure's own error text matched
    #: `expected_failure_pattern`. `None` when the task passed (nothing to match) or no
    #: pattern applies to this run. Kept separate from `passed` so a report can tell "failed
    #: for the expected drift reason" apart from "failed for some other reason" — the
    #: distinction the SDK-drift control specifically has to prove.
    drift_reason_matched: bool | None = None
    wall_time_s: float = Field(ge=0)


class BenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    benchmark: Literal["sdk-drift"] = "sdk-drift"
    run_mode: RunMode
    adapter_name: str
    pipeline_commit_sha: str | None
    dataset_sha256: str
    #: `qiskit.__version__` actually installed in the environment that produced this
    #: report — recorded directly so a report is never read as scored against a different
    #: Qiskit than it actually ran under.
    qiskit_version: str
    total: int = Field(ge=0)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0.0, le=1.0)
    results: list[TaskResult]
    note: str | None = None
