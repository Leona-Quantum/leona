"""Exact metrics for the deterministic structured-metadata baseline."""

from __future__ import annotations

import dataclasses
import json

from .vqe_metadata_assertions import MetadataAssertion


@dataclasses.dataclass(frozen=True)
class ExpectedDeclaredFact:
    field: str
    value: str | tuple[str, ...]
    path: str
    pointer: str
    content_sha256: str


@dataclasses.dataclass(frozen=True)
class DeterministicExtractionMetrics:
    expected_facts: int
    extracted_facts: int
    true_positive_facts: int
    precision: float
    recall: float
    evidence_locator_accuracy: float

    def as_dict(self) -> dict[str, int | float]:
        return dataclasses.asdict(self)


def _value_key(value: str | tuple[str, ...]) -> str:
    serializable: str | list[str] = list(value) if isinstance(value, tuple) else value
    return json.dumps(serializable, sort_keys=True, separators=(",", ":"))


def evaluate_declared_facts(
    assertions: tuple[MetadataAssertion, ...],
    expected: tuple[ExpectedDeclaredFact, ...],
) -> DeterministicExtractionMetrics:
    """Measure exact declared facts separately from evidence-locator accuracy."""

    extracted_by_fact = {}
    for assertion in assertions:
        for fact in assertion.declared_facts:
            key = (fact.field, _value_key(fact.value))
            if key in extracted_by_fact:
                raise ValueError("duplicate extracted fact identity")
            extracted_by_fact[key] = fact.locator

    expected_by_fact = {}
    for fact in expected:
        key = (fact.field, _value_key(fact.value))
        if key in expected_by_fact:
            raise ValueError("duplicate expected fact identity")
        expected_by_fact[key] = fact

    true_positive_keys = extracted_by_fact.keys() & expected_by_fact.keys()
    expected_count = len(expected_by_fact)
    extracted_count = len(extracted_by_fact)
    true_positive_count = len(true_positive_keys)
    precision = true_positive_count / extracted_count if extracted_count else 0.0
    recall = true_positive_count / expected_count if expected_count else 0.0

    exact_locators = 0
    for key in true_positive_keys:
        actual = extracted_by_fact[key]
        wanted = expected_by_fact[key]
        exact_locators += int(
            actual.path == wanted.path
            and actual.pointer == wanted.pointer
            and actual.content_sha256 == wanted.content_sha256
        )
    locator_accuracy = exact_locators / true_positive_count if true_positive_count else 0.0

    return DeterministicExtractionMetrics(
        expected_facts=expected_count,
        extracted_facts=extracted_count,
        true_positive_facts=true_positive_count,
        precision=precision,
        recall=recall,
        evidence_locator_accuracy=locator_accuracy,
    )
