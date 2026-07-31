"""Generate typed H₂ hardware-efficient component and identity fixtures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from majorana_vqe.executable import (
    H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES,
    H2_HARDWARE_EFFICIENT_SEMANTIC_KEYS,
    build_h2_hardware_efficient_scientific_identity,
)
from majorana_vqe.models import ComponentType

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g"
BASE_PATH = FIXTURE_DIR / "executable_components_uccsd_v0.3.json"
CIRCUIT_PATH = FIXTURE_DIR / "canonical_hardware_efficient_v0.1.json"
OUTPUT_PATH = FIXTURE_DIR / "executable_components_hardware_efficient_v0.4.json"
IDENTITY_PATH = FIXTURE_DIR / "hardware_efficient_scientific_identity_v0.4.json"
PACKAGED_PATH = (
    ROOT
    / "packages"
    / "py"
    / "vqe"
    / "src"
    / "majorana_vqe"
    / "data"
    / "h2_hardware_efficient_executable_components_v0.4.json"
)
HAMILTONIAN_DIGEST = "d9dd24eb30011e8ea091759e6f0e25d76d0ccc0661e47748afb85e5f13654d79"


def _canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            indent=2,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode()


def build_components() -> dict[str, object]:
    base = json.loads(BASE_PATH.read_text())
    circuit = json.loads(CIRCUIT_PATH.read_text())
    components = {
        role.value: base[role.value]
        for role in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES
        if role
        not in {
            ComponentType.ANSATZ,
            ComponentType.COMPILATION_BACKEND,
        }
    }
    components[ComponentType.ANSATZ.value] = {
        "schema_version": "0.4.0",
        "kind": "hardware_efficient_ansatz_definition",
        "name": "h2_hardware_efficient_ry_linear_cx_reps2",
        "num_qubits": 4,
        "rotation_gate": circuit["rotation_gate"],
        "entanglement_gate": circuit["entanglement_gate"],
        "entanglement_topology": circuit["entanglement_topology"],
        "repetitions": circuit["repetitions"],
        "final_rotation_layer": circuit["final_rotation_layer"],
        "parameter_sharing": circuit["parameter_sharing"],
        "initialization_policy": "benchmark_specific_frozen_palindromic_seed",
        "canonical_circuit_id": circuit["circuit_id"],
        "canonical_circuit_sha256": circuit["canonical_circuit_sha256"],
        "operation_sequence_sha256": circuit["common_basis_operation_sequence_sha256"],
        "parameter_slots": [
            {
                "schema_version": "0.2.0",
                "slot_id": parameter["slot_id"],
                "generator_id": parameter["slot_id"].replace("theta.", "ry."),
                "initial_float64_hex": parameter["initial_float64_hex"],
            }
            for parameter in circuit["initial_parameters"]
        ],
        "expected_parameter_count": 8,
    }
    components[ComponentType.COMPILATION_BACKEND.value] = {
        "schema_version": "0.4.0",
        "kind": "hardware_efficient_compilation_metric_protocol",
        "protocol_id": circuit["compilation_protocol_id"],
        "compilation_protocol_sha256": circuit["compilation_protocol_sha256"],
        "canonical_circuit_sha256": circuit["canonical_circuit_sha256"],
        "operation_sequence_sha256": circuit["common_basis_operation_sequence_sha256"],
        "input_stage": "canonical_ordered_parameterized_gate_list",
        "primary_resource_stages": ["canonical_logical", "common_basis_compiled"],
        "diagnostic_resource_stage": "provider_native_diagnostic",
        "logical_block_definition": "canonical_ry_all_cx_linear_reps2",
        "parameter_binding": "independent_float64_slot_per_ry",
        "basis_gates": ["ry", "cx"],
        "topology": "four_qubit_directed_linear_0_1_2_3",
        "initial_layout": [0, 1, 2, 3],
        "routing_policy": "none",
        "optimization_level": 0,
        "compiler": "majorana_identity_common_basis_compiler",
        "compiler_version": "0.1.0",
        "compiler_seed": 0,
        "metric_scope": "ansatz_only",
        "reference_state_inclusion_policy": "excluded",
        "measurement_inclusion_policy": "excluded",
        "hardware_optimization_inclusion_policy": "excluded",
        "depth_definition": "asap_dependency_layers_each_gate_duration_one",
        "cnot_definition": "count_gate_name_cx",
        "expected_common_basis_gate_count": 14,
        "expected_common_basis_cnot_count": 6,
        "expected_common_basis_depth": 7,
    }
    return components


def build_identity(components: dict[str, object]) -> dict[str, object]:
    typed = {role: components[role.value] for role in H2_HARDWARE_EFFICIENT_APPLICABLE_ROLES}
    return build_h2_hardware_efficient_scientific_identity(
        semantic_keys=H2_HARDWARE_EFFICIENT_SEMANTIC_KEYS,
        specs=typed,
        hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
    ).model_dump(mode="json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    components = build_components()
    component_bytes = _canonical_bytes(components)
    outputs = {
        OUTPUT_PATH: component_bytes,
        PACKAGED_PATH: component_bytes,
        IDENTITY_PATH: _canonical_bytes(build_identity(components)),
    }
    if args.check:
        stale = [
            str(path.relative_to(ROOT))
            for path, payload in outputs.items()
            if not path.exists() or path.read_bytes() != payload
        ]
        if stale:
            raise SystemExit("stale generated H2 hardware-efficient fixtures: " + ", ".join(stale))
        print("H2 hardware-efficient executable fixtures are current")
        return
    for path, payload in outputs.items():
        path.write_bytes(payload)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
