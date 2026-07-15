"""Framework-native source programs and the sandbox circuit-observation protocol.

The generated Python source remains authoritative throughout the pipeline.  A sandbox
epilogue may observe a Qiskit ``FINAL_CIRCUIT`` and serialize it through a provider-read
sidecar for later conversion, but that optional payload never replaces the source.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from majorana_contracts.enums import Framework
from majorana_contracts.models import ResourceMetrics
from majorana_frameworks.adapters import NativeOptimization, adapter_for


def _normalize_source(source: str) -> str:
    normalized = source.replace("\r\n", "\n").replace("\r", "\n")
    return normalized if normalized.endswith("\n") else normalized + "\n"


@dataclass(frozen=True)
class InterchangeExtraction:
    """Optional OpenQASM captured from an executed framework program."""

    qasm: str | None
    source: Literal["sandbox_epilogue", "missing"]
    epilogue_error: str | None = None


@dataclass(frozen=True)
class FrameworkProgram:
    """Authoritative code in the framework selected by the user."""

    framework: Framework
    source: str

    def __post_init__(self) -> None:
        if not self.source.strip():
            raise ValueError("framework program source is empty")

    @property
    def normalized_source(self) -> str:
        return _normalize_source(self.source)

    @property
    def fingerprint(self) -> str:
        payload = f"{self.framework.value}\0{self.normalized_source}".encode()
        return hashlib.sha256(payload).hexdigest()

    def contract_diagnostics(self, *, circuit_expected: bool) -> list[str]:
        """Return framework execution-contract violations without rewriting source."""
        return adapter_for(self.framework).contract_diagnostics(
            self.source, circuit_expected=circuit_expected
        )

    def native_optimization(self, observation: dict[str, Any] | None = None) -> NativeOptimization:
        """Classify optimization already present in the selected framework code.

        Arbitrary Python source cannot be rewritten safely after verification.  The
        generator therefore emits native optimization calls, and this boundary records
        whether such a call is part of the exact source that was executed.
        """
        return adapter_for(self.framework).native_optimization(self.source, observation)

    def resource_metrics(
        self,
        *,
        qubits: int,
        expected_runtime_sec: int,
        observation: dict[str, Any] | None = None,
    ) -> ResourceMetrics:
        """Estimate operations directly from the selected-framework source."""
        return adapter_for(self.framework).resource_metrics(
            self.source,
            qubits=qubits,
            expected_runtime_sec=expected_runtime_sec,
            observation=observation,
        )

    def trusted_observer(self, *, circuit_expected: bool) -> str:
        """Build provider-owned SDK observation code.

        Cirq and PennyLane remain valid framework-native programs without OpenQASM.
        Their future converters belong behind this boundary rather than in the worker.
        """
        return adapter_for(self.framework).trusted_observer(
            self.source, circuit_expected=circuit_expected
        )

    def trusted_setup(self, *, circuit_expected: bool) -> str:
        """Build imports and stable SDK references captured before generated code."""
        return adapter_for(self.framework).trusted_setup(circuit_expected=circuit_expected)


def extract_interchange_qasm(
    protected_result: Mapping[str, Any] | None,
) -> InterchangeExtraction:
    """Recover interchange only from the provider-owned structured result field."""
    if protected_result is None:
        return InterchangeExtraction(None, "missing")
    error = protected_result.get("interchange_error")
    epilogue_error = error if isinstance(error, str) else None
    qasm = protected_result.get("interchange_qasm")
    if isinstance(qasm, str) and qasm.strip():
        return InterchangeExtraction(qasm.strip(), "sandbox_epilogue", epilogue_error)
    return InterchangeExtraction(None, "missing", epilogue_error)
