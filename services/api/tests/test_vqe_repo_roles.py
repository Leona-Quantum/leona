"""Role gates on the VQE registry repos fail CLOSED before any statement is
issued, mirroring test_repo_roles.py's pattern for the rest of the repo layer."""

import uuid

import pytest
from repo_test_helpers import make_scope
from majorana_contracts.enums import Role
from majorana_vqe.models import ComponentType

from majorana_api.repos import AuthzError, vqe

VIEWER_BLOCKED_WRITES = [
    lambda s, db: vqe.create_component_spec(
        s,
        db,
        artifact_version_id=uuid.uuid4(),
        schema_version="0.1.0",
        component_type=ComponentType.ANSATZ,
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
        resolved=object(),
    ),
    lambda s, db: vqe.append_observation(
        s,
        db,
        uuid.uuid4(),
        attempt=1,
        evidence={},
    ),
]


@pytest.mark.parametrize("call", VIEWER_BLOCKED_WRITES)
async def test_viewer_cannot_write(call, session):
    with pytest.raises(AuthzError):
        await call(make_scope(Role.VIEWER), session)
    assert session.statements == [] and session.added == []  # failed closed
