from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"


def _report(name: str) -> dict:
    return json.loads((RAW / name).read_text())


def test_qiskit_and_pennylane_actual_vqe_use_the_same_scientific_input():
    qiskit = _report("qiskit_vqe_v0.2.json")
    pennylane = _report("pennylane_vqe_v0.2.json")

    assert qiskit["status"] == pennylane["status"] == "succeeded"
    assert qiskit["capability"] == pennylane["capability"] == "h2_sto3g_actual_vqe_v1"
    assert qiskit["canonical_input"] == pennylane["canonical_input"]


def test_cross_framework_actual_vqe_matches_energy_state_and_parameter():
    qiskit = _report("qiskit_vqe_v0.2.json")["optimization"]
    pennylane = _report("pennylane_vqe_v0.2.json")["optimization"]

    assert abs(qiskit["best_energy_ha"] - pennylane["best_energy_ha"]) <= 1e-12
    assert qiskit["absolute_error_ha"] <= 1e-12
    assert pennylane["absolute_error_ha"] <= 1e-12
    assert 1.0 - qiskit["final_state_fidelity"] <= 1e-12
    assert 1.0 - pennylane["final_state_fidelity"] <= 1e-12
    assert abs(qiskit["final_parameter"] - pennylane["final_parameter"]) <= 1e-7


def test_resource_metrics_keep_logical_and_provider_native_stages_separate():
    qiskit = _report("qiskit_vqe_v0.2.json")["resources"]
    pennylane = _report("pennylane_vqe_v0.2.json")["resources"]

    assert qiskit["logical"] == pennylane["logical"]
    assert "provider_native_compiled" in qiskit
    assert "provider_native" in pennylane
    assert qiskit["provider_native_compiled"] != pennylane["provider_native"]
