from __future__ import annotations

import pytest
from pydantic import ValidationError

from majorana_vqe.result import (
    EXECUTION_EVIDENCE_ADAPTER,
    OptimizerWork,
    ParameterValue,
    ResourceObservation,
    VqeOptimizationSuccessResult,
)


def _vqe_success(**updates):
    values = {
        "scientific_spec_sha256": "1" * 64,
        "registry_resolution_sha256": "2" * 64,
        "framework": "qiskit",
        "runtime_profile_id": "qiskit-1.4.6-py312-linux-x86_64",
        "runtime_image_digest": "sha256:" + "3" * 64,
        "adapter_release_id": "majorana-vqe-qiskit-adapter-0.1.0",
        "provider_versions": {"qiskit": "1.4.6"},
        "hamiltonian_exact_digest": "4" * 64,
        "seed": 0,
        "status": "succeeded",
        "capability": "h2_sto3g_actual_vqe_v1",
        "best_energy_ha": -1.1373060357534,
        "reference_energy_ha": -1.1373060357534,
        "absolute_error_ha": 0.0,
        "final_state_fidelity": 1.0,
        "converged": True,
        "optimizer_work": OptimizerWork(
            iterations=13,
            energy_evaluations=13,
            gradient_evaluations=0,
            hessian_evaluations=0,
        ),
        "initial_parameters": [ParameterValue(slot_id="theta.0", float64_hex="0000000000000000")],
        "final_parameters": [ParameterValue(slot_id="theta.0", float64_hex="bfcc9d4f00000000")],
        "initial_parameters_sha256": "5" * 64,
        "final_parameters_sha256": "6" * 64,
        "ansatz_semantic_digest": "7" * 64,
        "energy_trajectory": [-1.0, -1.1373060357534],
        "resources": [
            ResourceObservation(
                stage="logical",
                metric_protocol_sha256="8" * 64,
                qubits=4,
                parameter_count=1,
            )
        ],
    }
    values.update(updates)
    return VqeOptimizationSuccessResult(**values)


def test_vqe_success_requires_energy_trajectory():
    with pytest.raises(ValidationError, match="energy trajectory"):
        _vqe_success(energy_trajectory=None)


def test_vqe_success_requires_matching_parameter_slots():
    with pytest.raises(ValidationError, match="slot order"):
        _vqe_success(
            final_parameters=[ParameterValue(slot_id="theta.other", float64_hex="bfcc9d4f00000000")]
        )


def test_vqe_success_requires_logical_resource_metrics():
    with pytest.raises(ValidationError, match="logical resource"):
        _vqe_success(
            resources=[
                ResourceObservation(
                    stage="compiled",
                    metric_protocol_sha256="8" * 64,
                    qubits=4,
                    parameter_count=1,
                )
            ]
        )


def test_execution_evidence_union_rejects_energyless_success():
    with pytest.raises(ValidationError):
        EXECUTION_EVIDENCE_ADAPTER.validate_python(
            {
                "result_kind": "vqe_optimization_success",
                "status": "succeeded",
                "scientific_spec_sha256": "1" * 64,
            }
        )


def test_complete_vqe_success_is_accepted():
    result = _vqe_success()
    assert result.converged
    assert result.best_energy_ha == result.reference_energy_ha
