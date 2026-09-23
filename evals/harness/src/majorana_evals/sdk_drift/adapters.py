"""`ModelAdapter` implementations. Zero-cost only — see `paper_to_code.adapters`'s docstring
for the same reasoning; nothing here calls a network or a paid model API.

- `CanonicalAdapter` — positive control. Returns `scaffold + canonical_solution` (the
  MODERN idiom). MUST score 100% against the pinned Qiskit version.
- `OutdatedAdapter` — negative control. Returns `scaffold + outdated_solution` (the
  deliberately pre-1.0/pre-2.0 idiom a model trained on old Qiskit examples would plausibly
  write). MUST score 0%, and the failure MUST match each task's own
  `expected_failure_pattern` — i.e. it must fail for the cited drift reason, not for some
  unrelated defect."""

from __future__ import annotations

from typing import Protocol

from majorana_evals.sdk_drift.schema import SdkDriftTask


class ModelAdapter(Protocol):
    name: str

    def answer(self, task: SdkDriftTask) -> str: ...


class CanonicalAdapter:
    name = "canonical"

    def answer(self, task: SdkDriftTask) -> str:
        return task.scaffold + task.canonical_solution


class OutdatedAdapter:
    name = "outdated"

    def answer(self, task: SdkDriftTask) -> str:
        return task.scaffold + task.outdated_solution
