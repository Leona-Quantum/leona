"""Plan Part IV Phase 1 Tests: invalid/unknown field rejection, arbitrary
path/module/code rejection, component ArtifactVersion reference validation."""

from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_vqe.models import (
    Capability,
    ComponentReference,
    ComponentSpec,
    ComponentType,
    ExecutionBinding,
    ExecutionRequest,
    ExecutionStatus,
    FailureCode,
    Framework,
    ResultContract,
    ScientificExperimentSpec,
    WorkflowComponentRef,
    WorkflowSpec,
)


def _spec_kwargs(**overrides):
    kwargs = dict(
        problem_version_id=uuid4(),
        representation_version_id=uuid4(),
        reference_state_version_id=uuid4(),
        ansatz_version_id=uuid4(),
        operator_pool_version_id=uuid4(),
        selection_version_id=uuid4(),
        growth_version_id=uuid4(),
        optimizer_version_id=uuid4(),
        compression_version_id=uuid4(),
        measurement_protocol_version_id=uuid4(),
        evaluation_protocol_version_id=uuid4(),
        seed=0,
        stopping_protocol_version_id=uuid4(),
    )
    kwargs.update(overrides)
    return kwargs


class TestUnknownFieldRejection:
    def test_component_spec_rejects_unknown_field(self):
        with pytest.raises(ValidationError):
            ComponentSpec(
                artifact_version_id=uuid4(),
                component_type=ComponentType.ANSATZ,
                this_field_does_not_exist="anything",
            )

    def test_scientific_experiment_spec_rejects_unknown_field(self):
        with pytest.raises(ValidationError):
            ScientificExperimentSpec(**_spec_kwargs(unknown_extra_field=1))

    def test_execution_binding_rejects_unknown_field(self):
        with pytest.raises(ValidationError):
            ExecutionBinding(
                framework=Framework.QISKIT,
                runtime_profile_id="qiskit-current-v1",
                adapter_release_id="adapter-2026-07-24",
                container_digest="sha256:" + "0" * 64,
                architecture="arm64",
                protocol_version="0.1.0",
                mystery_field="nope",
            )

    def test_result_contract_rejects_unknown_field(self):
        with pytest.raises(ValidationError):
            ResultContract(
                scientific_spec_sha256="0" * 64,
                framework=Framework.QISKIT,
                runtime_profile_id="qiskit-current-v1",
                runtime_image_digest="sha256:" + "0" * 64,
                adapter_release_id="adapter-2026-07-24",
                protocol_version="0.1.0",
                hamiltonian_digest="0" * 64,
                status=ExecutionStatus.SUCCEEDED,
                seed=0,
                surprise_field=True,
            )


class TestModelsAreImmutable:
    def test_component_spec_is_frozen(self):
        spec = ComponentSpec(artifact_version_id=uuid4(), component_type=ComponentType.ANSATZ)
        with pytest.raises(ValidationError):
            spec.component_type = ComponentType.PARAMETER_OPTIMIZER


class TestArbitraryPathModuleOrCodeRejection:
    @pytest.mark.parametrize(
        "malicious_value",
        [
            "/etc/passwd",
            "../../etc/shadow",
            "~/secrets.env",
            "C:\\Windows\\System32\\config",
            "os.system('rm -rf /')",
            "subprocess.run(['ls'])",
            "__import__('os').system('id')",
            "import os; os.system('id')",
            "eval('1+1')",
            "exec(compile('x', '<s>', 'exec'))",
            "payload.py",
            "malicious.dylib",
        ],
    )
    def test_component_spec_json_rejects_malicious_string_values(self, malicious_value):
        with pytest.raises(ValidationError):
            ComponentSpec(
                artifact_version_id=uuid4(),
                component_type=ComponentType.ANSATZ,
                spec_json={"note": malicious_value},
            )

    @pytest.mark.parametrize("malicious_key", ["../escape", "__class__", "os.system"])
    def test_component_spec_json_rejects_malicious_keys(self, malicious_key):
        with pytest.raises(ValidationError):
            ComponentSpec(
                artifact_version_id=uuid4(),
                component_type=ComponentType.ANSATZ,
                spec_json={malicious_key: "value"},
            )

    def test_component_spec_json_rejects_malicious_value_nested_in_list(self):
        with pytest.raises(ValidationError):
            ComponentSpec(
                artifact_version_id=uuid4(),
                component_type=ComponentType.ANSATZ,
                spec_json={"notes": ["fine", "../../etc/passwd"]},
            )

    def test_component_spec_json_accepts_plain_labels_and_numbers(self):
        spec = ComponentSpec(
            artifact_version_id=uuid4(),
            component_type=ComponentType.ANSATZ,
            spec_json={
                "family": "UCCSD",
                "excitation_order": 2,
                "notes": ["singlet reference", "spin-adapted"],
                "reps": 1,
                "nested": {"tolerance_ha": 1e-5},
            },
        )
        assert spec.spec_json["family"] == "UCCSD"

    def test_component_spec_json_accepts_a_real_doi_and_arxiv_id(self):
        """Regression test: a naive path-rejection allowlist would also
        reject legitimate identifiers containing "/", like DOIs. This must
        keep passing -- if it starts failing, the schema is too strict for
        real literature annotation (Phase 2)."""
        spec = ComponentSpec(
            artifact_version_id=uuid4(),
            component_type=ComponentType.PROBLEM,
            spec_json={
                "source_paper_doi": "10.1038/ncomms5213",
                "source_paper_arxiv_id": "1304.3061",
            },
        )
        assert spec.spec_json["source_paper_doi"] == "10.1038/ncomms5213"

    def test_workflow_component_ref_rejects_path_like_role(self):
        with pytest.raises(ValidationError):
            WorkflowComponentRef(
                component_role="../ansatz",
                component_artifact_version_id=uuid4(),
                ordinal=0,
            )

    def test_scientific_experiment_spec_rejects_path_like_dataset_snapshot_id(self):
        with pytest.raises(ValidationError):
            ScientificExperimentSpec(**_spec_kwargs(dataset_snapshot_id="/var/data/snapshot"))

    def test_execution_binding_rejects_code_like_runtime_profile_id(self):
        with pytest.raises(ValidationError):
            ExecutionBinding(
                framework=Framework.QISKIT,
                runtime_profile_id="__import__('os')",
                adapter_release_id="adapter-2026-07-24",
                container_digest="sha256:" + "0" * 64,
                architecture="arm64",
                protocol_version="0.1.0",
            )


class TestComponentArtifactVersionReferenceValidation:
    def test_component_reference_requires_a_real_uuid(self):
        with pytest.raises(ValidationError):
            ComponentReference(
                artifact_version_id="not-a-uuid", component_type=ComponentType.ANSATZ
            )

    def test_component_reference_accepts_a_real_uuid(self):
        ref_id = uuid4()
        ref = ComponentReference(artifact_version_id=ref_id, component_type=ComponentType.ANSATZ)
        assert ref.artifact_version_id == ref_id

    def test_scientific_experiment_spec_requires_uuids_for_every_component_version_id(self):
        with pytest.raises(ValidationError):
            ScientificExperimentSpec(**_spec_kwargs(ansatz_version_id="uccsd"))

    def test_workflow_spec_rejects_duplicate_role_ordinal(self):
        dup = WorkflowComponentRef(
            component_role="ansatz", component_artifact_version_id=uuid4(), ordinal=0
        )
        with pytest.raises(ValidationError):
            WorkflowSpec(workflow_artifact_version_id=uuid4(), components=[dup, dup])


class TestExecutionRequestCapabilityAllowlist:
    def test_rejects_unknown_capability_string(self):
        with pytest.raises(ValidationError):
            ExecutionRequest(experiment_id=uuid4(), requested_capability="arbitrary_capability")

    def test_accepts_allowlisted_capability(self):
        req = ExecutionRequest(
            experiment_id=uuid4(), requested_capability=Capability.H2_STO3G_EXACT_ENERGY
        )
        assert req.preferred_framework is None


class TestResultContractStatusConsistency:
    def _base_kwargs(self, **overrides):
        kwargs = dict(
            scientific_spec_sha256="0" * 64,
            framework=Framework.QISKIT,
            runtime_profile_id="qiskit-current-v1",
            runtime_image_digest="sha256:" + "0" * 64,
            adapter_release_id="adapter-2026-07-24",
            protocol_version="0.1.0",
            seed=0,
        )
        kwargs.update(overrides)
        return kwargs

    def test_failed_status_requires_failure_code(self):
        with pytest.raises(ValidationError):
            ResultContract(**self._base_kwargs(status=ExecutionStatus.FAILED))

    def test_succeeded_status_forbids_failure_code(self):
        with pytest.raises(ValidationError):
            ResultContract(
                **self._base_kwargs(
                    status=ExecutionStatus.SUCCEEDED,
                    failure_code=FailureCode.EXECUTION_FAILED,
                    hamiltonian_digest="0" * 64,
                )
            )

    def test_succeeded_status_requires_hamiltonian_digest(self):
        with pytest.raises(ValidationError):
            ResultContract(**self._base_kwargs(status=ExecutionStatus.SUCCEEDED))

    def test_valid_succeeded_result_contract(self):
        result = ResultContract(
            **self._base_kwargs(status=ExecutionStatus.SUCCEEDED, hamiltonian_digest="a" * 64)
        )
        assert result.status is ExecutionStatus.SUCCEEDED

    def test_valid_failed_result_contract(self):
        result = ResultContract(
            **self._base_kwargs(
                status=ExecutionStatus.FAILED, failure_code=FailureCode.RUNTIME_TIMEOUT
            )
        )
        assert result.failure_code is FailureCode.RUNTIME_TIMEOUT

    def test_mutually_exclusive_trajectory_fields(self):
        from majorana_vqe.models import TrajectoryOverflowRef

        with pytest.raises(ValidationError):
            ResultContract(
                **self._base_kwargs(
                    status=ExecutionStatus.SUCCEEDED,
                    hamiltonian_digest="a" * 64,
                    energy_trajectory=[1.0, 2.0],
                    energy_trajectory_overflow=TrajectoryOverflowRef(
                        object_uri="s3://bucket/key", sha256="b" * 64, size_bytes=100
                    ),
                )
            )
