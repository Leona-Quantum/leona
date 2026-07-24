"""Role gates on the VQE registry repos fail CLOSED before any statement is
issued, mirroring test_repo_roles.py's pattern for the rest of the repo layer."""

import uuid

import pytest
from repo_test_helpers import make_scope
from majorana_contracts.enums import Role
from majorana_vqe.models import AnnotationState, ComponentType, ExecutionStatus, Framework

from majorana_api.repos import AuthzError, vqe

VIEWER_BLOCKED_WRITES = [
    lambda s, db: vqe.create_component_spec(
        s,
        db,
        artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        component_type=ComponentType.ANSATZ,
        annotation_state=AnnotationState.DRAFT,
    ),
    lambda s, db: vqe.create_workflow_component(
        s,
        db,
        workflow_artifact_version_id=uuid.uuid4(),
        component_role="ansatz",
        component_artifact_version_id=uuid.uuid4(),
        ordinal=0,
    ),
    lambda s, db: vqe.create_experiment(
        s,
        db,
        workflow_artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        scientific_spec_json={},
        scientific_spec_sha256="a" * 64,
        protocol_version="0.1.0",
    ),
    lambda s, db: vqe.append_observation(
        s,
        db,
        uuid.uuid4(),
        attempt=1,
        framework=Framework.QISKIT,
        runtime_profile_id="qiskit-current-v1",
        runtime_image_digest="sha256:" + "0" * 64,
        adapter_release_id="adapter1",
        architecture="arm64",
        protocol_version="0.1.0",
        scientific_spec_sha256="a" * 64,
        status=ExecutionStatus.SUCCEEDED,
    ),
]


@pytest.mark.parametrize("call", VIEWER_BLOCKED_WRITES)
async def test_viewer_cannot_write(call, session):
    with pytest.raises(AuthzError):
        await call(make_scope(Role.VIEWER), session)
    assert session.statements == [] and session.added == []  # failed closed
