"""Corpus + report schema. A corpus case is a prompt plus the honest expectations
a correct run must meet — never a fabricated golden number, but structural facts:
did verification pass, was the export classified as claimed, were the promised
keys present. Mirrors evals/benchmark-suite-v0.md categories."""

from __future__ import annotations

from pathlib import Path

import yaml
from majorana_contracts.enums import ExportStatus, Framework, VerifierDecision
from pydantic import BaseModel, ConfigDict, Field


class Expect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verifier_decision: VerifierDecision = VerifierDecision.PASS
    export_status: ExportStatus | None = None
    output_keys: list[str] = Field(default_factory=list)
    saves_artifact: bool = True


class CorpusCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    category: str = Field(description="Benchmark suite category, e.g. 'A — Bell/GHZ'")
    prompt: str
    framework: Framework = Framework.QISKIT
    expect: Expect = Field(default_factory=Expect)


class CaseEvidence(BaseModel):
    """Reproducible attribution fields observed during one pipeline attempt."""

    failed_stage: str | None = None
    error_code: str | None = None
    qasm_source: str | None = None
    qasm_epilogue_applied: bool | None = None
    qasm_available: bool | None = None
    qasm_epilogue_error: str | None = None


class CaseResult(BaseModel):
    id: str
    category: str
    passed: bool
    run_status: str
    verifier_decision: str | None = None
    export_status: str | None = None
    saved: bool = False
    reasons: list[str] = Field(default_factory=list)
    evidence: CaseEvidence = Field(default_factory=CaseEvidence)


class Report(BaseModel):
    total: int
    passed: int
    pass_rate: float
    cases: list[CaseResult]
    note: str | None = None


def load_corpus(directory: str | Path) -> list[CorpusCase]:
    """Load every *.yaml case in a directory, sorted by id for determinism."""
    cases: list[CorpusCase] = []
    for path in sorted(Path(directory).glob("*.yaml")):
        data = yaml.safe_load(path.read_text())
        cases.append(CorpusCase.model_validate(data))
    return cases
