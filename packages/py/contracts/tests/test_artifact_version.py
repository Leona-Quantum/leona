from datetime import datetime, timezone
from uuid import uuid4

import pytest
from majorana_contracts.models import ArtifactVersion
from pydantic import ValidationError


def _payload(**updates):
    payload = {
        "id": uuid4(),
        "artifact_id": uuid4(),
        "seq": 1,
        "qasm_version": "3.0",
        "qasm": "OPENQASM 3.0;",
        "code": "print('ok')",
        "code_lang": "python",
        "fingerprint": "digest",
        "export_status": "lossless",
        "created_at": datetime.now(timezone.utc),
    }
    payload.update(updates)
    return payload


def test_artifact_version_requires_canonical_version_with_qasm():
    version = ArtifactVersion.model_validate(_payload())
    assert version.qasm_version == "3.0"

    with pytest.raises(ValidationError):
        ArtifactVersion.model_validate(_payload(qasm_version=None))


def test_artifact_version_rejects_version_without_qasm():
    with pytest.raises(ValidationError):
        ArtifactVersion.model_validate(_payload(qasm=None))

    version = ArtifactVersion.model_validate(_payload(qasm=None, qasm_version=None))
    assert version.qasm is None
    assert version.qasm_version is None
