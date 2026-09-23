"""`ModelAdapter` implementations. This increment ships ONLY offline, zero-cost adapters —
neither calls a network or a paid model API of any kind ("spend nothing" was a hard
constraint for this PR, same as the resource-estimation benchmark). A real adapter (wrapping
an actual LLM call, e.g. through `majorana_llm.LLMClient`) is future work for whoever runs
this benchmark against a model; `runner.run_benchmark` takes any object satisfying
`ModelAdapter`, so adding one later needs no change here.

- `CanonicalAdapter` — positive control. Returns the task's own `scaffold +
  canonical_solution` verbatim. MUST score 100%; if it doesn't, the grader or a case's own
  test is broken, not the benchmark.
- `GarbageAdapter` — negative control. Returns the scaffold with a deliberately, obviously
  wrong body (`return None`) rather than a syntax error or a missing function — same
  reasoning as `public_benchmarks.stub_llm._garbage_source`: this exercises the grader's
  ability to detect a wrong answer, not just its ability to handle a crash before scoring is
  possible. MUST score 0%."""

from __future__ import annotations

from typing import Protocol

from majorana_evals.paper_to_code.schema import PaperToCodeTask


class ModelAdapter(Protocol):
    """Anything `runner.run_benchmark` can drive: a name for the report, and a way to answer
    one task with a complete, standalone Python source string."""

    name: str

    def answer(self, task: PaperToCodeTask) -> str: ...


class CanonicalAdapter:
    name = "canonical"

    def answer(self, task: PaperToCodeTask) -> str:
        return task.scaffold + task.canonical_solution


class GarbageAdapter:
    name = "garbage"

    def answer(self, task: PaperToCodeTask) -> str:
        return f"{task.scaffold}\n    return None  # garbage control: deliberately wrong\n"
