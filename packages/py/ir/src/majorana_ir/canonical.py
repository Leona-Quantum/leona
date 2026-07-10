"""Canonicalization + fingerprints. Two circuits that mean the same thing produce
byte-identical canonical JSON, so the sha256 fingerprint dedupes identical
artifact versions (models.ArtifactVersion.fingerprint). Ported from quepo."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from majorana_ir.models import Circuit


def normalize_param(value: float | str) -> float | str:
    if isinstance(value, bool):
        raise TypeError("boolean parameters are not valid")
    if isinstance(value, int | float):
        numeric = float(value)
        if not math.isfinite(numeric):
            raise ValueError("parameters must be finite")
        if numeric == 0:
            numeric = 0.0
        return float(format(numeric, ".15g"))
    return " ".join(str(value).strip().split())


def _sort_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _sort_json(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_sort_json(item) for item in value]
    return value


def canonicalize_circuit(circuit: Circuit) -> Circuit:
    operations = [
        operation.model_copy(
            update={
                "gate": operation.gate.lower(),
                "qubits": list(operation.qubits),
                "params": [normalize_param(param) for param in operation.params],
                # typed_params carry a duplicate of each param (added by
                # upgrade_to_v3); normalize them too or canonically-equal circuits
                # (e.g. 0.0 vs -0.0) fingerprint differently.
                "typed_params": [
                    typed.model_copy(update={"value": normalize_param(typed.value)})
                    for typed in operation.typed_params
                ],
                "clbits": list(operation.clbits),
                "condition": None,
            }
        )
        for operation in circuit.operations
    ]
    return circuit.model_copy(
        update={
            "operations": operations,
            "metadata": _sort_json(circuit.metadata),
            "annotations": _sort_json(circuit.annotations),
            "noise_model_annotations": _sort_json(circuit.noise_model_annotations),
        }
    )


def canonical_dict(circuit: Circuit) -> dict[str, Any]:
    canonical = canonicalize_circuit(circuit)
    return _sort_json(canonical.model_dump(mode="json", exclude_none=False))


def canonical_json(circuit: Circuit) -> str:
    return json.dumps(
        canonical_dict(circuit), sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )


def circuit_fingerprint(circuit: Circuit) -> str:
    return hashlib.sha256(canonical_json(circuit).encode("utf-8")).hexdigest()
