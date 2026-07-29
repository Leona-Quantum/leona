from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pennylane as qml
from qiskit import QuantumCircuit
from qiskit.quantum_info import Operator

ROOT = Path(__file__).resolve().parents[4]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"
CIRCUIT = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "canonical_double_excitation_v0.2.json"
)


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

    assert qiskit["canonical_logical"] == pennylane["canonical_logical"]
    assert qiskit["common_basis_compiled"] == pennylane["common_basis_compiled"]
    assert qiskit["common_basis_compiled"]["cnot_count"] == 48
    assert qiskit["common_basis_compiled"]["depth"] == 83
    assert qiskit["provider_native_diagnostic"]["comparison_eligible"] is False
    assert pennylane["provider_native_diagnostic"]["comparison_eligible"] is False


def _target_two_level(theta: float, *, qiskit_order: bool) -> np.ndarray:
    target = np.eye(16, dtype=complex)
    hf_bits = "1010"
    excited_bits = "0101"
    if qiskit_order:
        hf_bits = hf_bits[::-1]
        excited_bits = excited_bits[::-1]
    hf = int(hf_bits, 2)
    excited = int(excited_bits, 2)
    cosine = math.cos(theta / 2)
    sine = math.sin(theta / 2)
    target[hf, hf] = cosine
    target[excited, excited] = cosine
    target[excited, hf] = sine
    target[hf, excited] = -sine
    return target


def _assert_equal_up_to_global_phase(actual: np.ndarray, expected: np.ndarray) -> None:
    overlap = np.vdot(expected.ravel(), actual.ravel())
    phase = overlap / abs(overlap)
    assert np.max(np.abs(actual - phase * expected)) <= 1e-12


def test_qiskit_and_pennylane_adapters_are_unitary_equivalent_to_generic_definition():
    specification = json.loads(CIRCUIT.read_text())
    theta = -0.417

    qiskit_circuit = QuantumCircuit(4)
    for operation in specification["common_basis_operations"]:
        gate, wires = operation["gate"], operation["wires"]
        if gate == "h":
            qiskit_circuit.h(wires[0])
        elif gate == "s":
            qiskit_circuit.s(wires[0])
        elif gate == "sdg":
            qiskit_circuit.sdg(wires[0])
        elif gate == "cx":
            qiskit_circuit.cx(*wires)
        elif gate == "rz":
            qiskit_circuit.rz(
                theta * operation["angle_theta_numerator"] / operation["angle_theta_denominator"],
                wires[0],
            )
    _assert_equal_up_to_global_phase(
        np.asarray(Operator(qiskit_circuit).data),
        _target_two_level(theta, qiskit_order=True),
    )

    def pennylane_circuit():
        for operation in specification["common_basis_operations"]:
            gate, wires = operation["gate"], operation["wires"]
            if gate == "h":
                qml.Hadamard(wires=wires[0])
            elif gate == "s":
                qml.S(wires=wires[0])
            elif gate == "sdg":
                qml.adjoint(qml.S)(wires=wires[0])
            elif gate == "cx":
                qml.CNOT(wires=wires)
            elif gate == "rz":
                qml.RZ(
                    theta
                    * operation["angle_theta_numerator"]
                    / operation["angle_theta_denominator"],
                    wires=wires[0],
                )

    _assert_equal_up_to_global_phase(
        np.asarray(qml.matrix(pennylane_circuit, wire_order=range(4))()),
        _target_two_level(theta, qiskit_order=False),
    )


def test_resource_adapters_do_not_use_provider_native_generic_unitaries():
    qiskit_source = (ROOT / "runtimes/vqe/qiskit-current/spike/h2_actual_vqe_v02.py").read_text()
    pennylane_source = (
        ROOT / "runtimes/vqe/pennylane-current/spike/h2_actual_vqe_v02.py"
    ).read_text()
    assert ".unitary(" not in qiskit_source
    assert "UnitaryGate" not in qiskit_source
    assert "QubitUnitary" not in pennylane_source


def test_uccsd_reports_share_the_frozen_three_parameter_identity():
    qiskit = _report("qiskit_uccsd_v0.1.json")
    pennylane = _report("pennylane_uccsd_v0.1.json")

    assert qiskit["status"] == pennylane["status"] == "succeeded"
    assert qiskit["capability"] == pennylane["capability"] == "h2_sto3g_uccsd_v1"
    assert qiskit["canonical_input"] == pennylane["canonical_input"]
    assert qiskit["canonical_input"]["parameter_orientation"] == "exp_theta_generator"
    assert len(qiskit["canonical_input"]["parameter_slot_order"]) == 3


def test_cross_framework_uccsd_matches_energy_state_and_common_resources():
    qiskit = _report("qiskit_uccsd_v0.1.json")
    pennylane = _report("pennylane_uccsd_v0.1.json")
    qiskit_optimization = qiskit["optimization"]
    pennylane_optimization = pennylane["optimization"]

    assert abs(
        qiskit_optimization["best_energy_ha"] - pennylane_optimization["best_energy_ha"]
    ) <= (1e-12)
    assert qiskit_optimization["absolute_error_ha"] <= 1e-12
    assert pennylane_optimization["absolute_error_ha"] <= 1e-12
    assert 1.0 - qiskit_optimization["final_state_fidelity"] <= 1e-12
    assert 1.0 - pennylane_optimization["final_state_fidelity"] <= 1e-12
    assert np.allclose(
        qiskit_optimization["final_parameters"],
        pennylane_optimization["final_parameters"],
        atol=2e-7,
    )
    assert (
        qiskit["resources"]["common_basis_compiled"]
        == pennylane["resources"]["common_basis_compiled"]
    )
    assert qiskit["resources"]["common_basis_compiled"]["cnot_count"] == 56
    assert qiskit["resources"]["common_basis_compiled"]["depth"] == 96
    assert qiskit["resources"]["common_basis_compiled"]["parameter_count"] == 3


def test_uccsd_resource_adapters_do_not_use_provider_native_templates():
    qiskit_source = (ROOT / "runtimes/vqe/qiskit-current/spike/h2_uccsd_v01.py").read_text()
    pennylane_source = (ROOT / "runtimes/vqe/pennylane-current/spike/h2_uccsd_v01.py").read_text()

    assert "UCCSD(" not in qiskit_source
    assert "UCCSD(" not in pennylane_source
    assert ".unitary(" not in qiskit_source
    assert "QubitUnitary" not in pennylane_source
