"""Generate the typed H₂ UCCSD component fixture without fake adaptive roles."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from majorana_vqe.executable import (
    H2_UCCSD_APPLICABLE_ROLES,
    H2_UCCSD_SEMANTIC_KEYS,
    build_h2_uccsd_scientific_identity,
)
from majorana_vqe.models import ComponentType
from majorana_vqe.portable import float_to_ieee754_hex

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g"
BASE_PATH = FIXTURE_DIR / "executable_components_v0.2.json"
CIRCUIT_PATH = FIXTURE_DIR / "canonical_uccsd_v0.1.json"
OUTPUT_PATH = FIXTURE_DIR / "executable_components_uccsd_v0.3.json"
IDENTITY_PATH = FIXTURE_DIR / "uccsd_scientific_identity_v0.3.json"
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
        for role in H2_UCCSD_APPLICABLE_ROLES
        if role
        not in {
            ComponentType.ANSATZ,
            ComponentType.COMPILATION_BACKEND,
        }
    }
    components[ComponentType.ANSATZ.value] = {
        "schema_version": "0.3.0",
        "kind": "uccsd_ansatz_definition",
        "name": "h2_uccsd_first_order_double_then_singles",
        "num_qubits": 4,
        "generator_convention": circuit["generator_convention"],
        "parameter_orientation": circuit["parameter_orientation"],
        "generator_order": circuit["generator_order"],
        "trotter_order": circuit["trotter_order"],
        "trotter_steps": circuit["trotter_steps"],
        "parameter_sharing": circuit["parameter_sharing"],
        "canonical_circuit_id": circuit["circuit_id"],
        "canonical_circuit_sha256": circuit["canonical_circuit_sha256"],
        "parameter_slots": [
            {
                "schema_version": "0.2.0",
                "slot_id": slot_id,
                "generator_id": generator_id,
                "initial_float64_hex": float_to_ieee754_hex(0.0),
            }
            for slot_id, generator_id in zip(
                circuit["parameter_slot_order"],
                circuit["generator_order"],
                strict=True,
            )
        ],
        "expected_parameter_count": 3,
    }
    components[ComponentType.COMPILATION_BACKEND.value] = {
        "schema_version": "0.3.0",
        "kind": "uccsd_compilation_metric_protocol",
        "protocol_id": "majorana.h2.uccsd.common_cnot_depth.v1",
        "compilation_protocol_sha256": circuit["compilation_protocol_sha256"],
        "canonical_circuit_sha256": circuit["canonical_circuit_sha256"],
        "input_stage": "canonical_logical_pauli_rotations",
        "primary_resource_stages": ["canonical_logical", "common_basis_compiled"],
        "diagnostic_resource_stage": "provider_native_diagnostic",
        "logical_block_definition": "canonical_uccsd_double_then_singles",
        "parameter_binding": "independent_float64_slot_per_generator",
        "basis_gates": ["h", "s", "sdg", "rz", "cx"],
        "topology": "four_qubit_all_to_all",
        "initial_layout": [0, 1, 2, 3],
        "routing_policy": "none",
        "optimization_level": 0,
        "compiler": "majorana_deterministic_pauli_rotation_compiler",
        "compiler_version": "0.3.0",
        "compiler_seed": 0,
        "metric_scope": "ansatz_only",
        "reference_state_inclusion_policy": "excluded",
        "measurement_inclusion_policy": "excluded",
        "hardware_optimization_inclusion_policy": "excluded",
        "depth_definition": "asap_dependency_layers_each_gate_duration_one",
        "cnot_definition": "count_gate_name_cx",
        "expected_logical_rotation_count": 12,
        "expected_common_basis_cnot_count": 56,
        "expected_common_basis_depth": 96,
    }
    optimizer = dict(components[ComponentType.PARAMETER_OPTIMIZER.value])
    optimizer["algorithm"] = "scipy_slsqp"
    components[ComponentType.PARAMETER_OPTIMIZER.value] = optimizer
    return components


def build_identity(components: dict[str, object]) -> dict[str, object]:
    typed = {role: components[role.value] for role in H2_UCCSD_APPLICABLE_ROLES}
    return build_h2_uccsd_scientific_identity(
        semantic_keys=H2_UCCSD_SEMANTIC_KEYS,
        specs=typed,
        hamiltonian_digest_sha256=HAMILTONIAN_DIGEST,
    ).model_dump(mode="json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    components = build_components()
    outputs = {
        OUTPUT_PATH: _canonical_bytes(components),
        IDENTITY_PATH: _canonical_bytes(build_identity(components)),
    }
    if args.check:
        stale = [
            str(path.relative_to(ROOT))
            for path, payload in outputs.items()
            if not path.exists() or path.read_bytes() != payload
        ]
        if stale:
            raise SystemExit("stale generated H2 UCCSD fixtures: " + ", ".join(stale))
        print("H2 UCCSD executable fixtures are current")
        return
    for path, payload in outputs.items():
        path.write_bytes(payload)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
