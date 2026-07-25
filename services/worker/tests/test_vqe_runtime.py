import json
from pathlib import Path

import pytest

from majorana_api.vqe_runtime_profiles import candidate_runtime_profile
from majorana_vqe.models import Framework
from majorana_worker.vqe_runtime import (
    VqeRuntimeError,
    build_success_evidence,
)

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw"


@pytest.mark.parametrize(
    ("framework", "filename"),
    [
        (Framework.QISKIT, "qiskit_vqe_v0.2.json"),
        (Framework.PENNYLANE, "pennylane_vqe_v0.2.json"),
    ],
)
def test_raw_runtime_report_translates_to_complete_evidence(framework, filename):
    profile = candidate_runtime_profile(framework)
    report = json.loads((RAW / filename).read_text())

    evidence = build_success_evidence(
        report,
        binding=profile.binding,
        scientific_spec_sha256="1" * 64,
        registry_resolution_sha256="2" * 64,
        ansatz_semantic_digest="3" * 64,
        seed=0,
    )

    assert evidence.framework is framework
    assert evidence.absolute_error_ha <= 1e-10
    assert evidence.canonical_circuit_sha256 == (
        "a95f4a8e8749e361c85df00b9bf42d9cea407a048840bc8e58f7e5c9920be3b1"
    )
    assert [resource.stage for resource in evidence.resources] == [
        "canonical_logical",
        "common_basis_compiled",
        "provider_native_diagnostic",
    ]
    common = evidence.resources[1]
    assert (common.two_qubit_gate_count, common.depth, common.gate_count) == (
        48,
        83,
        152,
    )


def test_runtime_report_rejects_framework_drift():
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())
    report["framework"] = "pennylane"

    with pytest.raises(VqeRuntimeError, match="framework"):
        build_success_evidence(
            report,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
        )


def test_runtime_report_rejects_numerical_gate_regression():
    profile = candidate_runtime_profile(Framework.QISKIT)
    report = json.loads((RAW / "qiskit_vqe_v0.2.json").read_text())
    report["optimization"]["best_energy_ha"] = report["optimization"]["exact_energy_ha"] + 1e-3
    report["optimization"]["absolute_error_ha"] = 1e-3

    with pytest.raises(VqeRuntimeError, match="numerical gate"):
        build_success_evidence(
            report,
            binding=profile.binding,
            scientific_spec_sha256="1" * 64,
            registry_resolution_sha256="2" * 64,
            ansatz_semantic_digest="3" * 64,
            seed=0,
        )
