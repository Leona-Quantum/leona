"""Zero-cost `LLMClient` double for testing the public-benchmark harness itself.

`ProductionSimplePipelinePorts` (services/worker/src/majorana_worker/simple_ports.py) and
`handlers.py` make, in order, for a single-candidate EXECUTE run with no repair and no
business-reference audit (true of every task in both vendored benchmarks — neither is an
assignment/knapsack-style task that triggers `_reference_problem_requires_audit`):

1. `schema_name="research_triage"` (model_for("route")) — fires once per run whenever
   `MAJORANA_RESEARCH` is not explicitly disabled (research.py: "absent means ON", the
   production default); a real, priced call this stub answers rather than dodges.
2. a free-text conversation-title call (`model_for("writeback")`, no `response_schema`)
3. `schema_name="request_plan"`    (model_for("plan"))
4. `schema_name in {"linear_system_reference_extraction", "..._audit_extraction"}` —
   `_reconcile_linear_system_reference` fires (once or twice — plan role, then an audit
   role) whenever the task prompt or plan text matches an A*x=b marker ("linear system",
   "hhl", "matrix a", …), which some tasks in both benchmarks do. Real, conditional, priced.
5. `schema_name="generate_circuit"` (model_for("generate"), or model_for("audit") on repair)
6. `schema_name="intent_alignment"` (model_for("verify"))
7. on SUCCEEDED only: `schema_name="explain_result"` (model_for("analyze"), free text)

This is not guessed: (2) and (7) are pinned by
`services/worker/tests/test_handlers.py::test_completed_execute_generates_a_grounded_natural_language_explanation`
and by reading `_title_conversation`/`_emit_run_explanation` directly; (3), (5), (6) are the
exact three branches `_DeterministicSimpleLLM` in
`services/api/tests/test_pipeline_e2e.py` handles to drive the real fixed pipeline through
`handle_run_execute` end to end in that file's own (passing, DB-gated) test; (1) and (4) are
read directly from `ProductionSimplePipelinePorts._research_for_plan` and
`_reconcile_linear_system_reference` in `simple_ports.py`.

`StubPipelineLLM` answers each of these calls deterministically, using EXACTLY these shapes;
anything else raises `AssertionError` naming the unexpected `schema_name` rather than
guessing at it, so an unexpected pipeline branch (e.g. a repair loop, or a business-reference
audit) is a loud harness failure instead of a silently wrong control result.

Two modes, matched to what the task brief calls the positive and negative control:

- `mode="canonical"`: the `generate_circuit` response is the task's own scaffold plus its
  own `canonical_solution`, so the benchmark's own test should PASS. A trailing
  `FINAL_CIRCUIT`/`RESULT` pair is appended unconditionally so Nala's OWN sandbox+review
  stages (which this stub does not bypass — the pipeline genuinely runs) have something
  well-formed to execute and accept, independent of what the graded `entry_point` function
  itself returns. This keeps the control decoupled from Nala's own circuit-execution
  convention: the benchmark's `check()`/structural grader is re-run directly against the
  delivered candidate source afterwards (see `runner.run_public_task`), never against this
  placeholder.
- `mode="garbage"`: `generate_circuit` still defines `entry_point` (so the pipeline reaches
  a delivered candidate rather than crashing before one exists — a more informative negative
  control than a syntax error, because it exercises the SCORER's ability to detect a wrong
  answer, not just its ability to handle a pipeline crash) but returns an evidently wrong
  value for every task.

Neither mode calls a network. `LLMResponse.input_tokens`/`output_tokens` are computed from
the actual request text (`len(text) // 4`, the same conservative fallback
`OpenAICompatibleLLM` uses when a provider omits usage) — real prompt sizes even though the
completion is stubbed, per the brief's instruction to measure token counts this way.
"""

from __future__ import annotations

import contextvars
import json
from typing import Literal

from majorana_llm import LLMRequest, LLMResponse

StubMode = Literal["canonical", "garbage"]


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


class StubPipelineLLM:
    """Deterministic, zero-cost `LLMClient` for the fixed EXECUTE pipeline's five calls."""

    def __init__(self, mode: StubMode) -> None:
        if mode not in ("canonical", "garbage"):
            raise ValueError(f"unknown stub mode {mode!r}")
        self.mode = mode
        #: schema_name -> count, for tests that want to assert the expected call shape.
        self.calls: list[str] = []

    async def complete(self, request: LLMRequest, *, on_delta=None) -> LLMResponse:
        del on_delta
        input_tokens = _estimate_tokens(request.system + request.user)
        if request.response_schema is None:
            # Free-text calls: conversation title (writeback) and the post-success
            # explanation (analyze). Both tolerate arbitrary prose; neither is scored.
            if request.schema_name == "explain_result":
                text = "Stub explanation: graded by the benchmark's own test, not this text."
            else:
                text = "Benchmark task"
            self.calls.append(request.schema_name)
            return LLMResponse(
                text=text,
                model=request.model,
                input_tokens=input_tokens,
                output_tokens=_estimate_tokens(text),
            )

        self.calls.append(request.schema_name)
        if request.schema_name == "request_plan":
            payload = _plan_payload()
        elif request.schema_name == "generate_circuit":
            payload = _generate_payload(request, mode=self.mode)
        elif request.schema_name == "intent_alignment":
            payload = _review_payload()
        elif request.schema_name == "research_triage":
            # Always declines: `ProductionSimplePipelinePorts._research_for_plan` fires
            # this once per run whenever `MAJORANA_RESEARCH` is not explicitly disabled
            # (research.py: "absent means ON", the production default) — a real cost this
            # stub must still price, not silently dodge. Neither benchmark's tasks need an
            # arXiv lookup, so declining is also the semantically correct answer, not just
            # the cheap one.
            payload = {"needed": False, "query": ""}
        elif request.schema_name in (
            "linear_system_reference_extraction",
            "linear_system_reference_audit_extraction",
        ):
            # `_reconcile_linear_system_reference` fires whenever the task prompt or plan
            # matches an A*x=b marker ("linear system", "hhl", "matrix a", ...) — real for
            # any linear-system-flavored task in either benchmark, priced like the rest.
            # "not supported" is both the cheap answer and the correct one: this stub's
            # `generate_circuit` response does not depend on a declared exact reference.
            payload = {"supported": False, "reason": "not applicable to this benchmark task"}
        else:
            raise AssertionError(
                f"StubPipelineLLM: unexpected schema_name {request.schema_name!r} — "
                "the public-benchmark tasks are expected to take the fixed single-candidate "
                "EXECUTE path with no repair and no business-reference audit; see this "
                "module's docstring for the five calls it handles."
            )
        text = json.dumps(payload)
        return LLMResponse(
            text=text,
            model=request.model,
            input_tokens=input_tokens,
            output_tokens=_estimate_tokens(text),
        )


def _plan_payload() -> dict:
    """A minimal, always-valid Plan. Free-text fields need not be task-specific: nothing
    downstream of the plan stage in this harness's scoring path reads them."""

    return {
        "domain": "quantum information",
        "framework": "qiskit",
        # Algorithm is a closed enum (Bell/GHZ/QFT/.../"other") — "other" is the
        # deliberate escape hatch for a task that is not one of the named algorithms,
        # which every public-benchmark task here is.
        "algorithm": "other",
        "problem_summary": "Implement the requested function.",
        "algorithm_rationale": "Direct implementation of the requested function.",
        "parameters": {"shots": 1024, "seed": 7},
        "qubits_estimate": 2,
        "expected_runtime_sec": 10,
        "success_criteria": {"primary_metric": "counts"},
        "expected_output_keys": ["counts"],
    }


#: Appended to every `generate_circuit` source (both modes) so Nala's own sandbox always has
#: a well-formed FINAL_CIRCUIT/RESULT pair to execute, decoupled from whatever the graded
#: `entry_point` function itself returns. See the module docstring.
_TRAILER = (
    "\n\nfrom qiskit import QuantumCircuit as _StubQC\n"
    "FINAL_CIRCUIT = _StubQC(1)\n"
    "FINAL_CIRCUIT.h(0)\n"
    "FINAL_CIRCUIT.measure_all()\n"
    'RESULT = {"counts": {"0": 512, "1": 512}}\n'
)


def _generate_payload(request: LLMRequest, *, mode: StubMode) -> dict:
    task = _CURRENT_TASK.get()
    if task is None:
        raise RuntimeError(
            "StubPipelineLLM.generate_circuit called with no task bound — "
            "use stub_llm.bind_task(...) around the handle_run_execute call"
        )
    if mode == "canonical":
        body = task.scaffold + task.canonical_solution
    else:
        body = _garbage_source(task)
    return {"source": body + _TRAILER}


def _garbage_source(task) -> str:
    """A plausible-but-wrong implementation: defines `entry_point` so the pipeline still
    delivers a candidate, but returns an obviously incorrect value so the benchmark's own
    test fails rather than the pipeline crashing before scoring is possible."""

    return f"{task.scaffold}\n    return None  # stub garbage control: deliberately wrong\n"


def _review_payload() -> dict:
    return {
        "decision": "ready",
        "confidence": "high",
        "severity": "none",
        "summary": "Stub review: unconditional accept for the harness control run.",
        "mismatches": [],
        "repair_instructions": [],
        "residual_risks": ["Stub review — not a real correctness check."],
    }


_CURRENT_TASK: contextvars.ContextVar = contextvars.ContextVar(
    "public_benchmark_task", default=None
)


def bind_task(task):
    """Context manager binding the task `generate_circuit` should answer for.

    A ContextVar rather than a constructor argument because one `StubPipelineLLM` instance
    is reused across every task in a benchmark run (so `.calls` accumulates a full trace),
    and `complete()` has no other way to know which task's canonical_solution to inject."""

    return _TaskBinding(task)


class _TaskBinding:
    def __init__(self, task) -> None:
        self._task = task
        self._token = None

    def __enter__(self):
        self._token = _CURRENT_TASK.set(self._task)
        return self

    def __exit__(self, *exc_info):
        _CURRENT_TASK.reset(self._token)
