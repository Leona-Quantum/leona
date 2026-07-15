"""Framework-native source programs and the sandbox circuit-observation protocol.

The generated Python source remains authoritative throughout the pipeline.  A sandbox
epilogue may observe a Qiskit ``FINAL_CIRCUIT`` and serialize it to OpenQASM for later
cross-framework conversion, but that optional payload never replaces the source.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

from majorana_contracts.enums import Framework
from majorana_contracts.models import ResourceMetrics
from majorana_frameworks.adapters import (
    INTERCHANGE_QASM_BEGIN,
    INTERCHANGE_QASM_END,
    INTERCHANGE_QASM_ERROR,
    NativeOptimization,
    adapter_for,
)

_INTERCHANGE_RE = re.compile(
    rf"^{re.escape(INTERCHANGE_QASM_BEGIN)}\r?$\n(?P<qasm>.*?)"
    rf"^{re.escape(INTERCHANGE_QASM_END)}\r?$",
    re.DOTALL | re.MULTILINE,
)
_INTERCHANGE_ERROR_RE = re.compile(
    rf"^{re.escape(INTERCHANGE_QASM_ERROR)}:(?P<error>[A-Za-z_][A-Za-z0-9_]*)\s*$",
    re.MULTILINE,
)


def _normalize_source(source: str) -> str:
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip() + "\n"


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

    def native_optimization(self) -> NativeOptimization:
        """Classify optimization already present in the selected framework code.

        Arbitrary Python source cannot be rewritten safely after verification.  The
        generator therefore emits native optimization calls, and this boundary records
        whether such a call is part of the exact source that was executed.
        """
        return adapter_for(self.framework).native_optimization(self.source)

    def resource_metrics(self, *, qubits: int, expected_runtime_sec: int) -> ResourceMetrics:
        """Estimate operations directly from the selected-framework source."""
        return adapter_for(self.framework).resource_metrics(
            self.source,
            qubits=qubits,
            expected_runtime_sec=expected_runtime_sec,
        )

    def instrument_for_interchange(self, *, circuit_expected: bool) -> str:
        """Append optional Qiskit→OpenQASM observation after native execution.

        Cirq and PennyLane remain valid framework-native programs without OpenQASM.
        Their future converters belong behind this boundary rather than in the worker.
        """
        return adapter_for(self.framework).instrument_for_interchange(
            self.source, circuit_expected=circuit_expected
        )


def extract_interchange_qasm(text: str) -> InterchangeExtraction:
    """Recover only a Majorana-owned interchange envelope from sandbox stdout."""
    errors = _INTERCHANGE_ERROR_RE.findall(text)
    epilogue_error = errors[-1] if errors else None
    envelopes = list(_INTERCHANGE_RE.finditer(text))
    if envelopes:
        qasm = envelopes[-1].group("qasm").strip()
        if qasm:
            return InterchangeExtraction(qasm, "sandbox_epilogue", epilogue_error)
    return InterchangeExtraction(None, "missing", epilogue_error)
